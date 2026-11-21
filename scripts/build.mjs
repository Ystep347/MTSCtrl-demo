import {readFileSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
execFileSync(process.execPath,[resolve(root,'node_modules/tailwindcss/lib/cli.js'),'-c',resolve(root,'tailwind.config.cjs'),'-i',resolve(root,'web/tailwind-input.css'),'-o',resolve(root,'web/reference-utilities.css'),'--minify'],{cwd:root,stdio:'inherit'});
const assets={};
for(const [path,file,type] of [['/','index.html','text/html; charset=utf-8'],['/login','login.html','text/html; charset=utf-8'],['/guide','guide.html','text/html; charset=utf-8'],['/styles.css','styles.css','text/css; charset=utf-8'],['/app.js','app.js','text/javascript; charset=utf-8']]) assets[path]={body:readFileSync(resolve(root,'web',file),'utf8'),type};
for(const [path,file,type] of [['/designs','designs.html','text/html; charset=utf-8'],['/designs.css','designs.css','text/css; charset=utf-8'],['/designs.js','designs.js','text/javascript; charset=utf-8'],['/concepts.css','concepts.css','text/css; charset=utf-8'],['/concepts.js','concepts.js','text/javascript; charset=utf-8']])assets[path]={body:readFileSync(resolve(root,'web',file),'utf8'),type};
assets['/assets/mts-logo.png']={body:readFileSync(resolve(root,'web/assets/mts-logo.png')).toString('base64'),encoding:'base64',type:'image/png'};
assets['/assets/login-ctrl-hero.png']={body:readFileSync(resolve(root,'web/assets/login-ctrl-hero.png')).toString('base64'),encoding:'base64',type:'image/png'};
assets['/login.css']={body:readFileSync(resolve(root,'web/login.css'),'utf8'),type:'text/css; charset=utf-8'};
assets['/auth-validation.js']={body:readFileSync(resolve(root,'lib/auth-validation.mjs'),'utf8'),type:'text/javascript; charset=utf-8'};
assets['/ctrl.css']={body:readFileSync(resolve(root,'web/ctrl.css'),'utf8'),type:'text/css; charset=utf-8'};
for(const file of ['reference-utilities.css','ctrl-reference.css','ctrl-overlays.css','analytics-ui.js','reference-view.js','itsm-demo.js','operations-ui.js','operations.css'])assets['/'+file]={body:readFileSync(resolve(root,'web',file),'utf8'),type:file.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8'};
for(const [path,file,type] of [['/login.js','login.js','text/javascript; charset=utf-8'],['/account','account.html','text/html; charset=utf-8'],['/account.js','account.js','text/javascript; charset=utf-8'],['/ai-settings','ai-settings.html','text/html; charset=utf-8'],['/ai-settings.js','ai-settings.js','text/javascript; charset=utf-8']])assets[path]={body:readFileSync(resolve(root,'web',file),'utf8'),type};
assets['/mts-simulation.js']={body:readFileSync(resolve(root,'lib/mts-simulation.mjs'),'utf8'),type:'text/javascript; charset=utf-8'};
assets['/itsm-demo']={body:readFileSync(resolve(root,'web/itsm-demo.html'),'utf8'),type:'text/html; charset=utf-8'};
assets['/dashboard-analytics.js']={body:readFileSync(resolve(root,'lib/dashboard-analytics.mjs'),'utf8').replace("from './incidents.mjs'","from '/incidents.js'"),type:'text/javascript; charset=utf-8'};
assets['/coordinator-insights.js']={body:readFileSync(resolve(root,'lib/coordinator-insights.mjs'),'utf8').replace("from './incidents.mjs'","from '/incidents.js'"),type:'text/javascript; charset=utf-8'};
assets['/design-archive']=assets['/designs'];
assets['/designs']=assets['/'];
for(const [path,file,type] of [['/legacy/styles.css','styles.css','text/css; charset=utf-8'],['/legacy/app.js','app.js','text/javascript; charset=utf-8']])assets[path]={body:readFileSync(resolve(root,'web/legacy',file),'utf8'),type};
const legacyHtml=readFileSync(resolve(root,'web/legacy/index.html'),'utf8').replace('src="/app.js"','src="/legacy/app.js"');
const conceptNames={classic:['A','МТС Классика'],night:['B','Ночная смена'],focus:['C','Пульт координатора'],digital:['D','МТС Digital']};
for(const [key,[letter,name]] of Object.entries(conceptNames)){
  const body=legacyHtml
    .replace('<html lang="ru">',`<html lang="ru" data-design="${key}" data-quiet="${key==='focus'}">`)
    .replace('<title>Фокус · Дашборд координатора МТС</title>',`<title>${letter} · ${name} · МТС Фокус</title>`)
    .replace('<link rel="stylesheet" href="/styles.css">','<link rel="stylesheet" href="/legacy/styles.css"><link rel="stylesheet" href="/concepts.css"><script src="/concepts.js" defer></script>')
    .replace('<body>',`<body><div class="concept-ribbon" aria-label="Просмотр концепции"><a href="/designs" target="_top">Все варианты</a><strong>${letter} · ${name}</strong><button id="concept-focus" aria-pressed="${key==='focus'}">Режим фокуса</button><button id="concept-critical" data-scenario="critical">Демо сбоя</button><button id="concept-guide">О продукте</button></div>`)
    .replace('<a class="brand" href="/" aria-label="МТС Фокус">','<a class="brand" href="/designs" target="_top" aria-label="МТС Фокус · все варианты">');
  assets['/concept/'+key]={body,type:'text/html; charset=utf-8'};
}
for(const [path,file,type] of [['/workbench.css','workbench.css','text/css; charset=utf-8'],['/workbench.js','workbench.js','text/javascript; charset=utf-8']])assets[path]={body:readFileSync(resolve(root,'web',file),'utf8'),type};
assets['/workbench-core.js']={body:readFileSync(resolve(root,'lib/workbench.mjs'),'utf8').replace("from './incidents.mjs'","from '/incidents.js'"),type:'text/javascript; charset=utf-8'};
const boldConcepts={
 pulse:{LETTER:'E',TITLE:'Пульс',EYEBROW:'ВАЖНОЕ НА ПОВЕРХНОСТИ',HEADLINE:'Ничего <em>не упустить.</em>',SUBTITLE:'Ситуация меняется. Контекст остаётся у вас.'},
 orbit:{LETTER:'F',TITLE:'Карта ответственности',EYEBROW:'ОТ ПРОДУКТА К КОМАНДЕ',HEADLINE:'Всё связано. <em>Всё видно.</em>',SUBTITLE:'Продукты, инциденты и назначенные команды в одной картине.'},
 command:{LETTER:'G',TITLE:'Командный центр',EYEBROW:'СНАЧАЛА ВНИМАНИЕ. ЗАТЕМ ДЕЙСТВИЕ.',HEADLINE:'Смена под <em>Ctrl.</em>',SUBTITLE:'Очередь слева. Решение перед вами. Контекст всегда рядом.'}
};
for(const [MODE,fields] of Object.entries(boldConcepts)){
 let body=readFileSync(resolve(root,'web/workbench.html'),'utf8');
 for(const [key,value] of Object.entries({MODE,...fields}))body=body.replaceAll('{{'+key+'}}',value);
 assets['/concept/'+MODE]={body,type:'text/html; charset=utf-8'};
}
assets['/incidents.js']={body:readFileSync(resolve(root,'lib/incidents.mjs'),'utf8'),type:'text/javascript; charset=utf-8'};
assets['/operations.js']={body:readFileSync(resolve(root,'lib/operations.mjs'),'utf8').replace("from './incidents.mjs'","from '/incidents.js'"),type:'text/javascript; charset=utf-8'};
assets['/assistant-rules.js']={body:readFileSync(resolve(root,'lib/assistant-rules.mjs'),'utf8').replace(/from '\.\/(incidents|operations)\.mjs'/g,"from '/$1.js'"),type:'text/javascript; charset=utf-8'};
assets['/import-summary.js']={body:readFileSync(resolve(root,'lib/import-summary.mjs'),'utf8').replace("from './incidents.mjs'","from '/incidents.js'"),type:'text/javascript; charset=utf-8'};
let source=readFileSync(resolve(root,'worker/index.js'),'utf8');
source=source.replace(/^import \{[^\n]+\} from '\.\.\/lib\/ai-settings\.mjs';\n/m,()=>readFileSync(resolve(root,'lib/ai-settings.mjs'),'utf8').replace(/^import \{[^\n]+\} from '\.\/yandex\.mjs';\n/m,'')+'\n');
const authLibrary=readFileSync(resolve(root,'lib/password-hash.mjs'),'utf8')+'\n'+readFileSync(resolve(root,'lib/auth-validation.mjs'),'utf8')+'\n'+readFileSync(resolve(root,'lib/auth.mjs'),'utf8').replace(/^import \{[^\n]+\} from '\.\/(?:password-hash|auth-validation)\.mjs';\n/gm,'');
source=source.replace(/^import \{[^\n]+\} from '\.\.\/lib\/auth\.mjs';\n/m,()=>authLibrary+'\n');
source=source.replace(/^import \{[^\n]+\} from '\.\.\/lib\/mts-simulation\.mjs';\n/m,()=>readFileSync(resolve(root,'lib/mts-simulation.mjs'),'utf8')+'\n');
source=source.replace(/^import \{[^\n]+\} from '\.\.\/lib\/itsm\.mjs';\n/m,()=>readFileSync(resolve(root,'lib/itsm.mjs'),'utf8')+'\n');
const summaryLibrary=readFileSync(resolve(root,'lib/import-summary.mjs'),'utf8').replace(/^import \{[^\n]+\} from '\.\/incidents\.mjs';\n/m,'');
const sharedLibrary=summaryLibrary+'\n'+readFileSync(resolve(root,'lib/shared-data.mjs'),'utf8').replace(/^import \{[^\n]+\} from '\.\/(?:incidents|import-summary|workflow)\.mjs';\n/gm,'');
source=source.replace(/^import \{[^\n]+\} from '\.\.\/lib\/shared-data\.mjs';\n/m,()=>sharedLibrary+'\n');
for(const file of ['operations','workflow','assistant-rules']){
 const pattern=new RegExp(`^import \\{[^\\n]+\\} from '\\.\\.\\/lib\\/${file}\\.mjs';\\n`,'m');
 const library=readFileSync(resolve(root,'lib',file+'.mjs'),'utf8').replace(/^import \{[^\n]+\} from '\.\/(?:incidents|operations|itsm)\.mjs';\n/gm,'');
 source=source.replace(pattern,()=>library+'\n');
}
source=source.replace(/^export \{localAnswer\};\n/m,'');
const incidentLibrary=readFileSync(resolve(root,'lib/incidents.mjs'),'utf8');
const yandexLibrary=readFileSync(resolve(root,'lib/yandex.mjs'),'utf8').replace(/^import \{[^\n]+\} from '\.\/(?:incidents|operations)\.mjs';\n/gm,'');
source=source.replace(/^import \{[^\n]+\} from '\.\.\/lib\/yandex\.mjs';\n/m,()=>yandexLibrary+'\n');
source=source.replace(/^import \{[^\n]+\} from '\.\.\/lib\/incidents\.mjs';\n/m,()=>incidentLibrary+'\n');
const raw=readFileSync(resolve(root,'data/incidents.json'),'utf8');
const attributes=readFileSync(resolve(root,'data/attributes.json'),'utf8');
const {normalizeIncidentDataset}=await import('../lib/incidents.mjs');
normalizeIncidentDataset(JSON.parse(raw),JSON.parse(attributes));
source=source.replace('/* __INCIDENTS__ */ []',()=>raw).replace('/* __ATTRIBUTES__ */ []',()=>attributes);
if(!source.includes('/* __ASSETS__ */ {}'))throw new Error('Missing assets placeholder');
const manifest=JSON.parse(readFileSync(resolve(root,'.openai/hosting.json'),'utf8'));
if(manifest.static)throw new Error('Remove static.directory for the Worker deployment');
rmSync(resolve(root,'dist'),{recursive:true,force:true});
mkdirSync(resolve(root,'dist/server'),{recursive:true});
mkdirSync(resolve(root,'dist/.openai'),{recursive:true});
writeFileSync(resolve(root,'dist/server/index.js'),source.replace('/* __ASSETS__ */ {}',()=>JSON.stringify(assets)));
writeFileSync(resolve(root,'dist/.openai/hosting.json'),JSON.stringify(manifest,null,2)+'\n');
console.log('Built self-contained Worker and dashboard assets.');
