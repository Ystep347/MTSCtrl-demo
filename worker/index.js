import {canStoreAiSettings,aiEffectiveEnvironment,saveAiSettings,aiSettingsSummary} from '../lib/ai-settings.mjs';
import {authSameOrigin,passwordSession,registerPasswordUser,loginPasswordUser,logoutPasswordUser,listPasswordUsers,setPasswordUserRole} from '../lib/auth.mjs';
import {projectMtsSimulation} from '../lib/mts-simulation.mjs';
import {canImportIncidents,sharedDataset,ensureSharedData,importSharedDataset,listSharedEvents,readSharedState,SHARED_MAX_BYTES} from '../lib/shared-data.mjs';
import {yandexAnswer,yandexStatus} from '../lib/yandex.mjs';
import {normalizeIncidentDataset,isActiveIncident,isFinishedIncident,incidentGroups} from '../lib/incidents.mjs';
import {attachItsmLinks} from '../lib/itsm.mjs';
const ASSETS = /* __ASSETS__ */ {};
const RAW_INCIDENTS = /* __INCIDENTS__ */ [];
const FIELD_DICTIONARY = /* __ATTRIBUTES__ */ [];
const COORDINATORS='КЦ ИТ Координаторы Массовых Инцидентов';
const labels={working:'Выполняется',assigned:'Назначен',investigating:'Исследование',resolved:'Завершён',closed:'Закрыт'};
const priorityLabels={critical:'Критический',high:'Высокий',medium:'Средний',low:'Низкий'};
const rateWindows=new Map();
const normalize=s=>String(s||'').toLocaleLowerCase('ru').replaceAll('ё','е');
const active=isActiveIncident;
const clock=t=>new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',hour:'2-digit',minute:'2-digit'}).format(t);
const shortTeam=t=>t===COORDINATORS?'Координаторы':t;
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
function groupNames(i){return incidentGroups(i).map(key=>({critical:'Критические',coord:'На координаторах',high:'Высокий приоритет',research:'Исследование'})[key]);}
function remaining(i,now){if(isFinishedIncident(i))return `Инцидент завершён. Статус: ${labels[i.status]}.`;if(i.status==='investigating')return 'Статус — исследование ситуации; продолжается разбор причин.';if(i.dueAt===null)return 'Дедлайн в выгрузке не указан.';const minutes=Math.max(1,Math.ceil(Math.abs(i.dueAt-now)/60000));return i.dueAt<now?`Срок решения нарушен на ${minutes} мин.`:`До срока решения — ${minutes} мин (до ${clock(i.dueAt)} МСК).`;}
function row(i,now){return `${i.id} — ${i.title}\n${i.product} · ${labels[i.status]} · ${shortTeam(i.team)}\nИсполнитель: ${i.assignee}. ${remaining(i,now)}`;}
function selectReferences(answer,incidents){const known=new Set(incidents.map(i=>i.id));return [...new Set(answer.match(/INC-?\d+/g)||[])].filter(x=>known.has(x)).slice(0,8);}

export function localAnswer(question,snapshot,history=[],now=Date.now()){
  const all=snapshot.incidents,q=normalize(question);
  let id=q.match(/inc[-\s]?(\d+)/i)?.[0]?.toUpperCase().replace(/\s/g,'');
  if(!id&&/(?:^|\s)(его|ему|нем|ним|он|этот|этому)(?:\s|[?.!,]|$)|сколько времени|кто решает|кому передать|объясни этот/.test(q)){
    id=snapshot.selectedId||history.filter(m=>m.role==='user').map(m=>m.content.match(/INC[-\s]?(\d+)/i)?.[0]?.toUpperCase().replace(/\s/g,'')).filter(Boolean).at(-1);
  }
  const focused=id?all.find(i=>i.id.replace(/^INC-?/,'')===id.replace(/^INC-?/,'')):null;
  if(id&&!focused)return `В текущем наборе нет инцидента ${id}. Проверьте ID или выберите карточку на дашборде.`;
  if(focused){
    if(/кому|переда|рекоменду|подключить команд/.test(q))return focused.recommendation?`${focused.id}: рекомендуется команда «${focused.recommendation}».\n\nОснование: продукт «${focused.product}» и описание проблемы: ${focused.description}\n\nСейчас назначен на «${shortTeam(focused.team)}». Передачу подтверждает координатор в ITSM.`:`${focused.id}: сейчас назначен на «${shortTeam(focused.team)}».\n\nВ выгрузке нет справочника владельцев продукта «${focused.product}», поэтому надёжно рекомендовать другую команду по этим данным нельзя. Координатору нужно уточнить владельца сервиса; команда по названию продукта не выдумывается.`;
    if(/кто|исполнител|ответствен|какая команда/.test(q))return `${focused.id} решает ${focused.assignee}, команда «${shortTeam(focused.team)}».\nСтатус: ${labels[focused.status]}. ${remaining(focused,now)}`;
    if(/врем|срок|дедлайн|sla/.test(q))return `${focused.id}: ${remaining(focused,now)}\nСоздан: ${clock(focused.createdAt)} МСК. Статус: ${labels[focused.status]}.`;
    return `${row(focused,now)}\n\n${focused.summary||focused.description}\n\nГруппы: ${groupNames(focused).join(', ')||(isFinishedIncident(focused)?'Завершённые':'Вне четырёх групп фокуса')}. Точная техническая причина в текущих данных не подтверждена.`;
  }
  const open=all.filter(active),critical=open.filter(i=>i.priority==='critical').sort((a,b)=>(a.dueAt??Infinity)-(b.dueAt??Infinity)),overdue=open.filter(i=>i.dueAt!==null&&i.dueAt<now),coord=all.filter(i=>i.team===COORDINATORS&&!isFinishedIncident(i)),research=all.filter(i=>i.status==='investigating');
  const overview=()=>`Всего в снимке: ${all.length}. В фокусе ${all.filter(i=>groupNames(i).length).length} уникальных инцидентов.\n\nАктивных: ${open.length}.\nКритических: ${critical.length}.\nПросроченных: ${overdue.length}.\nНа координаторах: ${coord.length}.\nНа исследовании: ${research.length}.\nЗавершённых и закрытых: ${all.filter(isFinishedIncident).length}.\n\n${critical.length?`Ближайший критический дедлайн: ${critical[0].id}. ${remaining(critical[0],now)}`:'Критических инцидентов сейчас нет.'}\n\nОдин инцидент может входить в несколько групп, поэтому счётчики групп не складываются.`;
  if(/сводк/.test(q))return overview();
  if(/что такое.*sla|что значит.*sla|объясни.*sla|что такое.*срок/.test(q))return 'SLA — согласованный срок предоставления услуги или выполнения обязательства. На этом дашборде отслеживается срок решения инцидента: время до дедлайна или длительность просрочки. На этапе исследования сервис уже восстановлен; разбор причин показывается отдельно.';
  if(/нескольк.*групп|двух.*групп|дублир|почему.*групп/.test(q)){const overlap=all.filter(i=>groupNames(i).length>1);return 'Группы могут пересекаться, потому что проверяют разные признаки: приоритет, команду назначения и статус. Общий счётчик учитывает каждый ID один раз.\n\n'+(overlap.length?overlap.map(i=>`${i.id}: ${groupNames(i).join(', ')}.`).join('\n'):'В текущем снимке пересечений нет.');}
  if(/просроч|наруш.*срок/.test(q))return overdue.length?`Просроченных активных инцидентов: ${overdue.length}.\n\n${overdue.map(i=>row(i,now)).join('\n\n')}\n\nНужно уточнить прогресс ответственных и необходимость эскалации.`:'Сейчас просроченных активных инцидентов нет. Решённые инциденты и исследование не считаются активной просрочкой.';
  if(/координатор|передать/.test(q))return coord.length?`На координаторах ${coord.length} инцидента:\n\n${coord.map(i=>`${i.id} — ${i.title}\n${labels[i.status]}. Рекомендуемая команда: ${i.recommendation||'требуется уточнение'}.`).join('\n\n')}\n\nДля исследования передаются материалы разбора причин: сервис уже восстановлен.`:'У координаторов сейчас нет инцидентов для передачи.';
  if(/исслед|разбор причин/.test(q))return research.length?`На исследовании ${research.length} инцидента. Сервисы уже восстановлены:\n\n${research.map(i=>`${i.id} — ${i.title}\nКоманда: ${shortTeam(i.team)}. ${i.team===COORDINATORS?'Нужно передать разбор профильной команде.':'Продолжается разбор причин.'}`).join('\n\n')}`:'Инцидентов на исследовании сейчас нет.';
  if(/решен|завершен|восстановлен|закрыт/.test(q)){const solved=all.filter(i=>isFinishedIncident(i)||i.status==='investigating');return solved.length?`Завершённые и исследуемые инциденты:\n\n${solved.map(i=>`${i.id} — ${i.product}. ${labels[i.status]}.`).join('\n')}`:'В текущем наборе нет завершённых инцидентов.';}
  if(/критич|сроч|важн|приоритет|первую очередь|сначала/.test(q)){
    const urgent=critical.length?critical:overdue.length?overdue:open.filter(i=>i.priority==='high');
    return urgent.length?`${critical.length?'Сначала — критические инциденты':'Приоритетное внимание'} (${urgent.length}):\n\n${urgent.slice(0,5).map(i=>row(i,now)).join('\n\n')}${critical.some(i=>i.team===COORDINATORS)?'\n\nУ критического инцидента на координаторах нужно оперативно определить профильную команду.':''}`:'Активных критических и высокоприоритетных инцидентов сейчас нет.';
  }
  const product=all.filter(i=>[normalize(i.product),...(normalize(i.product).includes('банк')?['банк']:[]),...(i.product==='КИОН'?['кион']:[]),...(i.product==='Сообщения'?['sms','смс']:[]),...(i.product==='Мой МТС'?['мой мтс']:[])].some(name=>name&&q.includes(name)));
  if(product.length)return `По выбранному продукту:\n\n${product.map(i=>row(i,now)).join('\n\n')}`;
  if(/сводк|ситуац|обзор|сколько.*инцидент|количеств|что сломалось|что происходит/.test(q))return overview();
  return 'Сейчас включён демо-анализ по данным дашборда, без языковой модели. Я могу показать срочные и просроченные инциденты, объяснить карточку по ID, назвать исполнителя или рекомендуемую команду.\n\nНапример: «Что сейчас самое срочное?», «Какие инциденты просрочены?» или вопрос с ID из выбранной карточки. Для свободных вопросов требуется подключение модели.';
}

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
  return attachItsmLinks(await loadRawIncidentData(env),env);
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
    if(!i||!/^INC-?\d{1,18}$/.test(i.id)||!Object.hasOwn(labels,i.status)||!Object.hasOwn(priorityLabels,i.priority)||!timestamp(i.createdAt)||!(i.dueAt===null||timestamp(i.dueAt)))throw {status:400,message:'Некорректная карточка инцидента.'};
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
  let source;try{source=await loadIncidentData(env);}catch{throw {status:503,message:'Не удалось получить актуальные инциденты. Повторите вопрос после восстановления источника.'};}
  if(selectedId&&!source.incidents.some(i=>i.id===selectedId))throw {status:404,message:'Выбранного инцидента больше нет в текущей выгрузке. Обновите данные и выберите карточку снова.'};
  const dataset=view==='mts-demo'?projectMtsSimulation(source):source;
  const history=Array.isArray(body.history)?body.history.slice(-8).filter(m=>m&&['user','assistant'].includes(m.role)&&typeof m.content==='string').map(m=>({role:m.role,content:m.content.slice(0,1600)})):[];
  return {input:{question:body.question.trim(),history,snapshot:{simulation:view==='mts-demo',selectedId,incidents:dataset.incidents}},context:{mode:'server',view,simulation:view==='mts-demo',revision:source.revision,version:source.version??null,total:dataset.incidents.length,source:source.source,stale:Boolean(source.sourceWarning),sourceWarning:source.sourceWarning||null}};
}
function allowRequest(request,user){
  const key=user.userId;
  const now=Date.now(),old=rateWindows.get(key);
  if(rateWindows.size>3000)for(const[k,v]of rateWindows)if(now-v.start>60000)rateWindows.delete(k);
  if(!old||now-old.start>60000){if(!old&&rateWindows.size>=3000)return false;rateWindows.set(key,{start:now,count:1});return true;}
  if(old.count>=12)return false;old.count++;return true;
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
        const data=await loadIncidentData(env),etag='"'+data.representationRevision+'"';
        if(!data.sourceWarning&&request.headers.get('if-none-match')===etag)return new Response(null,{status:304,headers:{ETag:etag,'Cache-Control':'no-store'}});
        return json(data,200,{ETag:etag});
      }catch{return json({error:'Не удалось прочитать выгрузку. Проверьте JSON, статусы и даты источника.',code:'incident_source_unavailable'},503);}
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
        let snapshot=null;try{snapshot=await loadIncidentData(env);}catch{}
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
