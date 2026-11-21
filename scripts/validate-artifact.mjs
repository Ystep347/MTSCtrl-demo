import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const workerPath = resolve(projectRoot, "dist/server/index.js");
const manifestPath = resolve(projectRoot, "dist/.openai/hosting.json");

const [source, manifest] = await Promise.all([
  readFile(workerPath, "utf8"),
  readFile(manifestPath, "utf8"),
]);
JSON.parse(manifest);

// A data URL forces ESM parsing even though the generated output has no package.json.
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const workerModule = await import(moduleUrl);
assert.equal(
  typeof workerModule.default?.fetch,
  "function",
  `${pathToFileURL(workerPath)} must export default.fetch`,
);

console.log("Artifact is valid ESM and exports default.fetch");

for (const [route,file] of [['/','index.html'],['/designs','index.html'],['/guide','guide.html'],['/app.js','app.js'],['/styles.css','styles.css'],['/ctrl.css','ctrl.css'],['/ctrl-reference.css','ctrl-reference.css'],['/reference-utilities.css','reference-utilities.css'],['/reference-view.js','reference-view.js'],['/analytics-ui.js','analytics-ui.js'],['/itsm-demo','itsm-demo.html'],['/itsm-demo.js','itsm-demo.js'],['/legacy/app.js','legacy/app.js'],['/legacy/styles.css','legacy/styles.css'],['/login.css','login.css'],['/login.js','login.js']]) {
  const response=await workerModule.default.fetch(new Request('https://example.test'+route));
  assert.equal(response.status,200);
  assert.equal(await response.text(),await readFile(resolve(projectRoot,'web',file),'utf8'),`Embedded asset differs: ${file}`);
}
console.log('Embedded dashboard assets match the authored source byte for byte.');
const sharedLibrary=await workerModule.default.fetch(new Request('https://example.test/incidents.js'));
assert.equal(sharedLibrary.status,200);
assert.equal(await sharedLibrary.text(),await readFile(resolve(projectRoot,'lib/incidents.mjs'),'utf8'));
const exportResponse=await workerModule.default.fetch(new Request('https://example.test/api/incidents'));
assert.equal(exportResponse.status,200);
const snapshot=await exportResponse.json();
assert.equal(snapshot.meta.total,44);
assert.deepEqual(snapshot.meta.groups,{critical:0,coord:2,high:1,research:5});
assert.equal(snapshot.source,'bundled');
assert.equal(snapshot.incidents[0].sysId,'179413934903718013');
console.log('The deployed artifact contains the exact export and shared normalization contract.');

const login=await workerModule.default.fetch(new Request('https://example.test/login?return_to=%2F%3Fassistant%3D1'));
assert.equal(login.status,200);
const loginHtml=await login.text();
assert.ok(loginHtml.includes('/signin-with-chatgpt?return_to=%2F%3Fassistant%3D1'));
assert.ok(!loginHtml.includes('{{AUTH_URL}}'));
const redirect=await workerModule.default.fetch(new Request('https://example.test/login?return_to=%2F%3Fassistant%3D1',{headers:{'oai-authenticated-user-id':'integration-user','oai-authenticated-user-email':'integration@example.test'}}));
assert.equal(redirect.status,200);
assert.ok((await redirect.text()).includes('id="password-form"'));
console.log('Independent password form and optional safe service sign-in are available.');
const authValidation=await workerModule.default.fetch(new Request('https://example.test/auth-validation.js'));
assert.equal(authValidation.status,200);
assert.equal(await authValidation.text(),await readFile(resolve(projectRoot,'lib/auth-validation.mjs'),'utf8'));
const hero=await workerModule.default.fetch(new Request('https://example.test/assets/login-ctrl-hero.png'));
assert.equal(hero.status,200);
assert.match(hero.headers.get('content-type'),/image\/png/);
assert.deepEqual(Buffer.from(await hero.arrayBuffer()),await readFile(resolve(projectRoot,'web/assets/login-ctrl-hero.png')));

for(const route of ['/guide/','/guide.html','/guide/index.html']){
 const response=await workerModule.default.fetch(new Request('https://example.test'+route));
 assert.equal(response.status,200,route);assert.match(response.headers.get('content-type'),/text\/html/);
 assert.equal(await response.text(),await readFile(resolve(projectRoot,'web/guide.html'),'utf8'));
 const head=await workerModule.default.fetch(new Request('https://example.test'+route,{method:'HEAD'}));assert.equal(head.status,200);assert.equal(await head.text(),'');
}
console.log('All guide URL variants work without authentication.');

for(const route of ['/designs','/concept/classic','/concept/night','/concept/focus','/concept/digital','/concept/pulse','/concept/orbit','/concept/command','/workbench.css','/workbench.js','/workbench-core.js','/designs.css','/designs.js','/concepts.css','/concepts.js','/assets/mts-logo.png']){
 const response=await workerModule.default.fetch(new Request('https://example.test'+route));assert.equal(response.status,200,route);assert.ok((await response.arrayBuffer()).byteLength>0,route);
}
const review=await (await workerModule.default.fetch(new Request('https://example.test/design-archive'))).text();
assert.equal((review.match(/data-open-concept=/g)||[]).length,7);
assert.ok(!source.includes('DEV_EDITOR_PREVIEW'));
console.log('Seven isolated design concepts, comparison gallery and official brand asset are available.');

const {createLocalDatabase}=await import('./local-database.mjs');
const db=createLocalDatabase();
try{
  const env={DB:db,DATA_EDITOR_EMAILS:'artifact-editor@example.test'};
  const initial=await workerModule.default.fetch(new Request('https://example.test/api/incidents'),env);
  const shared=await initial.json();
  assert.equal(initial.status,200);assert.equal(shared.source,'shared');assert.equal(shared.persistent,true);assert.equal(shared.meta.total,44);assert.equal(shared.version,1);
  const changed=JSON.parse(await readFile(resolve(projectRoot,'data/incidents.json'),'utf8'));changed[0].priorityId=4;
  const write=await workerModule.default.fetch(new Request('https://example.test/api/incidents/import',{method:'POST',headers:{'Content-Type':'application/json','If-Match':`"${shared.revision}"`,'oai-authenticated-user-id':'artifact-editor','oai-authenticated-user-email':'artifact-editor@example.test'},body:JSON.stringify(changed)}),env);
  assert.equal(write.status,200);assert.equal((await write.json()).snapshot.meta.groups.critical,1);
  const history=await workerModule.default.fetch(new Request('https://example.test/api/incidents/history'),env);assert.equal((await history.json()).events.length,2);
  const summaryAsset=await workerModule.default.fetch(new Request('https://example.test/import-summary.js'));assert.equal(summaryAsset.status,200);assert.ok((await summaryAsset.text()).includes("from '/incidents.js'"));
  assert.equal(JSON.parse(manifest).d1,'DB');
  console.log('Packaged Worker seeds, imports and audits through the actual SQLite migration; browser import module is available.');
}finally{db.close();}
