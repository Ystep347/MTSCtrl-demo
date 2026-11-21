import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import worker from '../worker/index.js';
import {createLocalDatabase} from '../scripts/local-database.mjs';
import {incidentConnections,incidentPrecedents,matchesIncidentScope,possibleConsequences,relevanceOrder,teamAssessment,teamWorkload,workGroupKeys,projectWorkflowItem,availableWorkflowActions,nextWorkflowState,completeWorkflowDelivery} from '../lib/operations.mjs';
import {normalizeIncidentDataset} from '../lib/incidents.mjs';
import {localAnswer} from '../lib/assistant-rules.mjs';

const raw=JSON.parse(readFileSync(new URL('../data/incidents.json',import.meta.url)));
const base='https://workflow.test';
const editor={'oai-authenticated-user-id':'test-editor','oai-authenticated-user-email':'editor@example.test'};
const request=(env,path,{method='GET',headers={},body}={})=>worker.fetch(new Request(base+path,{
  method,headers:{origin:base,'content-type':'application/json',...headers},body:body?JSON.stringify(body):undefined
}),env);

const coordinatorTeam='КЦ ИТ Координаторы Массовых Инцидентов';

test('Work groups cover every unique ID and preserve overlapping memberships',()=>{
  const {incidents,meta}=normalizeIncidentDataset(raw);
  for(const [scope,count] of Object.entries({all:meta.total,focus:meta.focus,active:meta.active,finished:meta.finished})){
    const scoped=incidents.filter(item=>matchesIncidentScope(item,scope));
    const groups=['critical','coord','high','medium','low','research','resolved','closed'];
    const displayed=groups.flatMap(group=>scoped.filter(i=>workGroupKeys(i).includes(group)));
    assert.equal(new Set(displayed.map(i=>i.id)).size,count);
    assert.ok(displayed.length>=count);
  }
  assert.deepEqual(workGroupKeys({priority:'critical',team:coordinatorTeam,status:'working'}),['critical','coord']);
  assert.deepEqual(workGroupKeys({priority:'critical',team:coordinatorTeam,status:'investigating'}),['coord','research']);
});

test('Consequences require later evidence and keep a similarity separate from a source link',()=>{
  const original={id:'INC1',product:'МТС',service:'Вход',title:'Ошибка доступа',createdAt:100000};
  const peer=(id,offset,extra={})=>({...original,id,createdAt:original.createdAt+offset,...extra});
  const candidates=[peer('INC2',60000),peer('INC3',-1000),peer('INC4',0),peer('INC5',86400001),
    peer('INC6',20000,{isDuplicate:true}),peer('INC7',20000,{linkedIncidentIds:['INC1'],service:'Биллинг'})];
  const links=incidentConnections(original,candidates);
  assert.equal(links.find(link=>link.item.id==='INC7').kind,'confirmed');
  assert.deepEqual(possibleConsequences(original,links).map(row=>row.item.id),['INC2']);
});

test('Team advice uses current active assignments and excludes future, closed and undated assignments',()=>{
  const now=5000000;
  const make=(id,assignedAt,extra={})=>({id,team:'Связь',priority:'low',status:'working',dueAt:now-1000,assignedAt,...extra});
  const items=[make('1',now-3600000),make('2',now-1000),make('3',null),make('4',now+1),make('5',now,{status:'closed'})];
  let [team]=teamAssessment(items,now);
  assert.equal(team.count,4);assert.equal(team.overdue,4);
  assert.ok(!team.findings.some(f=>f.incidentId));
  items.push(make('6',now));
  [team]=teamAssessment(items,now);
  assert.equal(team.findings.find(f=>f.incidentId)?.incidentId,'6');
  assert.match(team.findings.find(f=>f.incidentId).fact,/3\./);
});
const executorTeam=items=>items.find(item=>item.team!==coordinatorTeam&&item.team!=='Команда не назначена').team;
const getSnapshot=async (env,headers={})=>(await request(env,'/api/incidents',{headers})).json();
const mutate=(env,headers,id,action,version,extra={})=>request(env,'/api/workflow',{method:'POST',headers,body:{id,action,version,...extra}});

test('A critical moving directly to research produces one recovery across imports and research transfer',async t=>{
  const DB=createLocalDatabase(),data=structuredClone(raw);
  const rawItem=data.find(i=>i.stateEnum==='Assigned');
  Object.assign(rawItem,{priorityId:4,assignedGroupName:coordinatorTeam});
  const env={DB,INCIDENTS_JSON:JSON.stringify(data),DATA_EDITOR_EMAILS:'editor@example.test'};
  t.after(()=>DB.close());
  const first=await getSnapshot(env);
  const switchStatus=async(status,id,label,revision)=>{
    Object.assign(rawItem,{stateEnum:status,stateId:id,state:label,completionDate:'2026-01-12T09:00:00Z'});
    const res=await request(env,'/api/incidents/import',{method:'POST',headers:{...editor,'if-match':revision},body:data});
    assert.equal(res.status,200);
    return getSnapshot(env);
  };
  const research=await switchStatus('Research',20,'Исследование ситуации',first.revision);
  const transfers=research.events.filter(e=>e.incidentId===rawItem.id&&e.type==='success');
  assert.equal(transfers.length,1);
  const assigned=await mutate(env,editor,rawItem.id,'assign',0,{team:executorTeam(first.incidents)});
  assert.equal(assigned.status,200);
  const snap=await getSnapshot(env),row=snap.workflow.find(i=>i.id===rawItem.id);
  const projected=projectWorkflowItem(snap.incidents.find(i=>i.id===rawItem.id),row);
  assert.deepEqual(workGroupKeys(projected),['research']);
  assert.equal(projected.resolvedAt,Date.parse(rawItem.completionDate));
  const closed=await switchStatus('Closed',10,'Закрыт',snap.revision);
  assert.deepEqual(closed.events.filter(e=>e.incidentId===rawItem.id&&e.type==='success'),transfers);
});

test('A research handoff keeps the restoration date, supports retry and respects newer source assignments',()=>{
  const item={id:'INC10',sysId:'test10',status:'investigating',team:coordinatorTeam,assignee:'Дежурный',
    priority:'critical',resolvedAt:50,assignedAt:90,title:'Сбой',product:'Сервис'};
  const actor={role:'coordinator',displayName:'Координатор'};
  const draft=nextWorkflowState(item,null,{action:'assign',version:0,team:'Команда А'},actor,100);
  const failed=completeWorkflowDelivery(draft,'failed',actor,101);
  assert.ok(availableWorkflowActions(item,failed,actor,102).includes('retry'));
  const retried=nextWorkflowState(item,failed,{action:'retry',version:2},actor,103);
  const sent=completeWorkflowDelivery(retried,'sent',actor,104);
  const projected=projectWorkflowItem(item,sent);
  assert.equal(projected.team,'Команда А');assert.equal(projected.resolvedAt,50);
  assert.deepEqual(workGroupKeys(projected),['research']);
  assert.deepEqual(availableWorkflowActions(item,sent,actor),['finish-investigation']);
  const fresh={...item,status:'working',team:'Команда Б',assignee:'Иван',assignedAt:105};
  assert.equal(projectWorkflowItem(fresh,sent).team,'Команда Б');
  assert.equal(projectWorkflowItem(fresh,sent).assignee,'Иван');
  assert.deepEqual(availableWorkflowActions(fresh,sent,{role:'executor',dispatchId:sent.dispatch.id}),[]);
  assert.ok(projectWorkflowItem({...fresh,assignedAt:null},sent).assignmentConflict);
});

test('An analyst-coordinator dispatches new incidents and closes them after resolution or investigation',async t=>{
  const DB=createLocalDatabase(),env={DB,INCIDENTS_JSON:JSON.stringify(raw),DATA_EDITOR_EMAILS:'editor@example.test'};
  t.after(()=>DB.close());
  const original=await getSnapshot(env);
  assert.deepEqual(original.workflow,[]);
  const assigned=original.incidents.find(item=>item.status==='assigned');
  const copy=raw.find(row=>row.id===assigned.id),id='INC-456789';
  const imported=await request(env,'/api/incidents/import',{method:'POST',headers:{...editor,'if-match':original.revision},
    body:[...raw,{...copy,id,sysId:'workflow-test-record',priorityId:4}]});
  assert.equal(imported.status,200,await imported.clone().text());
  const beforeResponse=await request(env,'/api/incidents'),before=await beforeResponse.json();
  assert.equal(before.workflow.find(row=>row.id===id).pending,true);

  const registration=await request(env,'/api/auth/register',{method:'POST',body:{
    username:'test.analyst',displayName:'Аналитик',password:'test-only-long-password',role:'analyst'
  }});
  assert.equal(registration.status,201);
  assert.equal((await registration.json()).user.role,'coordinator');
  const session={cookie:registration.headers.get('set-cookie').split(';')[0]};
  const team=executorTeam(original.incidents);
  assert.equal((await mutate(env,session,id,'close',1)).status,403);
  assert.equal((await mutate(env,{},id,'assign',1,{team})).status,401);
  const transferred=await mutate(env,session,id,'assign',1,{team,note:'Проверить доступность приложения'});
  assert.equal(transferred.status,200,await transferred.clone().text());
  const assignedRow=(await transferred.json()).workflow;
  assert.equal(assignedRow.dispatch.state,'demo');
  assert.equal(assignedRow.pending,false);
  assert.match(assignedRow.report,/Проверить доступность приложения/);
  assert.equal((await mutate(env,session,id,'assign',1,{team})).status,409);
  assert.equal((await request(env,'/api/incidents',{headers:{'if-none-match':beforeResponse.headers.get('etag')}})).status,200);
  assert.equal((await getSnapshot(env)).workflow.find(row=>row.id===id).report,undefined);
  assert.equal((await mutate(env,session,id,'resolve',assignedRow.version)).status,422);
  const done=await mutate(env,session,id,'demo-executor-resolve',assignedRow.version,{dispatchId:assignedRow.dispatch.id,note:'Шлюз перезапущен'});
  assert.equal(done.status,200,await done.clone().text());
  const resolved=(await done.json()).workflow;
  assert.equal(resolved.caseStatus,'resolved');
  const observer=await getSnapshot(env);
  const recoveries=s=>s.events.filter(e=>e.incidentId===id&&e.type==='success');
  assert.equal(recoveries(observer).length,1);
  assert.ok(recoveries(observer)[0].id.startsWith('recovery:'));
  assert.match(resolved.history.at(-1).actor,/учебный SimpleOne/);
  const research=(await (await mutate(env,session,id,'investigate',resolved.version)).json()).workflow;
  assert.equal(research.caseStatus,'investigating');
  assert.equal((await mutate(env,session,id,'close',research.version)).status,403);
  const investigated=(await (await mutate(env,session,id,'finish-investigation',research.version,{note:'Причина установлена'})).json()).workflow;
  assert.ok(investigated.researchCompletedAt);
  const closed=(await (await mutate(env,session,id,'close',investigated.version)).json()).workflow;
  assert.equal(closed.caseStatus,'closed');
  assert.equal(closed.resolvedAt,resolved.resolvedAt);
  assert.equal((await mutate(env,session,id,'assign',closed.version,{team})).status,403);

  assert.equal((await request(env,'/api/simpleone/demo',{method:'POST',body:{incidentId:id,sysId:'workflow-test-record',team,dispatchId:assignedRow.dispatch.id}})).status,200);
  const unchanged=(await getSnapshot(env,session)).workflow.find(row=>row.id===id);
  assert.equal(unchanged.version,closed.version);
  const reconciled=[...raw,{...copy,id,sysId:'workflow-test-record',priorityId:4,stateEnum:'Research',stateId:20,state:'Исследование ситуации'}];
  const updated=await request(env,'/api/incidents/import',{method:'POST',headers:{...editor,'if-match':observer.revision},body:reconciled});
  assert.equal(updated.status,200);
  assert.equal(recoveries(await getSnapshot(env)).length,1);
});

test('SimpleOne JSON delivery reserves one assignment, retries safely, and validates executor callbacks',async t=>{
  const DB=createLocalDatabase(),env={DB,INCIDENTS_JSON:JSON.stringify(raw),SIMPLEONE_URL:'https://simpleone.example.test',
    SIMPLEONE_TOKEN:'table-test-token',SIMPLEONE_EVENTS_TOKEN:'callback-test-token',SIMPLEONE_DISPATCH_FIELD:'mts_dispatch_id'};
  t.after(()=>DB.close());
  const initial=await getSnapshot(env),item=initial.incidents.find(i=>i.team===coordinatorTeam&&i.status==='assigned');
  const team=executorTeam(initial.incidents),groupId='157417569011449935';
  env.SIMPLEONE_GROUP_IDS=JSON.stringify({[team]:groupId});
  const sent=[];
  t.mock.method(globalThis,'fetch',async (url,options)=>{
    assert.equal(new URL(url).pathname,'/rest/v1/table/itsm_incident/'+item.sysId);
    assert.equal(options.method,'PATCH');assert.equal(options.redirect,'error');
    assert.equal(options.headers.Authorization,'Bearer table-test-token');
    const payload=JSON.parse(options.body);sent.push(payload);
    assert.equal(payload.assignment_group,groupId);
    assert.match(payload.mts_dispatch_id,/^[a-f0-9]{32}$/);
    if(sent.length===1)return new Response('',{status:503});
    return Response.json({status:'OK',data:[{sys_id:item.sysId,assignment_group:groupId}]});
  });
  const race=await Promise.all([mutate(env,editor,item.id,'assign',0,{team}),mutate(env,editor,item.id,'assign',0,{team})]);
  const first=race.find(r=>r.status===200);
  assert.ok(first);
  assert.equal(race.filter(r=>r.status===409).length,1);
  const failed=(await first.json()).workflow;
  assert.equal(failed.dispatch.state,'failed');
  assert.equal(failed.pending,true);
  const retry=await mutate(env,editor,item.id,'retry',failed.version);
  assert.equal(retry.status,200,await retry.clone().text());
  const delivered=(await retry.json()).workflow;
  assert.equal(delivered.dispatch.state,'sent');
  assert.deepEqual(sent[0],sent[1]);
  const body={event:'resolved',incidentId:item.id,sysId:item.sysId,dispatchId:delivered.dispatch.id,assignmentGroupId:groupId,solution:'Восстановлен сервис'};
  const callback=(headers,body)=>request(env,'/api/simpleone/events',{method:'POST',headers,body});
  const identity={authorization:'Bearer callback-test-token'};
  assert.equal((await callback({},body)).status,401);
  assert.equal((await callback(identity,{...body,assignmentGroupId:'123'})).status,409);
  assert.equal((await callback(identity,body)).status,200);
  const repeated=await callback(identity,body);
  assert.equal((await repeated.json()).alreadyResolved,true);
  const resolved=(await getSnapshot(env,editor)).workflow.find(row=>row.id===item.id);
  assert.equal(resolved.caseStatus,'resolved');
  assert.equal(resolved.solution,'Восстановлен сервис');
  assert.equal(resolved.history.filter(event=>event.type==='resolve').length,1);
  const closed=await mutate(env,editor,item.id,'close',resolved.version);
  assert.equal((await closed.json()).workflow.caseStatus,'closed');
});

test('Relevance, team heat, precedents and confirmed links use their underlying data',()=>{
  const now=Date.now();
  const item={id:'INC-1',sysId:'one',status:'assigned',priority:'medium',team:'Ops',product:'Оплата',
    service:'Платежи',title:'Массовая недоступность оплаты',description:'Ошибки обработки платежей',createdAt:now-60000,dueAt:now-1000};
  const newer={...item,id:'INC-2',priority:'low',title:'Проверка оплаты',createdAt:now,dueAt:now+7200000};
  const resolved={...item,id:'INC-3',sysId:'three',status:'resolved',resolvedAt:now-10000,solution:'Переключить платежный шлюз'};
  assert.equal(relevanceOrder([newer,item],{now})[0].id,item.id);
  assert.equal(relevanceOrder([item,newer],{mode:'newest',now})[0].id,newer.id);
  const [heat]=teamWorkload([item,newer,resolved],{},now);
  assert.equal(heat.load,6);
  assert.equal(heat.overdue,1);
  assert.equal(incidentConnections({...item,isMaster:true},[item,resolved])[0].kind,'suggested');
  assert.equal(incidentConnections({...item,linkedIncidentIds:['three']},[item,resolved])[0].kind,'confirmed');
  assert.equal(incidentPrecedents(item,[newer,resolved])[0].item.solution,resolved.solution);
});

test('The assistant distinguishes confirmed links, similarity and assignment deviations',()=>{
  const now=Date.now();
  const item={id:'INC-1',sysId:'one',status:'assigned',priority:'high',team:coordinatorTeam,product:'Облако',
    service:'Доступ',title:'Сбой подключения',description:'Ошибка проверки подключения',createdAt:now-60000,dueAt:now-1000,
    linkedIncidentIds:['two']};
  const confirmed={...item,id:'INC-2',sysId:'two',linkedIncidentIds:[]};
  const similar={...confirmed,id:'INC-3',sysId:'three'};
  const answer=localAnswer('Проверь связи, сходство и аномалии назначения',{incidents:[item,confirmed,similar],selectedId:item.id},[],now);
  assert.match(answer,/Подтверждённые связи\nINC-2/);
  assert.match(answer,/Возможное сходство\nINC-3/);
  assert.match(answer,/Нет исполнительной команды/);
  assert.match(answer,/Срок истёк до передачи/);
});

test('The model can qualify a risk and draft a handoff while the server retains the facts',async t=>{
  const DB=createLocalDatabase(),env={DB,INCIDENTS_JSON:JSON.stringify(raw),DATA_EDITOR_EMAILS:'editor@example.test',
    YANDEX_API_KEY:'workflow-test-fake-key',YANDEX_FOLDER_ID:'test-folder'};
  t.after(()=>DB.close());
  const {incidents}=await (await request(env,'/api/incidents')).json();
  const item=incidents.find(record=>record.status==='assigned'&&record.team===coordinatorTeam);
  let calls=0;
  t.mock.method(globalThis,'fetch',async (url,options)=>{
    assert.equal(new URL(url).hostname,'ai.api.cloud.yandex.net');
    calls++;
    const input=JSON.parse(options.body);
    assert.ok(input.messages.some(message=>message.text.includes(item.id)));
    const text=calls===1?JSON.stringify([
      {id:item.id,level:'high',boost:99,reason:'Проверить влияние на пользователей'},
      {id:'INC-999999',level:'high',boost:6,reason:'Чужой ID'}
    ]):'Уточнить, затронуты ли дополнительные пользователи.';
    return Response.json({result:{alternatives:[{status:'ALTERNATIVE_STATUS_FINAL',message:{text}}]}});
  });
  const analysis=await request(env,'/api/workflow/analysis',{method:'POST',headers:editor,body:{id:item.id,view:'mts-demo'}});
  assert.equal(analysis.status,200);
  const answer=await analysis.json();
  assert.equal(answer.source,'yandex');
  assert.equal(answer.model[item.id].boost,16);
  assert.equal(Object.keys(answer.model).length,1);
  const assignment=await request(env,'/api/workflow',{method:'POST',headers:editor,body:{id:item.id,action:'assign',version:0,team:executorTeam(incidents),note:'Проверить карточку'}});
  assert.equal(assignment.status,200);
  const {workflow}=await assignment.json();
  assert.equal(workflow.reportSource,'yandex');
  assert.match(workflow.report,/Проверить карточку/);
  assert.match(workflow.report,/Черновик Яндекса/);
  assert.equal(calls,2);
});
