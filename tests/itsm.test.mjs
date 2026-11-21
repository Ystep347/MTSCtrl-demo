import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import worker from '../worker/index.js';
import {itsmTemplate,incidentItsmLink,attachItsmLinks} from '../lib/itsm.mjs';
import {localRequestHeaders} from '../scripts/local-identity.mjs';
const raw=JSON.parse(readFileSync(new URL('../data/incidents.json',import.meta.url)));

test('ITSM preserves long sysIds and encodes incident IDs in path and query',()=>{
  assert.equal(incidentItsmLink({id:'INC-12&x=3',sysId:'179413934903718013'},'https://itsm.example/incident/{sysId}?id={id}'),'https://itsm.example/incident/179413934903718013?id=INC-12%26x%3D3');
  assert.equal(incidentItsmLink({id:'INC12'},'https://itsm.example/{sysId}'),null);
});
test('Only explicit HTTPS incident templates can generate links',()=>{
  for(const value of [undefined,'','javascript:alert({id})','http://itsm.example/{id}','https://user:password@itsm.example/{id}','https://{id}.example/path','https://itsm.example/{unknown}','https://itsm.example/static','https://itsm.example/\\{id}','https://itsm.example/{id}\n'])assert.equal(itsmTemplate(value),null,String(value));
  assert.ok(itsmTemplate('https://itsm.example/#/incident/{id}'));
});
test('ITSM configuration changes the HTTP representation without changing raw revision',async()=>{
  const get=env=>worker.fetch(new Request('https://site.test/api/incidents'),{INCIDENTS_JSON:raw,...env});
  const base=await get({}),before=await base.json();
  const linked=await get({ITSM_INCIDENT_URL_TEMPLATE:'https://itsm.example/incident/{sysId}'}),after=await linked.json();
  assert.equal(before.revision,after.revision);assert.notEqual(base.headers.get('etag'),linked.headers.get('etag'));
  assert.equal(after.incidents[0].itsmUrl,'https://itsm.example/incident/'+raw[0].sysId);
  assert.equal(before.incidents[0].itsmUrl,null);assert.equal(after.integrations.itsm.configured,true);
  const cached=await worker.fetch(new Request('https://site.test/api/incidents',{headers:{'if-none-match':linked.headers.get('etag')}}),{INCIDENTS_JSON:raw,ITSM_INCIDENT_URL_TEMPLATE:'https://itsm.example/incident/{sysId}'});
  assert.equal(cached.status,304);
  const dataset={revision:'r',incidents:[{id:'INC1',sysId:'1'}]};await attachItsmLinks(dataset,{ITSM_INCIDENT_URL_TEMPLATE:'https://itsm.example/{id}'});assert.equal(dataset.incidents[0].itsmUrl,undefined);
});
test('Standalone server strips forged platform identities and only injects explicit local preview',()=>{
  const incoming={'oai-authenticated-user-id':'attacker','OAI-Authenticated-User-Email':'owner@example.test','accept':'application/json'};
  const anonymous=localRequestHeaders(incoming);assert.equal(anonymous.get('oai-authenticated-user-id'),null);assert.equal(anonymous.get('accept'),'application/json');
  const editor=localRequestHeaders(incoming,true);assert.equal(editor.get('oai-authenticated-user-id'),'preview-editor');assert.equal(editor.get('oai-authenticated-user-email'),'preview-editor@example.test');
});
