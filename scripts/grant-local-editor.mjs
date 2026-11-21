// Local database administration only. Does not connect to the hosted D1.
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {createLocalDatabase} from './local-database.mjs';
import {normalizeLoginIdentifier,loginIdentifierError} from '../lib/auth-validation.mjs';
try{process.loadEnvFile(fileURLToPath(new URL('../.env',import.meta.url)));}catch(error){if(error.code!=='ENOENT')throw error;}
const username=normalizeLoginIdentifier(process.argv[2]);
if(loginIdentifierError(username)){console.error('Usage: npm run auth:editor -- your-login-or-email');process.exitCode=2;}
else{
  const DB=createLocalDatabase(process.env.LOCAL_DB_PATH?resolve(process.env.LOCAL_DB_PATH):fileURLToPath(new URL('../local-data/incidents.sqlite',import.meta.url)));
  try{
    const row=await DB.prepare('SELECT id FROM app_users WHERE username=? AND disabled=0').bind(username).first();
    if(!row){console.error('Сначала зарегистрируйте этот аккаунт на локальном сайте.');process.exitCode=1;}
    else{await DB.prepare("UPDATE app_users SET role='editor' WHERE id=?").bind(row.id).run();console.log('Локальному аккаунту '+username+' выданы права редактора. Обновите страницу. Опубликованный сайт не изменялся.');}
  }finally{DB.close();}
}
