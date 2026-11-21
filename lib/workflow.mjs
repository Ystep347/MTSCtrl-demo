import {nextWorkflowState,projectWorkflowItem} from './operations.mjs';
import {criticalRecoveryEvent} from './incidents.mjs';
import {simpleOneDestination} from './itsm.mjs';

function workflowRow(row){
  return {id:row.incident_id,sysId:row.sys_id,version:row.version,phase:row.phase,pending:Boolean(row.pending),
    team:row.team,takenAt:row.taken_at,updatedAt:row.updated_at,report:row.report,reportSource:row.report_source,
    ...JSON.parse(row.details_json||'{}')};
}

export async function incidentWorkflowSnapshot(db,items){
  if(!db||!items.length)return [];
  const keys=items.map(({id,sysId})=>[id,sysId]);
  const result=await db.prepare("SELECT w.* FROM json_each(?) i JOIN incident_workflow w ON w.incident_id=json_extract(i.value,'$[0]') AND w.sys_id=json_extract(i.value,'$[1]') ORDER BY w.incident_id,w.sys_id").bind(JSON.stringify(keys)).all();
  return result.results.map(workflowRow);
}

export function workflowForViewer(row,user){
  const {id,sysId,version,phase,pending,team,takenAt,updatedAt,caseStatus,resolvedAt,researchCompletedAt,solution,history,report,reportSource}=row;
  const dispatch=row.dispatch?{id:row.dispatch.id,state:row.dispatch.state,at:row.dispatch.at,previousTeam:row.dispatch.previousTeam,sourceTeam:row.dispatch.sourceTeam}:null;
  return {id,sysId,version,phase,pending,team,takenAt,updatedAt,caseStatus,resolvedAt,researchCompletedAt,dispatch,
    ...(user?{solution,history,report,reportSource}:{})};
}

export function incidentAssignments(items,workflow){
  const byId=new Map(workflow.map(row=>[row.id,row]));
  return items.map(item=>{
    const row=byId.get(item.id);
    return row?.sysId===item.sysId?projectWorkflowItem(item,row):item;
  });
}

export function newIncidentWorkflowStatements(db,before,after,importId,now){
  const keys=new Set(before.map(item=>item.id+'\n'+item.sysId));
  const newcomers=after.filter(item=>!keys.has(item.id+'\n'+item.sysId)&&['assigned','working','investigating'].includes(item.status));
  const statements=[];
  for(let i=0;i<newcomers.length;i+=100){
    const rows=newcomers.slice(i,i+100).map(({id,sysId})=>({id,sysId}));
    statements.push(db.prepare("INSERT INTO incident_workflow (incident_id,sys_id,version,phase,pending,updated_at) SELECT json_extract(value,'$.id'),json_extract(value,'$.sysId'),1,'new',1,? FROM json_each(?) WHERE EXISTS (SELECT 1 FROM incident_imports WHERE id=?) ON CONFLICT(incident_id,sys_id) DO UPDATE SET version=incident_workflow.version+1,phase='new',pending=1,team='',target_id=NULL,target_name=NULL,owner_id=NULL,owner_name=NULL,taken_at=NULL,updated_at=excluded.updated_at,report='',report_source='rules',details_json='{}'").bind(now,JSON.stringify(rows),importId));
  }
  return statements;
}

export async function readIncidentWorkflow(db,item){
  const row=await db.prepare('SELECT * FROM incident_workflow WHERE incident_id=? AND sys_id=?').bind(item.id,item.sysId||'').first();
  return row?workflowRow(row):null;
}

export async function planIncidentWorkflow(db,snapshot,input,actor,config=null){
  const item=snapshot.incidents.find(i=>i.id===input.id);
  if(!item)throw {status:404,message:'Инцидент отсутствует в текущей выгрузке.'};
  const current=await readIncidentWorkflow(db,item);
  const next=nextWorkflowState(item,current,input,actor);
  if(input.action==='assign'){
    if(!config&&!snapshot.incidents.some(i=>i.team===next.team))throw {status:422,message:'Выберите команду из текущей выгрузки.'};
    Object.assign(next.dispatch,{groupId:simpleOneDestination(item,next.team,config),origin:config?.origin||null,table:config?.table||null});
  }
  if(input.action==='retry'&&(next.dispatch.origin!==(config?.origin||null)||next.dispatch.table!==(config?.table||null)||
    next.dispatch.groupId!==simpleOneDestination(item,next.team,config)))
    throw {status:409,message:'Настройки назначения в SimpleOne изменились. Проверьте состояние доставки.'};
  return {item,current,next};
}

export async function saveIncidentWorkflow(db,snapshot,next){
  const details=JSON.stringify({caseStatus:next.caseStatus,resolvedAt:next.resolvedAt,researchCompletedAt:next.researchCompletedAt,solution:next.solution,history:next.history,dispatch:next.dispatch});
  const fields=[next.version,next.phase,Number(next.pending),next.team||'',next.takenAt??null,next.updatedAt,next.report||'',next.reportSource||'rules',details];
  const write=next.version===1
    ? await db.prepare('INSERT INTO incident_workflow (incident_id,sys_id,version,phase,pending,team,taken_at,updated_at,report,report_source,details_json) SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM incident_state WHERE revision=?) ON CONFLICT(incident_id,sys_id) DO NOTHING').bind(next.id,next.sysId,...fields,snapshot.revision)
    : await db.prepare('UPDATE incident_workflow SET version=?,phase=?,pending=?,team=?,taken_at=?,updated_at=?,report=?,report_source=?,details_json=? WHERE incident_id=? AND sys_id=? AND version=? AND EXISTS (SELECT 1 FROM incident_state WHERE revision=?)').bind(...fields,next.id,next.sysId,next.version-1,snapshot.revision);
  const statements=[write];
  const item=snapshot.incidents.find(item=>item.id===next.id&&item.sysId===next.sysId);
  if(item?.priority==='critical'&&next.caseStatus==='resolved'&&next.history?.at(-1)?.type==='resolve'){
    const event=criticalRecoveryEvent(item);
    statements.push(db.prepare(`INSERT INTO incident_events (id,import_id,incident_id,kind,title,detail,at,changes_json)
      SELECT ?,import_id,?,?,?,?,?,'[]' FROM incident_state WHERE id=1 AND changes()=1
      ON CONFLICT(id) DO NOTHING`).bind(event.id,item.id,event.type,event.title,event.detail,next.resolvedAt));
  }
  const [result]=await db.batch(statements);
  if(!result.meta?.changes)throw {status:409,message:'Инцидент или его назначение изменились. Повторите действие по актуальной карточке.'};
  return next;
}
