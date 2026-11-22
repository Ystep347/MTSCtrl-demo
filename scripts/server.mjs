import http from 'node:http';
import https from 'node:https';
import {networkInterfaces} from 'node:os';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createLocalDatabase} from './local-database.mjs';
import {localRequestHeaders} from './local-identity.mjs';
import worker from '../dist/server/index.js';
export async function startServer({lan=false}={}){
  try{process.loadEnvFile(fileURLToPath(new URL('../.env',import.meta.url)));}catch(error){if(error.code!=='ENOENT')throw error;}
  const database=createLocalDatabase(process.env.LOCAL_DB_PATH || fileURLToPath(new URL('../local-data/incidents.sqlite',import.meta.url)));
  const incidentFile=process.env.INCIDENTS_FILE ? resolve(process.env.INCIDENTS_FILE) : fileURLToPath(new URL('../data/incidents.json',import.meta.url));
  const port=process.env.PORT===undefined?4173:Number(process.env.PORT);
  const host=process.env.HOST||(lan?'0.0.0.0':'127.0.0.1');
  const editorPreview=!lan&&process.env.DEV_EDITOR_PREVIEW==='1';
  const {TLS_CERT_FILE:cert,TLS_KEY_FILE:key,PUBLIC_ORIGIN:origin}=process.env;
  if(Boolean(cert)!==Boolean(key))throw new Error('Укажите вместе TLS_CERT_FILE и TLS_KEY_FILE.');
  if(origin){
    const url=new URL(origin);
    if(url.protocol!=='https:'||url.origin!==origin)throw new Error('PUBLIC_ORIGIN должен иметь вид https://имя без пути и завершающего слеша.');
  }
  const protocol=cert?'https':'http';
  if(!Number.isInteger(port)||port<0||port>65535)throw new Error('PORT must be an integer from 0 to 65535');
  const handleRequest=async(req,res)=>{
    try{
      if(req.url==='/__preview/mobile'||req.url==='/__preview/designs-mobile'){
        res.writeHead(200,{'content-type':'text/html; charset=utf-8'});
        const mobilePath=req.url==='/__preview/designs-mobile'?'/designs':'/';
        res.end('<!doctype html><title>Мобильная проверка</title><style>body{margin:0;background:#dfe3ec;display:flex;justify-content:center;padding:20px}iframe{width:390px;height:844px;border:0;border-radius:16px;box-shadow:0 10px 60px #1f2b4820}</style><iframe src="'+mobilePath+'" title="Мобильный макет"></iframe>');return;
      }
      const chunks=[];let size=0;
      for await(const chunk of req){size+=chunk.length;if(size>2097152){res.writeHead(413);res.end('Too large');return;}chunks.push(chunk);}
      const request=new Request((origin||protocol+'://'+req.headers.host)+req.url,{method:req.method,headers:localRequestHeaders(req.headers,editorPreview),...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(chunks)})});
      // Local settings are opt-in in .env; production values are never copied here.
      const env={DB:database,DATA_EDITOR_EMAILS:editorPreview?'preview-editor@example.test':process.env.DATA_EDITOR_EMAILS,YANDEX_API_KEY:process.env.YANDEX_API_KEY,YANDEX_FOLDER_ID:process.env.YANDEX_FOLDER_ID,YANDEX_MODEL_URI:process.env.YANDEX_MODEL_URI,ITSM_INCIDENT_URL_TEMPLATE:process.env.ITSM_INCIDENT_URL_TEMPLATE,AUTH_REGISTRATION_OPEN:process.env.AUTH_REGISTRATION_OPEN,AI_CONFIG_ENCRYPTION_KEY:process.env.AI_CONFIG_ENCRYPTION_KEY};
      for(const name of ['SIMPLEONE_URL','SIMPLEONE_TOKEN','SIMPLEONE_GROUP_IDS','SIMPLEONE_TABLE','SIMPLEONE_DISPATCH_FIELD','SIMPLEONE_EVENTS_TOKEN'])env[name]=process.env[name];
      if(process.env.INCIDENTS_SOURCE_URL)env.INCIDENTS_SOURCE_URL=process.env.INCIDENTS_SOURCE_URL;
      else if(['/api/incidents','/api/assistant/chat','/api/workflow','/api/workflow/analysis','/api/simpleone/events'].includes(new URL(request.url).pathname)){
        // Editors may replace the file by rename. Keep the saved snapshot usable
        // during a missing/unreadable source, including assistant requests.
        try{env.INCIDENTS_JSON=await readFile(incidentFile,'utf8');}
        catch{env.INCIDENTS_SOURCE_UNAVAILABLE=true;}
      }
      const response=await worker.fetch(request,env,{});
      res.writeHead(response.status,Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    }catch{res.writeHead(500,{'content-type':'text/plain'});res.end('Preview request failed');}
  };
  const server=cert?https.createServer({cert:await readFile(cert),key:await readFile(key)},handleRequest):http.createServer(handleRequest);
  server.listen(port,host,()=>{
    const portNumber=server.address().port;
    if(!lan){console.log(`Dashboard preview on ${protocol}://${host}:${portNumber}`);return;}
    if(origin){console.log('МТС Фокус · '+origin);return;}
    const addresses=host==='0.0.0.0'?['localhost',...Object.values(networkInterfaces()).flat().filter(net=>net?.family==='IPv4'&&!net.internal).map(net=>net.address)]:[host];
    for(const address of new Set(addresses))console.log('МТС Фокус · '+protocol+'://'+(address.includes(':')?'['+address+']':address)+':'+portNumber);
  });
}
