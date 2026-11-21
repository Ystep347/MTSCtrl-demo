import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeIncidentDataset,isActiveIncident} from '../lib/incidents.mjs';
import {attentionScore,attentionReasons,rankIncidents,workbenchCounts,buildTimeline,productAssignments,shiftBrief,incidentBrief,DEMO_ID} from '../lib/workbench.mjs';
const base=normalizeIncidentDataset(JSON.parse(readFileSync(new URL('../data/incidents.json',import.meta.url)))).incidents;
const now=Date.parse('2026-11-20T18:00:00Z');
test('Workbench uses the canonical four overlapping groups and exact 44-record input',()=>{
 const c=workbenchCounts(base,now);assert.equal(c.total,44);assert.equal(c.focus,8);assert.equal(c.critical,0);assert.equal(c.coord,2);assert.equal(c.high,1);assert.equal(c.research,5);
 const products=productAssignments(base);assert.equal(products.length,5);assert.equal(products.reduce((n,p)=>n+p.ids.length,0),44);
 for(const p of products)assert.equal(p.teams.reduce((n,t)=>n+t.ids.length,0),p.ids.length);
});
test('Ranking cannot turn recovered research or a missing deadline into active overdue risk',()=>{
 const research={...base.find(i=>i.status==='investigating'),dueAt:now-1000,priority:'critical'};
 const noDeadline={...base.find(isActiveIncident),dueAt:null,team:'Профильная команда',priority:'medium'};
 assert.equal(workbenchCounts([research,noDeadline],now).overdue,0);assert.ok(!attentionReasons(research,now).some(r=>r.title.includes('нарушен')));assert.ok(attentionReasons(noDeadline,now).some(r=>r.title==='Срок не указан'));
 const critical={...noDeadline,id:'INC-1',priority:'critical'},highOverdue={...noDeadline,id:'INC-2',priority:'high',dueAt:now-60000};
 assert.ok(attentionScore(critical,now)>attentionScore(highOverdue,now));assert.equal(rankIncidents([research,highOverdue,critical],now)[0].id,critical.id);
});
test('Local timeline preserves source data and stops the active timer after recovery',()=>{
 const original=JSON.stringify(base),one=buildTimeline(base,1,now),four=buildTimeline(base,4,now),five=buildTimeline(base,5,now);
 assert.equal(one.items.length,45);assert.equal(workbenchCounts(one.items,now).critical,1);assert.equal(one.items.find(i=>i.id===DEMO_ID).dueAt,now+12*60000);
 assert.equal(four.items.find(i=>i.id===DEMO_ID).status,'resolved');assert.equal(workbenchCounts(four.items,now).critical,0);
 assert.equal(five.items.find(i=>i.id===DEMO_ID).status,'investigating');assert.equal(workbenchCounts(five.items,now).research,6);assert.equal(isActiveIncident(five.items.find(i=>i.id===DEMO_ID)),false);
 assert.equal(JSON.stringify(base),original);assert.equal(buildTimeline(base,0,now).items.length,44);
});
test('Handoff is factual, labels demo mode, and never fabricates an ITSM link',()=>{
 const {items}=buildTimeline(base,1,now),text=shiftBrief(items,{demo:true,now});assert.match(text,/локальная демонстрация/);assert.match(text,/критических: 1/);assert.match(text,/Группы пересекаются/);assert.match(text,/не ответ языковой модели/);
 const brief=incidentBrief(items[0],now);assert.ok(brief.includes(DEMO_ID));assert.match(brief,/Ссылка на ITSM не предоставлена/);assert.ok(!brief.includes('http'));
});
