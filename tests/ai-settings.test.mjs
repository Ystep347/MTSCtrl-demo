import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
import {createLocalDatabase} from '../scripts/local-database.mjs';
import {saveAiSettings,aiEffectiveEnvironment,aiSettingsSummary} from '../lib/ai-settings.mjs';
const encryption='a'.repeat(64),apiKey='test-only-yandex-key-do-not-use',folder='test-folder';
const editor={'oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@example.test'};
const request=(path,body,headers={})=>new Request('https://site.test'+path,{method:'POST',headers:{'content-type':'application/json',origin:'https://site.test',...headers},body:JSON.stringify(body)});
test('AI credentials are encrypted at rest, not returned by status, and resolved only on the server',async()=>{
  const DB=createLocalDatabase(),env={DB,AI_CONFIG_ENCRYPTION_KEY:encryption};try{
    const saved=await saveAiSettings(env,{apiKey,folderId:folder},'owner');assert.equal(saved.verified,false);
    const row=await DB.prepare('SELECT * FROM app_ai_settings').first();assert.ok(row.ciphertext);assert.doesNotMatch(JSON.stringify(row),new RegExp(apiKey));assert.doesNotMatch(JSON.stringify(row),new RegExp(folder));
    const effective=await aiEffectiveEnvironment(env);assert.equal(effective.YANDEX_API_KEY,apiKey);assert.equal(effective.YANDEX_FOLDER_ID,folder);
    const summary=await aiSettingsSummary(env);assert.equal(summary.configured,true);assert.equal(summary.verified,false);assert.doesNotMatch(JSON.stringify(summary),new RegExp(apiKey));
    const firstIv=row.iv;await saveAiSettings(env,{apiKey,folderId:folder},'owner');assert.notEqual((await DB.prepare('SELECT iv FROM app_ai_settings').first()).iv,firstIv);
  }finally{DB.close();}
});
test('Only editors can save AI credentials; cross-site writes and invalid settings are rejected',async()=>{
  const DB=createLocalDatabase(),env={DB,AI_CONFIG_ENCRYPTION_KEY:encryption,DATA_EDITOR_EMAILS:'owner@example.test'};try{
    assert.equal((await worker.fetch(request('/api/assistant/settings',{apiKey,folderId:folder}),env)).status,403);
    assert.equal((await worker.fetch(request('/api/assistant/settings',{apiKey,folderId:folder},{...editor,origin:'https://evil.test'}),env)).status,403);
    assert.equal((await worker.fetch(request('/api/assistant/settings',{apiKey,folderId:folder},editor),env)).status,200);
    assert.equal((await worker.fetch(request('/api/assistant/settings',{apiKey:'short',folderId:folder},editor),env)).status,400);
    assert.equal((await worker.fetch(request('/api/assistant/settings',{apiKey,folderId:'invalid/folder'},editor),env)).status,400);
    const status=await (await worker.fetch(new Request('https://site.test/api/assistant/status'),env)).json();assert.equal(status.configured,true);assert.equal(status.available,false);assert.doesNotMatch(JSON.stringify(status),new RegExp(apiKey));
  }finally{DB.close();}
});
test('Wrong encryption key cannot decrypt stored settings and environment credentials keep precedence',async()=>{
  const DB=createLocalDatabase(),env={DB,AI_CONFIG_ENCRYPTION_KEY:encryption};try{
    await saveAiSettings(env,{apiKey,folderId:folder},'owner');
    assert.equal((await aiSettingsSummary({...env,AI_CONFIG_ENCRYPTION_KEY:'b'.repeat(64)})).configured,false);
    const effective=await aiEffectiveEnvironment({...env,YANDEX_API_KEY:'environment-test-key',YANDEX_FOLDER_ID:'environment-folder'});assert.equal(effective.YANDEX_API_KEY,'environment-test-key');assert.equal(effective.AI_SETTINGS_SOURCE,'environment');
  }finally{DB.close();}
});
test('A stored key is used for actual model requests without sending it to the browser',async()=>{
  const DB=createLocalDatabase(),env={DB,AI_CONFIG_ENCRYPTION_KEY:encryption};const original=globalThis.fetch;let authorization;try{
    await saveAiSettings(env,{apiKey,folderId:folder},'owner');
    globalThis.fetch=async(url,options)=>{authorization=options.headers.Authorization;return Response.json({result:{alternatives:[{status:'ALTERNATIVE_STATUS_FINAL',message:{text:'Учебная проверка модели выполнена.'}}]}});};
    const response=await worker.fetch(request('/api/assistant/chat',{question:'Сводка',context:{view:'mts-demo'}},editor),env);assert.equal(response.status,200);const data=await response.json();assert.equal(data.provider,'yandex');assert.equal(authorization,'Api-Key '+apiKey);assert.doesNotMatch(JSON.stringify(data),new RegExp(apiKey));
  }finally{globalThis.fetch=original;DB.close();}
});
