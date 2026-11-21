import {localPasswordHash,localPasswordVerify} from './password-hash.mjs';
import {normalizeLoginIdentifier,loginIdentifierError,registrationPasswordError,passwordLengthError} from './auth-validation.mjs';
const AUTH_SESSION_SECONDS=8*60*60;
const AUTH_DUMMY_HASH="$2b$12$TgX5CvlXsjlvssAqkeXrNuGV2nlKHtURSx4ARBwkQq8mkIyAkPUmC";
const authHex=bytes=>Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');
async function authDigest(value){return authHex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))));}
function authCookieName(request){const url=new URL(request.url);return url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)?'mts_dev_session':'__Host-mts_session';}
function authToken(request){const name=authCookieName(request);const values=(request.headers.get('cookie')||'').split(';').map(v=>v.trim()).filter(v=>v.startsWith(name+'='));if(values.length!==1)return null;const value=values[0].slice(name.length+1);return /^[a-f0-9]{64}$/.test(value)?value:null;}
function authCookie(request,value,seconds=AUTH_SESSION_SECONDS){return `${authCookieName(request)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${authCookieName(request).startsWith('__Host-')?'; Secure':''}`;}
function authUser(row){return {userId:'local:'+row.id,username:row.username,displayName:row.display_name,email:null,role:row.role,authProvider:'password'};}
export function authSameOrigin(request){const origin=request.headers.get('origin');return origin===new URL(request.url).origin&&!['cross-site','none'].includes(request.headers.get('sec-fetch-site'));}
export async function passwordSession(request,env={}){
  const token=authToken(request);if(!token||!env.DB)return null;
  try{const row=await env.DB.prepare('SELECT u.id,u.username,u.display_name,u.role FROM app_sessions s JOIN app_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.disabled=0').bind(await authDigest(token),Date.now()).first();return row?authUser(row):null;}catch{return null;}
}
async function authLimit(db,scope,identity,maximum,period){
  const now=Date.now(),reset=(Math.floor(now/period)+1)*period,key=await authDigest(scope+':'+identity+':'+reset);
  const row=await db.prepare('INSERT INTO auth_limits (key,count,reset_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count').bind(key,reset).first();
  if(!row||row.count>maximum)throw {status:429,message:'Слишком много попыток. Подождите несколько минут и повторите.',retryAfter:Math.max(1,Math.ceil((reset-now)/1000))};
}
async function authSessionData(request,userId){const token=authHex(crypto.getRandomValues(new Uint8Array(32)));return {token,hash:await authDigest(token),userId,at:Date.now(),expires:Date.now()+AUTH_SESSION_SECONDS*1000,previous:authToken(request)?await authDigest(authToken(request)):null};}
function authSessionStatements(db,session){return [db.prepare('DELETE FROM app_sessions WHERE expires_at<=? OR token_hash=?').bind(session.at,session.previous||''),db.prepare('DELETE FROM auth_limits WHERE reset_at<=?').bind(session.at),db.prepare('INSERT INTO app_sessions (token_hash,user_id,created_at,expires_at) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM app_users WHERE id=?)').bind(session.hash,session.userId,session.at,session.expires,session.userId)];}
export async function registerPasswordUser(request,env,body){
  if(!env.DB)throw {status:503,message:'Хранилище учётных записей пока недоступно.'};
  if(env.AUTH_REGISTRATION_OPEN==='0')throw {status:403,message:'Регистрация временно закрыта. Обратитесь к координатору команды.'};
  const username=normalizeLoginIdentifier(body.username),displayName=typeof body.displayName==='string'?body.displayName.trim():'';
  const identifierError=loginIdentifierError(username);if(identifierError)throw {status:400,message:identifierError};
  if(displayName.length<2||displayName.length>80||/[\u0000-\u001f\u007f]/.test(displayName))throw {status:400,message:'Укажите имя длиной от 2 до 80 символов.'};
  const passwordError=registrationPasswordError(body.password);if(passwordError)throw {status:400,message:passwordError};
  await authLimit(env.DB,'registration',request.headers.get('cf-connecting-ip')||'unknown',20,3600000);
  const id=crypto.randomUUID(),passwordHash=await localPasswordHash(body.password),session=await authSessionData(request,id);
  try{
    const results=await env.DB.batch([env.DB.prepare("INSERT INTO app_users (id,username,display_name,password_hash,role,disabled,created_at) SELECT ?,?,?,?,'coordinator',0,? WHERE (SELECT COUNT(*) FROM app_users)<2000").bind(id,username,displayName,passwordHash,session.at),...authSessionStatements(env.DB,session)]);
    if(!results[0].meta?.changes)throw {status:429,message:'Достигнут лимит учебных учётных записей. Обратитесь к организатору команды.'};
  }catch(error){if(String(error.message).includes('UNIQUE'))throw {status:409,message:'Этот логин или почта уже используются. Откройте вкладку «Войти» или выберите другой логин.'};throw error;}
  return {user:authUser({id,username,display_name:displayName,role:'coordinator'}),cookie:authCookie(request,session.token)};
}
export async function loginPasswordUser(request,env,body){
  if(!env.DB)throw {status:503,message:'Хранилище учётных записей пока недоступно.'};
  const username=normalizeLoginIdentifier(body.username),password=typeof body.password==='string'?body.password:'';
  await authLimit(env.DB,'login-ip',request.headers.get('cf-connecting-ip')||'unknown',60,900000);
  await authLimit(env.DB,'login-user',username.slice(0,254),8,900000);
  const row=!loginIdentifierError(username)?await env.DB.prepare('SELECT * FROM app_users WHERE username=?').bind(username).first():null;
  const candidate=passwordLengthError(password)?'':password;
  const matched=await localPasswordVerify(candidate,row?.password_hash||AUTH_DUMMY_HASH);
  if(!row||row.disabled||!matched)throw {status:401,message:'Неверный логин, почта или пароль.'};
  const session=await authSessionData(request,row.id);await env.DB.batch(authSessionStatements(env.DB,session));
  return {user:authUser(row),cookie:authCookie(request,session.token)};
}
export async function logoutPasswordUser(request,env){const token=authToken(request);if(token&&env.DB)await env.DB.prepare('DELETE FROM app_sessions WHERE token_hash=?').bind(await authDigest(token)).run();return authCookie(request,'',0);}
export async function listPasswordUsers(env){return (await env.DB.prepare('SELECT id,username,display_name AS displayName,role,created_at AS createdAt FROM app_users WHERE disabled=0 ORDER BY created_at DESC LIMIT 200').all()).results;}
export async function setPasswordUserRole(env,id,role){if(!/^[a-f0-9-]{36}$/.test(id)||!['coordinator','editor'].includes(role))throw {status:400,message:'Некорректная роль или учётная запись.'};const result=await env.DB.prepare('UPDATE app_users SET role=? WHERE id=? AND disabled=0').bind(role,id).run();if(!result.meta?.changes)throw {status:404,message:'Учётная запись не найдена.'};}
