import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import worker,{loadIncidentData,localAnswer} from '../worker/index.js';
import {normalizeIncidentDataset,incidentGroups,isActiveIncident,incidentChanges,exportBoolean} from '../lib/incidents.mjs';
const raw=JSON.parse(readFileSync(new URL('../data/incidents.json',import.meta.url),'utf8'));
const dictionary=JSON.parse(readFileSync(new URL('../data/attributes.json',import.meta.url),'utf8'));
const dataset=()=>normalizeIncidentDataset(structuredClone(raw),dictionary);
const api=(headers={})=>new Request('https://site.test/api/incidents',{headers});

test('The actual 44-record export produces all four groups and preserves other records',()=>{
  const {incidents,meta}=dataset();
  assert.equal(incidents.length,44);assert.equal(meta.exportFields,46);assert.equal(meta.dictionaryFields,30);
  assert.deepEqual(meta.groups,{critical:0,coord:2,high:1,research:5});
  assert.equal(meta.active,24);assert.equal(meta.finished,15);assert.equal(meta.focus,8);
  assert.equal(meta.products,5);assert.equal(meta.teams,22);
});
test('Export enums disambiguate reversed terminal status codes and undocumented research',()=>{
  const {incidents,meta}=dataset();
  assert.equal(incidents.filter(i=>i.status==='resolved'&&i.sourceStateId===7).length,10);
  assert.equal(incidents.filter(i=>i.status==='closed'&&i.sourceStateId===10).length,5);
  assert.equal(incidents.filter(i=>i.status==='investigating'&&i.sourceStateId===20).length,5);
  assert.equal(meta.warnings.find(w=>w.code==='dictionary_state_conflict').count,15);
  assert.equal(meta.warnings.find(w=>w.code==='undocumented_research').count,5);
  assert.ok(incidents.filter(i=>['resolved','closed'].includes(i.status)).every(i=>!isActiveIncident(i)&&incidentGroups(i).length===0));
});
test('Long external identifiers remain exact strings, and low priority is retained',()=>{
  const {incidents}=dataset();
  assert.equal(incidents[0].id,'INC000021931151');assert.equal(incidents[0].sysId,'179413934903718013');
  assert.equal(incidents.filter(i=>i.priority==='low').length,16);
  assert.equal(incidents[0].createdAt,Date.parse('2026-11-08T12:02:29Z'));
});
test('Null research deadlines remain null and never become an active SLA breach',()=>{
  const {incidents}=dataset(),now=Date.parse('2026-11-20T15:00:00Z');
  assert.equal(incidents.filter(i=>i.dueAt===null).length,3);
  const response=localAnswer('Сводка по всем инцидентам',{incidents},[],now);
  assert.match(response,/Активных: 24/);assert.match(response,/Просроченных: 13/);
  const missing=incidents.find(i=>i.dueAt===null);
  const changed={...missing,status:'assigned'};
  assert.match(localAnswer(`Какой срок у ${changed.id}?`,{incidents:[changed]},[],now),/не указан/);
});
test('An active solution field does not close an incident and false flags are preserved',()=>{
  const {incidents}=dataset();
  assert.ok(raw[0].solution);assert.equal(incidents[0].solution,'');assert.equal(incidents[0].status,'assigned');
  assert.equal(incidents[0].needsFollowUp,null);assert.equal(exportBoolean('Нет'),false);
  assert.equal(exportBoolean('false'),false);assert.equal(exportBoolean('Да'),true);
  assert.ok(incidents.every(i=>i.itsmUrl===null));
});
test('Duplicates, unknown priorities, ambiguous statuses and unzoned dates fail explicitly',()=>{
  const item=structuredClone(raw[0]);
  assert.throws(()=>normalizeIncidentDataset([item,item]),/Повторяющийся/);
  assert.throws(()=>normalizeIncidentDataset([{...item,priorityId:99}]),/priorityId/);
  assert.throws(()=>normalizeIncidentDataset([{...item,stateEnum:null,state:null,stateId:7}]),/неоднозначный/);
  assert.throws(()=>normalizeIncidentDataset([{...item,stateEnum:'constructor',state:'???',stateId:7}]),/неоднозначный/);
  assert.throws(()=>normalizeIncidentDataset([{...item,priorityId:'constructor'}]),/priorityId/);
  assert.throws(()=>normalizeIncidentDataset([{...item,submitDate:'2026-11-08 12:02:29'}]),/часовой пояс/);
});
test('A coordinator research item can be in two groups, without being active',()=>{
  const item={...dataset().incidents.find(i=>i.status==='investigating'),team:raw[0].assignedGroupName};
  assert.deepEqual(incidentGroups(item),['coord','research']);assert.equal(isActiveIncident(item),false);
});
test('JSON changes detect new critical, assignment, completion and changed deadlines',()=>{
  const before=dataset().incidents,after=structuredClone(before);
  after.push({...after[0],id:'INC000099999999',priority:'critical'});
  after[1].team=raw[0].assignedGroupName;after[2].status='resolved';after[3].dueAt+=60000;
  const changes=incidentChanges(before,after);
  assert.ok(changes.some(c=>c.type==='critical'&&c.incidentId==='INC000099999999'));
  assert.ok(changes.some(c=>c.type==='coord'&&c.incidentId===after[1].id));
  assert.ok(changes.some(c=>c.type==='success'&&c.incidentId===after[2].id));
  assert.ok(changes.some(c=>c.title==='Срок решения изменён'&&c.incidentId===after[3].id));
  assert.deepEqual(incidentChanges(before,[...before].reverse()),[]);
});
test('Removing a record is not treated as a resolved incident',()=>{
  const before=dataset().incidents,changes=incidentChanges(before,before.slice(1));
  assert.equal(changes.length,1);assert.equal(changes[0].type,'changed');
  assert.match(changes[0].detail,/не означает/);
});
test('The data API returns a shared snapshot, supports conditional reads and rejects writes',async()=>{
  const env={INCIDENTS_JSON:JSON.stringify(raw)};
  const response=await worker.fetch(api(),env),body=await response.json();
  assert.equal(response.status,200);assert.equal(body.source,'file');assert.equal(body.meta.total,44);
  assert.equal(body.pollIntervalMs,5000);assert.equal(body.incidents[42].dueAt,null);
  const unchanged=await worker.fetch(api({'If-None-Match':response.headers.get('etag')}),env);
  assert.equal(unchanged.status,304);
  assert.equal((await worker.fetch(new Request('https://site.test/api/incidents',{method:'POST'}),env)).status,405);
  assert.equal((await worker.fetch(api(),{INCIDENTS_JSON:'broken'})).status,503);
});
test('A common JSON source is reread and its revision changes after a file update',async()=>{
  const original=globalThis.fetch;let calls=0,current=structuredClone(raw);
  globalThis.fetch=async()=>{calls++;return Response.json(current);};
  try{
    const env={INCIDENTS_SOURCE_URL:'https://source.example/incidents.json'};
    const first=await loadIncidentData(env);current[0].priorityId=4;
    const second=await loadIncidentData(env);
    assert.equal(calls,2);assert.notEqual(first.revision,second.revision);
    assert.equal(second.meta.groups.critical,1);assert.equal(second.source,'remote');
  }finally{globalThis.fetch=original;}
});
test('Assistant accepts the complete export, long IDs, closed states, low priorities and null deadlines',async()=>{
  const {incidents}=dataset();
  const response=await worker.fetch(new Request('https://site.test/api/assistant/chat',{method:'POST',headers:{'Content-Type':'application/json','oai-authenticated-user-id':'full-export-test','oai-authenticated-user-email':'test@example.test'},body:JSON.stringify({question:'Кто решает INC000021931151?',contextMode:'client_demo',snapshot:{incidents}})}));
  const data=await response.json();assert.equal(response.status,200);assert.equal(data.mode,'local');
  const assignee=raw.find(item=>item.id==='INC000021931151').assignedEmployee;
  assert.ok(data.answer.includes(assignee));assert.deepEqual(data.references,['INC000021931151']);
  assert.match(localAnswer('Кому передать INC000021931151?',{incidents}),/нет справочника владельцев/);
  assert.doesNotMatch(localAnswer('Почему инциденты в нескольких группах?',{incidents}),/INC-2051/);
});
