// End-to-end HTTP check against the real built Worker. All writes use a new
// temporary file/database; source data, personal .env and production are untouched.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {once} from 'node:events';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const temp=await mkdtemp(join(tmpdir(),'mts-verify-'));
const file=join(temp,'incidents.json'),database=join(temp,'incidents.sqlite');
const original=JSON.parse(await readFile(join(root,'data/incidents.json'),'utf8'));
const COORD='КЦ ИТ Координаторы Массовых Инцидентов';
let child,base,checks=0;
function ok(label){checks++;console.log('PASS '+label);}
async function start(editor=false){
  child=spawn(process.execPath,['scripts/dev-server.mjs'],{cwd:root,env:{...process.env,PORT:'0',HOST:'127.0.0.1',LOCAL_DB_PATH:database,INCIDENTS_FILE:file,INCIDENTS_SOURCE_URL:'',DEV_EDITOR_PREVIEW:editor?'1':'0',DATA_EDITOR_EMAILS:'',YANDEX_API_KEY:'',YANDEX_FOLDER_ID:'',ITSM_INCIDENT_URL_TEMPLATE:'https://itsm.example/incidents/{sysId}'},stdio:['ignore','pipe','pipe']});
  let output='',errors='';child.stderr.on('data',b=>{errors+=b;});
  base=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Local server startup timeout: '+errors)),10000);
    child.once('error',e=>{clearTimeout(timer);reject(e);});
    child.once('exit',code=>{clearTimeout(timer);reject(new Error('Server exited '+code+': '+errors));});
    child.stdout.on('data',b=>{output+=b;const url=output.match(/Dashboard preview on (http:\/\/127\.0\.0\.1:\d+)/)?.[1];if(url){clearTimeout(timer);resolve(url);}});
  });
}
async function stop(){if(!child||child.exitCode!==null)return;const done=once(child,'exit');child.kill('SIGTERM');await done;child=null;}
const api=(path,options)=>fetch(base+path,options);
const snapshot=async()=>{const r=await api('/api/incidents');assert.equal(r.status,200);return r.json();};
const write=rows=>writeFile(file,JSON.stringify(rows,null,2));
const row=(s,id)=>s.incidents.find(i=>i.id===id);
try{
  await write(original);await start();
  const initial=await snapshot();assert.equal(initial.meta.total,44);assert.deepEqual(initial.meta.groups,{critical:0,coord:2,high:1,research:5});ok('44 source records and four canonical groups over HTTP');
  const page=await api('/');assert.equal(page.status,200);assert.match(await page.text(),/id="incidentQueueList"/);
  const app=await api('/app.js');assert.equal(app.status,200);assert.match(await app.text(),/data-focus-group=/);
  for(const path of ['/guide.html','/guide/','/guide/index.html','/?screen=wallboard'])assert.equal((await api(path)).status,200);ok('dashboard, wallboard and guide routes serve successfully');
  const forged={'oai-authenticated-user-id':'forged','oai-authenticated-user-email':'preview-editor@example.test'};
  const auth=await (await api('/api/auth/me',{headers:forged})).json();assert.equal(auth.authenticated,false);
  assert.equal((await api('/api/incidents/import',{method:'POST',headers:{...forged,'content-type':'application/json'},body:JSON.stringify(original)})).status,401);ok('forged identity cannot log in or import in standalone mode');
  const changed=structuredClone(original),target=changed.find(i=>i.stateEnum==='Assigned'||i.stateEnum==='WorkInProgress');assert.ok(target);const id=target.id;
  target.priorityId=4;target.assignedGroupName=COORD;await write(changed);
  let current=await snapshot();assert.equal(row(current,id).priority,'critical');assert.ok(current.events.some(e=>e.incidentId===id&&e.type==='critical'));assert.ok(current.meta.groups.coord>=2);
  const secondReader=await snapshot();assert.equal(secondReader.revision,current.revision);assert.equal(row(secondReader,id).priority,'critical');ok('file changes become critical and are visible to independent readers');
  target.deadline=new Date(Date.now()+15*60000).toISOString();await write(changed);current=await snapshot();assert.equal(row(current,id).dueAt,Date.parse(target.deadline));ok('changed deadline is read from the file');
  target.stateEnum='Resolved';target.state='Завершён';target.stateId=7;target.completionDate=new Date().toISOString();await write(changed);current=await snapshot();assert.equal(row(current,id).status,'resolved');assert.equal(current.meta.groups.critical,0);assert.ok(current.events.some(e=>e.incidentId===id&&e.type==='success'));ok('critical completion removes active focus and records recovery');
  target.stateEnum='Research';target.state='Исследование ситуации';target.stateId=20;target.deadline=null;await write(changed);current=await snapshot();assert.equal(row(current,id).dueAt,null);assert.equal(row(current,id).status,'investigating');assert.ok(current.meta.groups.research>=6);assert.ok(current.meta.groups.coord>=2);ok('research can remain at coordinators with no invented deadline');
  const savedRevision=current.revision;await writeFile(file,'{broken');current=await snapshot();assert.equal(current.revision,savedRevision);assert.ok(current.sourceWarning);ok('invalid file preserves the last valid shared snapshot');
  await rm(file);const missing=await api('/api/incidents',{headers:{'if-none-match':'"'+current.representationRevision+'"'}});assert.equal(missing.status,200);current=await missing.json();assert.equal(current.revision,savedRevision);assert.ok(current.sourceWarning);ok('missing source serves the saved snapshot with a warning instead of 500 or 304');
  await write(changed);current=await snapshot();assert.equal(current.revision,savedRevision);assert.equal(current.sourceWarning,null);ok('restored source clears the warning without creating a duplicate version');
  await write(changed);await snapshot();await stop();await start(true);
  current=await snapshot();assert.equal(current.revision,savedRevision);ok('SQLite snapshot survives server restart');
  const imported=structuredClone(changed);imported.find(i=>i.id===id).assignedGroupName='Команда проверки переноса';
  const importedResponse=await api('/api/incidents/import',{method:'POST',headers:{'content-type':'application/json','if-match':'"'+current.revision+'"',origin:base},body:JSON.stringify(imported)});assert.equal(importedResponse.status,200);
  const a=await snapshot(),b=await snapshot();assert.equal(a.revision,b.revision);assert.notEqual(a.revision,savedRevision);assert.equal(row(b,id).team,'Команда проверки переноса');
  assert.equal((await api('/api/incidents/import',{method:'POST',headers:{'content-type':'application/json','if-match':'"'+savedRevision+'"',origin:base},body:JSON.stringify(changed)})).status,409);ok('protected import reaches all readers and rejects stale edits');
  const exported=await (await api('/api/incidents/export')).json();assert.deepEqual(exported,imported);ok('export preserves the exact imported raw fields');
  const model=await (await api('/api/assistant/status')).json();assert.equal(model.configured,false);assert.equal(model.available,false);
  await rm(file);
  const staleResponse=await api('/api/assistant/chat',{method:'POST',headers:{'content-type':'application/json',origin:base},body:JSON.stringify({question:'Сводка',context:{view:'source'}})});assert.equal(staleResponse.status,200);const staleAnswer=await staleResponse.json();assert.equal(staleAnswer.context.stale,true);assert.equal(staleAnswer.context.revision,a.revision);assert.ok(staleAnswer.warning);ok('assistant discloses saved context while the source file is unavailable');
  await write(changed);
  const response=await api('/api/assistant/chat',{method:'POST',headers:{'content-type':'application/json',origin:base},body:JSON.stringify({question:'Что происходит?',context:{view:'source'}})});assert.equal(response.status,200);const answer=await response.json();assert.equal(answer.provider,'rules');ok('assistant answers and truthfully reports rules without model credentials');
  const updatedFile=structuredClone(imported);updatedFile.find(i=>i.id===id).assignedEmployee='Новый дежурный теста';await write(updatedFile);
  const fresh=await api('/api/assistant/chat',{method:'POST',headers:{'content-type':'application/json',origin:base},body:JSON.stringify({question:'Кто решает '+id+'?',context:{view:'source',selectedId:id}})});assert.equal(fresh.status,200);const freshAnswer=await fresh.json();assert.match(freshAnswer.answer,/Новый дежурный теста/);assert.equal(freshAnswer.context.mode,'server');assert.notEqual(freshAnswer.context.revision,a.revision);ok('assistant rereads changed JSON without a browser snapshot or prior dashboard GET');
  assert.equal(row(a,id).itsmUrl,'https://itsm.example/incidents/'+target.sysId);ok('configured ITSM links preserve exact source sysId');
  console.log(`Local HTTP verification: ${checks} checks passed. No production writes.`);
}finally{await stop();await rm(temp,{recursive:true,force:true});}
