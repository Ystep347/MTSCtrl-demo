import {projectMtsSimulation} from '/mts-simulation.js';
import {isActiveIncident} from '/incidents.js';
import {SIMPLEONE_DEMO_KEY,availableWorkflowActions,nextWorkflowState,projectWorkflowItem} from '/operations.js';

const statuses = {
  working: 'Выполняется',
  assigned: 'Назначен',
  investigating: 'Исследование ситуации',
  resolved: 'Завершён',
  closed: 'Закрыт',
};
const priorities = {critical: 'Критический', high: 'Высокий', medium: 'Средний', low: 'Низкий'};
const formatter = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow',
  dateStyle: 'short',
  timeStyle: 'short',
});
const date = value => Number.isFinite(value) ? formatter.format(value) + ' МСК' : 'Не указан';
const element = id => document.getElementById(id);
const write = (id, value) => { element(id).textContent = value || 'Не указано'; };
const show = id => { element(id).hidden = false; };

function receiveLocalIncident(id, token) {
  const key = 'mts-simpleone-preview:' + token;
  const read = storage => JSON.parse(storage.getItem(key) || 'null');
  try {
    const cached = read(sessionStorage);
    if (cached?.id === id) return cached;
    const item = read(localStorage);
    if (item?.id === id) {
      try {
        sessionStorage.setItem(key, JSON.stringify(item));
        localStorage.removeItem(key);
      } catch { /* The current page can still show the received card. */ }
      return item;
    }
  } catch { /* A disabled store or invalid record leaves no local card. */ }
  throw new Error('Локальная карточка недоступна. Откройте её заново из «МТС Фокус».');
}

function renderIncident(item, source) {
  document.title = item.id + ' · SimpleOne Демо';
  write('incident-id', item.id);
  write('incident-title', item.title);
  write('incident-source', source);
  write('incident-status', statuses[item.status]);
  element('status-badge').dataset.state = item.status;
  write('incident-priority', priorities[item.priority]);
  element('priority-badge').dataset.state = item.priority;
  write('incident-product', item.product);
  write('incident-service', item.service);
  write('incident-created', date(item.createdAt));
  write('incident-deadline', date(item.dueAt));
  write('incident-description', item.description || item.summary);
  write('incident-team', item.team);
  write('incident-assignee', item.assignee);
  if (item.sysId) {
    write('incident-sysid', item.sysId);
    show('sysid-field');
  }
  if (!isActiveIncident(item) && Number.isFinite(item.resolvedAt)) {
    write('incident-recovered', date(item.resolvedAt));
    show('recovered-field');
  }
  if (!isActiveIncident(item) && item.solution) {
    write('incident-solution', item.solution);
    show('resolution');
  }
  for (const id of ['incident-id', 'properties', 'incident-source', 'incident-body']) show(id);
}


const query=new URLSearchParams(location.search);
const fromSource=query.get('dataset')==='source',guest=query.get('guest')==='1';
const id=query.get('incident'),preview=query.get('preview');
const executorForm=element('executor-form'),feedback=element('executor-feedback');
let baseItem,current,sourceLabel,canConfirm=false;
const demo=()=>{try{return JSON.parse(localStorage.getItem(SIMPLEONE_DEMO_KEY)||'null');}catch{return null;}};
const rowKey=item=>item.id+'|'+(item.sysId||'');
if(fromSource||guest){
  const target=new URLSearchParams();
  if(fromSource)target.set('dataset','source');
  if(guest)target.set('guest','1');
  element('dashboard-link').href='/?'+target.toString();
}

let sharedWorkflow=null;
function renderTask(){
  if(guest)current=demo()?.rows?.[rowKey(baseItem)]||sharedWorkflow;
  const item=projectWorkflowItem(baseItem,current);
  renderIncident(item,sourceLabel);
  const executor={role:'executor',dispatchId:current?.dispatch?.id};
  executorForm.hidden=!(canConfirm&&current?.dispatch?.state==='demo'&&availableWorkflowActions(baseItem,current,executor).includes('resolve'));
}

async function fetchSnapshot(){
  const response=await fetch('/api/incidents',{cache:'no-store',credentials:guest?'omit':'same-origin',signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error('Выгрузка недоступна. Обновите карточку.');
  const snapshot=await response.json();
  const dataset=fromSource?snapshot:projectMtsSimulation(snapshot);
  const item=dataset.incidents.find(row=>row.id===id);
  if(!item)throw Error('Инцидент отсутствует в текущей выгрузке.');
  baseItem=item;
  sharedWorkflow=snapshot.workflow?.find(row=>row.id===id&&row.sysId===item.sysId)||null;
  current=sharedWorkflow;
  sourceLabel=(fromSource?'Исходная выгрузка':'Симуляция МТС')+(snapshot.sourceWarning?' · сохранённая версия':'');
}

try{
  if(!id||!/^INC-?\d{1,18}$/.test(id))throw Error('Выберите инцидент в «МТС Фокус» и откройте его в SimpleOne.');
  const localItem=guest?demo()?.incidents?.find(item=>item.id===id):null;
  if(localItem||preview){
    baseItem=localItem||receiveLocalIncident(id,preview);
    sourceLabel='Локальная симуляция';
  }else await fetchSnapshot();
  if(guest)canConfirm=true;
  else if(!preview){
    const response=await fetch('/api/auth/me',{cache:'no-store',signal:AbortSignal.timeout(7000)});
    canConfirm=response.ok&&(await response.json()).authenticated===true;
  }
  renderTask();
}catch(error){
  write('error',error.message);show('error');
}finally{
  element('loading').hidden=true;element('record').setAttribute('aria-busy','false');
}

window.addEventListener('storage',event=>{
  if(guest&&baseItem&&event.key===SIMPLEONE_DEMO_KEY)renderTask();
});
if(canConfirm&&!preview&&!demo()?.incidents?.some(item=>guest&&item.id===id))setInterval(async()=>{
  if(document.hidden||executorForm.querySelector('button').disabled)return;
  try{await fetchSnapshot();renderTask();}catch{}
},5000);

executorForm.addEventListener('submit',async event=>{
  event.preventDefault();
  if(!baseItem||!current||!canConfirm||executorForm.hidden)return;
  const note=element('executor-note').value.trim();
  if(!note){feedback.textContent='Опишите выполненное восстановление.';return;}
  const button=executorForm.querySelector('button');
  button.disabled=true;feedback.textContent='';
  try{
    if(guest){
      if(!preview&&!demo()?.incidents?.some(item=>item.id===id)){const expected=current;await fetchSnapshot();current=expected;}
      const data=demo(),key=rowKey(baseItem),row=data?.rows?.[key]||sharedWorkflow;
      if(row?.dispatch?.state!=='demo'||row.dispatch.id!==current.dispatch.id)throw Error('Учебное назначение изменилось.');
      const executor={role:'executor',dispatchId:row.dispatch.id,displayName:row.team+' · учебный SimpleOne'};
      data.rows[key]=nextWorkflowState(baseItem,row,{action:'resolve',version:current.version,note},executor);
      localStorage.setItem(SIMPLEONE_DEMO_KEY,JSON.stringify(data));
    }else{
      const response=await fetch('/api/workflow',{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(10000),
        body:JSON.stringify({id:baseItem.id,action:'demo-executor-resolve',version:current.version,dispatchId:current.dispatch.id,note})});
      const data=await response.json();
      if(!response.ok)throw Error(data.error||'Не удалось подтвердить решение.');
      current=data.workflow;
    }
    renderTask();
  }catch(error){feedback.textContent=error.message;}
  finally{button.disabled=false;}
});
