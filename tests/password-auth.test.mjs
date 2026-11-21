import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocalDatabase} from '../scripts/local-database.mjs';
import worker from '../worker/index.js';
import {canImportIncidents} from '../lib/shared-data.mjs';
const origin='https://site.test',username='team.coordinator',password='Test-only-passphrase-419';
const editor={'oai-authenticated-user-id':'native-owner','oai-authenticated-user-email':'owner@example.test'};
function request(path,body={},headers={}){return new Request(origin+path,{method:'POST',headers:{'content-type':'application/json',origin,...headers},body:JSON.stringify(body)});}
function cookie(response){return response.headers.get('set-cookie').split(';')[0];}
async function register(env,overrides={}){return worker.fetch(request('/api/auth/register',{username,password,displayName:'Координатор команды',...overrides}),env);}
test('Password registration creates a coordinator, stores only a salted hash and uses an HttpOnly Secure session',async()=>{
  const DB=createLocalDatabase();try{
    const response=await register({DB},{role:'editor',email:'owner@example.test'});assert.equal(response.status,201);const data=await response.json();assert.equal(data.user.role,'coordinator');assert.equal(data.user.authProvider,'password');assert.equal(data.user.password,undefined);
    const header=response.headers.get('set-cookie');assert.match(header,/^__Host-mts_session=[a-f0-9]{64};/);assert.match(header,/HttpOnly/);assert.match(header,/Secure/);assert.match(header,/SameSite=Lax/);assert.doesNotMatch(header,/Domain=/);
    const row=await DB.prepare('SELECT * FROM app_users WHERE username=?').bind(username).first();assert.match(row.password_hash,/^\$2[ab]\$12\$/);assert.notEqual(row.password_hash,password);
    const session=await DB.prepare('SELECT * FROM app_sessions').first();assert.notEqual(session.token_hash,header.split('=')[1].split(';')[0]);
    const me=await (await worker.fetch(new Request(origin+'/api/auth/me',{headers:{cookie:cookie(response)}}),{DB,DATA_EDITOR_EMAILS:'owner@example.test'})).json();assert.equal(me.authenticated,true);assert.equal(me.user.username,username);assert.equal(me.capabilities.askAssistant,true);assert.equal(me.capabilities.importIncidents,false);assert.equal(me.logoutMethod,'POST');assert.equal(me.user.userId,undefined);
  }finally{DB.close();}
});
test('Password login works without platform identity, rotates the session and logout revokes it on the server',async()=>{
  const DB=createLocalDatabase();try{
    const first=await register({DB}),oldCookie=cookie(first);
    const response=await worker.fetch(request('/api/auth/login',{username:username.toUpperCase(),password},{cookie:oldCookie}),{DB});assert.equal(response.status,200);const nextCookie=cookie(response);assert.notEqual(nextCookie,oldCookie);
    assert.equal((await (await worker.fetch(new Request(origin+'/api/auth/me',{headers:{cookie:oldCookie}}),{DB})).json()).authenticated,false);
    assert.equal((await (await worker.fetch(new Request(origin+'/api/auth/me',{headers:{cookie:nextCookie}}),{DB})).json()).authenticated,true);
    const logout=await worker.fetch(request('/api/auth/logout',{}, {cookie:nextCookie}),{DB});assert.equal(logout.status,200);assert.match(logout.headers.get('set-cookie'),/Max-Age=0/);
    assert.equal((await (await worker.fetch(new Request(origin+'/api/auth/me',{headers:{cookie:nextCookie}}),{DB})).json()).authenticated,false);
  }finally{DB.close();}
});
test('Wrong and unknown credentials have the same error; invalid passwords and cross-site writes fail',async()=>{
  const DB=createLocalDatabase();try{
    await register({DB});
    const wrong=await worker.fetch(request('/api/auth/login',{username,password:'wrong'}),{DB}),unknown=await worker.fetch(request('/api/auth/login',{username:'unknown.user',password:'wrong'}),{DB});
    assert.equal(wrong.status,401);assert.equal(unknown.status,401);assert.deepEqual(await wrong.json(),await unknown.json());
    assert.equal((await register({DB},{username:'other',password:'short'})).status,400);
    assert.equal((await register({DB},{username:'other',password:'я'.repeat(40)})).status,400);
    assert.equal((await worker.fetch(request('/api/auth/register',{username:'other',password,displayName:'Имя'},{origin:'https://evil.test'}),{DB})).status,403);
    assert.equal((await worker.fetch(new Request(origin+'/api/auth/logout'),{DB})).status,405);
    assert.equal((await register({DB})).status,409);
  }finally{DB.close();}
});
test('Editors grant roles server-side; self-registration cannot claim privileges or impersonate an allowlisted email',async()=>{
  const DB=createLocalDatabase(),env={DB,DATA_EDITOR_EMAILS:'owner@example.test'};try{
    const response=await register(env),session=cookie(response);const row=await DB.prepare('SELECT id FROM app_users WHERE username=?').bind(username).first();
    assert.equal((await worker.fetch(request('/api/auth/account-role',{userId:row.id,role:'editor'},{cookie:session}),env)).status,403);
    assert.equal((await worker.fetch(new Request(origin+'/api/auth/accounts',{headers:{cookie:session}}),env)).status,403);
    const grant=await worker.fetch(request('/api/auth/account-role',{userId:row.id,role:'editor'},editor),env);assert.equal(grant.status,200);
    const me=await (await worker.fetch(new Request(origin+'/api/auth/me',{headers:{cookie:session}}),env)).json();assert.equal(me.user.role,'editor');assert.equal(me.capabilities.importIncidents,true);assert.equal(me.capabilities.manageAccounts,true);
    const accounts=await (await worker.fetch(new Request(origin+'/api/auth/accounts',{headers:{cookie:session}}),env)).json();assert.equal(accounts.users[0].username,username);assert.equal(accounts.users[0].passwordHash,undefined);assert.equal(accounts.users[0].password_hash,undefined);
    assert.equal(canImportIncidents({authProvider:'password',role:'coordinator',email:'owner@example.test'},env),false);
    assert.equal((await worker.fetch(request('/api/auth/account-role',{userId:row.id,role:'admin'},editor),env)).status,400);
  }finally{DB.close();}
});
test('Expired, disabled and forged sessions cannot authenticate; self-registration can be closed',async()=>{
  const DB=createLocalDatabase();try{
    const response=await register({DB}),session=cookie(response);await DB.prepare('UPDATE app_sessions SET expires_at=0').run();
    assert.equal((await (await worker.fetch(new Request(origin+'/api/auth/me',{headers:{cookie:session}}),{DB})).json()).authenticated,false);
    assert.equal((await register({DB,AUTH_REGISTRATION_OPEN:'0'},{username:'closed'})).status,403);
    assert.equal((await (await worker.fetch(new Request(origin+'/api/auth/me',{headers:{cookie:'__Host-mts_session='+'a'.repeat(64)}}),{DB})).json()).authenticated,false);
  }finally{DB.close();}
});
test('Distributed login throttling returns Retry-After and local HTTP cookies work without a Secure prefix',async()=>{
  const DB=createLocalDatabase();try{
    const response=await worker.fetch(new Request('http://127.0.0.1:4173/api/auth/register',{method:'POST',headers:{origin:'http://127.0.0.1:4173','content-type':'application/json'},body:JSON.stringify({username,password,displayName:'Тест'})}),{DB});assert.equal(response.status,201);assert.match(response.headers.get('set-cookie'),/^mts_dev_session=/);assert.doesNotMatch(response.headers.get('set-cookie'),/; Secure/);
    const now=Date.now(),reset=(Math.floor(now/900000)+1)*900000;
    const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('login-user:'+username+':'+reset));const key=Array.from(new Uint8Array(bytes),v=>v.toString(16).padStart(2,'0')).join('');
    await DB.prepare('INSERT INTO auth_limits (key,count,reset_at) VALUES (?,8,?)').bind(key,reset).run();
    const blocked=await worker.fetch(request('/api/auth/login',{username,password}),{DB});assert.equal(blocked.status,429);assert.ok(Number(blocked.headers.get('retry-after'))>0);
  }finally{DB.close();}
});
