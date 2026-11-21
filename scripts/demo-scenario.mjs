// Live defense scenario. Writes an isolated JSON file, never data/incidents.json.
import {readFile,writeFile,mkdir,rename,access} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve,join} from 'node:path';
import {makeMtsSimulationRaw} from '../lib/mts-simulation.mjs';
import {normalizeIncidentDataset} from '../lib/incidents.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const directory=process.env.DEMO_SCENARIO_DIR?resolve(process.env.DEMO_SCENARIO_DIR):join(root,'local-data','defense-demo');
const filename=join(directory,'incidents.json'),demoId='INC990000000001';
const coord='КЦ ИТ Координаторы Массовых Инцидентов';
const command=process.argv[2]||'status';
async function save(rows){normalizeIncidentDataset(rows);await mkdir(directory,{recursive:true});await writeFile(filename+'.tmp',JSON.stringify(rows,null,2)+'\n');await rename(filename+'.tmp',filename);}
async function prepare(){const original=JSON.parse(await readFile(join(root,'data','incidents.json'),'utf8'));const rows=makeMtsSimulationRaw(original);await save(rows);return rows;}
try{
  if(command==='serve'){
    try{await access(filename);}catch{await prepare();}
    console.log('Учебный стенд: отдельный JSON и отдельная база. Исходная выгрузка не меняется.');
    console.log('Во втором терминале запускайте npm run demo:scenario -- critical / coord / deadline / resolve.');
    const child=spawn(process.execPath,['scripts/dev-server.mjs'],{cwd:root,env:{...process.env,INCIDENTS_FILE:filename,LOCAL_DB_PATH:join(directory,'incidents.sqlite'),INCIDENTS_SOURCE_URL:'',DEV_EDITOR_PREVIEW:'0',HOST:'127.0.0.1'},stdio:'inherit'});
    child.on('error',error=>{console.error(error.message);process.exitCode=1;});
    child.on('exit',code=>{process.exitCode=code||0;});
    for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
  }else{
    let rows;
    if(['prepare','reset'].includes(command))rows=await prepare();
    else{try{rows=JSON.parse(await readFile(filename,'utf8'));}catch{throw new Error('Сначала выполните npm run demo:scenario -- prepare');}}
    const now=Date.now(),target=rows.find(i=>i.id===demoId);
    if(command==='critical'){
      if(target)throw new Error('Демоинцидент уже создан. Для повторения выполните reset.');
      const created={...rows[0],id:demoId,sysId:'990000000000000001',state:'Назначен',stateEnum:'Assigned',stateId:0,submitDate:new Date(now).toISOString(),deadline:new Date(now+10*60000).toISOString(),completionDate:null,lastAssignmentToTeamDateTime:new Date(now).toISOString(),priorityId:4,priority:'Наивысший',assignedGroupName:coord,productName:'Биллинг МТС',header:'Недоступно пополнение баланса',service:'Платёжный API',scenarioName:'Учебный сценарий · оплата',shortDescription:'Тестовые запросы пополнения завершаются ошибкой.',description:'Симуляция: платёжный API не подтверждает тестовое пополнение баланса.',solution:'',productUrl:''};
      rows.push(created);await save(rows);
    }else if(command==='coord'){
      const item=rows.find(i=>i.stateEnum==='Research'&&i.assignedGroupName!==coord&&!i.deadline)||rows.find(i=>i.stateEnum==='Research'&&i.assignedGroupName!==coord);
      if(!item)throw new Error('Нет исследования вне координаторов. Выполните reset.');
      item.assignedGroupName=coord;item.lastAssignmentToTeamDateTime=new Date(now).toISOString();await save(rows);
    }else if(command==='deadline'||command==='resolve'){
      if(!target)throw new Error('Сначала создайте критический: npm run demo:scenario -- critical');
      if(command==='deadline')target.deadline=new Date(now+60000).toISOString();
      else Object.assign(target,{state:'Завершён',stateEnum:'Resolved',stateId:7,completionDate:new Date(now).toISOString(),solution:'Симуляция: обработка тестовых платежей восстановлена.'});
      await save(rows);
    }else if(command==='high'){
      const item=rows.find(i=>i.priorityId===3&&['Assigned','WorkInProgress'].includes(i.stateEnum));
      if(!item)throw new Error('Нет активного высокого приоритета. Выполните reset.');
      item.priorityId=4;item.priority='Наивысший';await save(rows);
    }else if(!['prepare','reset','status'].includes(command))throw new Error('Команды: prepare, serve, critical, coord, deadline, resolve, high, reset, status.');
    const data=normalizeIncidentDataset(rows);
    console.log(JSON.stringify({command,file:filename,total:data.meta.total,active:data.meta.active,groups:data.meta.groups,demoIncident:demoId},null,2));
  }
}catch(error){console.error(error.message);process.exitCode=1;}
