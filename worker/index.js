import {localAnswer,selectReferences} from '../lib/assistant-rules.mjs';
export {localAnswer};
import {canStoreAiSettings,aiEffectiveEnvironment,saveAiSettings,aiSettingsSummary} from '../lib/ai-settings.mjs';
import {authSameOrigin,passwordSession,registerPasswordUser,loginPasswordUser,logoutPasswordUser,listPasswordUsers,setPasswordUserRole} from '../lib/auth.mjs';
import {projectMtsSimulation} from '../lib/mts-simulation.mjs';
import {canImportIncidents,sharedDataset,ensureSharedData,importSharedDataset,listSharedEvents,readSharedState,incidentRevision,SHARED_MAX_BYTES} from '../lib/shared-data.mjs';
import {yandexAnswer,yandexStatus} from '../lib/yandex.mjs';
import {normalizeIncidentDataset,isActiveIncident,incidentGroups} from '../lib/incidents.mjs';
import {acceptDemoDispatch,attachItsmLinks,sendSimpleOneAssignment,simpleOneConfiguration,simpleOneDispatchInfo} from '../lib/itsm.mjs';
import {completeWorkflowDelivery,escalationAssessment,nextWorkflowState,relevanceOrder} from '../lib/operations.mjs';
import {incidentAssignments,incidentWorkflowSnapshot,workflowForViewer,readIncidentWorkflow,planIncidentWorkflow,saveIncidentWorkflow} from '../lib/workflow.mjs';
const ASSETS = /* __ASSETS__ */ {};
const RAW_INCIDENTS = /* __INCIDENTS__ */ [];
const FIELD_DICTIONARY = /* __ATTRIBUTES__ */ [];
const priorityLabels={critical:'Критический',high:'Высокий',medium:'Средний',low:'Низкий'};
const rateWindows=new Map();
const clip=(s,n)=>typeof s==='string'?s.slice(0,n):'';
export function safeReturnPath(value='/'){
  if(typeof value!=='string'||!value.startsWith('/')||value.startsWith('//'))return '/';
  try{const url=new URL(value,'https://app.local');if(url.origin!=='https://app.local'||['/signin-with-chatgpt','/signout-with-chatgpt','/callback','/login'].includes(url.pathname))return '/';return url.pathname+url.search+url.hash;}catch{return '/';}
}
export const signInPath=(returnTo='/')=>'/signin-with-chatgpt?return_to='+encodeURIComponent(safeReturnPath(returnTo));
export const signOutPath=(returnTo='/')=>'/signout-with-chatgpt?return_to='+encodeURIComponent(safeReturnPath(returnTo));
export function currentUser(request){
  // These identity headers are set by Sites after platform authentication.
  const userId=request.headers.get('oai-authenticated-user-id');
  const email=request.headers.get('oai-authenticated-user-email');
  if(!userId||!email)return null;
  let fullName=null;
  if(request.headers.get('oai-authenticated-user-full-name-encoding')==='percent-encoded-utf-8'){
    try{fullName=decodeURIComponent(request.headers.get('oai-authenticated-user-full-name')||'').trim()||null;}catch{}
  }
  return {userId,email:clip(email,254),displayName:clip(fullName||email,160),role:'coordinator'};
}
const loginPath=(returnTo='/')=>'/login?return_to='+encodeURIComponent(safeReturnPath(returnTo));
const htmlAttr=s=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function json(data,status=200,extra={}){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...extra}});}
async function boundedJson(request,limit){
  if(Number(request.headers.get('content-length'))>limit)throw {status:413,message:'Слишком большой JSON.'};
  const reader=request.body?.getReader();if(!reader)throw {status:400,message:'Пустой запрос.'};
  const chunks=[];let length=0;
  for(;;){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>limit){await reader.cancel();throw {status:413,message:'Слишком большой JSON.'};}chunks.push(value);}
  const bytes=new Uint8Array(length);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
  try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw {status:400,message:'Некорректный JSON.'};}
}
async function readJson(request){
  if(!request.headers.get('content-type')?.includes('application/json'))throw {status:415,message:'Отправьте JSON.'};
  return boundedJson(request,2097152);
}
export async function loadIncidentData(env={}){
  const data=await attachItsmLinks(await loadRawIncidentData(env),env);
  data.integrations.simpleOne=simpleOneDispatchInfo(env);
  return data;
}
async function loadRawIncidentData(env={}){
  if(env.DB){
    let inputSource=null,warning=env.INCIDENTS_SOURCE_UNAVAILABLE?'Источник данных временно недоступен. Показана сохранённая версия.':null;
    if(env.INCIDENTS_JSON!==undefined)inputSource={raw:env.INCIDENTS_JSON,name:'Обновление исходного файла'};
    else if(env.INCIDENTS_SOURCE_URL){
      try{
        const endpoint=new URL(env.INCIDENTS_SOURCE_URL);if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password)throw new Error();
        const response=await fetch(endpoint,{headers:{Accept:'application/json','Cache-Control':'no-cache'},redirect:'error',signal:AbortSignal.timeout(7000)});
        if(!response.ok)throw new Error();inputSource={raw:await boundedJson(response,SHARED_MAX_BYTES),name:'Общий источник данных'};
      }catch{warning='Источник данных временно недоступен. Показана сохранённая версия.';}
    }
    const snapshot=await sharedDataset(env.DB,RAW_INCIDENTS,FIELD_DICTIONARY,inputSource);
    if(warning)snapshot.sourceWarning=warning;
    return snapshot;
  }
  let raw=RAW_INCIDENTS,source='bundled';
  if(env.INCIDENTS_SOURCE_URL){
    const url=new URL(env.INCIDENTS_SOURCE_URL);
    if(url.protocol!=='https:'||url.username||url.password)throw new Error('Источник должен быть HTTPS URL без учётных данных.');
    const response=await fetch(url,{headers:{Accept:'application/json','Cache-Control':'no-cache'},redirect:'error',signal:AbortSignal.timeout(7000)});
    if(!response.ok)throw new Error('Источник выгрузки недоступен.');
    raw=await boundedJson(response,2097152);source='remote';
  }else if(env.INCIDENTS_JSON!==undefined){
    // Local development reads data/incidents.json on every request.
    raw=typeof env.INCIDENTS_JSON==='string'?JSON.parse(env.INCIDENTS_JSON):env.INCIDENTS_JSON;source='file';
  }
  const dataset=normalizeIncidentDataset(raw,FIELD_DICTIONARY);
  const bytes=new TextEncoder().encode(JSON.stringify(raw));
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  const revision=Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,'0')).join('');
  return {...dataset,revision,source,pollIntervalMs:5000,loadedAt:new Date().toISOString()};
}
function validateClientDemo(body){
  if(!body||typeof body.question!=='string'||!body.question.trim()||body.question.length>2000)throw {status:400,message:'Вопрос должен содержать от 1 до 2000 символов.'};
  if(!Array.isArray(body.snapshot?.incidents)||body.snapshot.incidents.length>500)throw {status:400,message:'Некорректный контекст инцидентов (максимум 500).'};
  const incidents=body.snapshot.incidents.map(i=>{
    const timestamp=x=>typeof x==='number'&&Number.isFinite(x)&&x>0&&x<8640000000000000;
    if(!i||!/^INC-?\d{1,18}$/.test(i.id)||!['assigned','working','investigating','resolved','closed'].includes(i.status)||!Object.hasOwn(priorityLabels,i.priority)||!timestamp(i.createdAt)||!(i.dueAt===null||timestamp(i.dueAt)))throw {status:400,message:'Некорректная карточка инцидента.'};
    return {id:i.id,title:clip(i.title,180),product:clip(i.product,100),priority:i.priority,status:i.status,team:clip(i.team,150),assignee:clip(i.assignee,100),description:clip(i.description,850),summary:clip(i.summary,700),recommendation:clip(i.recommendation,150),createdAt:i.createdAt,dueAt:i.dueAt};
  });
  if(new Set(incidents.map(i=>i.id)).size!==incidents.length)throw {status:400,message:'Повторяющиеся ID в контексте.'};
  const history=Array.isArray(body.history)?body.history.slice(-8).filter(m=>m&&['user','assistant'].includes(m.role)&&typeof m.content==='string').map(m=>({role:m.role,content:m.content.slice(0,1600)})):[];
  return {question:body.question.trim(),history,snapshot:{simulation:body.snapshot.simulation===true,incidents,selectedId:incidents.some(i=>i.id===body.snapshot.selectedId)?body.snapshot.selectedId:null}};
}
export async function assistantInput(body,env={}){
  if(!body||typeof body.question!=='string'||!body.question.trim()||body.question.length>2000)throw {status:400,message:'Вопрос должен содержать от 1 до 2000 символов.'};
  const contextMode=body.contextMode??'server';
  if(!['server','client_demo'].includes(contextMode))throw {status:400,message:'Неизвестный режим контекста.'};
  if(contextMode==='client_demo'){
    const input=validateClientDemo(body);input.snapshot.simulation=true;
    return {input,context:{mode:'client_demo',view:'local-demo',simulation:true,revision:null,version:null,total:input.snapshot.incidents.length,source:'browser-demo',stale:false}};
  }
  if(Object.hasOwn(body,'snapshot'))throw {status:400,message:'Для обычного вопроса снимок берётся на сервере. Клиентский снимок разрешён только в явно обозначенном деморежиме.'};
  if(body.context!==undefined&&(body.context===null||typeof body.context!=='object'||Array.isArray(body.context)))throw {status:400,message:'Некорректный выбор контекста.'};
  const view=body.context?.view??'source',selectedId=body.context?.selectedId??null;
  if(!['source','mts-demo'].includes(view)||selectedId!==null&&(typeof selectedId!=='string'||!/^INC-?\d{1,18}$/.test(selectedId)))throw {status:400,message:'Некорректный выбор контекста.'};
  let source,workflow;try{source=await loadIncidentData(env);workflow=await incidentWorkflowSnapshot(env.DB,source.incidents);}catch{throw {status:503,message:'Не удалось получить актуальные инциденты. Повторите вопрос после восстановления источника.'};}
  if(selectedId&&!source.incidents.some(i=>i.id===selectedId))throw {status:404,message:'Выбранного инцидента больше нет в текущей выгрузке. Обновите данные и выберите карточку снова.'};
  const dataset=view==='mts-demo'?projectMtsSimulation(source):source;
  const history=Array.isArray(body.history)?body.history.slice(-8).filter(m=>m&&['user','assistant'].includes(m.role)&&typeof m.content==='string').map(m=>({role:m.role,content:m.content.slice(0,1600)})):[];
  return {input:{question:body.question.trim(),history,snapshot:{simulation:view==='mts-demo',selectedId,incidents:incidentAssignments(dataset.incidents,workflow)}},context:{mode:'server',view,simulation:view==='mts-demo',revision:source.revision,version:source.version??null,total:dataset.incidents.length,source:source.source,stale:Boolean(source.sourceWarning),sourceWarning:source.sourceWarning||null}};
}
function allowRequest(request,user){
  const key=user.userId;
  const now=Date.now(),old=rateWindows.get(key);
  if(rateWindows.size>3000)for(const[k,v]of rateWindows)if(now-v.start>60000)rateWindows.delete(k);
  if(!old||now-old.start>60000){if(!old&&rateWindows.size>=3000)return false;rateWindows.set(key,{start:now,count:1});return true;}
  if(old.count>=12)return false;old.count++;return true;
}
async function workflowModelReply(snapshot,question,env,selectedId=null){
  const config=await aiEffectiveEnvironment(env);
  if(!config.YANDEX_API_KEY||!config.YANDEX_FOLDER_ID)return null;
  return yandexAnswer({question,history:[],snapshot:{...snapshot,simulation:Boolean(snapshot.simulation),selectedId}},config,{timeout:10000});
}
async function workflowAnalysis(snapshot,id,env){
  const selected=id?snapshot.incidents.find(i=>i.id===id):null;
  if(id&&!selected)throw {status:404,message:'Инцидент больше не входит в выгрузку.'};
  const items=selected?[selected]:relevanceOrder(snapshot.incidents.filter(i=>isActiveIncident(i)&&incidentGroups(i).length)).slice(0,8);
  const estimates=Object.fromEntries(items.map(i=>[i.id,escalationAssessment(i)]));
  if(!items.length)return {source:'rules',revision:snapshot.revision,estimates};
  try{
    const result=await workflowModelReply({...snapshot,incidents:items},
      'Оцени релевантность и риск эскалации по названию, описанию, времени создания и сроку. Для каждого переданного ID верни только JSON-массив вида [{"id":"INC...","level":"high|medium|low","boost":0,"reason":"одно основание из контекста"}]. boost от -16 до 16, это поправка к очереди, а не процент. Критический инцидент уже эскалирован. Недостающие факты не выдумывай.',env,selected?.id);
    if(!result)return {source:'rules',revision:snapshot.revision,estimates};
    const rows=JSON.parse(result.answer.replace(/^\x60{3}(?:json)?\s*|\s*\x60{3}$/gi,''));
    if(!Array.isArray(rows))throw new Error('invalid_workflow_estimates');
    const known=new Set(items.map(item=>item.id)),model=Object.create(null);
    for(const row of rows){
      if(!row||!known.has(row.id)||!['high','medium','low'].includes(row.level)||!Number.isFinite(row.boost)||typeof row.reason!=='string'||!row.reason.trim())continue;
      if(['critical','none'].includes(estimates[row.id].level))continue;
      model[row.id]={level:row.level,boost:Math.max(-16,Math.min(16,Math.round(row.boost))),reason:row.reason.trim().slice(0,250)};
    }
    if(Object.keys(model).length)return {source:'yandex',revision:snapshot.revision,estimates,model};
  }catch{}
  return {source:'rules',revision:snapshot.revision,estimates};
}

async function acceptSimpleOneResolution(request,env,body){
  const token=env.SIMPLEONE_EVENTS_TOKEN;
  if(!token||!env.DB)throw {status:404,message:'Входящие события SimpleOne не настроены.'};
  const auth=request.headers.get('authorization')||'';
  const encoder=new TextEncoder();
  const [expected,received]=await Promise.all(['Bearer '+token,auth].map(value=>
    crypto.subtle.digest('SHA-256',encoder.encode(value)).then(bytes=>new Uint8Array(bytes))));
  if(expected.reduce((diff,byte,index)=>diff|(byte^received[index]),0)!==0)throw {status:401,message:'Требуется токен событий SimpleOne.'};
  if(body.event!=='resolved'||typeof body.solution!=='string'||!/^[a-f0-9]{32}$/.test(body.dispatchId))
    throw {status:422,message:'Ожидается подтверждение решения с ID передачи и описанием.'};
  const snapshot=await loadIncidentData(env);
  const item=snapshot.incidents.find(item=>item.id===body.incidentId&&item.sysId===body.sysId);
  if(!item)throw {status:404,message:'Инцидент отсутствует в текущей выгрузке.'};
  const current=await readIncidentWorkflow(env.DB,item),dispatch=current?.dispatch;
  if(dispatch?.state!=='sent'||dispatch.id!==body.dispatchId||dispatch.groupId!==body.assignmentGroupId)
    throw {status:409,message:'Подтверждение относится к другой передаче или команде.'};
  if(current.caseStatus||['resolved','investigating','closed'].includes(item.status))return {received:true,alreadyResolved:true};
  const actor={role:'executor',dispatchId:dispatch.id,displayName:current.team+' · SimpleOne'};
  const next=nextWorkflowState(item,current,{action:'resolve',version:current.version,note:body.solution},actor);
  await saveIncidentWorkflow(env.DB,snapshot,next);
  return {received:true};
}
export default {
  async fetch(request,env={}){
    const url=new URL(request.url);
    const platformUser=currentUser(request),passwordUser=await passwordSession(request,env),user=passwordUser||platformUser;
    const canManageAccounts=Boolean(env.DB)&&(canImportIncidents(user,env)||canImportIncidents(platformUser,env));
    if(['/api/auth/register','/api/auth/login','/api/auth/logout','/api/auth/account-role'].includes(url.pathname)){
      if(request.method!=='POST')return json({error:'Метод не поддерживается.'},405,{Allow:'POST'});
      if(!authSameOrigin(request))return json({error:'Недопустимый источник запроса.'},403);
      try{
        if(url.pathname==='/api/auth/logout')return json({ok:true,redirectTo:platformUser?signOutPath('/'):'/'},200,{'Set-Cookie':await logoutPasswordUser(request,env)});
        if(!request.headers.get('content-type')?.includes('application/json'))return json({error:'Отправьте JSON.'},415);
        const body=await boundedJson(request,8192);if(!body||typeof body!=='object'||Array.isArray(body))return json({error:'Некорректные данные формы.'},400);
        if(url.pathname==='/api/auth/account-role'){
          if(!canManageAccounts)return json({error:'Изменять права может только редактор команды.'},403);
          await setPasswordUserRole(env,body.userId,body.role);return json({ok:true});
        }
        const result=url.pathname==='/api/auth/register'?await registerPasswordUser(request,env,body):await loginPasswordUser(request,env,body);
        return json({authenticated:true,user:{displayName:result.user.displayName,username:result.user.username,role:result.user.role,authProvider:'password'},redirectTo:safeReturnPath(body.returnTo||'/')},url.pathname.endsWith('register')?201:200,{'Set-Cookie':result.cookie});
      }catch(error){return json({error:error.status?error.message:'Не удалось выполнить вход. Повторите попытку.'},error.status||503,error.retryAfter?{'Retry-After':String(error.retryAfter)}:{});}
    }
    if(url.pathname==='/api/auth/accounts'){
      if(request.method!=='GET')return json({error:'Метод не поддерживается.'},405,{Allow:'GET'});
      if(!canManageAccounts)return json({error:'Нужны права редактора команды.'},403);
      try{return json({users:await listPasswordUsers(env)});}catch{return json({error:'Список учётных записей временно недоступен.'},503);}
    }
    if(url.pathname==='/api/incidents'){
      if(request.method!=='GET')return json({error:'Метод не поддерживается.'},405,{'Allow':'GET'});
      try{
        const data=await loadIncidentData(env);
        const workflow=await incidentWorkflowSnapshot(env.DB,data.incidents);
        data.workflow=workflow.map(row=>workflowForViewer(row,user));
        const suffix=workflow.length||data.integrations.simpleOne.mode!=='demo'
          ?'-'+(await incidentRevision([data.workflow,data.integrations.simpleOne])).slice(0,20):'';
        const etag='"'+data.representationRevision+suffix+'"';
        if(!data.sourceWarning&&request.headers.get('if-none-match')===etag)return new Response(null,{status:304,headers:{ETag:etag,'Cache-Control':'no-store'}});
        return json(data,200,{ETag:etag});
      }catch{return json({error:'Не удалось прочитать выгрузку. Проверьте JSON, статусы и даты источника.',code:'incident_source_unavailable'},503);}
    }
    if(url.pathname==='/api/simpleone/demo'||url.pathname==='/api/simpleone/events'){
      if(request.method!=='POST')return json({error:'Метод не поддерживается.'},405,{Allow:'POST'});
      const demo=url.pathname.endsWith('/demo');
      if(demo&&!authSameOrigin(request))return json({error:'Недопустимый источник запроса.'},403);
      if(!request.headers.get('content-type')?.includes('application/json'))return json({error:'Отправьте JSON.'},415);
      try{
        const body=await boundedJson(request,8192);
        if(!body||typeof body!=='object'||Array.isArray(body))throw {status:400,message:'Некорректное тело запроса.'};
        return json(demo?acceptDemoDispatch(body):await acceptSimpleOneResolution(request,env,body));
      }catch(error){return json({error:error.status?error.message:'Не удалось обработать сообщение SimpleOne.'},error.status||503);}
    }
    if(url.pathname==='/api/workflow'||url.pathname==='/api/workflow/analysis'){
      if(!user)return json({error:'Войдите в учётную запись для совместной работы.'},401);
      if(!env.DB)return json({error:'Хранилище назначений недоступно.'},503);
      const analysis=url.pathname.endsWith('/analysis');
      if(request.method!=='POST')return json({error:'Метод не поддерживается.'},405,{Allow:'POST'});
      if(!authSameOrigin(request))return json({error:'Недопустимый источник запроса.'},403);
      if(!request.headers.get('content-type')?.includes('application/json'))return json({error:'Отправьте JSON.'},415);
      try{
        const body=await boundedJson(request,8192);
        if(!body||typeof body!=='object'||Array.isArray(body))throw {status:400,message:'Некорректные данные операции.'};
        const source=await loadIncidentData(env),snapshot=body.view==='mts-demo'?projectMtsSimulation(source):source;
        if(analysis){
          if(!allowRequest(request,user))return json({error:'Повторите запрос позже.'},429);
          return json(await workflowAnalysis(snapshot,body.id,env));
        }
        if(body.action==='demo-executor-resolve'){
          const item=source.incidents.find(item=>item.id===body.id);
          if(!item)throw {status:404,message:'Инцидент отсутствует в текущей выгрузке.'};
          const current=await readIncidentWorkflow(env.DB,item);
          if(current?.dispatch?.state!=='demo'||current.dispatch.id!==body.dispatchId)
            throw {status:409,message:'Учебное назначение изменилось.'};
          const executor={role:'executor',dispatchId:current.dispatch.id,displayName:current.team+' · учебный SimpleOne'};
          const next=nextWorkflowState(item,current,{...body,action:'resolve'},executor);
          return json({workflow:workflowForViewer(await saveIncidentWorkflow(env.DB,source,next),user)});
        }
        const delivery=['assign','retry'].includes(body.action);
        const config=delivery?simpleOneConfiguration(env):null;
        const {item,next}=await planIncidentWorkflow(env.DB,snapshot,body,user,config);
        if(body.action==='assign'&&allowRequest(request,user)){
          try{
            const question='Для передачи '+item.id+' подготовь короткий черновик для исполнительной команды. Назови известные симптомы, факты, срок и что проверить дальше. Получатель: '+next.team+'. Комментарий передающего: '+JSON.stringify(String(body.note||'').slice(0,500))+'. Не достраивай историю выполненных работ.';
            const model=await workflowModelReply({...snapshot,incidents:[item]},question,env,item.id);
            if(model){next.report+='\n\nЧерновик Яндекса · сверить по карточке\n'+model.answer.slice(0,3000);next.reportSource='yandex';}
          }catch{}
        }
        await saveIncidentWorkflow(env.DB,source,next);
        if(!delivery)return json({workflow:workflowForViewer(next,user)});
        const state=await sendSimpleOneAssignment(item,next,config);
        const finished=completeWorkflowDelivery(next,state,user);
        return json({workflow:workflowForViewer(await saveIncidentWorkflow(env.DB,source,finished),user)});
      }catch(error){return json({error:error.status?error.message:'Не удалось выполнить действие. Повторите попытку.'},error.status||503);}
    }
    if(url.pathname==='/api/incidents/import'){
      if(request.method!=='POST')return json({error:'Метод не поддерживается.'},405,{Allow:'POST'});
      if(!user)return json({error:'Войдите, чтобы обновлять общие данные.',code:'authentication_required'},401);
      if(!canImportIncidents(user,env))return json({error:'Для загрузки нужны права редактора.'},403);
      if(!env.DB)return json({error:'Общее хранилище пока недоступно.'},503);
      const origin=request.headers.get('origin');if(origin&&origin!==url.origin)return json({error:'Недопустимый источник запроса.'},403);
      if(!request.headers.get('content-type')?.includes('application/json'))return json({error:'Выберите файл выгрузки в формате JSON.'},415);
      const tag=request.headers.get('if-match');if(!tag)return json({error:'Сначала обновите данные и повторите загрузку.'},428);
      const match=tag.match(/^"?([a-f0-9]{64})"?$/);if(!match)return json({error:'Некорректная версия данных.'},400);
      try{
        const raw=await boundedJson(request,SHARED_MAX_BYTES);
        await ensureSharedData(env.DB,RAW_INCIDENTS);
        let name;try{name=decodeURIComponent(request.headers.get('x-source-name')||'Обновлённая выгрузка');}catch{return json({error:'Некорректное имя файла.'},400);}
        const result=await importSharedDataset(env.DB,raw,match[1],user,name);
        let snapshot=null;try{
          const current=await loadIncidentData(env);
          snapshot={...current,workflow:(await incidentWorkflowSnapshot(env.DB,current.incidents)).map(row=>workflowForViewer(row,user))};
        }catch{}
        return json({...result,snapshot,refreshRequired:!snapshot});
      }catch(e){return json({error:e.status?e.message:'Не удалось подтвердить сохранение. Обновите данные и проверьте историю.'},e.status||503);}
    }
    if(url.pathname==='/api/incidents/history'){
      if(request.method!=='GET')return json({error:'Метод не поддерживается.'},405,{Allow:'GET'});
      if(!env.DB)return json({events:[],hasMore:false,nextCursor:null,persistent:false});
      const limit=Number(url.searchParams.get('limit')||50),before=url.searchParams.has('before')?Number(url.searchParams.get('before')):null,incidentId=url.searchParams.get('incident_id')||null;
      if(!Number.isInteger(limit)||limit<1||limit>100||before!==null&&(!Number.isSafeInteger(before)||before<1)||incidentId&&!/^INC-?\d{1,18}$/.test(incidentId))return json({error:'Некорректные параметры истории.'},400);
      try{await ensureSharedData(env.DB,RAW_INCIDENTS);return json({...await listSharedEvents(env.DB,{limit,before,incidentId}),persistent:true});}catch{return json({error:'История временно недоступна.'},503);}
    }
    if(url.pathname==='/api/incidents/export'){
      if(request.method!=='GET')return json({error:'Метод не поддерживается.'},405,{Allow:'GET'});
      if(!user)return json({error:'Войдите, чтобы скачать выгрузку.'},401);
      if(!canImportIncidents(user,env))return json({error:'Нужны права редактора.'},403);
      if(!env.DB)return json({error:'Общее хранилище пока недоступно.'},503);
      const version=url.searchParams.has('version')?Number(url.searchParams.get('version')):null;
      if(version!==null&&(!Number.isSafeInteger(version)||version<1))return json({error:'Некорректная версия.'},400);
      try{
        await ensureSharedData(env.DB,RAW_INCIDENTS);
        const record=version===null?await readSharedState(env.DB):await env.DB.prepare('SELECT version,raw_json FROM incident_imports WHERE version=?').bind(version).first();
        if(!record)return json({error:'Версия не найдена.'},404);
        return new Response(record.raw_json,{headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Content-Disposition':`attachment; filename="incidents-v${record.version}.json"`}});
      }catch{return json({error:'Не удалось прочитать выгрузку.'},503);}
    }
    if(url.pathname==='/api/auth/me'){
      if(request.method!=='GET')return json({error:'Метод не поддерживается.'},405,{'Allow':'GET'});
      return json({authenticated:Boolean(user),user:user?{displayName:user.displayName,email:user.email,username:user.username||null,role:user.role,authProvider:user.authProvider||'platform'}:null,capabilities:{viewDashboard:true,runDemo:true,askAssistant:Boolean(user),importIncidents:Boolean(env.DB)&&canImportIncidents(user,env),manageAccounts:canManageAccounts,passwordLogin:Boolean(env.DB),register:Boolean(env.DB)&&env.AUTH_REGISTRATION_OPEN!=='0'},loginUrl:loginPath('/'),assistantLoginUrl:loginPath('/?assistant=1'),logoutUrl:passwordUser?'/api/auth/logout':signOutPath('/'),logoutMethod:passwordUser?'POST':'GET'});
    }
    if(url.pathname==='/login'){
      if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405,headers:{Allow:'GET, HEAD'}});
      const returnTo=safeReturnPath(url.searchParams.get('return_to')||'/');
      if(passwordUser)return new Response(null,{status:302,headers:{Location:returnTo,'Cache-Control':'no-store'}});
      const login=ASSETS['/login'];if(!login)return new Response('Login page unavailable',{status:503});
      const body=login.body.replaceAll('{{AUTH_URL}}',()=>htmlAttr(signInPath(returnTo)));
      return new Response(request.method==='HEAD'?null:body,{headers:{'Content-Type':login.type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
    }
    if(url.pathname==='/api/assistant/settings'){
      if(!canManageAccounts)return json({error:'Настройки ИИ доступны только редакторам команды.'},403);
      if(request.method==='GET')return json(await aiSettingsSummary(env));
      if(request.method!=='POST')return json({error:'Метод не поддерживается.'},405,{Allow:'GET, POST'});
      if(!authSameOrigin(request))return json({error:'Недопустимый источник запроса.'},403);
      if(!request.headers.get('content-type')?.includes('application/json'))return json({error:'Отправьте JSON.'},415);
      try{const body=await boundedJson(request,8192);if(!body||typeof body!=='object'||Array.isArray(body))throw {status:400,message:'Некорректные настройки.'};return json(await saveAiSettings(env,body,(user||platformUser).userId));}catch(error){return json({error:error.status?error.message:'Не удалось сохранить подключение ИИ.'},error.status||503);}
    }
    if(url.pathname==='/api/assistant/status'){
      if(request.method!=='GET')return json({error:'Метод не поддерживается.'},405,{'Allow':'GET'});
      try{return json(yandexStatus(await aiEffectiveEnvironment(env)));}catch{return json({configured:false,available:false,mode:'local',provider:'yandex',label:'Нужна проверка подключения',message:'Не удалось прочитать настройки модели. Пока доступен анализ по правилам.'});}
    }
    if(url.pathname==='/api/assistant/chat'){
      if(request.method!=='POST')return json({error:'Метод не поддерживается.'},405,{'Allow':'POST'});
      if(!user)return json({error:'Чтобы задавать вопросы помощнику, войдите в Фокус.',code:'authentication_required',loginUrl:loginPath('/?assistant=1')},401);
      const origin=request.headers.get('origin');if(origin&&origin!==url.origin)return json({error:'Недопустимый источник запроса.'},403);
      if(!allowRequest(request,user))return json({error:'Слишком много вопросов. Повторите через минуту.'},429,{'Retry-After':'60'});
      let input,context;try{({input,context}=await assistantInput(await readJson(request),env));}catch(e){return json({error:e.status?e.message:'Не удалось подготовить контекст инцидентов.'},e.status||503);}
      let answer,model=null,mode='local',warning=null,modelEnv=env;
      try{modelEnv=await aiEffectiveEnvironment(env);}catch{warning='Не удалось прочитать настройки Яндекса. Ниже анализ по правилам.';}
      if(context.mode==='server'&&modelEnv.YANDEX_API_KEY&&modelEnv.YANDEX_FOLDER_ID){try{const result=await yandexAnswer(input,modelEnv);answer=result.answer;model=result.model;mode='llm';warning=result.warning;}catch{warning='Модель Яндекса сейчас не ответила. Ниже - демо-анализ по правилам, а не ответ нейросети.';}}
      if(context.mode==='client_demo')warning='Локальная симуляция: ответ по временным данным этой вкладки, без вызова языковой модели.';
      if(context.stale)warning=[warning,context.sourceWarning].filter(Boolean).join(' ');
      if(!answer)answer=localAnswer(input.question,input.snapshot,input.history);
      if(input.snapshot.simulation)answer='Учебная симуляция МТС.\n\n'+answer;
      return json({answer,mode,model,warning,label:mode==='llm'?'Фокус AI · Яндекс':'Демо-анализ',provider:mode==='llm'?'yandex':'rules',references:selectReferences(answer,input.snapshot.incidents),context,snapshotAt:new Date().toISOString(),requestId:crypto.randomUUID()});
    }
    if(url.pathname.startsWith('/api/'))return json({error:'Маршрут не найден.'},404);
    if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405,headers:{Allow:'GET, HEAD'}});
    let assetPath=url.pathname.replace(/\/+$/,'')||'/';
    if(assetPath==='/guide.html'||assetPath==='/guide/index.html')assetPath='/guide';
    const asset=ASSETS[assetPath==='/index.html'?'/':assetPath];
    if(!asset)return new Response('Not found',{status:404});
    const body=asset.encoding==='base64'?Uint8Array.from(atob(asset.body),c=>c.charCodeAt(0)):asset.body;
    return new Response(request.method==='HEAD'?null:body,{headers:{'Content-Type':asset.type,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff',...(asset.filename?{'Content-Disposition':`attachment; filename="${asset.filename}"`}:{})}});
  }
};
