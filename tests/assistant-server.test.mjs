import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import worker,{assistantInput} from '../worker/index.js';
import {createLocalDatabase} from '../scripts/local-database.mjs';
import {ensureSharedData,importSharedDataset} from '../lib/shared-data.mjs';
const raw=JSON.parse(readFileSync(new URL('../data/incidents.json',import.meta.url)));
let counter=0;
function request(body){return new Request('https://site.test/api/assistant/chat',{method:'POST',headers:{'content-type':'application/json',origin:'https://site.test','oai-authenticated-user-id':'server-context-'+(++counter),'oai-authenticated-user-email':'test@example.test'},body:JSON.stringify(body)});}

test('Normal assistant answers use the current server dataset and include its exact revision',async()=>{
  const env={INCIDENTS_JSON:raw},id=raw[0].id;
  const data=await (await worker.fetch(request({question:'Кто решает '+id+'?',context:{selectedId:id}}),env)).json();
  const snapshot=await (await worker.fetch(new Request('https://site.test/api/incidents'),env)).json();
  assert.equal(data.context.mode,'server');assert.equal(data.context.revision,snapshot.revision);assert.equal(data.context.total,44);assert.match(data.answer,new RegExp(raw[0].assignedEmployee.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
});
test('A forged browser snapshot cannot supply facts for a normal model request',async()=>{
  const response=await worker.fetch(request({question:'Сводка',snapshot:{incidents:[],simulation:false}}),{INCIDENTS_JSON:raw});
  assert.equal(response.status,400);assert.match((await response.json()).error,/на сервере/);
});
test('Telecom simulation is projected on the server with source IDs, performers and deadlines intact',async()=>{
  const prepared=await assistantInput({question:'Сводка',context:{view:'mts-demo',selectedId:raw[0].id}},{INCIDENTS_JSON:raw});
  assert.equal(prepared.context.mode,'server');assert.equal(prepared.context.simulation,true);assert.equal(prepared.context.total,44);
  const first=prepared.input.snapshot.incidents[0];assert.equal(first.id,raw[0].id);assert.equal(first.assignee,raw[0].assignedEmployee);assert.equal(first.dueAt,Date.parse(raw[0].deadline));assert.equal(first.product,'Личный кабинет МТС');assert.match(first.description,/Симуляция:/);
});
test('Imported shared changes are used by the assistant even when the browser sends no updated records',async()=>{
  const DB=createLocalDatabase();
  try{
    const state=await ensureSharedData(DB,raw),changed=structuredClone(raw);changed[0].assignedEmployee='Дежурный из общей базы';
    const imported=await importSharedDataset(DB,changed,state.revision,{userId:'test-editor',email:'editor@example.test',displayName:'Редактор'});
    const response=await worker.fetch(request({question:'Кто решает '+raw[0].id+'?',context:{selectedId:raw[0].id}}),{DB});
    assert.equal(response.status,200);const data=await response.json();assert.match(data.answer,/Дежурный из общей базы/);assert.equal(data.context.revision,imported.revision);assert.equal(data.context.version,2);
  }finally{DB.close();}
});
test('Explicit local demos are clearly labelled and never call the model even with configured keys',async()=>{
  const {input}=await assistantInput({question:'Сводка'},{INCIDENTS_JSON:raw});
  const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('must not call provider');};
  try{
    const response=await worker.fetch(request({question:'Сводка',contextMode:'client_demo',snapshot:input.snapshot}),{YANDEX_API_KEY:'private-test-key',YANDEX_FOLDER_ID:'test-folder'});
    assert.equal(response.status,200);const data=await response.json();assert.equal(data.provider,'rules');assert.equal(data.context.mode,'client_demo');assert.equal(data.context.revision,null);assert.match(data.warning,/Локальная симуляция/);assert.match(data.answer,/Учебная симуляция/);assert.equal(calls,0);
  }finally{globalThis.fetch=original;}
});
test('Bad source serves the saved server snapshot with an explicit stale-data warning',async()=>{
  const DB=createLocalDatabase();
  try{
    const first=await (await worker.fetch(request({question:'Сводка'}),{DB,INCIDENTS_JSON:raw})).json();
    const response=await worker.fetch(request({question:'Сводка'}),{DB,INCIDENTS_JSON:'{broken'});assert.equal(response.status,200);
    const data=await response.json();assert.equal(data.context.revision,first.context.revision);assert.equal(data.context.stale,true);assert.ok(data.warning);assert.equal(data.context.total,44);
  }finally{DB.close();}
});
test('Missing or malformed selected records and unknown modes fail before generation',async()=>{
  for(const [body,status] of [[{question:'Сводка',context:{selectedId:'INC999999999'}},404],[{question:'Сводка',context:{view:'injected'}},400],[{question:'Сводка',context:'bad'},400],[{question:'Сводка',contextMode:'unknown'},400]])assert.equal((await worker.fetch(request(body),{INCIDENTS_JSON:raw})).status,status);
  assert.equal((await worker.fetch(request({question:'Сводка'}),{INCIDENTS_JSON:'{broken'})).status,503);
});
test('Yandex receives all 44 trusted records in the selected view and returns server provenance',async()=>{
  const original=globalThis.fetch;let context;
  globalThis.fetch=async(url,options)=>{assert.equal(String(url),'https://ai.api.cloud.yandex.net/foundationModels/v1/completion');const body=JSON.parse(options.body);context=JSON.parse(body.messages[1].text.replace('Текущие данные (JSON): ',''));return Response.json({result:{alternatives:[{status:'ALTERNATIVE_STATUS_FINAL',message:{text:'Проверено '+raw[0].id}}]}});};
  try{
    const response=await worker.fetch(request({question:'Объясни '+raw[0].id,context:{view:'mts-demo',selectedId:raw[0].id}}),{INCIDENTS_JSON:raw,YANDEX_API_KEY:'private-test-key',YANDEX_FOLDER_ID:'test-folder'});
    assert.equal(response.status,200);const data=await response.json();assert.equal(data.provider,'yandex');assert.equal(context.statistics.total,44);assert.equal(context.simulation,true);assert.equal(context.catalog.find(i=>i.id===raw[0].id).product,'Личный кабинет МТС');assert.equal(data.context.mode,'server');assert.doesNotMatch(JSON.stringify(data),/private-test-key/);
  }finally{globalThis.fetch=original;}
});

test('The connection-check summary includes overall counts even when the question mentions coordinators',async()=>{
  const response=await worker.fetch(request({question:'Дай короткую сводку по текущим инцидентам: сколько активных, критических и у координаторов?',context:{view:'mts-demo'}}),{INCIDENTS_JSON:raw});
  const data=await response.json();assert.equal(response.status,200);assert.match(data.answer,/Активных: 24/);assert.match(data.answer,/Критических: 0/);assert.match(data.answer,/На координаторах: 2/);
});
