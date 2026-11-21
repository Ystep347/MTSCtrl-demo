// Default: inspect configuration only. --live makes exactly one real request.
// Credentials are read from server environment/.env and never printed.
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {normalizeIncidentDataset} from '../lib/incidents.mjs';
import {projectMtsSimulation} from '../lib/mts-simulation.mjs';
import {getYandexConfiguration,yandexAnswer} from '../lib/yandex.mjs';
try{process.loadEnvFile(fileURLToPath(new URL('../.env',import.meta.url)));}catch(error){if(error.code!=='ENOENT')throw error;}
const live=process.argv.includes('--live');
if(process.argv.slice(2).some(x=>x!=='--live')){console.error('Usage: npm run ai:check [-- --live]');process.exitCode=2;}
else{
  let config;try{config=getYandexConfiguration(process.env);}catch{console.error('Настройки Яндекса некорректны. Проверьте каталог и поддерживаемую модель.');process.exitCode=2;}
  if(process.exitCode!==2){
    const raw=JSON.parse(await readFile(new URL('../data/incidents.json',import.meta.url),'utf8'));
    const snapshot=projectMtsSimulation(normalizeIncidentDataset(raw));
    console.log(JSON.stringify({configured:Boolean(config),model:config?.name||null,records:snapshot.incidents.length,simulation:true,verified:false,requestSent:false}));
    if(!live)console.log('Проверены только настройки. Для одного настоящего запроса: npm run ai:check -- --live');
    else if(!config){console.error('Для запроса нужны серверные YANDEX_API_KEY и YANDEX_FOLDER_ID. Секретный ключ задаётся в .env, а не в коде.');process.exitCode=2;}
    else{
      try{
        const result=await yandexAnswer({question:'Кратко опиши ситуацию по учебной выгрузке и назови количество активных инцидентов. Обозначь, что это симуляция.',history:[],snapshot:{...snapshot,simulation:true,selectedId:null}},process.env);
        console.log(JSON.stringify({provider:'yandex',model:result.model,verified:true,requestSent:true,verifiedAt:new Date().toISOString(),warning:result.warning,answer:result.answer.replaceAll(config.key,'[скрыто]')}));
      }catch{console.error('Настоящий ответ Яндекса не получен. Проверьте ключ, права на каталог, доступ к модели и сеть. Проверка не считается успешной.');process.exitCode=1;}
    }
  }
}
