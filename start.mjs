import {fileURLToPath} from 'node:url';

if(Number(process.versions.node.split('.')[0])<24){
  console.error('Для запуска МТС Фокус нужен Node.js 24 или новее со встроенным node:sqlite.');
  process.exitCode=1;
}else{
  process.chdir(fileURLToPath(new URL('.',import.meta.url)));
  const {startServer}=await import('./scripts/server.mjs');
  await startServer({lan:true});
}
