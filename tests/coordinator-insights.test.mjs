import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeIncidentDataset,INCIDENT_COORDINATORS} from '../lib/incidents.mjs';
import {coordinatorAdvice,coordinationChecks} from '../lib/coordinator-insights.mjs';
const now=Date.parse('2026-11-21T08:00:00Z');
const base={id:'INC1',status:'working',priority:'medium',team:'Профильная команда',assignee:'Дежурный',dueAt:now+3600000};
test('Missing deadline is a data gap, while research never acquires an active SLA violation',()=>{
  const unknown=coordinatorAdvice({...base,dueAt:null},now);
  assert.equal(unknown.overdue,false);assert.equal(unknown.checks[0].code,'deadline');assert.match(unknown.reason,/определить нельзя/);
  for(const dueAt of [null,now-1000]){
    const research=coordinatorAdvice({...base,status:'investigating',dueAt},now);
    assert.equal(research.overdue,false);assert.equal(research.soon,false);assert.deepEqual(research.checks.map(c=>c.code),['research']);
  }
});
test('Coordinator research combines follow-up and routing without inventing an owner',()=>{
  const advice=coordinatorAdvice({...base,status:'investigating',team:INCIDENT_COORDINATORS,dueAt:null},now);
  assert.deepEqual(advice.checks.map(c=>c.code),['routing','research']);assert.match(advice.action,/материалы исследования/);assert.match(advice.reason,/восстановлен/);assert.equal(advice.mode,'rules');
});
test('Closed and resolved cards with missing fields do not enter the checks queue',()=>{
  for(const status of ['resolved','closed'])assert.deepEqual(coordinationChecks([{...base,status,team:'',assignee:'',dueAt:null}],now),[]);
});
test('Next step follows exact deadline boundaries and critical priority',()=>{
  assert.equal(coordinatorAdvice({...base,dueAt:now-1},now).overdue,true);
  for(const dueAt of [now,now+15*60000])assert.equal(coordinatorAdvice({...base,dueAt},now).soon,true);
  assert.equal(coordinatorAdvice({...base,dueAt:now+15*60000+1},now).soon,false);
  const critical=coordinatorAdvice({...base,priority:'critical',dueAt:null},now);assert.match(critical.action,/ближайшее обновление/);assert.match(critical.reason,/уточнить срок/);
});
test('Missing team and assignee have separate reasons; all checks preserve exact IDs',()=>{
  const i={...base,id:'INC000000000000000000001',team:'Команда не назначена',assignee:'Исполнитель не назначен',dueAt:null};
  const advice=coordinatorAdvice(i,now);assert.deepEqual(advice.checks.map(c=>c.code),['team','assignee','deadline']);assert.match(advice.action,/владельца сервиса/);assert.equal(coordinationChecks([i],now)[0].incident.id,i.id);
});
test('Checks are deterministic, unique by source card and leave the actual export unchanged',()=>{
  const items=normalizeIncidentDataset(JSON.parse(readFileSync(new URL('../data/incidents.json',import.meta.url)))).incidents;
  const original=JSON.stringify(items),checks=coordinationChecks(items,now);
  assert.equal(new Set(checks.map(x=>x.incident.id)).size,checks.length);
  assert.ok(checks.some(x=>x.incident.team===INCIDENT_COORDINATORS));assert.ok(checks.some(x=>x.incident.status==='investigating'));
  assert.deepEqual(coordinationChecks(items,now),checks);assert.equal(JSON.stringify(items),original);
  assert.deepEqual(coordinationChecks([],now),[]);
});
