import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createLocalDatabase} from '../scripts/local-database.mjs';
import {ensureSharedData,sharedDataset,readSharedState,importSharedDataset,listSharedEvents,canImportIncidents} from '../lib/shared-data.mjs';
import {summarizeImport} from '../lib/import-summary.mjs';
import {normalizeIncidentDataset} from '../lib/incidents.mjs';
import worker from '../worker/index.js';

const raw=JSON.parse(readFileSync(new URL('../data/incidents.json',import.meta.url)));
const actor={userId:'editor-test',displayName:'Тестовый редактор',email:'editor@example.test'};
const identity={'oai-authenticated-user-id':actor.userId,'oai-authenticated-user-email':actor.email};
const fresh=()=>structuredClone(raw);
const request=(path,options={})=>new Request('https://site.test'+path,options);
const update=(raw,revision,headers={})=>request('/api/incidents/import',{method:'POST',headers:{...identity,'Content-Type':'application/json',...(revision?{'If-Match':`"${revision}"`}:{}),...headers},body:JSON.stringify(raw)});
async function database(t){const db=createLocalDatabase();t.after(()=>db.close());await ensureSharedData(db,raw);return db;}
async function count(db,table){return db.prepare(`SELECT count(*) AS n FROM ${table}`).first('n');}

test('Seed is idempotent and shared version survives closing and reopening SQLite',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'focus-shared-')),file=join(dir,'data.sqlite');let db=createLocalDatabase(file);
  try{
    const initial=await sharedDataset(db,raw);assert.equal(initial.version,1);assert.equal(initial.meta.total,44);assert.equal(initial.persistent,true);assert.equal(initial.events.length,1);
    const changed=fresh();changed[0].priorityId=4;
    await importSharedDataset(db,changed,initial.revision,actor,'updated.json');db.close();db=createLocalDatabase(file);
    const persisted=await sharedDataset(db,raw);assert.equal(persisted.version,2);assert.equal(persisted.meta.groups.critical,1);
    await ensureSharedData(db,raw);assert.equal(await count(db,'incident_imports'),2);assert.equal(persisted.events.length,2);
  }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});

test('A committed import is visible to independent reads, records changes and preserves original versions',async t=>{
  const db=await database(t),initial=await sharedDataset(db,raw),changed=fresh();
  changed[0].priorityId=4;changed[1].assignedGroupName=raw[0].assignedGroupName;
  changed[2].stateEnum='Resolved';changed[2].state='Завершен';changed[2].stateId=7;
  changed[3].deadline=new Date(Date.parse(changed[3].deadline)+60000).toISOString();
  const imported=await importSharedDataset(db,changed,initial.revision,actor,'new.json');assert.equal(imported.version,2);assert.equal(imported.summary.changed,4);assert.equal(imported.summary.completed,1);
  const first=await sharedDataset(db,raw),second=await sharedDataset(db,raw);assert.equal(first.revision,second.revision);assert.deepEqual(first.meta,second.meta);
  for(const type of ['critical','coord','success'])assert.ok(first.events.some(e=>e.type===type),type);
  assert.ok(first.events.some(e=>e.changes.some(c=>c.label==='Срок решения'&&c.before!==c.after)));
  assert.deepEqual(JSON.parse((await db.prepare('SELECT raw_json FROM incident_imports WHERE version=1').first()).raw_json),raw);
  const publicText=JSON.stringify(first);assert.ok(!publicText.includes(actor.email));assert.ok(!publicText.includes(actor.userId));assert.ok(!publicText.includes(actor.displayName));
});

test('Concurrent editors cannot overwrite each other or leave losing audit events',async t=>{
  const db=await database(t),state=await readSharedState(db),a=fresh(),b=fresh();a[0].priorityId=4;b[1].priorityId=4;
  const result=await Promise.allSettled([importSharedDataset(db,a,state.revision,actor,'a.json'),importSharedDataset(db,b,state.revision,actor,'b.json')]);
  assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.equal(result.find(r=>r.status==='rejected').reason.status,409);
  assert.equal((await readSharedState(db)).version,2);assert.equal(await count(db,'incident_imports'),2);assert.equal(await count(db,'incident_events'),2);
});

test('Failed SQL batch rolls back current state, import version and audit together',async t=>{
  const db=await database(t),before=await readSharedState(db),changed=fresh();changed[0].priorityId=4;
  const failing={prepare:db.prepare,batch:statements=>db.batch([...statements,db.prepare('INSERT INTO nonexistent_table VALUES (1)')])};
  await assert.rejects(()=>importSharedDataset(failing,changed,before.revision,actor));
  assert.deepEqual(await readSharedState(db),before);assert.equal(await count(db,'incident_imports'),1);assert.equal(await count(db,'incident_events'),1);
});

test('Invalid, empty, duplicate, oversized and stale imports leave saved data intact',async t=>{
  const db=await database(t),before=await readSharedState(db);
  for(const [bad,status] of [[[],422],[[raw[0],raw[0]],422],[[{...raw[0],priorityId:99}],422],[[{...raw[0],header:'x'.repeat(1048577)}],413]]){
    await assert.rejects(()=>importSharedDataset(db,bad,before.revision,actor),e=>e.status===status);
  }
  await assert.rejects(()=>importSharedDataset(db,raw,'0'.repeat(64),actor),e=>e.status===409);
  assert.equal((await readSharedState(db)).revision,before.revision);assert.equal(await count(db,'incident_imports'),1);
});

test('Identical reimport is a no-op; removing a record does not mean completion',async t=>{
  const db=await database(t),state=await readSharedState(db);
  const same=await importSharedDataset(db,fresh(),state.revision,actor);assert.equal(same.changed,false);assert.equal(await count(db,'incident_events'),1);
  const removed=await importSharedDataset(db,raw.slice(1),state.revision,actor);assert.equal(removed.summary.removed,1);assert.equal(removed.summary.completed,0);
  const history=await listSharedEvents(db);assert.ok(history.events.some(e=>e.incidentId===raw[0].id&&e.type==='changed'&&/не означает/.test(e.detail)));
  assert.equal(summarizeImport(normalizeIncidentDataset(raw).incidents,normalizeIncidentDataset(raw.slice(1)).incidents).removed,1);
});

test('Journal has stable sequence pagination, incident filtering and snapshot version bound',async t=>{
  const db=await database(t);let state=await readSharedState(db);
  for(let n=0;n<4;n++){const changed=fresh();changed[0].priorityId=n%2?3:4;await importSharedDataset(db,changed,state.revision,actor);state=await readSharedState(db);}
  const page=await listSharedEvents(db,{limit:2}),older=await listSharedEvents(db,{limit:2,before:page.nextCursor});
  assert.equal(page.hasMore,true);assert.ok(older.events.every(e=>e.seq<page.events.at(-1).seq));assert.equal(new Set([...page.events,...older.events].map(e=>e.id)).size,4);
  const filtered=await listSharedEvents(db,{incidentId:raw[0].id});assert.equal(filtered.events.length,4);assert.ok(filtered.events.every(e=>e.incidentId===raw[0].id));
  const bound=await listSharedEvents(db,{maxVersion:2});assert.ok(bound.events.every(e=>e.version<=2));assert.equal(bound.events.length,2);
});

test('Unchanged local source never overwrites manual import; later source change is audited; bad source serves saved data',async t=>{
  const db=await database(t),source={raw,name:'source'};
  const initial=await sharedDataset(db,raw,[],source),manual=fresh();manual[0].priorityId=4;
  await importSharedDataset(db,manual,initial.revision,actor);
  const retained=await sharedDataset(db,raw,[],source);assert.equal(retained.version,2);assert.equal(retained.meta.groups.critical,1);
  const newSource=fresh();newSource[0].priorityId=3;
  const changed=await sharedDataset(db,raw,[],{raw:newSource,name:'source'});assert.equal(changed.version,3);assert.equal(changed.meta.groups.critical,0);
  const failed=await sharedDataset(db,raw,[],{raw:'not JSON',name:'source'});assert.equal(failed.version,3);assert.match(failed.sourceWarning,/сохранённая/);
});

test('Import capability requires a verified identity with allowlisted email',async t=>{
  const db=await database(t),env={DB:db,DATA_EDITOR_EMAILS:' EDITOR@example.test; second@example.test '};
  assert.equal(canImportIncidents(actor,env),true);assert.equal(canImportIncidents(null,env),false);assert.equal(canImportIncidents({...actor,email:'outsider@example.test'},env),false);
  const me=await (await worker.fetch(request('/api/auth/me',{headers:identity}),env)).json();assert.equal(me.capabilities.importIncidents,true);
  const outsider=await (await worker.fetch(request('/api/auth/me',{headers:{...identity,'oai-authenticated-user-email':'outsider@example.test'}}),env)).json();assert.equal(outsider.capabilities.importIncidents,false);
  const anonymous=await worker.fetch(update(raw,null,{'oai-authenticated-user-id':'','oai-authenticated-user-email':''}),env);assert.equal(anonymous.status,401);
  assert.equal((await worker.fetch(update(raw,null,{'oai-authenticated-user-email':'outsider@example.test'}),env)).status,403);
  assert.equal((await worker.fetch(update(raw,null),env)).status,428);
  assert.equal((await worker.fetch(update(raw,'bad'),env)).status,400);
  assert.equal((await worker.fetch(update(raw,(await readSharedState(db)).revision,{Origin:'https://other.test'}),env)).status,403);
});

test('HTTP import updates all readers and ETag, rejects stale copies, and limits export to editors',async t=>{
  const db=await database(t),env={DB:db,DATA_EDITOR_EMAILS:actor.email};
  const first=await worker.fetch(request('/api/incidents'),env),before=await first.json();assert.equal(before.source,'shared');
  assert.equal((await worker.fetch(request('/api/incidents',{headers:{'If-None-Match':first.headers.get('etag')}}),env)).status,304);
  const rawUpdate=fresh();rawUpdate[0].priorityId=4;
  const response=await worker.fetch(update(rawUpdate,before.revision),env),saved=await response.json();assert.equal(response.status,200);assert.equal(saved.snapshot.version,2);
  const next=await worker.fetch(request('/api/incidents',{headers:{'If-None-Match':first.headers.get('etag')}}),env);assert.equal(next.status,200);assert.equal((await next.json()).revision,saved.revision);
  assert.equal((await worker.fetch(update(raw,before.revision),env)).status,409);
  assert.equal((await worker.fetch(request('/api/incidents/export'),env)).status,401);
  assert.equal((await worker.fetch(request('/api/incidents/export',{headers:{...identity,'oai-authenticated-user-email':'outsider@example.test'}}),env)).status,403);
  const exported=await worker.fetch(request('/api/incidents/export',{headers:identity}),env);assert.deepEqual(await exported.json(),rawUpdate);
  const old=await worker.fetch(request('/api/incidents/export?version=1',{headers:identity}),env);assert.deepEqual(await old.json(),raw);
  assert.equal((await worker.fetch(request('/api/incidents/export?version=999',{headers:identity}),env)).status,404);
  const history=await (await worker.fetch(request('/api/incidents/history?incident_id='+raw[0].id),env)).json();assert.equal(history.persistent,true);assert.equal(history.events.length,1);
  assert.equal((await worker.fetch(request('/api/incidents/history?before=-1'),env)).status,400);
});

test('Malformed HTTP body does not change the shared snapshot',async t=>{
  const db=await database(t),env={DB:db,DATA_EDITOR_EMAILS:actor.email},before=await readSharedState(db);
  const response=await worker.fetch(request('/api/incidents/import',{method:'POST',headers:{...identity,'Content-Type':'application/json','If-Match':`"${before.revision}"`},body:'{oops'}),env);
  assert.equal(response.status,400);assert.equal((await readSharedState(db)).revision,before.revision);
});
