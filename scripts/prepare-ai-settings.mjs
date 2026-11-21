import {readFile,writeFile,chmod} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const path=fileURLToPath(new URL('../.env',import.meta.url));
try{process.loadEnvFile(path);}catch(error){if(error.code!=='ENOENT')throw error;}
if(process.env.AI_CONFIG_ENCRYPTION_KEY){
  if(!/^[a-f0-9]{64}$/i.test(process.env.AI_CONFIG_ENCRYPTION_KEY)){console.error('Существующий ключ шифрования имеет неверный формат. Он не изменён.');process.exitCode=1;}
  else console.log('Ключ шифрования уже настроен и сохранён без изменений.');
}else{
  let content='';try{content=await readFile(path,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
  const line='AI_CONFIG_ENCRYPTION_KEY='+randomBytes(32).toString('hex');
  const expression=/^AI_CONFIG_ENCRYPTION_KEY=.*$/m;
  content=expression.test(content)?content.replace(expression,line):content.replace(/\n?$/,'\n')+line+'\n';
  await writeFile(path,content,{mode:0o600});await chmod(path,0o600);
  console.log('Локальная форма подключения ИИ подготовлена. Секретный ключ шифрования не отображается. Перезапустите сервер.');
}
