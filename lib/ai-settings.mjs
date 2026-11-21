import {getYandexConfiguration} from './yandex.mjs';
const aiBytesToHex=value=>Array.from(value,x=>x.toString(16).padStart(2,'0')).join('');
function aiHexToBytes(value){if(typeof value!=='string'||value.length%2||!/^[a-f0-9]+$/i.test(value))throw new Error('invalid_cipher');return Uint8Array.from(value.match(/../g),x=>parseInt(x,16));}
export function canStoreAiSettings(env){return Boolean(env.DB)&&/^[a-f0-9]{64}$/i.test(env.AI_CONFIG_ENCRYPTION_KEY||'');}
async function aiStorageKey(env){if(!canStoreAiSettings(env))throw new Error('ai_settings_not_ready');return crypto.subtle.importKey('raw',aiHexToBytes(env.AI_CONFIG_ENCRYPTION_KEY),{name:'AES-GCM'},false,['encrypt','decrypt']);}
export async function aiEffectiveEnvironment(env){
  if(env.YANDEX_API_KEY&&env.YANDEX_FOLDER_ID)return {...env,AI_SETTINGS_SOURCE:'environment'};
  if(!canStoreAiSettings(env))return env;
  const row=await env.DB.prepare('SELECT ciphertext,iv FROM app_ai_settings WHERE id=1').first();if(!row)return env;
  const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:aiHexToBytes(row.iv),additionalData:new TextEncoder().encode('mts-focus-yandex-v1')},await aiStorageKey(env),aiHexToBytes(row.ciphertext));
  const values=JSON.parse(new TextDecoder().decode(plain));getYandexConfiguration(values);
  return {...env,...values,AI_SETTINGS_SOURCE:'encrypted_database'};
}
export async function saveAiSettings(env,body,userId){
  if(!canStoreAiSettings(env))throw {status:503,message:'Сервер ещё не подготовлен к сохранению настроек ИИ. Обратитесь к владельцу сайта.'};
  if(typeof body.apiKey!=='string'||body.apiKey.trim().length<10||body.apiKey.length>4096||/\s/.test(body.apiKey.trim()))throw {status:400,message:'Укажите секретный API-ключ Яндекса без пробелов.'};
  const values={YANDEX_API_KEY:body.apiKey.trim(),YANDEX_FOLDER_ID:typeof body.folderId==='string'?body.folderId.trim():'',YANDEX_MODEL_URI:typeof body.modelUri==='string'?body.modelUri.trim():''};
  let configuration;try{configuration=getYandexConfiguration(values);}catch{}
  if(!configuration)throw {status:400,message:'Проверьте ID каталога и выбранную модель Яндекса.'};
  values.YANDEX_MODEL_URI=configuration.uri;
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode('mts-focus-yandex-v1')},await aiStorageKey(env),new TextEncoder().encode(JSON.stringify(values)));
  await env.DB.prepare('INSERT INTO app_ai_settings (id,ciphertext,iv,updated_at,updated_by) VALUES (1,?,?,?,?) ON CONFLICT(id) DO UPDATE SET ciphertext=excluded.ciphertext,iv=excluded.iv,updated_at=excluded.updated_at,updated_by=excluded.updated_by').bind(aiBytesToHex(new Uint8Array(ciphertext)),aiBytesToHex(iv),Date.now(),userId).run();
  return {saved:true,configured:true,verified:false,model:configuration.name,source:env.YANDEX_API_KEY&&env.YANDEX_FOLDER_ID?'environment':'encrypted_database',message:env.YANDEX_API_KEY&&env.YANDEX_FOLDER_ID?'Настройки сохранены. Сейчас приоритет имеют настройки окружения сервера.':'Настройки сохранены. Проверьте настоящий ответ модели.'};
}
export async function aiSettingsSummary(env){
  let effective;try{effective=await aiEffectiveEnvironment(env);}catch{return {canConfigure:canStoreAiSettings(env),configured:false,verified:false,error:'Не удалось прочитать настройки ИИ. Сохраните ключ заново.'};}
  let config;try{config=getYandexConfiguration(effective);}catch{}
  return {canConfigure:canStoreAiSettings(env),configured:Boolean(config),verified:false,folderId:config?.folder||'',modelUri:config?.uri||'',model:config?.name||null,source:effective.AI_SETTINGS_SOURCE||null};
}
