import {incidentGroups,isActiveIncident,isFinishedIncident,INCIDENT_COORDINATORS} from './incidents.mjs';
export const DEMO_ID='INC-9001';
export const TIMELINE_STEPS=['Исходные данные','Критический сбой','Назначение','Изменение срока','Восстановление','Исследование'];
export function attentionScore(i,now=Date.now()){
  if(isFinishedIncident(i))return -1000;
  if(i.status==='investigating')return 20+(i.team===INCIDENT_COORDINATORS?80:0);
  let score=({critical:1000,high:600,medium:200,low:100})[i.priority]||0;
  if(i.team===INCIDENT_COORDINATORS)score+=80;
  if(i.dueAt!==null){const left=i.dueAt-now;if(left<0)score+=300;else if(left<=5*60000)score+=200;else if(left<=15*60000)score+=120;}
  return score;
}
export function attentionReasons(i,now=Date.now()){
  const out=[];
  if(isActiveIncident(i)&&i.priority==='critical')out.push({title:'Критический приоритет',detail:'Восстановление сервиса требует первоочередного внимания.',tone:'critical'});
  if(isActiveIncident(i)&&i.dueAt!==null){const left=i.dueAt-now;if(left<0)out.push({title:'Срок решения нарушен',detail:'Нужно уточнить прогресс и необходимость эскалации.',tone:'warning'});else if(left<=15*60000)out.push({title:'До срока менее 15 минут',detail:'Проверьте, успевает ли назначенная команда.',tone:'warning'});}
  if(i.team===INCIDENT_COORDINATORS&&!isFinishedIncident(i))out.push({title:'У координаторов',detail:i.status==='investigating'?'Нужна передача исследования профильной команде.':'Нужно определить профильную команду.',tone:'coord'});
  if(i.status==='investigating')out.push({title:'Сервис восстановлен',detail:'Продолжается исследование причин; активная просрочка восстановления не считается.',tone:'research'});
  if(isFinishedIncident(i))out.push({title:'Инцидент завершён',detail:'Карточка остаётся доступна для истории и передачи смены.',tone:'success'});
  if(isActiveIncident(i)&&i.dueAt===null)out.push({title:'Срок не указан',detail:'Уточните срок у ответственных. Отсутствие срока не означает просрочку.',tone:'warning'});
  if(!out.length)out.push({title:'Команда назначена',detail:'Следите за прогрессом и сроком решения.',tone:'neutral'});
  return out;
}
export function nextAction(i,now=Date.now()){
  if(isFinishedIncident(i))return 'Проверить фиксацию восстановления и оставшиеся действия.';
  if(i.status==='investigating')return i.team===INCIDENT_COORDINATORS?'Передать исследование профильной команде.':'Уточнить результаты исследования причин.';
  if(i.team===INCIDENT_COORDINATORS)return 'Определить профильную команду и подготовить передачу.';
  if(i.dueAt===null)return 'Уточнить срок решения у назначенной команды.';
  if(i.dueAt<now)return 'Уточнить прогресс и необходимость эскалации.';
  return 'Проверить прогресс команды до срока решения.';
}
export function rankIncidents(items,now=Date.now()){
  return [...items].sort((a,b)=>attentionScore(b,now)-attentionScore(a,now)||(a.dueAt??Infinity)-(b.dueAt??Infinity)||a.id.localeCompare(b.id));
}
export function workbenchCounts(items,now=Date.now()){
  return {total:items.length,active:items.filter(isActiveIncident).length,finished:items.filter(isFinishedIncident).length,focus:items.filter(i=>incidentGroups(i).length).length,critical:items.filter(i=>incidentGroups(i).includes('critical')).length,coord:items.filter(i=>incidentGroups(i).includes('coord')).length,high:items.filter(i=>incidentGroups(i).includes('high')).length,research:items.filter(i=>incidentGroups(i).includes('research')).length,overdue:items.filter(i=>isActiveIncident(i)&&i.dueAt!==null&&i.dueAt<now).length};
}
export function productAssignments(items){
  const result=new Map();
  for(const i of items){if(!result.has(i.product))result.set(i.product,{name:i.product,ids:[],active:0,critical:0,teams:new Map()});const p=result.get(i.product);p.ids.push(i.id);if(isActiveIncident(i))p.active++;if(incidentGroups(i).includes('critical'))p.critical++;if(!p.teams.has(i.team))p.teams.set(i.team,[]);p.teams.get(i.team).push(i.id);}
  return [...result.values()].sort((a,b)=>b.critical-a.critical||b.active-a.active||a.name.localeCompare(b.name,'ru')).map(p=>({...p,teams:[...p.teams].map(([name,ids])=>({name,ids})).sort((a,b)=>b.ids.length-a.ids.length)}));
}
export function buildTimeline(base,step,now=Date.now()){
  const stage=Math.max(0,Math.min(TIMELINE_STEPS.length-1,Math.trunc(step)||0)),items=structuredClone(base),events=[];
  if(stage===0)return {items,events,step:stage};
  // This is a presentation-only scenario, never sent to import or shared storage.
  if(items.some(i=>i.id===DEMO_ID))throw new Error('demo_id_collision');
  const start=now-5*60000;
  const demo={id:DEMO_ID,title:'Не проходит оплата мобильной связи',product:'Мой МТС',priority:'critical',status:'assigned',team:INCIDENT_COORDINATORS,assignee:'Демонстрационный исполнитель',createdAt:start,dueAt:now+12*60000,resolvedAt:null,assignedAt:start,description:'Демонстрационный сценарий: при пополнении счёта возникает ошибка. Изменения действуют только в этом предпросмотре.',summary:'Недоступна оплата мобильной связи. Требуется контроль восстановления и определение профильной команды.',history:[{title:'Зарегистрирован демонстрационный сбой',detail:'Критический приоритет',at:start}],solution:'',itsmUrl:null};
  items.unshift(demo);
  events.push({id:'demo-1',incidentId:demo.id,title:'Новый критический сбой',detail:'Мой МТС · требуется реакция',type:'critical',at:start});
  const candidate=items.find(i=>i.id!==DEMO_ID&&isActiveIncident(i)&&i.team!==INCIDENT_COORDINATORS);
  if(stage>=2&&candidate){candidate.team=INCIDENT_COORDINATORS;candidate.status='assigned';events.push({id:'demo-2',incidentId:candidate.id,title:'Назначен на координаторов',detail:candidate.product,type:'coord',at:start+60000});}
  if(stage>=3){demo.dueAt=now+3*60000;events.push({id:'demo-3',incidentId:demo.id,title:'Срок решения изменён',detail:'До срока осталось 3 минуты',type:'changed',at:start+2*60000});}
  if(stage>=4){demo.status='resolved';demo.resolvedAt=now-60000;demo.solution='Демонстрация: работа оплаты восстановлена.';events.push({id:'demo-4',incidentId:demo.id,title:'Сервис восстановлен',detail:'Мой МТС · активный таймер остановлен',type:'success',at:now-60000});}
  if(stage>=5){demo.status='investigating';events.push({id:'demo-5',incidentId:demo.id,title:'Начато исследование причин',detail:'Сервис работает · нужен разбор причин',type:'research',at:now});}
  return {items,events:events.reverse(),step:stage};
}
const clock=t=>new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).format(t);
const statusNames={assigned:'Назначен',working:'Выполняется',investigating:'Исследование',resolved:'Завершён',closed:'Закрыт'};
export function incidentBrief(i,now=Date.now()){
  return `${i.id} · ${i.title}\nПродукт: ${i.product}\nСтатус: ${statusNames[i.status]}\nКоманда: ${i.team}\nИсполнитель: ${i.assignee}\nСрок: ${i.dueAt===null?'не указан':clock(i.dueAt)+' МСК'}\nСледующий шаг по правилам: ${nextAction(i,now)}\n${i.itsmUrl?'Заявка: '+i.itsmUrl:'Ссылка на ITSM не предоставлена.'}`;
}
export function shiftBrief(items,{demo=false,version=null,now=Date.now()}={}){
  const c=workbenchCounts(items,now),attention=rankIncidents(items.filter(i=>incidentGroups(i).length),now).slice(0,6);
  return `Фокус · передача смены\nСнимок: ${clock(now)} МСК\nРежим: ${demo?'локальная демонстрация':'общие данные'+(version?' · версия '+version:'')}\n\nВсего: ${c.total}; активных: ${c.active}; критических: ${c.critical}; просроченных активных: ${c.overdue}; у координаторов: ${c.coord}; на исследовании: ${c.research}.\nГруппы пересекаются; показатели не складываются.\n\nВ первую очередь:\n${attention.map(i=>`${i.id} · ${i.product}\n${nextAction(i,now)} Команда: ${i.team}`).join('\n\n')}\n\nСводка сформирована по текущим данным и правилам; это не ответ языковой модели.`;
}
