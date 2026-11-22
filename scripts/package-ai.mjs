import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {writeZip} from './write-zip.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const names=['app.py','requirements.txt','README.md','.env.example','setup_local.py','check_model.py','test_service.py'];
writeZip(resolve(root,'downloads/focus-ai-service.zip'),names.map(name=>({
  name:'focus-ai-service/'+name,bytes:readFileSync(resolve(root,'ai-service',name))
})));
