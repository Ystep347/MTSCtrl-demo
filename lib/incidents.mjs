// The organizer export stays unchanged in data/. This adapter is the contract
// between its external schema and the dashboard; no deadlines are invented.
export const INCIDENT_COORDINATORS = 'КЦ ИТ Координаторы Массовых Инцидентов';
export const INCIDENT_STATUSES = {Assigned:'assigned',WorkInProgress:'working',Resolved:'resolved',Closed:'closed',Research:'investigating'};
export const INCIDENT_PRIORITIES = {1:'low',2:'medium',3:'high',4:'critical'};
const stateNames = {'назначен':'assigned','выполняется':'working','завершен':'resolved','закрыт':'closed','исследование ситуации':'investigating'};
const canonicalStateIds = {assigned:0,working:2,resolved:7,closed:10,investigating:20};
const documentedStateIds = {assigned:0,working:2,resolved:10,closed:7};
const clean = (value,max=5000) => typeof value==='string'?value.trim().slice(0,max):'';
const folded = value => clean(value).toLocaleLowerCase('ru').replaceAll('ё','е');
const fail = message => {throw new Error(message);};
export const isFinishedIncident = item => item.status==='resolved'||item.status==='closed';
export const isActiveIncident = item => item.status==='assigned'||item.status==='working';
export function incidentGroups(item){
  const groups=[];
  if(isActiveIncident(item)&&item.priority==='critical')groups.push('critical');
  if(item.team===INCIDENT_COORDINATORS&&!isFinishedIncident(item))groups.push('coord');
  if(isActiveIncident(item)&&item.priority==='high')groups.push('high');
  if(item.status==='investigating')groups.push('research');
  return groups;
}
export function exportTimestamp(value,field,id,required=false){
  if(value===null||value===undefined||value===''||/^0001-/.test(String(value))){
    if(required)fail(`${id}: не указано поле ${field}.`);
    return null;
  }
  // A date without a zone is ambiguous. The supplied export has UTC (Z).
  if(typeof value!=='string'||!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value))fail(`${id}: у даты ${field} должен быть часовой пояс.`);
  const stamp=Date.parse(value);
  if(!Number.isFinite(stamp)||stamp<=0)fail(`${id}: некорректная дата ${field}.`);
  return stamp;
}
export function exportBoolean(value){
  if(value===null||value===undefined||value==='')return null;
  if(value===true||value===1||['true','да','1'].includes(folded(value)))return true;
  if(value===false||value===0||['false','нет','0'].includes(folded(value)))return false;
  fail('Некорректное логическое значение в выгрузке.');
}
export function normalizeIncidentDataset(rows,dictionary=[]){
  if(!Array.isArray(rows)||rows.length>5000)fail('Ожидается массив не более 5000 инцидентов.');
  const ids=new Set(),warnings=new Map();
  const warn=(code,message,id)=>{
    if(!warnings.has(code))warnings.set(code,{code,message,count:0,ids:[]});
    const entry=warnings.get(code);entry.count++;if(entry.ids.length<5)entry.ids.push(id);
  };
  const incidents=rows.map((raw,index)=>{
    if(!raw||typeof raw!=='object'||Array.isArray(raw))fail(`Запись ${index+1}: ожидается объект.`);
    const id=clean(raw.id,40);
    if(!/^INC-?\d{1,18}$/.test(id))fail(`Запись ${index+1}: некорректный ID инцидента.`);
    if(ids.has(id))fail(`Повторяющийся ID: ${id}.`);ids.add(id);
    const enumStatus=Object.hasOwn(INCIDENT_STATUSES,raw.stateEnum)?INCIDENT_STATUSES[raw.stateEnum]:undefined;
    const textStatus=Object.hasOwn(stateNames,folded(raw.state))?stateNames[folded(raw.state)]:undefined;
    let status=enumStatus||textStatus;
    // 7 and 10 contradict the dictionary: never guess a terminal status.
    const fallbackStates={0:'assigned',2:'working',20:'investigating'};
    if(!status&&Object.hasOwn(fallbackStates,raw.stateId))status=fallbackStates[raw.stateId];
    if(!status)fail(`${id}: неизвестный или неоднозначный статус; нужны stateEnum или state.`);
    if(enumStatus&&textStatus&&enumStatus!==textStatus)warn('state_text_conflict','stateEnum и текст state расходятся; использован stateEnum.',id);
    if(raw.stateId!=null&&Number(raw.stateId)!==canonicalStateIds[status])warn('state_id_conflict','stateId расходится со stateEnum; использован смысловой статус.',id);
    if(Object.hasOwn(documentedStateIds,status)&&Number(raw.stateId)!==documentedStateIds[status])warn('dictionary_state_conflict','Коды 7 и 10 в справочнике противоположны выгрузке. Использован stateEnum.',id);
    if(status==='investigating')warn('undocumented_research','Research / «Исследование ситуации» / 20 отсутствует в справочнике.',id);
    const priority=Object.hasOwn(INCIDENT_PRIORITIES,raw.priorityId)?INCIDENT_PRIORITIES[raw.priorityId]:undefined;
    if(!priority)fail(`${id}: priorityId должен быть от 1 до 4.`);
    const createdAt=exportTimestamp(raw.submitDate,'submitDate',id,true);
    const dueAt=exportTimestamp(raw.deadline,'deadline',id);
    const resolvedAt=exportTimestamp(raw.completionDate,'completionDate',id);
    const assignedAt=exportTimestamp(raw.lastAssignmentToTeamDateTime,'lastAssignmentToTeamDateTime',id);
    if(dueAt===null)warn('missing_deadline','Дедлайн не указан: активная просрочка по нему не вычисляется.',id);
    if(isActiveIncident({status})&&clean(raw.solution))warn('active_solution','У активного инцидента заполнено solution. Это поле не считается подтверждением восстановления.',id);
    const product=clean(raw.productName,180)||'Продукт не указан';
    const team=clean(raw.assignedGroupName,220)||'Команда не назначена';
    const history=[{title:'Инцидент зарегистрирован',detail:`Продукт: ${product}`,at:createdAt}];
    if(assignedAt)history.push({title:'Назначена команда',detail:team,at:assignedAt});
    if(resolvedAt&&!isActiveIncident({status}))history.push({title:status==='investigating'?'Зарегистрировано восстановление':'Инцидент завершён',detail:clean(raw.state),at:resolvedAt});
    const terminal=isFinishedIncident({status})||status==='investigating';
    return {
      id,sysId:clean(raw.sysId,80),title:clean(raw.header,300)||id,
      description:clean(raw.description),summary:clean(raw.shortDescription,1500)||clean(raw.description,1500),
      product,productCode:clean(raw.productMasterId,100),service:clean(raw.service,250),scenario:clean(raw.scenarioName,250),
      priority,status,sourceState:clean(raw.state,100),sourceStateEnum:clean(raw.stateEnum,80),sourceStateId:raw.stateId,
      team,assignee:clean(raw.assignedEmployee,180)||'Исполнитель не назначен',
      createdAt,dueAt,resolvedAt,assignedAt,history,isNew:false,
      // productUrl is a product URL, not an incident link. Do not substitute it.
      itsmUrl:null,recommendation:'',solution:terminal?clean(raw.solution):'',
      stateReason:clean(raw.stateReason,250),needsFollowUp:exportBoolean(raw.isNeedUp),
      isDuplicate:exportBoolean(raw.isDouble),isMaster:exportBoolean(raw.isMaster),
      serviceType:clean(raw.serviceType,150),channel:clean(raw.receivingChannel,150)
    };
  });
  const groups={critical:0,coord:0,high:0,research:0};
  for(const item of incidents)for(const key of incidentGroups(item))groups[key]++;
  return {incidents,meta:{total:incidents.length,active:incidents.filter(isActiveIncident).length,finished:incidents.filter(isFinishedIncident).length,focus:incidents.filter(i=>incidentGroups(i).length).length,groups,products:new Set(incidents.map(i=>i.product)).size,teams:new Set(incidents.map(i=>i.team)).size,exportFields:rows.length?Object.keys(rows[0]).length:0,dictionaryFields:Array.isArray(dictionary)?dictionary.length:0,warnings:[...warnings.values()]}};
}
export function incidentChanges(before,after){
  const old=new Map(before.map(i=>[i.id,i])),next=new Map(after.map(i=>[i.id,i])),changes=[];
  const add=(item,type,title,detail)=>changes.push({incidentId:item.id,type,title,detail});
  for(const item of after){
    const previous=old.get(item.id);
    if(!previous){
      add(item,item.priority==='critical'&&isActiveIncident(item)?'critical':'changed',item.priority==='critical'&&isActiveIncident(item)?'Новый критический инцидент':'Новый инцидент',item.product);
      if(item.team===INCIDENT_COORDINATORS&&!isFinishedIncident(item))add(item,'coord','Новый инцидент у координаторов',item.product);
      continue;
    }
    if(!isFinishedIncident(previous)&&isFinishedIncident(item))add(item,'success','Инцидент завершён',`${item.product} · ${item.sourceState||item.status}`);
    else if(previous.status!==item.status)add(item,'changed','Статус изменён',`${item.product} · ${item.sourceState||item.status}`);
    if(previous.priority!==item.priority)add(item,item.priority==='critical'&&isActiveIncident(item)?'critical':'changed',item.priority==='critical'&&isActiveIncident(item)?'Инцидент стал критическим':'Приоритет изменён',`${item.product} · ${{critical:'Наивысший',high:'Высокий',medium:'Средний',low:'Низкий'}[item.priority]}`);
    if(previous.team!==item.team)add(item,item.team===INCIDENT_COORDINATORS&&!isFinishedIncident(item)?'coord':'changed',item.team===INCIDENT_COORDINATORS&&!isFinishedIncident(item)?'Назначен на координаторов':'Команда изменена',item.team);
    if(previous.dueAt!==item.dueAt)add(item,'changed','Срок решения изменён',item.product);
    if(previous.assignee!==item.assignee)add(item,'changed','Исполнитель изменён',item.assignee);
  }
  for(const previous of before)if(!next.has(previous.id))add(previous,'changed','Запись отсутствует в новой выгрузке','Удаление из файла не означает, что инцидент решён.');
  return changes;
}
