import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {normalizeIncidentDataset,incidentGroups} from '../lib/incidents.mjs';
import {projectMtsSimulation} from '../lib/mts-simulation.mjs';
test('Defense commands change an isolated real JSON through critical, coordinator research, deadline, recovery and escalation',()=>{
  const directory=mkdtempSync(join(tmpdir(),'mts-defense-'));
  const source=new URL('../data/incidents.json',import.meta.url),original=readFileSync(source,'utf8');
  const invoke=command=>JSON.parse(execFileSync(process.execPath,[fileURLToPath(new URL('../scripts/demo-scenario.mjs',import.meta.url)),command],{env:{...process.env,DEMO_SCENARIO_DIR:directory},encoding:'utf8'}));
  const read=()=>JSON.parse(readFileSync(join(directory,'incidents.json'),'utf8'));
  try{
    assert.equal(invoke('prepare').total,44);
    let result=invoke('critical');assert.equal(result.total,45);assert.equal(result.groups.critical,1);
    let rows=read(),created=rows.find(i=>i.id==='INC990000000001');assert.equal(created.sysId,'990000000000000001');
    let view=projectMtsSimulation(normalizeIncidentDataset(rows)).incidents.find(i=>i.id===created.id);assert.equal(view.title,'Недоступно пополнение баланса');assert.deepEqual(incidentGroups(view),['critical','coord']);
    const coordBefore=result.groups.coord;result=invoke('coord');assert.equal(result.groups.coord,coordBefore+1);
    const research=normalizeIncidentDataset(read()).incidents.find(i=>i.team==='КЦ ИТ Координаторы Массовых Инцидентов'&&i.status==='investigating');assert.ok(research);assert.equal(research.dueAt,null);
    invoke('deadline');created=read().find(i=>i.id===created.id);assert.ok(Date.parse(created.deadline)>Date.now());assert.ok(Date.parse(created.deadline)-Date.now()<=60000);
    result=invoke('resolve');assert.equal(result.groups.critical,0);assert.equal(normalizeIncidentDataset(read()).incidents.find(i=>i.id===created.id).status,'resolved');
    result=invoke('high');assert.equal(result.groups.critical,1);
    assert.equal(invoke('reset').total,44);assert.equal(readFileSync(source,'utf8'),original);
  }finally{rmSync(directory,{recursive:true,force:true});}
});
