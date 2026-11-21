import {summarizeImport} from './import-summary.mjs';
import {normalizeIncidentDataset,incidentChanges,isActiveIncident,isFinishedIncident} from './incidents.mjs';
export const SHARED_MAX_BYTES=1048576;
export const SHARED_MAX_RECORDS=500;
const sharedLabels={assigned:'Назначен',working:'Выполняется',resolved:'Завершён',closed:'Закрыт',investigating:'Исследование'};
const sharedPriorities={low:'Низкий',medium:'Средний',high:'Высокий',critical:'Наивысший'};
const sharedFieldLabels={status:'Статус',priority:'Приоритет',team:'Команда',assignee:'Исполнитель',dueAt:'Срок решения'};
export function canImportIncidents(user,env={}){
  if(!user)return false;
  if(user.authProvider==='password')return user.role==='editor';
  const emails=String(env.DATA_EDITOR_EMAILS||'').split(/[\s,;]+/).map(x=>x.trim().toLowerCase()).filter(Boolean);
  return emails.includes(String(user.email||'').trim().toLowerCase());
}
export async function incidentRevision(raw){
  const bytes=new TextEncoder().encode(JSON.stringify(raw)),digest=await crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,'0')).join('');
}
const sharedDate=value=>value===null?'Не указан':new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(value)+' МСК';
const sharedValue=(field,value)=>field==='status'?sharedLabels[value]:field==='priority'?sharedPriorities[value]:field==='dueAt'?sharedDate(value):String(value??'Не указано');
function importEvents(before,after){
  const output=incidentChanges(before,after),old=new Map(before.map(i=>[i.id,i])),next=new Map(after.map(i=>[i.id,i]));
  const contentFields=['title','description','summary','product','service','scenario','solution','stateReason','needsFollowUp'];
  for(const i of after){const was=old.get(i.id);if(was&&!output.some(e=>e.incidentId===i.id)&&contentFields.some(f=>was[f]!==i[f]))output.push({incidentId:i.id,type:'changed',title:'Карточка обновлена',detail:i.product});}
  return output.map(e=>{
    const was=old.get(e.incidentId),now=next.get(e.incidentId),changes=[];
    if(was&&now)for(const field of Object.keys(sharedFieldLabels))if(was[field]!==now[field])changes.push({label:sharedFieldLabels[field],before:sharedValue(field,was[field]),after:sharedValue(field,now[field])});
    return {...e,changes};
  });
}
export async function readSharedState(db){return db.prepare('SELECT * FROM incident_state WHERE id=1').first();}
export async function ensureSharedData(db,raw){
  let state=await readSharedState(db);if(state)return state;
  const normalized=normalizeIncidentDataset(raw),revision=await incidentRevision(raw),id=crypto.randomUUID(),at=Date.now();
  const summary=JSON.stringify({added:raw.length,changed:0,removed:0,completed:0});
  await db.batch([
    db.prepare('INSERT INTO incident_imports (id,version,revision,source_name,at,actor_id,actor_name,record_count,summary_json,raw_json) SELECT ?,1,?,?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM incident_state WHERE id=1)').bind(id,revision,'Исходная выгрузка',at,'system','Система',normalized.incidents.length,summary,JSON.stringify(raw)),
    db.prepare('INSERT INTO incident_state (id,version,revision,raw_json,updated_at,source_name,import_id) SELECT 1,1,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM incident_imports WHERE id=?)').bind(revision,JSON.stringify(raw),at,'Исходная выгрузка',id,id),
    db.prepare('INSERT INTO incident_events (id,import_id,incident_id,kind,title,detail,at,changes_json) SELECT ?,?,NULL,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM incident_imports WHERE id=?)').bind(id+':seed',id,'system','Подключена исходная выгрузка',`${raw.length} инцидента`,at,'[]',id)
  ]);
  state=await readSharedState(db);if(!state)throw new Error('shared_seed_failed');return state;
}
export async function importSharedDataset(db,raw,expectedRevision,actor,sourceName='Обновлённая выгрузка',options={}){
  if(!expectedRevision)throw {status:428,message:'Сначала обновите данные и повторите загрузку.'};
  if(!Array.isArray(raw)||raw.length===0||raw.length>SHARED_MAX_RECORDS)throw {status:422,message:`В файле должно быть от 1 до ${SHARED_MAX_RECORDS} инцидентов.`};
  if(new TextEncoder().encode(JSON.stringify(raw)).length>SHARED_MAX_BYTES)throw {status:413,message:'Размер выгрузки превышает 1 МБ.'};
  let normalized;try{normalized=normalizeIncidentDataset(raw);}catch(error){throw {status:422,message:error.message};}
  const state=await readSharedState(db);if(!state)throw {status:503,message:'Общие данные ещё загружаются. Повторите попытку.'};
  if(state.revision!==expectedRevision)throw {status:409,message:'Другой редактор уже обновил данные. Обновите страницу и проверьте файл ещё раз.'};
  const revision=await incidentRevision(raw),before=normalizeIncidentDataset(JSON.parse(state.raw_json)).incidents;
  if(revision===state.revision){
    if(options.sourceRevision)await db.prepare('UPDATE incident_state SET last_source_revision=? WHERE id=1 AND version=? AND revision=?').bind(options.sourceRevision,state.version,state.revision).run();
    return {changed:false,revision,version:state.version,summary:summarizeImport(before,normalized.incidents)};
  }
  const id=crypto.randomUUID(),at=Date.now(),version=state.version+1,summary=summarizeImport(before,normalized.incidents),events=importEvents(before,normalized.incidents);
  const name=String(sourceName||'Обновлённая выгрузка').replace(/[\r\n\\/]/g,' ').slice(0,100);
  if(!events.length)events.push({incidentId:null,type:'system',title:'Общая выгрузка обновлена',detail:`${raw.length} инцидентов`,changes:[]});
  const records=events.map((e,index)=>({id:id+':'+index,incidentId:e.incidentId,type:e.type,title:e.title,detail:String(e.detail||'').slice(0,600),at,changes:JSON.stringify(e.changes||[])}));
  const statements=[
    db.prepare('INSERT INTO incident_imports (id,version,revision,source_name,at,actor_id,actor_name,record_count,summary_json,raw_json) SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM incident_state WHERE id=1 AND version=? AND revision=?)').bind(id,version,revision,name,at,actor.userId,String(actor.displayName||'Редактор').slice(0,160),raw.length,JSON.stringify(summary),JSON.stringify(raw),state.version,state.revision),
    db.prepare('UPDATE incident_state SET version=?,revision=?,raw_json=?,updated_at=?,source_name=?,import_id=?,last_source_revision=COALESCE(?,last_source_revision) WHERE id=1 AND version=? AND revision=? AND EXISTS (SELECT 1 FROM incident_imports WHERE id=?)').bind(version,revision,JSON.stringify(raw),at,name,id,options.sourceRevision||null,state.version,state.revision,id)
  ];
  for(let n=0;n<records.length;n+=100)statements.push(db.prepare("INSERT INTO incident_events (id,import_id,incident_id,kind,title,detail,at,changes_json) SELECT json_extract(value,'$.id'),?,json_extract(value,'$.incidentId'),json_extract(value,'$.type'),json_extract(value,'$.title'),json_extract(value,'$.detail'),json_extract(value,'$.at'),json_extract(value,'$.changes') FROM json_each(?) WHERE EXISTS (SELECT 1 FROM incident_imports WHERE id=?)").bind(id,JSON.stringify(records.slice(n,n+100)),id));
  const result=await db.batch(statements);
  if(!result[1]?.meta?.changes)throw {status:409,message:'Данные изменились во время загрузки. Обновите их и повторите попытку.'};
  return {changed:true,revision,version,summary,importId:id};
}
export async function listSharedEvents(db,{before=null,incidentId=null,limit=50,maxVersion=null}={}){
  const conditions=[],params=[];
  if(before!==null){conditions.push('e.seq < ?');params.push(before);}
  if(maxVersion!==null){conditions.push('i.version <= ?');params.push(maxVersion);}
  if(incidentId){conditions.push('e.incident_id = ?');params.push(incidentId);}
  const where=conditions.length?' WHERE '+conditions.join(' AND '):'';
  const result=await db.prepare('SELECT e.*,i.version,i.actor_id FROM incident_events e JOIN incident_imports i ON i.id=e.import_id'+where+' ORDER BY e.seq DESC LIMIT ?').bind(...params,limit+1).all();
  const rows=result.results||[],hasMore=rows.length>limit,visible=rows.slice(0,limit);
  return {events:visible.map(e=>({id:e.id,seq:e.seq,incidentId:e.incident_id,type:e.kind,title:e.title,detail:e.detail,at:e.at,version:e.version,changes:JSON.parse(e.changes_json),actor:e.actor_id==='system'?'Источник данных':'Редактор'})),nextCursor:hasMore?visible.at(-1).seq:null,hasMore};
}
export async function sharedDataset(db,seed,dictionary=[],inputSource=null){
  let state=await ensureSharedData(db,seed),sourceWarning=null;
  if(inputSource){
    try{
      const raw=typeof inputSource.raw==='string'?JSON.parse(inputSource.raw):inputSource.raw,sourceRevision=await incidentRevision(raw);
      if(state.last_source_revision!==sourceRevision){await importSharedDataset(db,raw,state.revision,{userId:'system',displayName:'Источник данных'},inputSource.name,{sourceRevision});state=await readSharedState(db);}
    }catch(error){if(error.status===409)state=await readSharedState(db);else sourceWarning='Не удалось обновить источник. Показана последняя сохранённая версия.';}
  }
  const dataset=normalizeIncidentDataset(JSON.parse(state.raw_json),dictionary),history=await listSharedEvents(db,{limit:100,maxVersion:state.version});
  return {...dataset,source:'shared',revision:state.revision,version:state.version,updatedAt:state.updated_at,sourceName:state.source_name,sourceWarning,persistent:true,importLimits:{maxBytes:SHARED_MAX_BYTES,maxRecords:SHARED_MAX_RECORDS},events:history.events,historyCursor:history.nextCursor,historyHasMore:history.hasMore,pollIntervalMs:5000,loadedAt:new Date().toISOString()};
}
