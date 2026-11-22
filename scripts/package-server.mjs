import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {writeZip} from './write-zip.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const read=name=>readFileSync(resolve(root,name));
const journal='drizzle/meta/_journal.json';
const migrations=JSON.parse(read(journal)).entries.map(entry=>'drizzle/'+entry.tag+'.sql');
const runtime=['start.mjs','dist/server/index.js','scripts/server.mjs','scripts/local-database.mjs',
  'scripts/local-identity.mjs','scripts/grant-local-editor.mjs','scripts/prepare-ai-settings.mjs',
  'lib/auth-validation.mjs','data/incidents.json','data/attributes.json',journal,...migrations,
  'vendor/bcrypt-LICENSE','.env.example'];
const entries=runtime.map(name=>({name,bytes:read(name)}));
for(const name of ['README.md','compose.yaml','start.cmd']){
  entries.push({name,bytes:read('deploy/'+name)});
}
entries.push({name:'package.json',bytes:Buffer.from('{"name":"mts-focus-server","private":true,"type":"module","engines":{"node":">=24"},"scripts":{"start":"node start.mjs"}}\n')});
const output=resolve(root,'release/mts-focus-server.zip');
writeZip(output,entries.map(entry=>({...entry,name:'mts-focus-server/'+entry.name})));
console.log('Архив сервера: '+output);
