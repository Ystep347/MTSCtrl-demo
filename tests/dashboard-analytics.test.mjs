import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeIncidentDataset} from '../lib/incidents.mjs';
import {dashboardAnalytics,slaBucket} from '../lib/dashboard-analytics.mjs';
const {incidents}=normalizeIncidentDataset(JSON.parse(readFileSync(new URL('../data/incidents.json',import.meta.url))),JSON.parse(readFileSync(new URL('../data/attributes.json',import.meta.url))));
const now=Date.parse('2026-11-21T00:00:00+03:00');
test('Charts account for the exact export and distinguish recovery from closed work',()=>{
  const a=dashboardAnalytics(incidents,now);
  assert.equal(a.total,44);assert.equal(a.active,24);assert.equal(a.research,5);assert.equal(a.finished,15);
  assert.equal(a.statuses.reduce((s,b)=>s+b.count,0),44);assert.equal(a.priorities.reduce((s,b)=>s+b.count,0),44);
  assert.equal(a.buckets.reduce((s,b)=>s+b.count,0)+a.unknownDeadline,24);
  assert.equal(a.products.reduce((s,p)=>s+p.buckets.reduce((n,c)=>n+c,0),0),24);
  assert.equal(a.teams.reduce((s,t)=>s+t.total,0),29);
  assert.equal(a.timeline.reduce((s,t)=>s+t.created,0),44);
  assert.equal(a.timeline.reduce((s,t)=>s+t.recovered,0),incidents.filter(i=>Number.isFinite(i.resolvedAt)).length);
});
test('SLA boundaries and missing deadlines never turn research into overdue',()=>{
  const i={status:'working',dueAt:now-1};assert.equal(slaBucket(i,now),'overdue');
  assert.equal(slaBucket({...i,dueAt:now},now),'urgent');
  assert.equal(slaBucket({...i,dueAt:now+15*60000},now),'warning');
  assert.equal(slaBucket({...i,dueAt:now+60*60000},now),'buffer');
  assert.equal(slaBucket({...i,dueAt:null},now),null);
  assert.equal(slaBucket({...i,status:'investigating'},now),null);
});
test('Charts are deterministic, keep input intact and handle empty snapshots',()=>{
  const original=JSON.stringify(incidents);
  const a=dashboardAnalytics(incidents,now),b=dashboardAnalytics(incidents,now,24);
  assert.equal(JSON.stringify(incidents),original);assert.deepEqual(a,dashboardAnalytics(incidents,now));
  assert.equal(b.timeline.reduce((s,t)=>s+t.created,0),44);
  assert.equal(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Moscow',hour:'2-digit',hourCycle:'h23'}).format(b.timeline[0].at),'00');
  assert.deepEqual(dashboardAnalytics([],now).timeline,[]);
});
