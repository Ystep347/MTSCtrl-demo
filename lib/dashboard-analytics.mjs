import {isActiveIncident,isFinishedIncident} from './incidents.mjs';

export const SLA_BUCKETS=[
  {key:'overdue',range:'Срок нарушен',label:'Просрочено',color:'#FF0032'},
  {key:'urgent',range:'0–15 мин',label:'Нужна реакция',color:'#F97316'},
  {key:'warning',range:'15–60 мин',label:'Под контролем',color:'#F59E0B'},
  {key:'buffer',range:'Более 60 мин',label:'Есть запас',color:'#10B981'}
];
export function slaBucket(incident,now=Date.now()){
  if(!isActiveIncident(incident)||!Number.isFinite(incident.dueAt))return null;
  const left=incident.dueAt-now;
  return left<0?'overdue':left<15*60000?'urgent':left<60*60000?'warning':'buffer';
}
export function dashboardAnalytics(incidents,now=Date.now(),intervalHours=6){
  const active=incidents.filter(isActiveIncident),research=incidents.filter(i=>i.status==='investigating');
  const buckets=SLA_BUCKETS.map(b=>({...b,count:active.filter(i=>slaBucket(i,now)===b.key).length}));
  const productNames=[...new Set(incidents.map(i=>i.product))];
  const products=productNames.map(name=>{
    const own=incidents.filter(i=>i.product===name),open=own.filter(isActiveIncident),unfinished=own.filter(i=>!isFinishedIncident(i));
    return {name,total:own.length,count:unfinished.length,active:open.length,critical:open.filter(i=>i.priority==='critical').length,overdue:open.filter(i=>slaBucket(i,now)==='overdue').length,buckets:buckets.map(b=>open.filter(i=>slaBucket(i,now)===b.key).length)};
  });
  const statuses=[['working','Выполняется','#2563EB'],['assigned','Назначен','#8B5CF6'],['investigating','Исследование','#F59E0B'],['resolved','Завершён','#10B981'],['closed','Закрыт','#94A3B8']].map(([key,label,color])=>({key,label,color,count:incidents.filter(i=>i.status===key).length}));
  const priorities=[['critical','Критический','#FF0032'],['high','Высокий','#F59E0B'],['medium','Средний','#2563EB'],['low','Низкий','#94A3B8']].map(([key,label,color])=>({key,label,color,count:incidents.filter(i=>i.priority===key).length}));
  const teams=[...new Set(incidents.filter(i=>!isFinishedIncident(i)).map(i=>i.team))].map(name=>{
    const own=incidents.filter(i=>i.team===name&&!isFinishedIncident(i));
    return {name,total:own.length,critical:own.filter(i=>isActiveIncident(i)&&i.priority==='critical').length,high:own.filter(i=>isActiveIncident(i)&&i.priority==='high').length,other:own.filter(i=>isActiveIncident(i)&&!['critical','high'].includes(i.priority)).length,research:own.filter(i=>i.status==='investigating').length};
  }).sort((a,b)=>b.total-a.total||a.name.localeCompare(b.name,'ru'));
  const times=incidents.flatMap(i=>[i.createdAt,i.resolvedAt]).filter(Number.isFinite);
  const interval=([6,24].includes(intervalHours)?intervalHours:6)*3600000;
  let timeline=[];
  if(times.length){
    // At most 100 bins, even when imports span many years. No invented history.
    const min=Math.min(...times),max=Math.max(...times),step=Math.max(interval,Math.ceil((max-min)/100/interval)*interval);
    const moscowOffset=3*3600000;
    const start=Math.floor((min+moscowOffset)/step)*step-moscowOffset,end=Math.floor((max+moscowOffset)/step)*step-moscowOffset;
    timeline=Array.from({length:Math.round((end-start)/step)+1},(_,index)=>({at:start+index*step,created:0,recovered:0}));
    for(const i of incidents){
      if(Number.isFinite(i.createdAt))timeline[Math.floor((i.createdAt-start)/step)].created++;
      if(Number.isFinite(i.resolvedAt))timeline[Math.floor((i.resolvedAt-start)/step)].recovered++;
    }
  }
  return {total:incidents.length,active:active.length,research:research.length,finished:incidents.filter(isFinishedIncident).length,unknownDeadline:active.filter(i=>!Number.isFinite(i.dueAt)).length,buckets,products,statuses,priorities,teams,timeline};
}
