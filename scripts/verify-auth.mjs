// Real HTTP password/session checks. Uses only disposable local data and no
// external model requests. Does not create accounts in production.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {once} from 'node:events';
import {randomBytes} from 'node:crypto';
import {createLocalDatabase} from './local-database.mjs';
const root=dirname(dirname(fileURLToPath(import.meta.url))),temp=await mkdtemp(join(tmpdir(),'mts-auth-verify-')),database=join(temp,'accounts.sqlite');
const username='http.test',password=randomBytes(18).toString('base64url');
const environment={...process.env,PORT:'0',HOST:'127.0.0.1',LOCAL_DB_PATH:database,DEV_EDITOR_PREVIEW:'0',AUTH_REGISTRATION_OPEN:'1',INCIDENTS_SOURCE_URL:'',YANDEX_API_KEY:'',YANDEX_FOLDER_ID:'',AI_CONFIG_ENCRYPTION_KEY:randomBytes(32).toString('hex')};
let child,base,checks=0;const pass=label=>{checks++;console.log('PASS '+label);};
async function start(){child=spawn(process.execPath,['scripts/dev-server.mjs'],{cwd:root,env:environment,stdio:['ignore','pipe','pipe']});let output='',errors='';child.stderr.on('data',b=>{errors+=b;});base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Auth server startup timeout: '+errors)),10000);child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',code=>{clearTimeout(timer);reject(new Error('Server exited '+code+': '+errors));});child.stdout.on('data',b=>{output+=b;const url=output.match(/Dashboard preview on (http:\/\/127\.0\.0\.1:\d+)/)?.[1];if(url){clearTimeout(timer);resolve(url);}});});}
async function stop(){if(!child||child.exitCode!==null)return;const done=once(child,'exit');child.kill('SIGTERM');await done;child=null;}
const post=(path,body,session)=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json',origin:base,...(session?{cookie:session}:{})},body:JSON.stringify(body)});
const get=(path,session)=>fetch(base+path,{headers:session?{cookie:session}:{}});
const cookie=response=>response.headers.get('set-cookie').split(';')[0];
try{
  await start();const page=await get('/login');assert.equal(page.status,200);assert.match(await page.text(),/id="password-form"/);pass('independent login and registration form is served');
  const registration=await post('/api/auth/register',{username,password,displayName:'HTTP test coordinator',role:'editor'});assert.equal(registration.status,201);const firstCookie=cookie(registration);assert.match(firstCookie,/^mts_dev_session=/);assert.equal((await registration.json()).user.role,'coordinator');pass('registration creates its own account and session without platform identity');
  const login=await post('/api/auth/login',{username,password},firstCookie);assert.equal(login.status,200);const session=cookie(login);assert.notEqual(session,firstCookie);assert.equal((await (await get('/api/auth/me',firstCookie)).json()).authenticated,false);pass('password login rotates the cookie and revokes the previous session');
  const me=await (await get('/api/auth/me',session)).json();assert.equal(me.authenticated,true);assert.equal(me.user.authProvider,'password');assert.equal(me.capabilities.importIncidents,false);assert.equal((await get('/api/auth/accounts',session)).status,403);pass('coordinator can sign in but cannot claim editor permissions');
  const email='http.mail@example.test';
  const emailRegistration=await post('/api/auth/register',{username:email,password,displayName:'Email test coordinator'});
  assert.equal(emailRegistration.status,201);
  assert.equal((await post('/api/auth/register',{username:email.toUpperCase(),password,displayName:'Duplicate'})).status,409);
  assert.equal((await post('/api/auth/register',{username:'http@@example.test',password,displayName:'Invalid'})).status,400);
  const emailLogin=await post('/api/auth/login',{username:'  '+email.toUpperCase()+'  ',password});
  assert.equal(emailLogin.status,200);assert.equal((await emailLogin.json()).user.username,email);
  pass('email registration and login normalize identifiers and reject duplicates and malformed addresses');
  const chat=await post('/api/assistant/chat',{question:'Краткая сводка',context:{view:'mts-demo'}},session);assert.equal(chat.status,200);assert.equal((await chat.json()).provider,'rules');pass('own account can ask the assistant without ChatGPT sign-in');
  await stop();await start();assert.equal((await (await get('/api/auth/me',session)).json()).authenticated,true);pass('session persists after restarting the HTTP server');
  execFileSync(process.execPath,['scripts/grant-local-editor.mjs',username],{cwd:root,env:environment,stdio:'pipe'});const editor=await (await get('/api/auth/me',session)).json();assert.equal(editor.user.role,'editor');assert.equal(editor.capabilities.importIncidents,true);assert.equal((await get('/api/auth/accounts',session)).status,200);pass('local administrator can grant editor access without platform authentication');
  const fakeKey='test-key-only-not-a-real-yandex-credential';const saved=await post('/api/assistant/settings',{apiKey:fakeKey,folderId:'test-folder'},session);assert.equal(saved.status,200);const status=await (await get('/api/assistant/settings',session)).json();assert.equal(status.configured,true);assert.equal(status.verified,false);assert.doesNotMatch(JSON.stringify(status),new RegExp(fakeKey));
  const DB=createLocalDatabase(database);try{assert.doesNotMatch(JSON.stringify(await DB.prepare('SELECT * FROM app_ai_settings').first()),new RegExp(fakeKey));}finally{DB.close();}pass('editor saves encrypted AI configuration without exposing the key or calling the provider');
  const logout=await post('/api/auth/logout',{},session);assert.equal(logout.status,200);assert.match(logout.headers.get('set-cookie'),/Max-Age=0/);assert.equal((await (await get('/api/auth/me',session)).json()).authenticated,false);assert.equal((await post('/api/assistant/chat',{question:'Сводка'},session)).status,401);pass('logout revokes server-side access even when an old cookie is replayed');
  console.log(`Independent-auth HTTP verification: ${checks} checks passed. No production writes or model requests.`);
}finally{await stop();await rm(temp,{recursive:true,force:true});}
