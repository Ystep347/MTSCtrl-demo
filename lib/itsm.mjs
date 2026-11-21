// Links are derived from deployment settings; raw incident data and its revision
// stay intact. productUrl identifies a product and is never an incident URL.
export function itsmTemplate(value) {
  if (typeof value !== 'string' || value.length > 2048 || /[\s\\<>"']/.test(value)) return null;
  if (!/\{(?:id|sysId)\}/.test(value) || /[{}]/.test(value.replace(/\{(?:id|sysId)\}/g, ''))) return null;
  try {
    const url = new URL(value.replaceAll('{id}', 'INC123').replaceAll('{sysId}', '123'));
    const authority = value.match(/^https:\/\/([^/?#]+)/i)?.[1];
    if (url.protocol !== 'https:' || url.username || url.password || !authority || /[{}]/.test(authority)) return null;
    return value;
  } catch { return null; }
}

export function incidentItsmLink(item, template) {
  const valid = itsmTemplate(template);
  if (!valid || valid.includes('{sysId}') && !item.sysId || valid.includes('{id}') && !item.id) return null;
  return valid.replaceAll('{id}', encodeURIComponent(item.id || '')).replaceAll('{sysId}', encodeURIComponent(item.sysId || ''));
}

export async function attachItsmLinks(dataset, env = {}) {
  const template = itsmTemplate(env.ITSM_INCIDENT_URL_TEMPLATE);
  const incidents = dataset.incidents.map(item => ({...item, itsmUrl: incidentItsmLink(item, template)}));
  // ETag describes the representation, including configured links. The raw
  // revision still serves as the optimistic concurrency guard for imports.
  const suffix = template ? Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(template)))).map(x => x.toString(16).padStart(2, '0')).join('').slice(0, 16) : '';
  return {...dataset, incidents, representationRevision: dataset.revision + (suffix ? '-' + suffix : ''), integrations: {itsm: {configured: Boolean(template)}}};
}

const simpleOneId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value);
const simpleOneField = value => typeof value === 'string' && /^[a-z][a-z0-9_]{0,62}$/.test(value);
export function simpleOneConfiguration(env) {
  const {SIMPLEONE_URL:base, SIMPLEONE_TOKEN:token, SIMPLEONE_GROUP_IDS:groups, SIMPLEONE_TABLE:table='itsm_incident', SIMPLEONE_DISPATCH_FIELD:field}=env;
  if(!base&&!token&&!groups&&!field&&!env.SIMPLEONE_EVENTS_TOKEN)return null;
  try {
    const url=new URL(base),mapping=JSON.parse(groups);
    const tableName=table||'itsm_incident';
    if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash||
      !token||/[\r\n]/.test(token)||!simpleOneField(tableName)||!mapping||Array.isArray(mapping)||
      !Object.keys(mapping).length||Object.values(mapping).some(id=>typeof id!=='string'||!/^\d{1,24}$/.test(id))||
      (field&&(!simpleOneField(field)||['sys_id','assignment_group','state'].includes(field)))||
      (env.SIMPLEONE_EVENTS_TOKEN&&!field))throw new Error();
    return {origin:url.origin,token,mapping,table:tableName,field};
  } catch {
    throw {status:503,message:'Проверьте серверные настройки SimpleOne и соответствие команд системным ID.'};
  }
}

export function simpleOneDispatchInfo(env) {
  try{
    const config=simpleOneConfiguration(env);
    return config?{mode:'live',teams:Object.keys(config.mapping)}:{mode:'demo'};
  }catch{return {mode:'unavailable'};}
}

export function simpleOneDestination(item,team,config) {
  if(!config)return null;
  if(!simpleOneId(item.sysId))throw {status:422,message:'В выгрузке отсутствует системный ID карточки SimpleOne.'};
  if(!Object.hasOwn(config.mapping,team))throw {status:422,message:'У команды нет соответствия в справочнике SimpleOne.'};
  return config.mapping[team];
}

export async function sendSimpleOneAssignment(item,row,config) {
  if(!config){
    acceptDemoDispatch({incidentId:item.id,sysId:item.sysId||'',team:row.team,dispatchId:row.dispatch.id});
    return 'demo';
  }
  const destination=row.dispatch.groupId;
  const body={assignment_group:destination};
  if(config.field)body[config.field]=row.dispatch.id;
  const url=new URL('/rest/v1/table/'+config.table+'/'+encodeURIComponent(item.sysId),config.origin);
  url.searchParams.set('sysparm_display_value','0');
  url.searchParams.set('sysparm_fields','sys_id,assignment_group');
  try {
    const response=await fetch(url,{method:'PATCH',redirect:'error',signal:AbortSignal.timeout(8000),
      headers:{Authorization:'Bearer '+config.token,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(body)});
    if(!response.ok)return 'failed';
    const result=await response.json(),record=Array.isArray(result.data)?result.data[0]:result.data;
    const group=record?.assignment_group?.value??record?.assignment_group;
    return result.status==='OK'&&record?.sys_id===item.sysId&&group===destination?'sent':'failed';
  } catch {
    return 'failed';
  }
}

export function acceptDemoDispatch(body) {
  if(!body||!/^INC-?\d{1,18}$/.test(body.incidentId)||typeof body.sysId!=='string'||body.sysId.length>80||
    typeof body.team!=='string'||!body.team.trim()||body.team.length>220||!/^[a-f0-9]{32}$/.test(body.dispatchId))
    throw {status:422,message:'Учебный SimpleOne не принял данные назначения.'};
  return {received:true,dispatchId:body.dispatchId,mode:'demo'};
}
