import {dashboardAnalytics,SLA_BUCKETS} from '/dashboard-analytics.js';
import {timelineChart} from '/analytics-ui.js';
import {coordinatorAdvice,coordinationChecks} from '/coordinator-insights.js';
const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const put=(id,value)=>{const n=document.getElementById(id);if(n)n.textContent=value;};
const html=(id,value)=>{const n=document.getElementById(id);if(n)n.innerHTML=value;};
const date=t=>t==null?'Не указан':new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).format(t);
function activeStyle(button,on){if(button){button.setAttribute('aria-pressed',on);if(button.getAttribute('role')==='tab')button.setAttribute('aria-selected',on);button.style.cssText=on?'background-color:var(--seg-active-bg);color:var(--seg-active-text);box-shadow:var(--seg-active-shadow)':'background-color:transparent;color:var(--text-secondary)';}}
function selected(c){const rows=c.operations.order(c.matching(),c.state.sort);return c.items.find(i=>i.id===c.presentation.spotlight)||rows.find(c.isOpen)||rows[0];}
function queue(c,a){
  const checks=coordinationChecks(c.items);
  put('coordinationCheckCount',checks.length);
  html('coordinationCheckList',checks.length?checks.map(row=>`<button data-open="${esc(row.incident.id)}" class="coord-check-row"><span class="coord-check-card"><strong>${esc(row.incident.id)}</strong><span>${esc(row.incident.product)}</span></span><span>${row.checks.map(check=>`<span class="coord-check-tag" title="${esc(check.reason)}">${esc(check.label)}</span>`).join('')}<span class="coord-check-reason">${esc(row.action)}</span></span><span aria-hidden="true">↗</span></button>`).join(''):'<p class="coord-checks-note">По текущим правилам дополнительных проверок нет.</p>');
  const scope=c.presentation.scope,filtered=c.filteredItems(),matching=c.matching(filtered);
  const scopes=[['focus','В фокусе'],['active','В работе'],['finished','Решённые'],['all','Все']];
  html('queueTabs',scopes.map(([key,label])=>[key,label,filtered.filter(item=>c.matchesIncidentScope(item,key)).length]).map(([key,label,count])=>`<button data-queue-scope="${key}" aria-pressed="${scope===key}" class="px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer" style="${scope===key?'background:var(--seg-active-bg);box-shadow:var(--seg-active-shadow)':'color:var(--text-secondary)'}"><span>${label}</span><span class="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded-md ${scope===key?'bg-[#FF0032] text-white':'bg-[var(--bg-card)] text-[var(--text-tertiary)]'}">${count}</span></button>`).join(''));
  const list=c.state.layout==='board'?c.renderBoard(matching):c.renderTable(matching);
  const focusedHeader=document.activeElement?.dataset.focusGroup;
  html('incidentQueueList',list||`<div class="bento-card rounded-2xl p-10 text-center"><h2 class="font-bold">Нет совпадений</h2><p class="text-sm text-[var(--text-secondary)] mt-2">Измените фильтры или откройте полную выгрузку.</p><button data-all-incidents class="button button-primary mt-4">Все ${a.total}</button></div>`);
  if(focusedHeader)$(`[data-focus-group="${focusedHeader}"]`)?.focus({preventScroll:true});
  put('queueCountInfo',`Показано ${matching.length} из ${a.total}`);
  const chips=[];if(c.state.team)chips.push('Команда: '+c.state.team);if(c.state.product!=='all')chips.push('Продукт: '+c.state.product);if(c.presentation.bucket)chips.push('SLA: '+(SLA_BUCKETS.find(b=>b.key===c.presentation.bucket)?.range||'Срок не указан'));
  html('activeFiltersBadges',chips.map(x=>`<span class="px-2.5 py-1 rounded-lg bg-[#2563EB]/10 text-[#2563EB] font-semibold">${esc(x)}</span>`).join(''));
  $('#activeFiltersBar').classList.toggle('hidden',!chips.length);$('#activeFiltersBar').style.display=chips.length?'flex':'';
  const reset=$('#activeFiltersBar>button');if(reset)reset.setAttribute('data-reset-reference','');

}
function incidentTimeChart(i,c){
  const end=i.resolvedAt??Date.now(),limit=Math.max(i.createdAt+1,end,i.dueAt??end),start=i.createdAt,scale=t=>18+(t-start)/Math.max(1,limit-start)*324;
  const x=scale(end),deadline=i.dueAt==null?null:scale(i.dueAt),col=!c.isOpen(i)?'#10B981':c.isOverdue(i)?'#FF0032':'#2563EB';
  return `<svg viewBox="0 0 360 148" class="ref-lifecycle" role="img" aria-label="Ход инцидента ${esc(i.id)}: создан ${date(start)}, ${c.isOpen(i)?'сейчас':'восстановлен'} ${date(end)}, дедлайн ${date(i.dueAt)}"><path d="M18 72H342" stroke="#ffffff20" stroke-width="6" stroke-linecap="round"/><path d="M18 72H${x}" stroke="${col}" stroke-width="6" stroke-linecap="round"/>${deadline===null?'':`<path d="M${deadline} 35V100" stroke="#94A3B8" stroke-width="1" stroke-dasharray="3 3"/><text x="${Math.min(280,Math.max(80,deadline))}" y="26" text-anchor="middle" fill="#94A3B8" font-size="10">Срок ${date(i.dueAt)}</text>`}<circle cx="18" cy="72" r="5" fill="#F8FAFC"><title>Создан ${date(start)} МСК</title></circle><circle cx="${x}" cy="72" r="6" fill="${col}" stroke="#11131A" stroke-width="2"><title>${c.isOpen(i)?'Сейчас':'Восстановлен'} ${date(end)} МСК</title></circle><text x="18" y="112" fill="#94A3B8" font-size="10">Создан ${date(start)}</text><text x="342" y="134" text-anchor="end" fill="${col}" font-size="11">${c.isOpen(i)?'Сейчас':'Восстановлен'} ${date(end)}</text></svg>`;
}
function copilot(c){
  html('workstationLiveFeed',c.events.slice(0,4).map(event=>c.eventMarkup(event)).join(''));
  put('aiLiveClock',c.sourceData.frozen?'ДЕМО':'5 сек');
  const i=selected(c);if(!i){
    put('aiRecommendationReason','');html('aiDataChecks','');
    put('aiSelectedId','—');put('aiSelectedSubtitle','Нет совпадений');put('aiRootCauseTag','Нет карточки');put('aiSummaryText',c.sourceData.snapshot?'Нет инцидентов для выбранных фильтров. Измените фильтры или выберите другую группу.':'Загружаю текущие инциденты…');put('aiAffectedText','—');html('aiSourceTags','');html('anomalyChartWrap','');put('aiRecTeam','—');put('aiRecEngineer','—');put('aiRecInitials','');html('aiRoutingActions','');put('aiRiskScore','—');$('#aiRiskBar').style.width='0';put('aiCascadeText','');put('aiRecommendationText','');return;
  }
  put('aiSelectedId',i.id);put('aiSelectedSubtitle',i.product);put('aiRootCauseTag',i.isSimulated?'Симуляция':'Из выгрузки');put('aiSummaryText',i.summary||i.description);
  $('#aiSummaryText').parentElement.querySelector('.uppercase').textContent='Что произошло';
  put('aiAffectedText',i.service||i.product);html('aiSourceTags',`<button data-open="${esc(i.id)}" class="ref-route-button">Карточка инцидента</button>${c.simpleOneLink(i,'ref-route-button')}`);
  const chart=$('#anomalyChartWrap');chart.previousElementSibling.innerHTML='<div><span class="text-[10px] font-bold uppercase tracking-wider text-[#C4B5FD] block">Ход инцидента и срок</span><span class="text-xs font-semibold text-white">Фактические даты</span></div><span class="text-[10px] text-[var(--ai-text-secondary)]">МСК</span>';
  chart.innerHTML=incidentTimeChart(i,c);
  put('aiMatchPct','Из карточки');$('#aiMatchPct').previousElementSibling.textContent='Команда назначения';
  const assignment=c.operations.assignment(i);
  put('aiRecTeam',c.shortTeam(assignment.team));put('aiRecEngineer',assignment.person);put('aiRecInitials',c.initials(assignment.person));
  html('aiRoutingActions',`<button class="ref-route-button" data-open="${esc(i.id)}" data-initial-tab="ai">Разбор ситуации</button><button class="ref-route-button primary" data-chat-open data-chat-context="${esc(i.id)}">Спросить ИИ${c.icon('sparkle')}</button>`);
  $('#aiRiskScore').previousElementSibling.textContent='Контроль срока';put('aiRiskScore',!c.isOpen(i)?'Восстановлен':i.dueAt===null?'Срок не указан':c.isOverdue(i)?'Нарушен':'В пределах срока');
  const bar=$('#aiRiskBar');bar.style.width=(!c.isOpen(i)?100:c.progress(i))+'%';bar.style.background=!c.isOpen(i)?'#10B981':c.isOverdue(i)?'#FF0032':'#2563EB';
  put('aiCascadeText',i.status==='investigating'?'Сервис восстановлен. Продолжается разбор причин.':i.dueAt===null?'В выгрузке нет срока. Просрочка не вычисляется.':c.isOverdue(i)?'Срок восстановления нарушен. Уточните прогресс у назначенной команды.':'Команда назначена. Следите за сроком и обновлениями статуса.');
  const advice=coordinatorAdvice(i);
  put('aiRecommendationText',advice.action);put('aiRecommendationReason','Основание: '+advice.reason);
  html('aiDataChecks',advice.checks.map(check=>`<span title="${esc(check.reason)}">${esc(check.label)}</span>`).join(''));
  html('workstationLiveFeed',c.events.slice(0,4).map(event=>c.eventMarkup(event)).join(''));
  put('aiLiveClock',c.sourceData.frozen?'ДЕМО':'5 сек');
}
function wallboard(c,a){
  html('wallboardBoard',c.renderBoard(c.items,true));
  html('inflowChartWrap',timelineChart(a,c.presentation.interval,$('#inflowChartWrap').clientWidth));
  put('wallboardClock',new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',hour:'2-digit',minute:'2-digit'}).format(Date.now())+' МСК');
}
export function renderReference(c){
  const a=dashboardAnalytics(c.items,Date.now(),c.presentation.interval),dashboard=c.state.view==='dashboard',wall=c.presentation.screen==='wallboard';
  $('#workstationView').hidden=!dashboard||wall;$('#wallboardView').hidden=!dashboard||!wall;$('#alternate-view').hidden=dashboard;
  $('#workstationView').classList.remove('hidden');$('#wallboardView').classList.remove('hidden');
  if(dashboard){
    const recovered=c.events.find(e=>e.type==='success'&&c.items.some(i=>i.id===e.incidentId&&!c.isOpen(i)&&(String(e.id).startsWith('recovery:')||i.priority==='critical')));
    const item=recovered&&c.items.find(i=>i.id===recovered.incidentId);
    const message=item?`Восстановлен критический ${item.id} · ${item.product}`:'';
    html('criticalRecovery',item?`<button class="recovery-strip" data-open="${esc(item.id)}">${c.icon('checkCircle')}<strong>${esc(message)}</strong></button>`:'');
    put('wallRecovery',message);$('#wallRecovery').hidden=!item;
    if(wall)wallboard(c,a);else{queue(c,a);copilot(c);c.operations.overview();}}
  for(const [id,on] of [['viewWorkstationBtn',!wall],['viewWallboardBtn',wall]])activeStyle(document.getElementById(id),on);
  put('source-summary',c.sourceData.frozen?'Локальное демо':`${c.presentation.datasetView==='mts-demo'?'Симуляция МТС':'Исходная выгрузка'} · ${a.total}`);
}
