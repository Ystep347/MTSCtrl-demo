import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';

const archive=fileURLToPath(new URL('../release/mts-focus-server.zip',import.meta.url));
const temp=await mkdtemp(join(tmpdir(),'mts-zip-'));
const app=join(temp,'mts-focus-server');
let child,base;
async function start(port='0',publicOrigin=''){
  // Supply only host OS settings. Deployment secrets and development paths
  // from the build machine must not affect this installation.
  const env={PORT:port};
  for(const key of ['PATH','SystemRoot','TEMP','TMP','HOME'])if(process.env[key])env[key]=process.env[key];
  if(publicOrigin)env.PUBLIC_ORIGIN=publicOrigin;
  child=spawn(process.execPath,[join(app,'start.mjs')],{cwd:temp,env,stdio:['ignore','pipe','pipe']});
  await new Promise((resolve,reject)=>{
    let out='',err='';
    const timer=setTimeout(()=>reject(Error('Server startup timeout: '+err)),10000);
    child.stderr.setEncoding('utf8').on('data',chunk=>err+=chunk);
    child.once('exit',code=>{clearTimeout(timer);reject(Error('Server exited '+code+': '+err));});
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.stdout.setEncoding('utf8').on('data',chunk=>{
      out+=chunk;
      const url=out.match(/http:\/\/localhost:(\d+)/);
      if(url||publicOrigin&&out.includes(publicOrigin)){
        base='http://127.0.0.1:'+(url?url[1]:port);
        clearTimeout(timer);resolve();
      }
    });
  });
}
async function stop(){
  if(child&&child.exitCode===null&&child.signalCode===null){
    const done=once(child,'exit');child.kill();await done;
  }
}
const post=(path,body,origin=base)=>fetch(base+path,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
try{
  if(process.platform==='win32')execFileSync('tar.exe',['-xf',archive,'-C',temp]);
  else execFileSync('unzip',['-q',archive,'-d',temp]);
  await start();
  for(const path of ['/','/login','/?screen=wallboard','/operations.css','/operations-ui.js','/itsm-demo']){
    assert.equal((await fetch(base+path)).status,200,path);
  }
  const snapshot=async()=>(await fetch(base+'/api/incidents')).json();
  const first=await snapshot();
  assert.equal(first.source,'shared');assert.equal(first.incidents.length,44);
  const credentials={username:'zip.user',password:randomBytes(18).toString('hex')};
  const register=await post('/api/auth/register',{...credentials,displayName:'ZIP test'});
  assert.equal(register.status,201);
  const cookie=register.headers.get('set-cookie').split(';')[0];
  const file=join(app,'data/incidents.json'),rows=JSON.parse(await readFile(file,'utf8'));
  rows[0].priorityId=4;await writeFile(file,JSON.stringify(rows));
  assert.equal((await snapshot()).incidents.find(i=>i.id===rows[0].id).priority,'critical');
  const port=new URL(base).port;
  await stop();await start();
  const me=await (await fetch(base+'/api/auth/me',{headers:{cookie}})).json();
  assert.equal(me.authenticated,true);assert.equal(me.user.username,credentials.username);
  await stop();
  const origin='https://focus.example.test';
  await start(port,origin);
  const login=await post('/api/auth/login',credentials,origin);
  assert.equal(login.status,200);assert.match(login.headers.get('set-cookie'),/__Host-mts_session=.*; Secure/);
  assert.equal((await post('/api/auth/login',credentials,'https://other.example.test')).status,403);
  console.log('ZIP verified: clean installation, dashboard, wallboard, SQLite migrations, file updates, persistent sessions and HTTPS proxy origin.');
}finally{
  await stop();
  await rm(temp,{recursive:true,force:true});
}
