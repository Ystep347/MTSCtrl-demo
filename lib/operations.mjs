import {incidentGroups,INCIDENT_COORDINATORS,isActiveIncident,isFinishedIncident} from './incidents.mjs';

const minute=60000;
const weights={low:1,medium:2,high:3,critical:5};
const clearText=value=>String(value??'').toLocaleLowerCase('ru').replaceAll('ё','е');
const signals=/(массов|повсемест|все(?:х)? пользовател|полная недоступ|нескольк.{0,12}регион|утечк|остановк.{0,12}платеж)/i;

export function workGroupKeys(item){
  const groups=incidentGroups(item);
  if(isActiveIncident(item)&&['medium','low'].includes(item.priority))groups.push(item.priority);
  if(isFinishedIncident(item))groups.push(item.status);
  return groups;
}

export function matchesIncidentScope(item,scope){
  if(scope==='focus')return incidentGroups(item).length>0;
  if(scope==='active')return isActiveIncident(item);
  if(scope==='finished')return isFinishedIncident(item);
  return scope==='all';
}

export function escalationAssessment(item,now=Date.now()){
  if(!isActiveIncident(item))return {level:'none',label:'Сервис восстановлен или работа завершена',score:0,evidence:[]};
  const evidence=[],left=Number.isFinite(item.dueAt)?item.dueAt-now:null;
  let score=(weights[item.priority]||1)*12;
  if(item.priority==='high'||item.priority==='critical')evidence.push('Повышенный исходный приоритет');
  if(left===null)evidence.push('Срок восстановления отсутствует');
  else if(left<0){score+=26;evidence.push('Срок восстановления нарушен');}
  else if(left<=15*minute){score+=22;evidence.push('До срока осталось не более 15 минут');}
  else if(left<=60*minute){score+=9;evidence.push('Восстановление требуется в течение часа');}
  if(signals.test(clearText([item.title,item.summary,item.description].join(' ')))){
    score+=23;evidence.push('В названии или описании есть признаки массового влияния');
  }
  if(Number.isFinite(item.createdAt)&&now>=item.createdAt&&now-item.createdAt<=60*minute){
    score+=8;evidence.push('Инцидент поступил в течение последнего часа');
  }
  if(!evidence.length)evidence.push('По текущим полям дополнительных признаков срочности не найдено');
  const level=item.priority==='critical'?'critical':score>=57?'high':score>=32?'medium':'low';
  const label={critical:'Уже критический',high:'Повышенный риск эскалации',medium:'Умеренный риск эскалации',low:'Низкая оценка риска'}[level];
  return {level,label,score,evidence};
}

export function relevanceOrder(items,{mode='relevance',workflow={},model={},now=Date.now()}={}){
  const compareDate=(a,b)=>b.item.createdAt-a.item.createdAt||a.item.id.localeCompare(b.item.id);
  const compareDeadline=(a,b)=>(a.item.dueAt??Infinity)-(b.item.dueAt??Infinity)||0;
  const compareRelevance=(a,b)=>b.pending-a.pending||b.active-a.active||b.score-a.score||compareDeadline(a,b)||compareDate(a,b);
  const compare={
    newest:compareDate,
    sla:(a,b)=>b.active-a.active||compareDeadline(a,b)||compareRelevance(a,b),
    product:(a,b)=>a.item.product.localeCompare(b.item.product,'ru')||compareRelevance(a,b)
  }[mode]||compareRelevance;
  return items.map(item=>{
    const score=escalationAssessment(item,now).score;
    return {item,active:Number(isActiveIncident(item)),score:score+(model[item.id]?.boost||0),
      pending:Number(Boolean(workflow[item.id]?.pending||item.isNew&&workflow[item.id]?.pending!==false))};
  }).sort(compare).map(row=>row.item);
}

export function teamWorkload(items,workflow={},now=Date.now()){
  const teams=new Map();
  for(const item of items.filter(isActiveIncident)){
    const current=workflow[item.id],name=projectWorkflowItem(item,current).team;
    const team=teams.get(name)||{name,count:0,critical:0,high:0,overdue:0,soon:0,load:0,takenMinutes:[]};
    const left=Number.isFinite(item.dueAt)?item.dueAt-now:null;
    team.count++;
    team.critical+=Number(item.priority==='critical');
    team.high+=Number(item.priority==='high');
    team.overdue+=Number(left!==null&&left<0);
    team.soon+=Number(left!==null&&left>=0&&left<=15*minute);
    team.load+=(weights[item.priority]||1)+(left===null?0:left<0?3:left<=15*minute?2:0);
    if(current?.dispatch&&['sent','demo'].includes(current.dispatch.state)&&Number.isFinite(current.takenAt))team.takenMinutes.push(Math.max(0,Math.floor((now-current.takenAt)/minute)));
    teams.set(name,team);
  }
  return [...teams.values()].sort((a,b)=>b.load-a.load||b.overdue-a.overdue||a.name.localeCompare(b.name,'ru'));
}

const words=item=>new Set((clearText([item.title,item.summary,item.description].join(' ')).match(/[\p{L}\p{N}]{4,}/gu)||[])
  .filter(word=>!['симуляция','учебный','сценарий','инцидент','сервис','сервиса','работает','запросы'].includes(word)));
function similarity(a,b,terms){
  const shared=[...words(b)].filter(word=>terms.has(word)),basis=[];
  let score=0;
  if(a.product&&a.product!=='Продукт не указан'&&a.product===b.product){score+=3;basis.push('совпадает продукт');}
  if(a.service&&a.service===b.service){score+=4;basis.push('совпадает сервис');}
  if(Math.abs(a.createdAt-b.createdAt)<=24*60*minute){score+=1;basis.push('поступили в пределах суток');}
  if(shared.length>=2){score+=Math.min(4,shared.length);basis.push('общие слова: '+shared.slice(0,4).join(', '));}
  return {score,basis,sharedWords:shared.length};
}

export function incidentConnections(selected,items){
  const terms=words(selected);
  const connections=items.filter(item=>item.id!==selected.id).flatMap(item=>{
    const pointsTo=(source,target)=>(source.linkedIncidentIds||[]).some(id=>id===target.id||id===target.sysId);
    if(pointsTo(selected,item)||pointsTo(item,selected))return [{item,kind:'confirmed',score:Infinity,basis:['связанный ID указан в выгрузке']}];
    const match=similarity(selected,item,terms);
    return match.score>=6&&match.basis.length>=2?[{item,kind:'suggested',...match}]:[];
  });
  return connections.sort((a,b)=>b.score-a.score||b.item.createdAt-a.item.createdAt);
}

export function possibleConsequences(selected,connections){
  return connections.flatMap(row=>{
    const elapsed=row.item.createdAt-selected.createdAt;
    if(!(elapsed>0&&elapsed<=24*60*minute)||row.item.isDuplicate)return [];
    const sameService=selected.service&&selected.service===row.item.service;
    const causalFlags=(selected.isEffect||selected.isRootIncident)&&row.item.isReason;
    const similarSymptom=elapsed<=60*minute&&selected.product&&selected.product!=='Продукт не указан'&&
      selected.product===row.item.product&&row.sharedWords>=2;
    if(!sameService&&!causalFlags&&!similarSymptom)return [];
    const delay=Math.ceil(elapsed/minute);
    return [{...row,basis:[...row.basis,'зарегистрирован позже на '+delay+' мин',
      ...(sameService&&!row.basis.includes('совпадает сервис')?['совпадает сервис']:[]),
      ...(causalFlags?['в карточках есть признаки причины и дочернего инцидента']:[])]}];
  });
}

export function teamAssessment(items,now=Date.now()){
  const active=items.filter(isActiveIncident),byTeam=new Map();
  for(const item of active){
    if(!byTeam.has(item.team))byTeam.set(item.team,[]);
    byTeam.get(item.team).push(item);
  }
  return teamWorkload(active,{},now).map(team=>{
    const assigned=byTeam.get(team.name);
    const recent=assigned.filter(i=>Number.isFinite(i.assignedAt)&&i.assignedAt<=now&&i.assignedAt>=now-60*minute);
    const findings=[];
    if(team.overdue) findings.push({fact:'Просрочено '+team.overdue+' из '+team.count+' активных задач.',
      action:team.overdue>=2?'Сверьте прогресс с исполнителями и проверьте, какие задачи можно перенаправить профильной команде.':'Уточните у исполнителя срок восстановления.'});
    if(recent.length>=3) findings.push({fact:'За последний час команде назначено активных задач: '+recent.length+'.',
      action:'Сравните симптомы в ИнциДНК перед дальнейшим распределением.',incidentId:recent.sort((a,b)=>b.assignedAt-a.assignedAt)[0].id});
    if(team.soon||team.critical) findings.push({fact:[team.critical?'Критических задач: '+team.critical:'',team.soon?'Срок в ближайшие 15 минут: '+team.soon:''].filter(Boolean).join(' · ')+'.',
      action:'Согласуйте порядок восстановления с дежурным.'});
    return {...team,findings};
  }).sort((a,b)=>Number(Boolean(b.findings.length))-Number(Boolean(a.findings.length))||b.overdue-a.overdue||b.load-a.load);
}

export function incidentPrecedents(selected,items){
  const terms=words(selected);
  return items.filter(item=>item.id!==selected.id&&isFinishedIncident(item)&&item.resolvedAt&&item.solution)
    .map(item=>({item,...similarity(selected,item,terms)}))
    .filter(row=>row.score>=6&&row.basis.length>=2)
    .sort((a,b)=>b.score-a.score||b.item.resolvedAt-a.item.resolvedAt).slice(0,3);
}

export function workflowHandoff(item,previous,next,actor,note=''){
  const deadline=Number.isFinite(item.dueAt)?new Date(item.dueAt).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'})+' МСК':'не указан';
  return [
    '# Передача '+item.id,
    item.title,
    'Продукт и сервис: '+[item.product,item.service].filter(Boolean).join(' · '),
    'Состояние выгрузки: '+(item.sourceState||item.status)+'. Срок: '+deadline+'.',
    'Передал: '+actor.displayName+'. Откуда: '+item.team+'.',
    'Куда: '+next.team+(next.targetName?' · '+next.targetName:'')+'.',
    previous?.ownerName?'До передачи исполнитель: '+previous.ownerName+'.':null,
    'Что произошло: '+(item.summary||item.description||'описание отсутствует'),
    item.solution?'Запись о решении в выгрузке: '+item.solution:null,
    note?'Комментарий: '+note:null,
    item.status==='investigating'?'Следующий шаг: принять материалы расследования и установить причину сбоя. Сервис восстановлен.':'Следующий шаг: принять инцидент, сверить статус и срок, запросить результат диагностики.'
  ].filter(Boolean).join('\n');
}

export const workflowPhases={new:'Ожидает назначения',assigned:'Назначен исполнительной команде',working:'Назначение из предыдущей версии',deferred:'Назначение из предыдущей версии'};
const lifecycleRank={assigned:0,working:0,resolved:1,investigating:2,closed:3};
const transitionStatus={resolve:'resolved',investigate:'investigating','finish-investigation':'investigating',close:'closed'};
const transitionNames={resolve:'Решение подтверждено',investigate:'Отправлен на расследование','finish-investigation':'Расследование завершено',close:'Инцидент закрыт'};
export const SIMPLEONE_DEMO_KEY='mts-ctrl-guest-workflow';

export function projectWorkflowItem(item,row){
  if(!row)return item;
  const status=lifecycleRank[row.caseStatus]>lifecycleRank[item.status]?row.caseStatus:item.status;
  const dispatch=row.dispatch;
  const delivered=row.team&&(!dispatch||['sent','demo'].includes(dispatch.state));
  const transferTime=delivered?row.takenAt:dispatch?.at;
  const sameTime=Number.isFinite(item.assignedAt)&&item.assignedAt===transferTime;
  const newer=Number.isFinite(item.assignedAt)&&Number.isFinite(transferTime)&&item.assignedAt>transferTime;
  const differs=delivered&&row.team!==item.team;
  const uncertain=differs&&!newer&&(sameTime||(!Number.isFinite(item.assignedAt)||!Number.isFinite(transferTime))&&dispatch?.sourceTeam!==item.team);
  const useSource=newer||sameTime||uncertain;
  const team=useSource?item.team:delivered?row.team:dispatch?.previousTeam||item.team;
  const hasNewSolution=row.resolvedAt&&status!=='working'&&status!=='assigned';
  return {...item,status,team,assignee:!useSource&&delivered&&row.team!==item.team?'Исполнительная команда':item.assignee,
    assignmentConflict:uncertain?'В выгрузке указана команда «'+item.team+'», последняя передача была в «'+row.team+'». Уточните актуальное назначение.':item.assignmentConflict,
    resolvedAt:hasNewSolution?row.resolvedAt:item.resolvedAt,solution:hasNewSolution&&row.solution?row.solution:item.solution,
    assignedAt:!useSource&&delivered&&row.takenAt?row.takenAt:item.assignedAt,workHistory:row.history||[],
    researchCompletedAt:row.researchCompletedAt};
}

export function assignmentSignals(item,items,now=Date.now()){
  const signals=[];
  const team=item.team,hasTeam=Boolean(team&&team!=='Команда не назначена'&&team!==INCIDENT_COORDINATORS);
  if(isActiveIncident(item)&&!hasTeam){
    signals.push({label:'Нет исполнительной команды',evidence:team===INCIDENT_COORDINATORS?'Инцидент у координаторов.':'Команда назначения отсутствует.'});
    if(Number.isFinite(item.dueAt)&&item.dueAt<now)signals.push({label:'Срок истёк до передачи',evidence:'Дедлайн прошёл, исполнительная команда ещё не назначена.'});
  }
  const peers=item.service?items.filter(other=>other.id!==item.id&&other.product===item.product&&other.service===item.service&&isFinishedIncident(other)&&other.team&&other.team!=='Команда не назначена'&&other.team!==INCIDENT_COORDINATORS):[];
  if(hasTeam&&peers.length>=3){
    const byTeam=new Map();
    for(const peer of peers)byTeam.set(peer.team,[...(byTeam.get(peer.team)||[]),peer.id]);
    const [typical,ids]=[...byTeam].sort((a,b)=>b[1].length-a[1].length)[0];
    if(typical!==team&&ids.length/peers.length>=.67)signals.push({label:'Редкая команда для сервиса',evidence:'В '+ids.length+' из '+peers.length+' завершённых случаев этого сервиса работала команда «'+typical+'».',ids:ids.slice(0,5)});
  }
  const transfers=(item.workHistory||[]).filter(event=>event.type==='assignment');
  if(Number.isFinite(item.dueAt)&&transfers.some(event=>event.at>item.dueAt))
    signals.push({label:'Передача после дедлайна',evidence:'В журнале есть подтверждённое назначение после срока восстановления.'});
  if(new Set(transfers.map(event=>event.detail)).size>=3)signals.push({label:'Повторные переназначения',evidence:'В журнале этого инцидента зафиксированы передачи в три или более разные команды.'});
  return signals;
}

export function operationalEvidence(item,items,now=Date.now()){
  const related=incidentConnections(item,items);
  const compact=row=>({id:row.item.id,title:row.item.title,basis:row.basis});
  return {confirmed:related.filter(row=>row.kind==='confirmed').slice(0,5).map(compact),
    similarities:related.filter(row=>row.kind==='suggested').slice(0,5).map(compact),assignment:assignmentSignals(item,items,now)};
}

export function availableWorkflowActions(item,current,actor,now=Date.now()){
  if(!actor)return [];
  const active=projectWorkflowItem(item,current),dispatch=current?.dispatch;
  if(actor.role==='executor')return isActiveIncident(active)&&current?.team===active.team&&!active.assignmentConflict&&dispatch&&['sent','demo'].includes(dispatch.state)&&actor.dispatchId===dispatch.id?['resolve']:[];
  if(!['coordinator','editor'].includes(actor.role))return [];
  if(active.status==='closed')return [];
  if(active.status==='resolved')return ['investigate','close'];
  const research=active.status==='investigating';
  const finish=research?'finish-investigation':'resolve';
  if(research&&current?.researchCompletedAt)return ['close'];
  if(dispatch&&!(Number.isFinite(item.assignedAt)&&item.assignedAt>dispatch.at)){
    if(dispatch.state==='sending')return now-dispatch.at>=20000?['retry']:[];
    if(dispatch.state==='failed')return ['retry',finish];
  }
  if(research)return active.team===INCIDENT_COORDINATORS?['assign',finish]:[finish];
  return [...(incidentGroups(active).some(group=>group!=='research')?['assign']:[]),'resolve'];
}

function appendWorkflowEvent(row,event){
  return {...row,history:[...(row.history||[]),event].slice(-40)};
}

export function nextWorkflowState(item,current,input,actor,now=Date.now()){
  if(input.version!==(current?.version||0))throw {status:409,message:'Инцидент уже изменился. Откройте актуальную карточку.'};
  if(!availableWorkflowActions(item,current,actor,now).includes(input.action))throw {status:403,message:'Действие недоступно в текущем состоянии инцидента.'};
  const base={id:item.id,sysId:item.sysId||'',...current,version:(current?.version||0)+1,updatedAt:now};
  const note=String(input.note||'').trim().slice(0,1000);
  if(input.action==='assign'){
    const team=String(input.team||'').trim();
    if(!team||team.length>220||team===INCIDENT_COORDINATORS||team==='Команда не назначена')throw {status:422,message:'Выберите исполнительную команду.'};
    const id=Array.from(crypto.getRandomValues(new Uint8Array(16)),byte=>byte.toString(16).padStart(2,'0')).join('');
    const next={...base,phase:'assigned',pending:true,team,takenAt:null,
      dispatch:{id,state:'sending',at:now,previousTeam:projectWorkflowItem(item,current).team,sourceTeam:item.team}};
    return {...next,report:workflowHandoff(projectWorkflowItem(item,current),current,next,actor,note),reportSource:'rules'};
  }
  if(input.action==='retry')return {...base,dispatch:{...base.dispatch,state:'sending',at:now}};
  const caseStatus=transitionStatus[input.action];
  if(caseStatus==='resolved'&&!note)throw {status:422,message:'Укажите, какое решение подтверждено.'};
  if(input.action==='finish-investigation'&&!note)throw {status:422,message:'Укажите результат расследования.'};
  const next={...base,caseStatus,pending:false};
  if(caseStatus==='resolved')Object.assign(next,{resolvedAt:now,solution:note,criticalRecovery:item.priority==='critical'});
  if(input.action==='finish-investigation')next.researchCompletedAt=now;
  return appendWorkflowEvent(next,{title:transitionNames[input.action],type:input.action,detail:note,actor:actor.displayName,at:now});
}

export function completeWorkflowDelivery(row,state,actor,now=Date.now()){
  const confirmed=state==='sent'||state==='demo';
  const next={...row,version:row.version+1,updatedAt:now,pending:!confirmed,takenAt:confirmed?now:null,
    dispatch:{...row.dispatch,state,at:now}};
  const title=state==='demo'?'Назначение принято учебным SimpleOne':confirmed?'Назначение принято SimpleOne':'SimpleOne не подтвердил доставку';
  return appendWorkflowEvent(next,{type:confirmed?'assignment':'delivery',title,detail:row.team,actor:actor.displayName,at:now});
}
