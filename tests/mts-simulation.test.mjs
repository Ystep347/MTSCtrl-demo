import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {makeMtsSimulationRaw,projectMtsSimulation,mtsSimulationEvent} from '../lib/mts-simulation.mjs';
import {normalizeIncidentDataset,incidentGroups} from '../lib/incidents.mjs';
import {buildYandexContext} from '../lib/yandex.mjs';
import worker from '../worker/index.js';
const raw=JSON.parse(readFileSync(new URL('../data/incidents.json',import.meta.url)));
const normalized=normalizeIncidentDataset(raw);

test('Telecom simulation replaces all fictional products and faults while preserving every business attribute and performer',()=>{
  const original=structuredClone(raw),simulated=makeMtsSimulationRaw(raw);
  const replaceable=new Set(['productName','header','service','scenarioName','shortDescription','description','solution','productUrl']);
  assert.equal(simulated.length,44);
  for(const [index,item] of simulated.entries()){
    assert.deepEqual(Object.keys(item),Object.keys(raw[index]));
    for(const key of Object.keys(item))if(!replaceable.has(key))assert.deepEqual(item[key],raw[index][key],key);
    assert.notEqual(item.productName,raw[index].productName);assert.notEqual(item.header,raw[index].header);
    assert.match(item.description,/^Симуляция:/);assert.match(item.productName,/МТС/);
  }
  assert.deepEqual(raw,original);assert.deepEqual(normalizeIncidentDataset(simulated).meta.groups,normalized.meta.groups);
});
test('Projected cards preserve IDs, performers, times, priorities and all overlapping group memberships',()=>{
  const base=structuredClone(normalized),view=projectMtsSimulation(normalized);
  assert.equal(view.simulation.enabled,true);assert.equal(view.meta.total,44);assert.equal(view.meta.products,5);
  for(const [index,item] of view.incidents.entries()){
    const source=normalized.incidents[index];
    for(const key of ['id','sysId','assignee','team','createdAt','dueAt','resolvedAt','status','priority'])assert.equal(item[key],source[key]);
    assert.deepEqual(incidentGroups(item),incidentGroups(source));assert.equal(item.isSimulated,true);
    assert.equal(item.itsmUrl,null);assert.equal(item.demoItsmUrl,'/itsm-demo?incident='+encodeURIComponent(item.id));
    assert.notEqual(item.description,source.description);
  }
  assert.deepEqual(normalized,base);
});
test('Simulation does not hide changed deadlines, recovery or investigation at coordinators',()=>{
  const dataset=structuredClone(normalized);let item=dataset.incidents[0];item.priority='critical';item.status='working';item.team='КЦ ИТ Координаторы Массовых Инцидентов';item.dueAt=Date.now()+10000;
  assert.deepEqual(incidentGroups(projectMtsSimulation(dataset).incidents[0]),['critical','coord']);
  item.status='investigating';item.dueAt=null;
  const updated=projectMtsSimulation(dataset).incidents[0];assert.deepEqual(incidentGroups(updated),['coord','research']);assert.equal(updated.dueAt,null);
});
test('Simulation journal describes the telecom context without modifying audit IDs or original data',()=>{
  const event={seq:8,id:'event8',incidentId:raw[0].id,type:'critical',detail:'Автопросматриватель TicTok',changes:[{label:'Продукт',before:'Автопросматриватель TicTok',after:'Акваланг для муравьев'}]};
  const projected=mtsSimulationEvent(event);assert.equal(projected.seq,8);assert.equal(projected.incidentId,event.incidentId);assert.match(projected.detail,/Личный кабинет МТС/);assert.equal(event.detail,'Автопросматриватель TicTok');
});
test('Model context and rule answers explicitly label simulated incidents',async()=>{
  const snapshot={...projectMtsSimulation(normalized),simulation:true};
  const context=buildYandexContext({snapshot,question:'Что происходит?'});assert.equal(context.simulation,true);assert.match(context.dataProvenance,/Вымышленные/);
  const response=await worker.fetch(new Request('https://site.test/api/assistant/chat',{method:'POST',headers:{'content-type':'application/json','oai-authenticated-user-id':'sim-user','oai-authenticated-user-email':'sim@example.test'},body:JSON.stringify({question:'Что происходит?',contextMode:'client_demo',snapshot:{...snapshot,simulation:true}})}));
  assert.equal(response.status,200);const data=await response.json();assert.equal(data.provider,'rules');assert.match(data.answer,/^Учебная симуляция МТС/);
});
