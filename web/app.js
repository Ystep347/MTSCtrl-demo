import {projectMtsSimulation,mtsSimulationEvent} from '/mts-simulation.js';
import {dashboardAnalytics,slaBucket} from '/dashboard-analytics.js';
import {renderReference} from '/reference-view.js';
import {summarizeImport} from '/import-summary.js';
import {criticalRecoveryEvent,incidentChanges,isActiveIncident,isFinishedIncident,normalizeIncidentDataset} from '/incidents.js';
import {matchesIncidentScope,operationalEvidence,projectWorkflowItem,workGroupKeys} from '/operations.js';
import {createOperations} from '/operations-ui.js';
import {localAnswer,selectReferences} from '/assistant-rules.js';
"use strict";

const ICONS = {
  grid:'<rect x="3" y="3" width="7" height="7" rx="1.4"/><rect x="14" y="3" width="7" height="7" rx="1.4"/><rect x="3" y="14" width="7" height="7" rx="1.4"/><rect x="14" y="14" width="7" height="7" rx="1.4"/>',
  focus:'<path d="M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3m8 0h3a2 2 0 0 0 2-2v-3"/><circle cx="12" cy="12" r="4"/>',
  activity:'<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  users:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/><circle cx="9" cy="7" r="4"/>',
  help:'<circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3m.1 4h.01"/>',
  bell:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 12a2 2 0 0 0 4 0"/>',
  sliders:'<path d="M4 6h5m4 0h7M4 12h9m4 0h3M4 18h2m4 0h10"/><circle cx="11" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="8" cy="18" r="2"/>',
  chevron:'<path d="m7 10 5 5 5-5"/>',
  play:'<path d="m8 4 12 8-12 8z"/>',
  pause:'<path d="M8 4v16m8-16v16"/>',
  search:'<circle cx="10.5" cy="10.5" r="7"/><path d="m16 16 5 5"/>',
  timer:'<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6m-3 0v3m6 1 2-2"/>',
  list:'<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  alert:'<path d="m10.3 3.9-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3.1l-8-14a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4m0 4h.01"/>',
  external:'<path d="M15 3h6v6m0-6L10 14m8-1v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  check:'<path d="m5 12 4 4L19 6"/>',
  checkCircle:'<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
  bolt:'<path d="m13 2-9 12h7l-1 8 10-12h-7z"/>',
  research:'<path d="M9 3h6m-5 0v6l-6 10a1.4 1.4 0 0 0 1.2 2h13.6a1.4 1.4 0 0 0 1.2-2L14 9V3M8 15h8"/>',
  box:'<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M9 4v16m-5-9h16"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  sparkle:'<path d="m12 3 2.3 6.7L21 12l-6.7 2.3L12 21l-2.3-6.7L3 12l6.7-2.3zM20 3v4m-2-2h4"/>',
  close:'<path d="m6 6 12 12M6 18 18 6"/>',
  copy:'<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h4"/>',
  refresh:'<path d="M20 8a8 8 0 1 0 .5 7M20 3v5h-5"/>',
  archive:'<path d="M4 8h16v13H4zM3 3h18v5H3zm6 9h6"/>',
  more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ICONS.info}</svg>`;
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const COORDINATORS = "КЦ ИТ Координаторы Массовых Инцидентов";
const STATUS = {working:"Выполняется",assigned:"Назначен",investigating:"Исследование",resolved:"Завершён",closed:"Закрыт"};
const PRIORITY = {critical:"Критический",high:"Высокий",medium:"Средний",low:"Низкий"};
const fmtTime = value => value===null||value===undefined?"не указано": new Intl.DateTimeFormat("ru-RU",{timeZone:"Europe/Moscow",hour:"2-digit",minute:"2-digit"}).format(value);
const fmtFullTime = value => value===null||value===undefined?"не указано": new Intl.DateTimeFormat("ru-RU",{timeZone:"Europe/Moscow",day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}).format(value);
const initials = name => name.replace(/\([^)]*\)/g," ").trim().split(/\s+/).slice(0,2).map(x=>x[0]||"").join("");
const shortTeam = team => team===COORDINATORS ? "Координаторы" : team;
const isOpen = isActiveIncident;
const isDone = isFinishedIncident;
const isOverdue = item => isOpen(item) && item.dueAt!==null && item.dueAt < Date.now();
const workGroups=[
  {key:'coord',title:'На координаторах',icon:'users'},
  {key:'critical',title:'Критические',icon:'alert'},
  {key:'high',title:'Высокий приоритет',icon:'bolt'},
  {key:'medium',title:'Средний приоритет',icon:'list'},
  {key:'low',title:'Низкий приоритет',icon:'list'},
  {key:'research',title:'Исследование',icon:'research'},
  {key:'resolved',title:'Решённые',icon:'checkCircle'},
  {key:'closed',title:'Закрытые',icon:'archive'}
].map(group=>({...group,test:item=>workGroupKeys(item).includes(group.key)}));
const GROUPS=workGroups.filter(g=>['coord','critical','high','research'].includes(g.key));
const groupsFor=item=>GROUPS.filter(g=>g.test(item));
const state = {view:"dashboard",layout:"board",sort:"relevance",search:"",product:"all",overdue:false,coordinator:false,priority:"all",group:null,selected:null,drawerTab:"overview",demoRunning:false,demoTimer:null,demoStep:0,lastUpdate:Date.now(),unread:false,compact:false,team:null};
// Presentation preferences only. Source records, groups and permissions stay unchanged.
const presentation={datasetView:new URLSearchParams(location.search).get('dataset')==='source'?'source':'mts-demo',screen:new URLSearchParams(location.search).get('screen')==='wallboard'?'wallboard':'workstation',spotlight:null,bucket:null,scope:'focus',interval:6};
const assistant={messages:[],configuration:null,pending:false,contextId:null,lastFocus:null,generation:0,controller:null};
const auth={checking:true,canImport:false,user:null,error:null,loginUrl:'/login',assistantLoginUrl:'/login?return_to=%2F%3Fassistant%3D1',logoutUrl:'/signout-with-chatgpt?return_to=%2F'};
let items=[],baseItems=[],events=[],guestRecoveries=[],lastFocus=null;
const announcedRecoveries=new Set();
function announceEvents(changes){
  const rank=e=>e.id?.toString().startsWith('recovery:')||e.type==='critical'?0:e.type==='coord'?1:2;
  const important=changes.filter(e=>['critical','coord','success'].includes(e.type)).sort((a,b)=>rank(a)-rank(b));
  for(const e of important.slice(0,3)){
    if(String(e.id).startsWith('recovery:')){
      if(announcedRecoveries.has(e.id))continue;
      announcedRecoveries.add(e.id);
    }
    toast(e.title,`${e.incidentId||''} · ${e.detail}`,e.type);
  }
  return important.length;
}
const guestView=new URL(location.href).searchParams.get('guest')==='1';

const sourceData={snapshot:null,originalSnapshot:null,etag:null,revision:null,source:null,meta:null,busy:false,error:null,warning:null,checkedAt:null,frozen:false,lastSeq:0,historyCursor:null,historyHasMore:false};
const importState={raw:null,preview:null,filename:'',base:null,error:null,pending:false,stale:false};
const cardHistory=new Map();
let lastClockSignature='';
const operations=createOperations(()=>({
  auth,items,baseItems,workGroups,esc,isOpen,isDone,screen:presentation.screen,view:presentation.datasetView,
  selected:presentation.spotlight,snapshot:sourceData.snapshot,revision:sourceData.revision,frozen:sourceData.frozen,
  coordinatorTeam:COORDINATORS,reload:loadIncidents,
  applyWorkflow(row){
    if(sourceData.snapshot){
      const rows=(sourceData.snapshot.workflow||[]).filter(old=>old.id!==row.id||old.sysId!==row.sysId);
      sourceData.snapshot={...sourceData.snapshot,workflow:[...rows,row]};
    }
    rebuildItems();render();
  }
}),refreshOperations,toast);
function rebuildItems(){
  const demos=operations.demos();
  const localIds=new Set(demos.map(item=>item.id));
  const source=[...demos,...baseItems.filter(item=>!localIds.has(item.id))];
  const rows=operations.book(source);
  const previous=items;
  items=source.map(item=>projectWorkflowItem(item,rows[item.id]));
  guestRecoveries=operations.isGuest()?items.flatMap(item=>{
    const local=operations.guestRow(item);
    const at=local?.resolvedAt||(item.guestDemo&&!isOpen(item)?item.resolvedAt:null);
    if(!at||!(local?.criticalRecovery??(item.priority==='critical')))return [];
    return [{...criticalRecoveryEvent(item),at}];
  }):[];
  const newlyRecovered=guestRecoveries.filter(e=>previous.some(i=>i.id===e.incidentId&&isOpen(i)));
  if(newlyRecovered.length){state.unread=true;announceEvents(newlyRecovered);}
}
function refreshOperations(syncDemo=false){
  if(syncDemo){
    rebuildItems();
    refreshProducts();renderAccount();refreshAssistantAuth();
  }
  render();
}
function renderDataStatus(){
  $("#dataset-view-toggle").disabled=sourceData.busy;
  const el=$("#data-status"),expanded=Boolean(el.querySelector('details')?.open);
  const count=sourceData.meta?.total??0;
  const title=sourceData.frozen?'Демосценарий · изменения только на этом экране':sourceData.snapshot?`${presentation.datasetView==='mts-demo'?'Симуляция МТС':'Исходная выгрузка'} · ${count} инцидента`:'Загружаю выгрузку МТС…';
  const origin=sourceData.source==='shared'?`Общие данные · версия ${sourceData.snapshot.version} · изменения сохраняются`:sourceData.source==='file'?'Локальные данные · проверка изменений каждые 5 секунд':sourceData.source==='remote'?'Общие данные · проверка изменений каждые 5 секунд':'Снимок данных · общий живой источник пока не подключён';
  const note=sourceData.error||sourceData.warning||(!sourceData.frozen?origin:'Исходная выгрузка сохранена. Для возврата нажмите кнопку рядом.');
  el.classList.toggle('data-error',Boolean(sourceData.error||sourceData.warning));el.classList.toggle('data-demo',sourceData.frozen);
  const warnings=sourceData.meta?.warnings||[];
  const warningCopy={
    active_solution:'В незавершённых карточках уже есть описание решения. Для завершения должен измениться статус.',
    dictionary_state_conflict:'В исходных данных есть расхождения в обозначениях статусов. Использован смысловой статус карточки.',
    undocumented_research:'Отдельно показаны инциденты на исследовании: сервис восстановлен, причины ещё выясняют.',
    missing_deadline:'У части карточек срок не указан. Отсутствие срока само по себе не означает просрочку.',
    state_id_conflict:'В исходных данных расходятся обозначения статуса. Спорные записи нужно проверить.',
    state_text_conflict:'В исходных данных расходятся обозначения статуса. Спорные записи нужно проверить.'
  };
  el.innerHTML=`<div class="data-status-main"><span class="data-source-icon">${icon(sourceData.frozen?'play':'archive')}</span><div class="data-status-copy"><strong>${esc(title)}</strong><p>${esc(note)}</p></div><div class="data-actions"><button class="button button-secondary" data-all-incidents>Все ${items.length}</button><button class="button button-secondary" data-reload-incidents ${sourceData.busy?'disabled':''}>${icon('refresh')}${sourceData.frozen?'Вернуться к выгрузке':'Обновить'}</button>${auth.canImport?`<button class="button button-primary import-trigger" data-import-open>Загрузить выгрузку</button>`:''}</div></div>${warnings.length?`<details class="data-quality" ${expanded?'open':''}><summary>Особенности исходных данных</summary><ul>${warnings.map(w=>`<li>${esc(warningCopy[w.code]||w.message)} <strong>Записей: ${w.count}.</strong></li>`).join('')}</ul><p>Спорные статусы и сроки нужно подтвердить у ответственных за данные.</p></details>`:''}`;
  renderLiveStatus();
}
function refreshProducts(){
  $("#product-filter").innerHTML='<option value="all">Все продукты</option>'+[...new Set(items.map(i=>i.product))].sort((a,b)=>a.localeCompare(b,'ru')).map(product=>`<option value="${esc(product)}">${esc(product)}</option>`).join('');
  if(!items.some(i=>i.product===state.product))state.product='all';
  $("#product-filter").value=state.product;
}
function acceptSnapshot(snapshot,reset=false){
  sourceData.originalSnapshot=snapshot;
  if(presentation.datasetView==='mts-demo')snapshot=projectMtsSimulation(snapshot);
  if(snapshot.source==='shared'){
    if(!reset&&sourceData.source==='shared'&&snapshot.version<sourceData.snapshot.version)return;
    const first=!sourceData.snapshot||sourceData.source!=='shared'||reset,stamp=Date.now();
    const incoming=snapshot.events||[],newEvents=first?[]:incoming.filter(e=>e.seq>sourceData.lastSeq);
    const historyGap=!first&&incoming.length===100&&Math.min(...incoming.map(e=>e.seq))>sourceData.lastSeq;
    baseItems=snapshot.incidents.map(i=>({...i,history:[...i.history]}));
    events=first||historyGap?incoming:[...new Map([...events.filter(e=>e.seq),...incoming].map(e=>[e.id,e])).values()].sort((a,b)=>b.seq-a.seq);
    sourceData.snapshot=snapshot;sourceData.revision=snapshot.revision;sourceData.source=snapshot.source;sourceData.meta=snapshot.meta;sourceData.warning=snapshot.sourceWarning||null;
    rebuildItems();
    if(first||historyGap){sourceData.historyCursor=snapshot.historyCursor;sourceData.historyHasMore=snapshot.historyHasMore;}
    sourceData.lastSeq=Math.max(sourceData.lastSeq,...incoming.map(e=>e.seq),0);state.lastUpdate=snapshot.updatedAt||stamp;
    if(newEvents.length){state.unread=true;if(!announceEvents(newEvents))toast('Общие данные обновлены',`Новая версия: ${snapshot.version}`,'changed');}
    if($('#import-dialog').open&&importState.base?.revision!==snapshot.revision&&!importState.pending){importState.stale=true;importState.error='Другой редактор обновил данные. Обновите предпросмотр.';renderImportPreview();}
    refreshProducts();render();
    if(state.selected&&state.drawerTab==='history')loadCardHistory(state.selected);
    return;
  }
  const first=!sourceData.snapshot||reset,previous=baseItems;
  const changes=first?[]:incidentChanges(previous,snapshot.incidents);
  const stamp=Date.now(),old=new Map(previous.map(i=>[i.id,i]));
  baseItems=snapshot.incidents.map(i=>({...i,history:[...i.history,...(!first?(old.get(i.id)?.history||[]).filter(e=>e.observed):[])]}));
  sourceData.snapshot=snapshot;sourceData.revision=snapshot.revision;sourceData.source=snapshot.source;sourceData.meta=snapshot.meta;
  rebuildItems();
  if(first){events=items.flatMap(i=>i.history.map(e=>({...e,id:`${i.id}-${e.at}-${e.title}`,incidentId:i.id,type:'changed'}))).sort((a,b)=>b.at-a.at).slice(0,100);}
  for(const [index,change] of changes.entries()){
    const event={...change,at:stamp,id:change.id||`${stamp}-${index}`};events.unshift(event);
    items.find(i=>i.id===change.incidentId)?.history.push({...event,observed:true});
  }
  events=events.slice(0,200);state.lastUpdate=stamp;
  if(changes.length){state.unread=true;if(!announceEvents(changes))toast('Выгрузка обновлена',`Изменений: ${changes.length}`,'changed');}
  refreshProducts();render();
}
async function loadIncidents(reset=false){
  if(sourceData.busy||sourceData.frozen&&!reset)return false;
  sourceData.busy=true;renderDataStatus();
  try{
    const headers=sourceData.etag&&!reset?{'If-None-Match':sourceData.etag}:{};
    const response=await fetch('/api/incidents',{cache:'no-store',credentials:guestView?'omit':'same-origin',headers,signal:AbortSignal.timeout(10000)});
    if(response.status!==304){
      if(!response.ok)throw new Error('Не удалось обновить выгрузку. Последний полученный снимок сохранён.');
      const snapshot=await response.json();
      if(!Array.isArray(snapshot.incidents)||!snapshot.meta||typeof snapshot.revision!=='string')throw new Error('Источник вернул некорректные данные.');
      if(reset){stopDemo();sourceData.frozen=false;resetFilters();}
      sourceData.etag=response.headers.get('etag');sourceData.error=null;acceptSnapshot(snapshot,reset);
    }
    sourceData.error=null;sourceData.checkedAt=Date.now();return true;
  }catch(e){sourceData.error=e.name==='TimeoutError'?'Источник не ответил вовремя. Показан последний полученный снимок.':e.message||'Ошибка чтения выгрузки.';return false;}
  finally{sourceData.busy=false;renderDataStatus();}
}

async function openImportDialog(){
  if(sourceData.frozen){stopDemo();if(!await loadIncidents(true))return;}
  Object.assign(importState,{raw:null,preview:null,filename:'',base:sourceData.originalSnapshot,error:null,pending:false,stale:false});
  $('#import-file').value='';renderImportPreview();$('#import-dialog').showModal();
}
function renderImportPreview(){
  const allowed=auth.canImport,ready=allowed&&importState.raw&&importState.preview&&importState.base?.revision&&!importState.stale&&!importState.pending;
  $('#import-access-note').textContent=allowed?'':'Для обновления общей выгрузки нужны права редактора. Обратитесь к владельцу проекта.';
  $('#import-access-note').hidden=allowed;$('#import-editor-area').hidden=!allowed;$('.import-export').hidden=!allowed;
  $('#import-file').disabled=importState.pending;$('#import-close').disabled=importState.pending;$('#import-cancel').disabled=importState.pending;
  $('#import-submit').disabled=!ready;$('#import-submit').textContent=importState.pending?'Сохраняю…':'Загрузить для всех';
  $('#import-error').hidden=!importState.error;$('#import-error').textContent=importState.error||'';
  $('#import-refresh-preview').hidden=!importState.stale;$('#import-refresh-preview').disabled=importState.pending||sourceData.busy;
  const preview=importState.preview,base=importState.base;
  if(!preview){$('#import-preview').innerHTML='';return;}
  const counts=summarizeImport(base.incidents,preview.incidents),rows=[['Добавится',counts.added,'added'],['Изменится',counts.changed,'changed'],['Исчезнет из выгрузки',counts.removed,'removed'],['Завершится',counts.completed,'completed']];
  const changes=incidentChanges(base.incidents,preview.incidents);
  $('#import-preview').innerHTML=`<section class="import-summary"><h3>Предпросмотр изменений</h3><p>${esc(importState.filename)} · ${preview.incidents.length} инцидентов · сравнение с версией ${base.version}</p><div class="import-counts">${rows.map(([label,count,kind])=>`<div class="import-count ${kind}"><strong>${count}</strong><span>${label}</span></div>`).join('')}</div>${changes.length?`<ul class="import-change-list">${changes.slice(0,5).map(e=>`<li><strong>${esc(e.incidentId)}</strong><span>${esc(e.title)}</span></li>`).join('')}</ul>${changes.length>5?`<p>И ещё событий: ${changes.length-5}.</p>`:''}`:'<p>Статусы, назначения и сроки не изменились.</p>'}<p class="import-preview-note">Пока ничего не сохранено. Исчезновение из выгрузки не означает, что инцидент решён. Завершённые входят в число изменённых.</p></section>`;
}
function validateImportFile(raw){
  const limits=sourceData.snapshot?.importLimits||{maxBytes:1048576,maxRecords:500};
  if(!Array.isArray(raw)||raw.length<1||raw.length>limits.maxRecords)throw new Error(`Нужен массив от 1 до ${limits.maxRecords} инцидентов.`);
  return normalizeIncidentDataset(raw);
}
async function readImportFile(){
  const file=$('#import-file').files[0];Object.assign(importState,{raw:null,preview:null,error:null,filename:file?.name||''});
  if(!file){renderImportPreview();return;}
  try{
    if(file.size>(sourceData.snapshot?.importLimits?.maxBytes||1048576))throw new Error('Размер файла превышает 1 МБ.');
    const text=await file.text();if($('#import-file').files[0]!==file)return;
    let raw;try{raw=JSON.parse(text);}catch{throw new Error('Не удалось прочитать JSON. Проверьте формат файла.');}
    importState.preview=validateImportFile(raw);importState.raw=raw;
  }catch(error){importState.error=error.message;}
  renderImportPreview();
}
async function refreshImportPreview(){
  if(!await loadIncidents(true)){importState.error='Не удалось получить свежие данные. Повторите обновление.';renderImportPreview();return;}
  importState.base=sourceData.originalSnapshot;importState.stale=false;importState.error=null;
  if(importState.raw)try{importState.preview=validateImportFile(importState.raw);}catch(error){importState.preview=null;importState.error=error.message;}
  renderImportPreview();
}
async function submitImport(){
  if(!auth.canImport||!importState.raw||!importState.preview||importState.pending||importState.stale)return;
  importState.pending=true;importState.error=null;renderImportPreview();
  try{
    const response=await fetch('/api/incidents/import',{method:'POST',headers:{'Content-Type':'application/json','If-Match':`"${importState.base.revision}"`,'X-Source-Name':encodeURIComponent(importState.filename)},body:JSON.stringify(importState.raw),signal:AbortSignal.timeout(20000)});
    const data=await response.json();
    if(!response.ok){if(response.status===409)importState.stale=true;if(response.status===401||response.status===403){auth.canImport=false;checkCurrentUser();}throw new Error(data.error||'Не удалось подтвердить сохранение. Обновите данные и проверьте историю.');}
    stopDemo();sourceData.frozen=false;
    if(data.snapshot)acceptSnapshot(data.snapshot);else await loadIncidents(true);
    $('#import-dialog').close();
    toast(data.changed?'Общая выгрузка сохранена':'Изменений нет',data.changed?`Версия ${data.version}. Другие вкладки получат её в течение 5 секунд.`:'Этот файл уже загружен. Повторное событие не добавлено.','success');
  }catch(error){importState.error=['TimeoutError','TypeError'].includes(error.name)?'Не удалось подтвердить сохранение. Обновите данные и проверьте историю перед повторной загрузкой.':error.message;}
  finally{importState.pending=false;renderImportPreview();renderDataStatus();}
}
let historyLoading=false;
async function loadMoreHistory(button){
  if(historyLoading||!sourceData.historyCursor)return;
  historyLoading=true;button.disabled=true;const cursor=sourceData.historyCursor;
  try{
    const response=await fetch('/api/incidents/history?'+new URLSearchParams({before:String(cursor),limit:'100'}),{cache:'no-store',signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw new Error();const data=await response.json();
    if(sourceData.historyCursor!==cursor)return;
    events=[...new Map([...events,...data.events].map(e=>[e.id,e])).values()].sort((a,b)=>b.seq-a.seq);
    sourceData.historyCursor=data.nextCursor;sourceData.historyHasMore=data.hasMore;render();
  }catch{toast('История временно недоступна','Попробуйте загрузить более ранние события ещё раз.','changed');}
  finally{historyLoading=false;if(button.isConnected)button.disabled=false;}
}
$('#import-file').addEventListener('change',readImportFile);
$('#import-submit').addEventListener('click',submitImport);
$('#import-refresh-preview').addEventListener('click',refreshImportPreview);
for(const id of ['import-close','import-cancel'])$('#'+id).addEventListener('click',()=>{if(!importState.pending)$('#import-dialog').close();});
$('#import-dialog').addEventListener('cancel',event=>{if(importState.pending)event.preventDefault();});

function filteredItems(now=Date.now()){
  const query=state.search.trim().toLocaleLowerCase('ru');
  return items.filter(i=>
    (!presentation.bucket||isOpen(i)&&(slaBucket(i,now)||'none')===presentation.bucket)&&
    (!query||[i.id,i.title,i.product,i.service,i.team,i.assignee,i.summary,i.description].join(' ').toLocaleLowerCase('ru').includes(query))&&
    (state.product==='all'||i.product===state.product)&&(!state.overdue||isOverdue(i))&&
    (!state.coordinator||i.team===COORDINATORS)&&(!state.team||i.team===state.team)&&
    (state.priority==='all'||i.priority===state.priority));
}
function matching(list=filteredItems()){
  return list.filter(i=>matchesIncidentScope(i,presentation.scope)&&(!state.group||workGroupKeys(i).includes(state.group)));
}
function timerText(i,kind="card"){
  if(isDone(i))return kind==="big"?"Инцидент завершён":STATUS[i.status];
  if(i.status==="investigating")return kind==="big"?"Сервис восстановлен":"Разбор причин";
  if(i.dueAt===null)return "Срок не указан";
  const seconds=Math.floor((i.dueAt-Date.now())/1000),abs=Math.abs(seconds);
  const h=Math.floor(abs/3600),m=Math.floor(abs%3600/60),s=abs%60;
  const clock=`${h>=24?Math.floor(h/24)+" д "+String(h%24).padStart(2,"0")+":":h?String(h).padStart(2,"0")+":":""}${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
  return `${seconds<0?"−":""}${clock}`;
}
function deadlineClass(i){if(!isOpen(i))return "recovered";if(i.dueAt===null)return "";const left=i.dueAt-Date.now();return left<0?"breached":left<15*60000?"urgent":left<45*60000?"warning":"";}
function deadlineMarkup(i,kind="card"){return `<span data-countdown-id="${esc(i.id)}" data-kind="${kind}">${esc(timerText(i,kind))}</span>`;}
function progress(i){if(i.dueAt===null)return 0;const end=i.resolvedAt||Date.now();return Math.max(0,Math.min(100,(end-i.createdAt)/Math.max(i.dueAt-i.createdAt,1)*100));}
function eventIcon(type){return type==="critical"?"alert":type==="success"?"checkCircle":type==="coord"?"users":"clock";}
function eventMarkup(e,journal=false){if(presentation.datasetView==='mts-demo')e=mtsSimulationEvent(e);return `<button class="event-item" ${items.some(i=>i.id===e.incidentId)?`data-open="${esc(e.incidentId)}"`:'disabled'}><span class="event-icon ${esc(e.type)}">${icon(eventIcon(e.type))}</span><span class="event-copy"><strong>${esc(e.title)}</strong><p>${e.incidentId?esc(e.incidentId)+" · ":""}${esc(e.detail)}</p><time>${fmtFullTime(e.at)} МСК${e.actor?" · "+esc(e.actor):""}</time></span>${journal?'<span class="event-open">Открыть карточку</span>':""}</button>`;}
function priorityBadge(item,pending){
  const alert=pending&&isOpen(item)&&item.priority==='critical';
  return `<span class="priority-badge ${item.priority}${alert?' critical-alert':''}"${alert?' title="Критический инцидент ждёт реакции"':''}>${PRIORITY[item.priority]}</span>`;
}
function cardMarkup(i,rows,wall){
  const dc=deadlineClass(i),assignment=operations.assignment(i,rows),element=wall?'article':'button';
  return `<${element} class="incident-card work-incident" ${wall?'':`data-open="${esc(i.id)}" aria-label="${esc(i.id+": "+i.title)}"`}>
    <span class="card-topline"><span class="incident-id">${esc(i.id)}</span><span class="card-tags">${assignment.pending?'<span class="new-tag">Ждёт реакции</span>':''}${priorityBadge(i,assignment.pending)}</span></span>
    <span class="card-title">${esc(i.title)}</span>
    <span class="card-middle"><span class="card-product">${icon("box")}<span>${esc(i.product)}${i.service?' · '+esc(i.service):''}</span></span><span class="deadline ${dc}" title="${!isOpen(i)?"Сервис восстановлен":isOverdue(i)?"Срок решения нарушен":"До срока решения"}">${icon(isOpen(i)?"timer":"checkCircle")}${deadlineMarkup(i)}</span></span>
    <span class="card-assignment">${esc(shortTeam(assignment.team))} · ${esc(STATUS[i.status])}${assignment.phase?' · '+esc(assignment.phase):''}</span>
    ${wall?`<span class="wall-owner">${esc(assignment.person)} · ${fmtFullTime(i.createdAt)} МСК</span>`:`<span class="work-incident-summary">${esc(i.summary||i.description)}</span><span class="card-bottom"><span class="card-team"><span class="avatar-mini">${esc(initials(assignment.person))}</span><span>${esc(assignment.person)}</span></span><span title="${fmtFullTime(i.createdAt)} МСК">с ${fmtTime(i.createdAt)}</span></span>`}
  </${element}>`;
}
function visibleEvents(){return [...new Map([...events,...guestRecoveries].map(event=>[event.id,event])).values()].sort((a,b)=>b.at-a.at);}
function ctrlContext(){return {items,events:visibleEvents(),state,presentation,sourceData,COORDINATORS,STATUS,PRIORITY,isOpen,isDone,isOverdue,shortTeam,initials,icon,deadlineClass,deadlineMarkup,progress,filteredItems,matching,matchesIncidentScope,renderBoard,renderTable,eventMarkup,simpleOneLink,operations};}
function renderTop(){if(state.view==='dashboard')renderReference(ctrlContext());}
function renderBoard(list,wall=false){
  const rows=operations.book();
  const definitions=wall||presentation.scope==='focus'?GROUPS:workGroups;
  const visible=wall||!state.group?definitions:definitions.filter(g=>g.key===state.group);
  const groups=operations.groups(list,visible,{wall,mode:state.sort});
  const heading=wall?'':`<div class="board-heading"><h2>Группы инцидентов</h2><div class="board-actions">${operations.rankingButton()}</div></div>`;
  if(!groups.length)return heading+`<div class="empty-full">${icon("checkCircle")}<h2>${wall?'В фокусе сейчас тихо':'Нет инцидентов по выбранным условиям'}</h2></div>`;
  const wallRows=innerWidth<=560?Math.ceil(groups.length/2):1;
  const boardHeight=wall?$('#wallboardBoard').clientHeight/wallRows:0;
  const maxCards=Math.max(1,Math.min(9,Math.floor((boardHeight-104)/Math.max(112,Math.min(190,innerWidth*.037)))));
  return heading+`<div class="board work-board" style="--group-count:${groups.length}">${groups.map(g=>{
    const cards=wall?g.members.slice(0,maxCards):g.members;
    const title=`<span class="group-symbol">${icon(g.icon)}</span>`;
    const count=`<span class="group-count">${g.members.length}</span>`;
    const focused=state.group===g.key;
    const header=wall?`<header class="group-head"><div class="group-title-row">${title}<h3>${g.title}</h3>${count}</div></header>`:
      `<header class="group-head group-head-toggle"><h3><button type="button" class="group-toggle group-title-row" data-focus-group="${g.key}" aria-pressed="${focused}" aria-controls="incidentQueueList" title="${focused?'Вернуть все группы':'Развернуть группу'}">${title}<span>${g.title}</span>${count}<span class="group-toggle-icon">${icon('focus')}</span></button></h3></header>`;
    return `<section class="incident-group group-${g.key}${g.urgent?' workflow-pulse':''}${g.criticalAlert?' workflow-pulse-critical':''}" aria-label="${esc(g.title)}">${header}<div class="group-cards">${cards.map(i=>cardMarkup(i,rows,wall)).join("")}</div>${cards.length<g.members.length?`<div class="wallboard-more">Ещё ${g.members.length-cards.length} в группе</div>`:''}</section>`;
  }).join("")}</div>`;
}
function renderTable(list){
  const rows=operations.book();
  if(!list.length)return `<div class="empty-full">${icon("search")}<h2>Ничего не найдено</h2><p>Попробуйте другой запрос или сбросьте фильтры.</p></div>`;
  return `<div class="table-panel"><div class="table-scroll"><table class="incidents-table"><thead><tr><th>Инцидент</th><th>Продукт</th><th>Приоритет</th><th>Команда и исполнитель</th><th>Статус</th><th>До срока</th><th>Поступил, МСК</th><th>ITSM</th></tr></thead><tbody>${operations.order(list,state.sort).map(i=>`<tr data-open="${i.id}" tabindex="0" role="button" aria-label="Открыть ${i.id}"><td class="table-incident"><span class="incident-id">${i.id}</span><strong>${esc(i.title)}</strong></td><td>${esc(i.product)}</td><td>${priorityBadge(i,operations.pending(i,rows))}</td><td>${esc(shortTeam(i.team))}<small>${esc(i.assignee)}</small></td><td><span class="status ${i.status}">${STATUS[i.status]}</span></td><td><span class="deadline ${deadlineClass(i)}">${deadlineMarkup(i)}</span></td><td>${fmtFullTime(i.createdAt)}</td><td>${simpleOneLink(i,'text-button')}</td></tr>`).join("")}</tbody></table></div><div class="table-meta"><span>${list.length} уникальных инцидентов</span><span>Откройте строку для подробностей</span></div></div>`;
}
function hasFilters(){return Boolean(state.team||state.search||state.product!=="all"||state.overdue||state.coordinator||state.priority!=="all"||state.group||presentation.bucket||presentation.scope!=='focus');}
function renderScreen(){
  renderReference(ctrlContext());
  if(state.view!=='dashboard')$('#alternate-screen').innerHTML=state.view==='journal'?renderJournal():renderTeams();
}
function renderLiveStatus(){
  const el=$('#ctrl-live');if(!el)return;
  el.textContent=sourceData.frozen?'ДЕМО · локально':sourceData.error?'Нет связи':sourceData.snapshot?(presentation.datasetView==='mts-demo'?'ДЕМО · 5 сек':'LIVE · 5 сек'):'Подключение';
  el.classList.toggle('is-demo',sourceData.frozen);el.classList.toggle('is-offline',Boolean(sourceData.error));
}
function syncPresentation(){
  document.documentElement.dataset.screen=presentation.screen;
  document.querySelector('meta[name="theme-color"]').content=document.documentElement.dataset.theme==='night'?'#0b0e14':'#f2f3f7';
  $$('[data-screen-mode]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.screenMode===presentation.screen));
  $$('[data-theme-mode]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.themeMode===document.documentElement.dataset.theme));
  const url=new URL(location.href);if(presentation.datasetView==='source')url.searchParams.set('dataset','source');else url.searchParams.delete('dataset');if(presentation.screen==='wallboard')url.searchParams.set('screen','wallboard');else url.searchParams.delete('screen');
  if(url.href!==location.href)history.replaceState(null,'',url);
  renderLiveStatus();
}
function renderJournal(){const events=visibleEvents();return `<section class="table-panel"><header class="journal-heading"><h2>История изменений</h2><span>${events.length} событий · МСК</span></header><div class="journal-list">${events.map(e=>eventMarkup(e,true)).join("")}</div>${sourceData.source==="shared"&&sourceData.historyHasMore?`<button class="history-more" data-history-more>Показать более ранние события</button>`:""}</section>`;}
function renderTeams(){
  const teams=[...new Set(items.filter(i=>!isDone(i)).map(i=>i.team))];
  return `<section class="teams-grid" aria-label="Команды назначения">${teams.map(team=>{const own=items.filter(i=>i.team===team&&!isDone(i));return `<article class="team-panel"><span class="team-avatar">${icon("users")}</span><h2>${esc(shortTeam(team))}</h2><p>${team===COORDINATORS?"Маршрутизация инцидентов и привлечение профильных команд":"Ответственные за восстановление и исследование сервисов"}</p><div class="team-stats"><div><strong>${own.length}</strong><span>инцидентов</span></div><div><strong>${own.filter(i=>isOpen(i)&&i.priority==='critical').length}</strong><span>критических</span></div><div><strong>${own.filter(isOverdue).length}</strong><span>просрочено</span></div></div><button data-team="${esc(team)}">Показать инциденты</button></article>`;}).join("")}</section>`;
}
function render(){
  if(state.group&&!matching().length)state.group=null;
  const sim=presentation.datasetView==='mts-demo';
  $('#simulation-label').textContent=sim?'Симуляция МТС':'Исходная выгрузка';
  $('#simulation-copy').textContent=sim?'Вымышленные сбои телеком-сервисов. Исполнители, статусы, приоритеты и сроки — из учебной выгрузки.':'Показаны названия, статусы и назначения из текущей выгрузки в формате МТС.';
  $('#dataset-view-toggle').textContent=sim?'Показать исходные данные':'Вернуться к симуляции МТС';
  $('#dataset-view-toggle').disabled=sourceData.busy;

  renderDataStatus();
  syncPresentation();
  const titles={dashboard:["Инциденты в фокусе","Ситуация, ответственные и сроки — на одном экране."],journal:["Журнал событий","Критические изменения, назначения и восстановление сервисов."],teams:["Команды назначения","Кто работает над инцидентами и кому требуется помощь."]};
  $("#page-title").textContent=state.view==='dashboard'&&presentation.screen==='wallboard'?'Вся смена на одном экране':titles[state.view][0];$("#page-subtitle").textContent=state.view==='dashboard'&&presentation.screen==='wallboard'?'Общий обзор для широкого монитора. Те же инциденты, команды и сроки.':titles[state.view][1];
  $$("[data-view]").forEach(b=>{if(b.classList.contains("nav-item")){b.classList.toggle("active",b.dataset.view===state.view);if(b.dataset.view===state.view)b.setAttribute("aria-current","page");else b.removeAttribute("aria-current");}});
  $("#toolbar").hidden=state.view!=="dashboard";
  $("#mine-filter").setAttribute("aria-pressed",state.coordinator);
  $("#reset-filters").hidden=!hasFilters();$("#work-sla").value=presentation.bucket||"";$("#work-sort").value=state.sort;
  $("#workstationView").dataset.layout=state.layout;
  const mobileToggle=$("#mobile-filters");
  if(mobileToggle){const activeFilters=Number(state.product!=="all")+Number(Boolean(presentation.bucket))+Number(Boolean(state.team))+Number(state.coordinator)+Number(state.priority!=="all")+Number(Boolean(state.group));mobileToggle.innerHTML=icon("sliders")+`Фильтры${activeFilters?` (${activeFilters})`:""}`;}
  $$("button[data-layout]").forEach(b=>{b.classList.toggle("active",b.dataset.layout===state.layout);b.setAttribute("aria-pressed",b.dataset.layout===state.layout);});
  renderScreen();
  operations.renderAlerts();
  $("#clock").title=`Последнее изменение: ${fmtTime(state.lastUpdate)} МСК`;
  $("#notification-dot").hidden=!state.unread;
  document.body.classList.toggle("compact",state.compact);
  if(!$("#notification-popover").hidden)renderNotifications();
  if(state.selected)renderDrawer();
  refreshAssistantContext();
  updateTimers();
}
function updateTimers(){
  $$("[data-countdown-id]").forEach(el=>{const i=items.find(i=>i.id===el.dataset.countdownId);if(!i)return;el.textContent=timerText(i,el.dataset.kind);const container=el.closest(".deadline");if(container)container.className=`deadline ${deadlineClass(i)}`;});
  $$("[data-progress-id]").forEach(el=>{const i=items.find(i=>i.id===el.dataset.progressId);if(i){el.style.width=progress(i)+"%";el.className=deadlineClass(i);}});
  $("#clock").textContent=fmtTime(Date.now())+" МСК";
  const sig=items.filter(isOverdue).map(i=>i.id).join(',')+Math.floor(Date.now()/60000);
  if(sig!==lastClockSignature){
    lastClockSignature=sig;
    if(state.group&&!matching().length){render();return;}
    renderTop();if(state.view==='dashboard'&&(state.overdue||presentation.bucket||presentation.screen==='wallboard'))renderScreen();
  }
}
function drawerOverview(i){
  const closed=!isOpen(i),cls=isDone(i)?"resolved":i.status==="investigating"?"research":"";
  return `<section class="deadline-box ${cls}"><div class="deadline-caption">${icon(closed?"checkCircle":"timer")}${closed?"Состояние сервиса":isOverdue(i)?"Срок решения нарушен":"Осталось до срока решения"}</div><div class="deadline-big">${deadlineMarkup(i,"big")}</div><p>${closed?`Дата завершения / восстановления: ${fmtFullTime(i.resolvedAt)} МСК${i.status==="investigating"?" · продолжается исследование":""}`:`Дедлайн: ${fmtFullTime(i.dueAt)} МСК`}</p></section>
  <section class="details-grid"><div><div class="detail-label">Продукт</div><div class="detail-value">${esc(i.product)}</div></div><div><div class="detail-label">Возникновение</div><div class="detail-value">${fmtFullTime(i.createdAt)} МСК</div></div><div><div class="detail-label">Приоритет</div><div class="detail-value"><span class="priority-badge ${i.priority}">${PRIORITY[i.priority]}</span></div></div><div><div class="detail-label">Статус</div><div class="detail-value"><span class="status ${i.status}">${STATUS[i.status]}</span></div></div><div class="detail-wide"><div class="detail-label">Команда назначения</div><div class="detail-value full-team">${esc(i.team)}</div></div><div class="detail-wide"><div class="detail-label">Исполнитель</div><div class="detail-value"><span class="avatar-mini">${esc(initials(i.assignee))}</span>${esc(i.assignee)}</div></div></section>
  <section class="detail-description">${i.status==="investigating"?`<h3>Срок из выгрузки</h3><p>${i.dueAt===null?"Не указан":fmtFullTime(i.dueAt)+" МСК"}. Исследование не учитывается как активная просрочка восстановления.</p>`:""}<h3>Что произошло</h3><p>${esc(i.description)}</p>${i.service?`<h3>Затронутый сервис</h3><p>${esc(i.service)}</p>`:""}${i.scenario?`<h3>Сценарий использования</h3><p>${esc(i.scenario)}</p>`:""}${i.solution?`<h3>Решение из выгрузки</h3><p>${esc(i.solution)}</p>`:""}${i.needsFollowUp===true?`<h3>Оставшиеся действия</h3><p>Выгрузка указывает, что требуется устранить последствия инцидента.</p>`:""}</section><section class="inline-ai"><h3>${icon("sparkle")}Кратко о ситуации</h3><p>${esc(isDone(i)?"Инцидент завершён. Решение и дата завершения показаны, если они есть в выгрузке.":i.summary)}</p><p class="ai-disclaimer">Краткое описание из карточки инцидента</p><button class="text-button" data-drawer-tab="ai">Рекомендация команды и факторы внимания</button></section>`;
}
function incidentEvidenceMarkup(i){
  const evidence=operationalEvidence(i,items);
  const links=(title,rows,empty)=>`<div><h4>${title}</h4>${rows.length?`<ul>${rows.map(row=>`<li><button class="text-button" data-open="${esc(row.id)}">${esc(row.id)} · ${esc(row.title)}</button><small>${esc(row.basis.join(' · '))}</small></li>`).join('')}</ul>`:`<p>${empty}</p>`}</div>`;
  return `<section class="workflow-detail incident-evidence"><h3>Связи, сходство и назначения</h3>
    ${links('Подтверждённые связи',evidence.confirmed,'Связанных ID среди карточек нет.')}
    ${links('Похожие инциденты',evidence.similarities,'Похожих записей по текущим полям не найдено.')}
    <h4>Аномалии назначения</h4>${evidence.assignment.length?`<ul>${evidence.assignment.map(row=>`<li><strong>${esc(row.label)}</strong><small>${esc(row.evidence)} ${(row.ids||[]).map(id=>`<button class="text-button" data-open="${esc(id)}">${esc(id)}</button>`).join(' ')}</small></li>`).join('')}</ul>`:'<p>По имеющимся данным отклонения не выявлены.</p>'}</section>`;
}
function drawerAI(i){
  const factors=[];
  if(isOpen(i)&&i.priority==="critical")factors.push("Критический приоритет: восстановление сервиса требует первоочередного внимания.");
  if(isOverdue(i))factors.push("Установленный срок решения уже нарушен.");
  else if(isOpen(i)&&i.dueAt!==null&&(i.dueAt-Date.now())<30*60000)factors.push("До срока решения остаётся менее 30 минут.");
  if(i.team===COORDINATORS&&!isDone(i))factors.push("Инцидент у координаторов: требуется определить профильную команду.");
  if(i.status==="investigating")factors.push("Сервис уже восстановлен. Сейчас требуется разбор причин, а не повторное восстановление.");
  if(isDone(i))factors.push("Инцидент находится в завершённом статусе.");
  if(!factors.length)factors.push("Команда назначена; следует отслеживать статус и оставшееся время.");
  return `<section class="inline-ai" style="margin-top:0"><h3>${icon("sparkle")}Сводка для координатора</h3><p>${esc(isDone(i)?"Инцидент завершён. Проверьте решение и признак необходимости устранения последствий в карточке.":i.summary)}</p><p class="ai-disclaimer">Разбор по правилам · на основе данных карточки</p></section>${incidentEvidenceMarkup(i)}<button class="button chat-incident-button" data-chat-open data-chat-context="${esc(i.id)}">${icon("sparkle")}Спросить об этом инциденте</button><div class="ai-section-label">Рекомендуемая команда</div><section class="recommendation"><strong>${esc(i.recommendation||"Владелец продукта не указан")}</strong><p>${i.recommendation?"Рекомендация демонстрационного сценария. Аналитик подтверждает передачу через SimpleOne.":`Сейчас назначено: «${esc(shortTeam(i.team))}». Для предложения другой команды нужен справочник владельцев продукта «${esc(i.product)}».`}</p></section><div class="ai-section-label">Почему стоит обратить внимание</div><ul class="risk-factors">${factors.map(f=>`<li>${esc(f)}</li>`).join("")}</ul><p class="source-note">Подсказки опираются на текущие данные. Основания и ссылки доступны прямо в карточке. В чате можно задать свой вопрос.</p>`;
}
function drawerHistory(i){
  const cache=cardHistory.get(i.id),observed=cache?.events||events.filter(e=>e.incidentId===i.id);
  const records=[...new Map([...i.history,...(i.workHistory||[]),...observed].map(e=>[e.id||[e.at,e.title,e.detail].join('|'),e])).values()].sort((a,b)=>b.at-a.at);
  return `<div class="timeline">${records.map(e=>`<div class="timeline-item"><strong>${esc(e.title)}</strong><p>${esc(e.detail)}</p>${(e.changes||[]).map(c=>`<div class="history-diff"><span>${esc(c.label)}</span><p>Было: ${esc(c.before)}<br>Стало: ${esc(c.after)}</p></div>`).join('')}<time>${fmtFullTime(e.at)} МСК${e.actor?' · '+esc(e.actor):''}</time></div>`).join('')}</div>${cache?.loading?'<p class="history-status">Загружаю историю…</p>':''}${cache?.error?`<p class="history-status">${esc(cache.error)}</p>`:''}${cache?.hasMore?`<button class="button button-secondary" data-card-history-more="${esc(i.id)}">Показать более ранние события</button>`:''}`;
}
async function loadCardHistory(id,more=false){
  if(sourceData.source!=='shared')return;
  const previous=cardHistory.get(id);if(previous?.loading||!more&&previous?.revision===sourceData.revision&&!previous.error)return;
  const cache={...previous,loading:true,error:null};cardHistory.set(id,cache);
  try{const query=new URLSearchParams({incident_id:id,limit:'50'});if(more&&cache.cursor)query.set('before',cache.cursor);const response=await fetch('/api/incidents/history?'+query,{cache:'no-store'});if(!response.ok)throw new Error();const data=await response.json();cardHistory.set(id,{events:more?[...(cache.events||[]),...data.events]:data.events,cursor:data.nextCursor,hasMore:data.hasMore,revision:sourceData.revision,loading:false});}
  catch{cardHistory.set(id,{...cache,loading:false,error:'Не удалось загрузить историю. Повторите позже.'});}
  if(state.selected===id&&state.drawerTab==='history')renderDrawer();
}
function safeItsmUrl(value){try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.href:null;}catch{return null;}}
function simpleOneLink(item,className){
  const url=!sourceData.frozen&&!item.isSimulated&&safeItsmUrl(item.itsmUrl);
  if(url)return `<a class="${className}" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Открыть в ITSM</a>`;
  const query=new URLSearchParams({incident:item.id,dataset:presentation.datasetView});
  if(operations.isGuest())query.set("guest","1");
  return `<a class="${className}" data-simpleone="${esc(item.id)}" href="/itsm-demo?${esc(query.toString())}" target="_blank" rel="noopener noreferrer">Открыть в SimpleOne · демо</a>`;
}
function passLocalIncident(event){
  const link=event.target.closest('a[data-simpleone]');
  if(!link||!sourceData.frozen)return;
  const item=items.find(row=>row.id===link.dataset.simpleone);
  if(!item)return;
  try{
    const token=Array.from(crypto.getRandomValues(new Uint8Array(16)),byte=>byte.toString(16).padStart(2,'0')).join('');
    const key='mts-simpleone-preview:'+token;
    localStorage.setItem(key,JSON.stringify(item));
    // The new tab consumes the handoff. Expire it if the tab was never opened.
    setTimeout(()=>{try{localStorage.removeItem(key);}catch{}},60000);
    const url=new URL(link.href);
    url.searchParams.set('preview',token);
    link.href=url.href;
  }catch{
    event.preventDefault();
    toast('Не удалось открыть учебную карточку','Разрешите браузеру сохранять данные сайта и повторите переход.','changed');
  }
}
document.addEventListener('click',passLocalIncident);
document.addEventListener('auxclick',event=>{if(event.button===1)passLocalIncident(event);});
function renderDrawer(){
  const i=items.find(i=>i.id===state.selected);if(!i){closeDrawer();return;}
  $("#drawer").innerHTML=`<header class="drawer-header"><div class="drawer-id-row"><div class="drawer-id">${esc(i.id)}<button class="copy-button icon-button" data-copy="${esc(i.id)}" aria-label="Скопировать ID">${icon("copy")}</button></div><button class="icon-button" id="close-drawer" aria-label="Закрыть карточку">${icon("close")}</button></div><h2 id="drawer-title">${esc(i.title)}</h2><div class="drawer-badges">${groupsFor(i).map(g=>`<span class="group-badge ${g.key}">${g.title}</span>`).join("")}${isDone(i)?'<span class="group-badge" style="background:#edf7f0;color:#5a8f6a">Решён</span>':""}</div><nav class="drawer-tabs" aria-label="Разделы карточки">${[["overview","Инцидент"],["history","История"],["ai","ИИ-помощник"]].map(([key,label])=>`<button class="${state.drawerTab===key?"active":""}" data-drawer-tab="${key}" aria-pressed="${state.drawerTab===key}">${label}</button>`).join("")}</nav></header><div class="drawer-body">${state.drawerTab==="overview"?operations.details(i,{showPrecedents:true})+drawerOverview(i):state.drawerTab==="ai"?drawerAI(i):drawerHistory(i)}</div><footer class="drawer-footer"><button class="button button-secondary" data-copy="${i.id}">${icon("copy")}Скопировать ID</button>${simpleOneLink(i,'button button-primary')}</footer>`;
}
function openIncident(id,tab="overview"){
  if(!items.some(x=>x.id===id))return;
  presentation.spotlight=id;renderReference(ctrlContext());
  lastFocus=document.activeElement;state.selected=id;state.drawerTab=tab;
  $("#drawer-backdrop").hidden=false;$("#drawer").hidden=false;document.body.style.overflow="hidden";
  $("#notification-popover").hidden=true;$("#notification-button").setAttribute("aria-expanded","false");$("#scenario-menu").hidden=true;$("#scenarios-button").setAttribute("aria-expanded","false");
  renderDrawer();if(tab==="history")loadCardHistory(id);$("#close-drawer").focus();
}
function closeDrawer(){state.selected=null;$("#drawer-backdrop").hidden=true;$("#drawer").hidden=true;document.body.style.overflow="";if(lastFocus?.isConnected)lastFocus.focus();else $(".nav-item.active").focus();}
function renderNotifications(){const events=visibleEvents();$("#notification-popover").innerHTML=`<h2>Уведомления</h2><p>${sourceData.frozen?"Локальная демонстрация":"Изменения полученной выгрузки"}</p>${events.slice(0,5).map(e=>eventMarkup(e)).join("")}`;}
function toast(title,detail,type="critical"){
  const el=document.createElement("div");el.className=`toast ${type}`;el.innerHTML=`${icon(type==="success"?"checkCircle":"alert")}<div class="toast-copy"><strong>${esc(title)}</strong><p>${esc(detail)}</p></div><button class="icon-button" aria-label="Закрыть уведомление">${icon("close")}</button>`;el.querySelector("button").addEventListener("click",()=>el.remove());$("#toast-region").append(el);while($("#toast-region").children.length>3)$("#toast-region").firstElementChild.remove();setTimeout(()=>el.remove(),7500);
}
function addEvent(item,type,title,detail){const now=Date.now();events.unshift({id:now+Math.random(),incidentId:item.id,type,title,detail,at:now});item.history.push({title,detail,at:now});state.lastUpdate=now;state.unread=true;refreshProducts();render();toast(title,`${item.id} · ${detail}`,type);}
function scenariosMenu(){return `<div class="menu-title">ДЕМОНСТРАЦИЯ ИЗМЕНЕНИЙ</div><button data-scenario="critical">${icon("alert")}Новый критический инцидент</button><button data-scenario="coord">${icon("users")}Назначить координаторам</button><button data-scenario="deadline">${icon("timer")}Изменить срок решения</button><button data-scenario="resolve">${icon("checkCircle")}Решить критический инцидент</button><div class="menu-separator"></div><button data-scenario="compact" class="muted-action">${icon("list")}${state.compact?"Обычный":"Компактный"} вид</button><button data-scenario="reset" class="muted-action">${icon("refresh")}Начать заново</button>`;}
function runScenario(type){
  if(type!=="compact"&&type!=="reset"&&!(operations.isGuest()&&type==="critical")){sourceData.frozen=true;renderDataStatus();}
  $("#scenario-menu").hidden=true;$("#scenarios-button").setAttribute("aria-expanded","false");
  if(type==="critical"){
    const now=Date.now(),id=`INC-${now}${String(Math.floor(Math.random()*1000)).padStart(3,"0")}`;
    const i={id,title:"Недоступна оплата мобильной связи",product:"Мой МТС",priority:"critical",status:"assigned",team:COORDINATORS,assignee:"Мария Орлова",createdAt:now,dueAt:now+15*60000,isNew:true,description:"Новый демонстрационный инцидент: при пополнении счёта возникает ошибка. Событие добавлено для проверки реакции дашборда.",summary:"Нарушена оплата мобильной связи. Инцидент критический и поступил координаторам; необходимо подключить платёжную команду.",recommendation:"Платёжная платформа",history:[{title:"Инцидент зарегистрирован",detail:"Приоритет: критический",at:now}]};
    if(operations.isGuest()){i.guestDemo=true;i.sysId="demo:"+id;operations.addDemo(i);}else baseItems.unshift(i);
    rebuildItems();addEvent(i,"critical","Новый критический инцидент","Мой МТС · требуется реакция координатора");
  }else if(type==="coord"){
    const i=baseItems.find(i=>isOpen(i)&&i.team!==COORDINATORS&&i.priority!=="critical")||baseItems.find(i=>isOpen(i)&&i.team!==COORDINATORS);
    if(!i){toast("Все активные инциденты уже у координаторов","Добавьте новое событие или начните демонстрацию заново.","success");return;}
    i.team=COORDINATORS;i.assignee="Павел Ильин";i.status="assigned";rebuildItems();addEvent(i,"coord","Назначен на координаторов",`${i.product} · требуется профильная команда`);
  }else if(type==="deadline"){
    const i=baseItems.find(i=>isOpen(i)&&i.priority==="high"&&!isOverdue(i))||baseItems.find(isOpen);
    if(!i){toast("Нет активных инцидентов","Начните демонстрацию заново.","success");return;}
    i.dueAt=Date.now()+2*60000;rebuildItems();addEvent(i,"changed","Срок решения изменён",`${i.product} · осталось 2 минуты`);
  }else if(type==="resolve"){
    const rows=operations.book(),critical=items.filter(i=>isOpen(i)&&i.priority==="critical");
    const i=critical.find(item=>!operations.pending(item,rows));
    if(!i){
      if(critical.length)toast("Инцидент ждёт аналитика","Передайте инцидент исполнительной команде через SimpleOne.","changed");
      else toast("Критических инцидентов нет","Все критические сервисы восстановлены.","success");
      return;
    }
    const entry=i.guestDemo?{...i}:baseItems.find(item=>item.id===i.id)||i;
    Object.assign(entry,{status:"resolved",resolvedAt:Date.now(),isNew:false,solution:"Демосценарий подтвердил восстановление сервиса."});
    if(i.guestDemo){operations.addDemo(entry);refreshOperations(true);return;}
    rebuildItems();addEvent(entry,"success","Критический инцидент решён",`${i.product} · работа сервиса восстановлена`);
  }else if(type==="compact"){state.compact=!state.compact;render();}
  else if(type==="reset"){if(operations.isGuest())operations.clearDemo();loadIncidents(true);}
}
function updateDemoButton(){$("#demo-button").innerHTML=`${icon(state.demoRunning?"pause":"play")}<span>${state.demoRunning?"Остановить демо":"Запустить демо"}</span>`;}
function stopDemo(){clearInterval(state.demoTimer);state.demoTimer=null;state.demoRunning=false;updateDemoButton();}
function startDemo(){
  state.demoRunning=true;state.demoStep=0;updateDemoButton();state.view="dashboard";resetFilters();render();
  const steps=["critical","coord","deadline","resolve"];
  runScenario(steps[state.demoStep++]);
  state.demoTimer=setInterval(()=>{runScenario(steps[state.demoStep++]);if(state.demoStep>=steps.length){stopDemo();}},6500);
}
function resetFilters(){presentation.bucket=null;presentation.scope='focus';state.team=null;state.search="";state.product="all";state.overdue=false;state.coordinator=false;state.priority="all";state.group=null;$("#search").value="";$("#product-filter").value="all";}
function selectDnaIncident(id){
  if(!items.some(item=>item.id===id))return;
  presentation.spotlight=id;
  renderTop();
}
async function copyId(id){try{await navigator.clipboard.writeText(id);toast("ID скопирован",id,"success");}catch{const temp=document.createElement("textarea");temp.value=id;temp.setAttribute("readonly","");temp.style.position="fixed";temp.style.opacity="0";document.body.append(temp);temp.select();const ok=document.execCommand("copy");temp.remove();toast(ok?"ID скопирован":"ID инцидента",id,"success");}}

document.addEventListener("click",event=>{
  if(event.target.closest("a[href]"))return;
  const target=event.target.closest("button, [data-open], [data-preview]");
  if(target?.id==='dataset-view-toggle'){if(sourceData.busy)return;presentation.datasetView=presentation.datasetView==='mts-demo'?'source':'mts-demo';stopDemo();sourceData.frozen=false;loadIncidents(true);return;}
  if(target?.dataset.preview){presentation.spotlight=target.dataset.preview;renderReference(ctrlContext());return;}
  if(target?.hasAttribute('data-clear-sla')){presentation.bucket=null;render();return;}
  if(target?.hasAttribute('data-reset-reference')){resetFilters();render();return;}
  if(target?.dataset.focusGroup){
    const group=target.dataset.focusGroup;
    state.group=state.group===group?null:group;
    render();
    $(`[data-focus-group="${group}"]`)?.focus({preventScroll:true});
    return;
  }
  if(target?.dataset.dnaIncident){
    $('#dna-search').value='';$('#dna-category').value='all';
    selectDnaIncident(target.dataset.dnaIncident);
    $('#incident-dna').scrollIntoView({block:'nearest'});
    $("#dna-incident-picker").focus({preventScroll:true});
    return;
  }
  if(target?.dataset.queueScope){state.group=null;presentation.scope=target.dataset.queueScope;state.view='dashboard';presentation.screen='workstation';render();return;}
  if(target?.hasAttribute('data-fullscreen')){if(!document.fullscreenElement)document.documentElement.requestFullscreen?.().catch(()=>{});else document.exitFullscreen?.();return;}
  if(target?.dataset.screenMode){presentation.screen=target.dataset.screenMode;state.view='dashboard';if(presentation.screen==='workstation'&&document.fullscreenElement)document.exitFullscreen?.();refreshOperations(true);return;}
  if(target?.dataset.themeMode){const theme=target.dataset.themeMode==='night'?'night':'day';document.documentElement.dataset.theme=theme;try{localStorage.setItem('mts-ctrl-theme',theme);}catch{}syncPresentation();document.querySelector('meta[name="theme-color"]').content=theme==='night'?'#0b0e14':'#f2f3f7';return;}
  if(target?.dataset.product){state.product=state.product===target.dataset.product?'all':target.dataset.product;$('#product-filter').value=state.product;render();return;}
  if(target?.hasAttribute("data-import-open")){openImportDialog();return;}
  if(target?.hasAttribute("data-history-more")){loadMoreHistory(target);return;}
  if(target?.dataset.cardHistoryMore){loadCardHistory(target.dataset.cardHistoryMore,true);return;}
  if(target?.hasAttribute("data-reload-incidents")){loadIncidents(true);return;}
  if(target?.hasAttribute("data-all-incidents")){presentation.screen='workstation';resetFilters();presentation.scope='all';state.view="dashboard";render();return;}
  if(target?.dataset.open){openIncident(target.dataset.open,target.dataset.initialTab||"overview");return;}
  if(target?.dataset.view){presentation.screen='workstation';state.view=target.dataset.view;render();window.scrollTo({top:0,behavior:"smooth"});}
  if(target?.matches('button[data-layout]')){state.layout=target.dataset.layout;render();}
  if(target?.dataset.scenario)runScenario(target.dataset.scenario);
  if(target?.dataset.drawerTab){state.drawerTab=target.dataset.drawerTab;renderDrawer();if(state.drawerTab==="history")loadCardHistory(state.selected);$(`#drawer [data-drawer-tab="${state.drawerTab}"]`).focus();}
  if(target?.dataset.copy)copyId(target.dataset.copy);
  if(target?.dataset.team){resetFilters();state.team=target.dataset.team;presentation.scope=target.hasAttribute('data-active-team')?'active':'all';state.view="dashboard";state.layout="table";render();window.scrollTo({top:0,behavior:"smooth"});}
  if(target?.dataset.metric){presentation.bucket=null;presentation.scope=target.dataset.metric==='all'?'active':'focus';presentation.screen='workstation';state.layout="table";const key=target.dataset.metric,was=key==="critical"?state.priority==="critical":key==="overdue"?state.overdue:key==="coord"?state.coordinator:false;state.overdue=false;state.coordinator=false;state.priority="all";state.group=null;if(!was){if(key==="critical")state.priority="critical";if(key==="overdue")state.overdue=true;if(key==="coord")state.coordinator=true;}render();}
  if(target?.id==="close-drawer")closeDrawer();
  if(!event.target.closest(".scenario-anchor")){$("#scenario-menu").hidden=true;$("#scenarios-button").setAttribute("aria-expanded","false");}
  if(!event.target.closest("#notification-popover")&&!event.target.closest("#notification-button")){$("#notification-popover").hidden=true;$("#notification-button").setAttribute("aria-expanded","false");}
});
$("#search").addEventListener("input",e=>{state.search=e.target.value;render();});
$("#work-sla").addEventListener("change",event=>{presentation.bucket=event.target.value||null;render();});
$("#work-sort").addEventListener("change",event=>{state.sort=event.target.value;render();});
$("#dna-search").addEventListener("input",()=>operations.renderDna());
$("#dna-category").addEventListener("change",()=>operations.renderDna());
$("#dna-incident-picker").addEventListener("change",event=>selectDnaIncident(event.target.value));
$("#product-filter").addEventListener("change",e=>{state.product=e.target.value;render();});
$("#mine-filter").addEventListener("click",()=>{state.coordinator=!state.coordinator;render();});
$("#reset-filters").addEventListener("click",()=>{resetFilters();render();});
$("#scenarios-button").addEventListener("click",()=>{const menu=$("#scenario-menu");menu.innerHTML=scenariosMenu();menu.hidden=!menu.hidden;$("#scenarios-button").setAttribute("aria-expanded",!menu.hidden);});
$("#demo-button").addEventListener("click",()=>state.demoRunning?stopDemo():startDemo());
$("#notification-button").addEventListener("click",()=>{const p=$("#notification-popover");renderNotifications();p.hidden=!p.hidden;state.unread=false;$("#notification-dot").hidden=true;$("#notification-button").setAttribute("aria-expanded",!p.hidden);});
$("#drawer-backdrop").addEventListener("click",closeDrawer);
$("#about-button").addEventListener("click",()=>$("#about-dialog").showModal());
document.addEventListener("keydown",e=>{
  if($("#workflow-dialog").open)return;
  if(!$("#assistant-panel").hidden){
    if(e.key==="Escape"){e.preventDefault();closeAssistant();return;}
    if(e.key==="Tab"){const focusable=$$("#assistant-panel button:not([disabled]),#assistant-panel textarea:not([disabled]),#assistant-panel a[href]");const first=focusable[0],last=focusable.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}
    return;
  }
  if($("#import-dialog").open)return;
  if(e.key==="Escape"){
    if(state.selected)closeDrawer();
    $("#scenario-menu").hidden=true;$("#scenarios-button").setAttribute("aria-expanded","false");$("#notification-popover").hidden=true;$("#notification-button").setAttribute("aria-expanded","false");
  }
  if(state.selected&&e.key==="Tab"){
    const focusable=$$("#drawer button:not([disabled]),#drawer a[href]");const first=focusable[0],last=focusable.at(-1);
    if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
  }
  if(e.key==="/"&&!state.selected&&state.view==="dashboard"&&presentation.screen==="workstation"&&!/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)){e.preventDefault();$("#search").focus();}
  if((e.key==="Enter"||e.key===" ")&&e.target.matches("[data-preview]")){e.preventDefault();presentation.spotlight=e.target.dataset.preview;renderReference(ctrlContext());}
  if((e.key==="Enter"||e.key===" ")&&e.target.matches("tr[data-open]")){e.preventDefault();openIncident(e.target.dataset.open);}
});
window.addEventListener("resize",()=>{if(presentation.screen==="wallboard")renderScreen();});
window.addEventListener("pagehide",()=>clearInterval(state.demoTimer));

function assistantRequestContext(){return sourceData.frozen?{contextMode:'client_demo',snapshot:assistantSnapshot()}:{contextMode:'server',context:{view:presentation.datasetView,selectedId:assistant.contextId}};}
function assistantSnapshot(){return {simulation:presentation.datasetView==='mts-demo',selectedId:assistant.contextId,incidents:items.map(i=>({id:i.id,title:i.title,product:i.product,priority:i.priority,status:i.status,team:i.team,assignee:i.assignee,createdAt:i.createdAt,dueAt:i.dueAt,description:i.description,summary:i.summary,recommendation:i.recommendation}))};}
function refreshAssistantContext(){const el=$("#assistant-context");if(!el)return;const current=items.find(i=>i.id===assistant.contextId);el.innerHTML=current?`${icon("box")}<span>В контексте: ${esc(current.id)}</span><button id="assistant-clear-context" aria-label="Переключить на все инциденты">${icon("close")}</button>`:`${icon("grid")}<span>${items.length} инцидентов · актуальный снимок</span>`;}
function assistantMessageMarkup(message){
  if(message.role==='user')return `<article class="assistant-message user"><div class="assistant-message-label">Вы</div><div class="assistant-message-body">${esc(message.content)}</div></article>`;
  const content=esc(message.content).replace(/\*\*([^*\n]+)\*\*/g,'<strong>$1</strong>');
  const known=new Set(items.map(i=>i.id));
  const refs=(message.references||[]).filter(id=>known.has(id));
  return `<article class="assistant-message ${message.error?'error':''}"><div class="assistant-message-label">${icon("sparkle")}${message.welcome?'Помощник координатора':message.mode==='llm'?'Фокус AI':message.error?'Не удалось получить ответ':'Демо-анализ'}${message.model?`<span>${esc(message.model)}</span>`:''}</div>${message.warning?`<div class="assistant-warning">${esc(message.warning)}</div>`:''}<div class="assistant-message-body">${content}</div>${refs.length?`<div class="assistant-references">${refs.map(id=>`<button data-chat-reference="${esc(id)}">${esc(id)}${icon("external")}</button>`).join('')}</div>`:''}${message.context?`<div class="assistant-data-proof">${message.context.mode==='client_demo'?'Локальная симуляция этой вкладки':`Данные сервера${message.context.version?' · версия '+message.context.version:''} · всего ${message.context.total}`}${message.context.stale?' · сохранённый снимок':''}</div>`:''}${message.at?`<time>${fmtTime(message.at)} МСК · ${message.mode==='llm'?'языковая модель':'анализ снимка'}</time>`:''}</article>`;
}
function assistantCanAsk(){return !auth.checking&&(Boolean(auth.user)||operations.isGuest());}
function renderAssistantMessages(){
  const box=$("#assistant-messages");if(!box)return;
  box.innerHTML=assistant.messages.map(assistantMessageMarkup).join('')+(assistant.pending?`<div class="assistant-working" role="status">${icon("sparkle")}Анализирую текущие инциденты…</div>`:'');
  box.scrollTop=box.scrollHeight;
  $("#assistant-new-chat").disabled=assistant.pending;
  $$("[data-chat-preset]").forEach(b=>b.disabled=assistant.pending||!assistantCanAsk());
  updateAssistantSendButton();
}
function updateAssistantSendButton(){const input=$("#assistant-input"),button=$("#assistant-send");if(!input||!button)return;button.disabled=assistant.pending||!input.value.trim()||!assistantCanAsk();$("#assistant-counter").textContent=`${input.value.length}/2000`;}
function renderAssistantStatus(){
  const badge=$("#assistant-mode"),notice=$("#assistant-mode-note");if(!badge||!notice)return;
  const config=assistant.configuration;
  badge.textContent=config?config.label:'Проверяю подключение';badge.classList.toggle('connected',Boolean(config?.available));
  notice.classList.toggle('connected',Boolean(config?.available));
  notice.textContent=config?config.message:'Проверяю, подключена ли языковая модель…';
}
async function checkAssistantConnection(){
  const check=$("#assistant-check");if(check)check.disabled=true;
  if(operations.isGuest()){assistant.configuration={available:false,label:'Гостевой анализ',message:'Ответы по правилам и текущим карточкам этого браузера.'};renderAssistantStatus();if(check)check.disabled=false;return;}
  try{const response=await fetch('/api/assistant/status',{cache:'no-store',signal:AbortSignal.timeout(7000)});if(!response.ok)throw new Error();const data=await response.json();assistant.configuration={available:data.available===true,label:data.label,message:data.message};}
  catch{assistant.configuration={available:false,label:'Сервис недоступен',message:'Не удалось проверить подключение. Проверьте интернет и нажмите кнопку обновления рядом с режимом.'};}
  finally{renderAssistantStatus();if($("#assistant-check"))$("#assistant-check").disabled=false;}
}
function openAssistant(contextId=null){
  assistant.lastFocus=document.activeElement;
  assistant.contextId=items.some(i=>i.id===contextId)?contextId:null;
  if(state.selected)closeDrawer();
  $("#scenario-menu").hidden=true;$("#notification-popover").hidden=true;
  $("#assistant-backdrop").hidden=false;$("#assistant-panel").hidden=false;document.body.style.overflow='hidden';
  $("#assistant-panel").innerHTML=`<header class="assistant-header"><div class="assistant-heading"><span class="assistant-avatar">${icon("sparkle")}</span><div><h2 id="assistant-title">Фокус AI</h2><p>Вопросы по инцидентам на дашборде</p></div><button class="icon-button" id="assistant-close" aria-label="Закрыть чат">${icon("close")}</button></div><div class="assistant-state-row"><span id="assistant-mode" class="assistant-mode"></span><button class="icon-button" id="assistant-check" aria-label="Проверить ответ помощника" title="Проверить ответ помощника">${icon("refresh")}</button><button class="assistant-new-chat" id="assistant-new-chat">Новый диалог</button></div><p class="assistant-mode-note" id="assistant-mode-note"></p><a class="assistant-setup-link" href="/guide.html#yandex" target="_top">Как работает помощник</a><div class="assistant-context" id="assistant-context"></div></header><div class="assistant-messages" id="assistant-messages" aria-live="polite" aria-relevant="additions text" aria-label="История диалога"></div><div class="assistant-presets"><button data-chat-preset="Что сейчас самое срочное?">Что самое срочное?</button><button data-chat-preset="Какие инциденты просрочены?">Что просрочено?</button><button data-chat-preset="${assistant.contextId?`Кому передать ${esc(assistant.contextId)}?`:'Сводка по всем инцидентам'}">${assistant.contextId?'Кому передать?':'Краткая сводка'}</button><button data-chat-preset="Проверь связи, похожие случаи и аномалии назначения${assistant.contextId?" "+esc(assistant.contextId):""}">Связи и назначения</button></div><form class="assistant-form" id="assistant-form"><label for="assistant-input" class="sr-only">Вопрос помощнику</label><textarea id="assistant-input" rows="2" maxlength="2000" placeholder="Например: кто решает INC000021931151?"></textarea><div class="assistant-form-bottom"><span><span id="assistant-counter">0/2000</span><span class="assistant-keyboard-hint"> · Enter — отправить</span></span><button class="button button-primary" id="assistant-send" type="submit" disabled>Отправить${icon("sparkle")}</button></div></form><div class="assistant-footer-note">Выгрузка хакатона. Ответы могут содержать ошибки — сверяйте с карточкой.</div>`;
  if(!assistant.messages.length)assistant.messages.push({role:'assistant',welcome:true,content:'Привет! Можно спросить о приоритетах, похожих инцидентах и аномалиях назначения. В каждом вопросе использую свежий снимок инцидентов: после демособытия ответ изменится.'});
  const gate=document.createElement('div');gate.id='assistant-auth-gate';gate.className='assistant-auth-gate';$(".assistant-presets").before(gate);
  refreshAssistantAuth();
  renderAssistantMessages();renderAssistantStatus();refreshAssistantContext();checkAssistantConnection();
  $("#assistant-input").addEventListener('input',updateAssistantSendButton);
  $("#assistant-input").addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();if(!assistant.pending)submitAssistantQuestion();}});
  $("#assistant-form").addEventListener('submit',e=>{e.preventDefault();submitAssistantQuestion();});
  if(auth.user)$("#assistant-input").focus();else $("#assistant-close").focus();
}
function closeAssistant(){$("#assistant-panel").hidden=true;$("#assistant-backdrop").hidden=true;document.body.style.overflow='';if(assistant.lastFocus?.isConnected&&!assistant.lastFocus.closest('[hidden]'))assistant.lastFocus.focus();else $("#assistant-launcher").focus();}
async function submitAssistantQuestion(preset){
  if(assistant.pending)return;
  if(!assistantCanAsk()){refreshAssistantAuth();return;}
  const input=$("#assistant-input"),question=(typeof preset==='string'?preset:input.value).trim();if(!question||question.length>2000)return;
  const history=assistant.messages.filter(m=>!m.welcome&&!m.error).slice(-8).map(m=>({role:m.role,content:m.content}));
  const generation=assistant.generation;
  if(operations.isGuest()){
    const rows=operations.book(),snapshot={...assistantSnapshot(),incidents:items.map(item=>{
      const assignment=operations.assignment(item,rows);return {...item,team:assignment.team,assignee:assignment.person};
    })};
    const answer=localAnswer(question,snapshot,history);
    assistant.messages.push({role:'user',content:question},{role:'assistant',content:answer,mode:'local',references:selectReferences(answer,snapshot.incidents),context:{mode:'client_demo'},at:Date.now()});
    input.value='';renderAssistantMessages();return;
  }
  assistant.messages.push({role:'user',content:question});assistant.pending=true;input.value='';assistant.controller=new AbortController();
  renderAssistantMessages();
  const timeout=setTimeout(()=>assistant.controller?.abort(),65000);
  try{
    const response=await fetch('/api/assistant/chat',{method:'POST',headers:{'Content-Type':'application/json'},signal:assistant.controller.signal,body:JSON.stringify({question,history,...assistantRequestContext()})});
    const data=await response.json().catch(()=>({error:'Сервис вернул некорректный ответ.'}));
    if(response.status===401){auth.user=null;auth.canImport=false;auth.checking=false;renderAccount();renderDataStatus();refreshAssistantAuth();}
    if(!response.ok)throw new Error(data.error||'Не удалось получить ответ.');
    if(typeof data.answer!=='string'||!data.answer.trim())throw new Error('Помощник вернул пустой ответ.');
    if(generation!==assistant.generation)return;
    if(data.context?.mode==='server'&&data.context.revision!==sourceData.revision&&!sourceData.frozen)await loadIncidents();
    assistant.messages.push({role:'assistant',content:data.answer.slice(0,12000),mode:data.mode,model:data.model,warning:data.warning,references:Array.isArray(data.references)?data.references:[],context:data.context,at:Date.now()});
    if(data.mode==='llm'){assistant.configuration={available:true,label:'Яндекс отвечает',message:'Получен настоящий ответ модели Яндекса по текущему снимку инцидентов.'};renderAssistantStatus();}
    else if(data.warning){assistant.configuration={available:false,label:'Модель недоступна',message:data.warning};renderAssistantStatus();}
  }catch(e){if(generation===assistant.generation)assistant.messages.push({role:'assistant',error:true,content:e.name==='AbortError'?'Время ожидания истекло. Попробуйте задать вопрос ещё раз.':e.message||'Не удалось связаться с помощником. Попробуйте ещё раз.'});}
  finally{clearTimeout(timeout);if(generation===assistant.generation){assistant.pending=false;assistant.controller=null;renderAssistantMessages();}}
}
document.addEventListener('click',event=>{
  const target=event.target.closest('button');if(!target)return;
  if(target.id==='assistant-launcher'||target.hasAttribute('data-chat-open'))openAssistant(target.dataset.chatContext||null);
  if(target.id==='assistant-close')closeAssistant();
  if(target.id==='assistant-check'){if(auth.user)submitAssistantQuestion('Дай короткую сводку по текущим инцидентам: сколько активных, критических и у координаторов?');else{checkAssistantConnection();refreshAssistantAuth();}}
  if(target.hasAttribute('data-chat-preset'))submitAssistantQuestion(target.dataset.chatPreset);
  if(target.dataset.chatReference){closeAssistant();openIncident(target.dataset.chatReference);}
  if(target.id==='assistant-clear-context'){assistant.contextId=null;refreshAssistantContext();}
  if(target.id==='assistant-new-chat'){assistant.generation++;assistant.messages=[{role:'assistant',welcome:true,content:'Новый диалог. Задайте вопрос по текущим инцидентам.'}];renderAssistantMessages();$("#assistant-input").focus();}
});
$("#assistant-backdrop").addEventListener('click',closeAssistant);

async function logoutOwnAccount(){
  try{const response=await fetch('/api/auth/logout',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:'{}'});const data=await response.json();if(!response.ok)throw new Error(data.error||'Не удалось выйти.');const target=new URL(data.redirectTo||'/',location.origin);location.assign(target.origin===location.origin?target.pathname+target.search:'/');}catch(error){toast('Не удалось выйти',error.message,'changed');}
}
document.addEventListener('click',event=>{if(event.target.closest('[data-auth-logout]'))logoutOwnAccount();});
function renderAccount(){
  const label=$("#account-label"),avatar=$("#account-avatar"),menu=$("#account-menu");
  if(auth.user){const name=auth.user.displayName;label.textContent=name.includes('@')?name.split('@')[0]:name.split(' ')[0];avatar.textContent=initials(name).toLocaleUpperCase('ru');avatar.classList.add('signed-in');menu.innerHTML=`<div class="account-summary"><strong>${esc(name)}</strong><span>${esc(auth.user.username||auth.user.email||'')}</span><span class="account-role">${auth.user.role==='editor'?'Редактор данных':'Аналитик-координатор'}</span></div><p>Вы можете задавать вопросы помощнику по текущим инцидентам.</p>${auth.canManageAccounts?'<a href="/account" target="_top" class="account-action">Доступ команды</a><a href="/ai-settings" target="_top" class="account-action">Подключение ИИ</a>':''}${auth.logoutMethod==='POST'?'<button type="button" data-auth-logout class="account-action">Выйти из Фокуса</button>':`<a href="${esc(auth.logoutUrl)}" target="_top" class="account-action">Выйти из Фокуса</a>`}`;}
  else{label.textContent=auth.checking?'Войти':'Гость';avatar.textContent='Г';avatar.classList.remove('signed-in');menu.innerHTML=`<div class="account-summary"><strong>${auth.checking?'Проверяем вход…':'Гостевой вход'}</strong><span>Учебные назначения и статусы сохраняются в этом браузере.</span></div>${auth.error?'<p>'+esc(auth.error)+'</p>':''}<a href="${esc(auth.loginUrl)}" target="_top" class="button button-primary">Войти в свой аккаунт</a>${auth.error?'<button id="account-retry" class="account-retry">Повторить проверку</button>':''}`;}
}
function refreshAssistantAuth(){
  const gate=$("#assistant-auth-gate"),input=$("#assistant-input");if(!gate||!input)return;
  const canAsk=assistantCanAsk();
  gate.hidden=canAsk;
  gate.innerHTML=auth.checking?'<strong>Проверяем вход…</strong><p>Подождите несколько секунд.</p>':`<strong>${auth.error?'Не удалось проверить сеанс':'Войдите в Фокус'}</strong><p>После входа вы сможете задавать вопросы по текущим инцидентам.</p><a class="button button-primary" href="${esc(auth.assistantLoginUrl)}" target="_top">Войти и открыть чат</a>`;
  input.disabled=!canAsk;input.placeholder=canAsk?'Например: кто решает INC000021931151?':'Войдите, чтобы отправить вопрос';
  $$("[data-chat-preset]").forEach(b=>b.disabled=assistant.pending||!canAsk);
  updateAssistantSendButton();
}
async function checkCurrentUser(){
  auth.checking=true;auth.error=null;renderAccount();refreshAssistantAuth();
  try{if(guestView)return;const response=await fetch('/api/auth/me',{cache:'no-store',credentials:'same-origin',signal:AbortSignal.timeout(7000)});if(!response.ok)throw new Error();const data=await response.json();auth.canImport=data.capabilities?.importIncidents===true;auth.canManageAccounts=data.capabilities?.manageAccounts===true;auth.logoutMethod=data.logoutMethod||'GET';auth.user=data.authenticated===true&&['coordinator','editor'].includes(data.user?.role)?data.user:null;auth.loginUrl=data.loginUrl;auth.assistantLoginUrl=data.assistantLoginUrl;auth.logoutUrl=data.logoutUrl;}
  catch{auth.user=null;auth.canImport=false;auth.error='Не удалось проверить вход. Повторите попытку.';}
  finally{auth.checking=false;refreshOperations(true);}
}
$("#account-button").addEventListener('click',()=>{const menu=$("#account-menu");menu.hidden=!menu.hidden;$("#account-button").setAttribute('aria-expanded',!menu.hidden);$("#notification-popover").hidden=true;});
document.addEventListener('click',event=>{if(!event.target.closest('.account-area')){$("#account-menu").hidden=true;$("#account-button").setAttribute('aria-expanded','false');}if(event.target.closest('#account-retry'))checkCurrentUser();});
document.addEventListener('keydown',event=>{if(event.key==='Escape'){$("#account-menu").hidden=true;$("#account-button").setAttribute('aria-expanded','false');}});
const mobileToggle=document.createElement("button");
mobileToggle.id="mobile-filters";mobileToggle.className="filter-chip mobile-filter-toggle";mobileToggle.setAttribute("aria-expanded","false");mobileToggle.setAttribute("aria-controls","work-sort work-sla product-filter mine-filter");
$(".reference-filters").prepend(mobileToggle);
mobileToggle.addEventListener("click",()=>{const open=$("#toolbar").classList.toggle("filters-open");mobileToggle.setAttribute("aria-expanded",open);});
$$('[data-icon]').forEach(el=>el.innerHTML=icon(el.dataset.icon));
$("#product-filter").innerHTML='<option value="all">Все продукты</option>'+[...new Set(items.map(i=>i.product))].sort((a,b)=>a.localeCompare(b,"ru")).map(product=>`<option value="${esc(product)}">${esc(product)}</option>`).join("");
render();
checkCurrentUser().then(()=>{if(new URLSearchParams(location.search).get('assistant')==='1'){openAssistant();history.replaceState(null,'',location.pathname+location.hash);}});
loadIncidents();
setInterval(()=>{if(!document.hidden)loadIncidents();},5000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)loadIncidents();});
setInterval(updateTimers,1000);
