const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stamp=value=>new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).format(value);
const day=value=>new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',day:'2-digit',month:'2-digit'}).format(value);
export function sparkline(values,color='#2563EB'){
  if(!values.length)return '<svg viewBox="0 0 80 28" aria-hidden="true"><path d="M2 23H78" stroke="var(--border)" fill="none"/></svg>';
  const max=Math.max(1,...values),min=Math.min(0,...values),span=Math.max(1,max-min);
  const points=values.map((v,i)=>[values.length===1?72:4+i*68/(values.length-1),23-(v-min)/span*19]);
  const d=points.map(([x,y],i)=>`${i?'L':'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' '),last=points.at(-1);
  return `<svg viewBox="0 0 80 28" aria-hidden="true"><path d="M2 24H78" stroke="var(--border)" stroke-dasharray="2 3" fill="none"/><path d="${d}" stroke="${color}" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${last[0]}" cy="${last[1]}" r="2.5" fill="${color}"/></svg>`;
}
function smoothTimelinePath(points){
  const changes=points.slice(1).map(([,y],i)=>y-points[i][1]);
  // Equal-width intervals let adjacent segments share a tangent at each point.
  // Limiting that tangent keeps the curve within the neighboring data values.
  const tangents=points.map((_,i)=>{
    const incoming=changes[i-1]??changes[i]??0;
    const outgoing=changes[i]??incoming;
    return incoming*outgoing>0?Math.sign(incoming)*Math.min(Math.abs(incoming),Math.abs(outgoing)):0;
  });
  const commands=[`M${points[0].join(' ')}`];
  for(let i=1;i<points.length;i++){
    const [startX,startY]=points[i-1], [endX,endY]=points[i];
    const third=(endX-startX)/3;
    commands.push(`C${startX+third} ${startY+tangents[i-1]/3} ${endX-third} ${endY-tangents[i]/3} ${endX} ${endY}`);
  }
  return commands.join(' ');
}
export function timelineChart(a,interval=6,compactWidth=0){
  if(!a.timeline.length)return '<div class="chart-empty">Загрузите выгрузку, чтобы увидеть динамику.</div>';
  const compact=compactWidth>0;
  const bins=a.timeline,W=compact?Math.max(320,compactWidth):720,H=compact?92:210,left=34,right=16,top=compact?9:20,bottom=compact?23:32,base=H-bottom;
  const max=Math.max(1,...bins.flatMap(b=>[b.created,b.recovered]));
  const x=i=>left+(W-left-right)*(bins.length===1?.5:i/(bins.length-1)),y=v=>base-(base-top)*v/max;
  const labels=[...new Set([0,Math.round((bins.length-1)/3),Math.round(2*(bins.length-1)/3),bins.length-1])];
  const ticks=[...new Set(Array.from({length:4},(_,i)=>Math.round(max*i/3)))];
  const series=[{key:'created',color:'#FF0032',name:'Поступило'},{key:'recovered',color:'#10B981',name:'Восстановлено'}]
    .map(s=>({...s,line:smoothTimelinePath(bins.map((b,i)=>[x(i),y(b[s.key])]))}));
  return `<div class="line-chart"><svg viewBox="0 0 ${W} ${H}" ${compact?'preserveAspectRatio="none"':''} role="img" aria-label="Динамика из выгрузки: поступление и восстановление, ${day(bins[0].at)} — ${day(bins.at(-1).at)}, МСК"><desc>График использует даты создания и восстановления записей текущей выгрузки. Исследование считается восстановленным сервисом, но не закрытым инцидентом.</desc>${ticks.map(n=>`<g><line x1="${left}" y1="${y(n)}" x2="${W-right}" y2="${y(n)}" stroke="var(--chart-grid)" stroke-dasharray="3 4"/><text x="24" y="${y(n)+4}" text-anchor="end" fill="var(--muted)" font-size="11">${n}</text></g>`).join('')}${labels.map(i=>`<text x="${x(i)}" y="${H-8}" text-anchor="${i===0?'start':i===bins.length-1?'end':'middle'}" fill="var(--muted)" font-size="11">${esc(stamp(bins[i].at))}</text>`).join('')}${series.map(s=>`<path d="${s.line} L${x(bins.length-1)} ${base} L${x(0)} ${base} Z" fill="${s.color}" opacity=".07"/><path d="${s.line}" fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>${bins.map((b,i)=>`<circle class="chart-point" ${compact?'':'tabindex="0"'} cx="${x(i)}" cy="${y(b[s.key])}" r="3.5" fill="${s.color}" stroke="var(--surface)" stroke-width="1.5" aria-label="${esc(stamp(b.at))}, ${s.name}: ${b[s.key]}"><title>${stamp(b.at)} МСК · ${s.name}: ${b[s.key]}</title></circle>`).join('')}`).join('')}</svg></div>${compact?'':`<div class="chart-bottom"><span>Период выгрузки · ${day(bins[0].at)}–${day(bins.at(-1).at)} · МСК</span><span>${interval===24?'По дням':'Интервалы по 6 часов'}</span></div><details class="chart-data"><summary>Данные графика</summary><div><table><thead><tr><th>Начало интервала · МСК</th><th>Поступило</th><th>Восстановлено</th></tr></thead><tbody>${bins.map(b=>`<tr><td>${stamp(b.at)}</td><td>${b.created}</td><td>${b.recovered}</td></tr>`).join('')}</tbody></table></div></details>`}`;
}
export function donutChart(segments,total){
  const radius=54,length=2*Math.PI*radius;let offset=0;
  const arcs=segments.filter(s=>s.count).map(s=>{const part=total?s.count/total*length:0;const result=`<circle cx="80" cy="80" r="${radius}" fill="none" stroke="${s.color}" stroke-width="18" stroke-dasharray="${Math.max(0,part-3)} ${length}" stroke-dashoffset="${-offset}" transform="rotate(-90 80 80)"><title>${esc(s.label)}: ${s.count}</title></circle>`;offset+=part;return result;}).join('');
  return `<div class="donut-layout"><svg viewBox="0 0 160 160" role="img" aria-label="Распределение ${total} инцидентов: ${esc(segments.map(s=>s.label+' '+s.count).join(', '))}"><circle cx="80" cy="80" r="${radius}" fill="none" stroke="var(--soft)" stroke-width="18"/>${arcs}<text x="80" y="80" text-anchor="middle" fill="var(--ink)" font-size="29" font-weight="750" font-family="ui-monospace,monospace">${total}</text><text x="80" y="100" text-anchor="middle" fill="var(--muted)" font-size="10">всего</text></svg><div class="donut-legend">${segments.map(s=>`<div><span class="legend-dot" style="background:${s.color}"></span><span>${esc(s.label)}</span><strong>${s.count}</strong><small>${total?Math.round(s.count/total*100):0}%</small></div>`).join('')}</div></div>`;
}
export function heatmapChart(a){
  const max=Math.max(1,...a.products.flatMap(p=>p.buckets));
  return `<div class="heatmap-scroll"><table class="heatmap"><caption class="sr-only">Количество активных инцидентов по продукту и сроку решения</caption><thead><tr><th>Продукт</th>${['Срок нарушен','0–15 мин','15–60 мин','>60 мин'].map(t=>`<th>${t}</th>`).join('')}</tr></thead><tbody>${a.products.map(p=>`<tr><th title="${esc(p.name)}">${esc(p.name)}</th>${p.buckets.map((count,index)=>`<td><button data-heat-product="${esc(p.name)}" data-sla-select="${a.buckets[index].key}" style="--cell-color:${a.buckets[index].color};--cell-alpha:${count?(.08+count/max*.23).toFixed(2):'0'}" aria-label="${esc(p.name)}, ${a.buckets[index].range}: ${count}">${count||'—'}</button></td>`).join('')}</tr>`).join('')}</tbody></table></div><p class="chart-footnote">Нажмите на ячейку, чтобы открыть инциденты. Исследование исключено из активного SLA.</p>`;
}
export function teamLoadChart(a,showAll=false){
  const teams=showAll?a.teams:a.teams.slice(0,6),max=Math.max(1,...a.teams.map(t=>t.total));
  return `<div class="team-bars">${teams.map(t=>`<button data-team="${esc(t.name)}" aria-label="${esc(t.name)}: ${t.total} инцидентов"><span><span title="${esc(t.name)}">${esc(t.name.replace('КЦ ИТ Координаторы Массовых Инцидентов','Координаторы'))}</span><strong>${t.total}</strong></span><span class="team-bar-track">${[['critical','#FF0032'],['high','#F59E0B'],['other','#2563EB'],['research','#10B981']].map(([key,color])=>`<span style="width:${t[key]/max*100}%;background:${color}"><span class="sr-only">${key}: ${t[key]}</span></span>`).join('')}</span></button>`).join('')}</div><div class="chart-key"><span><i style="background:#FF0032"></i>Критические</span><span><i style="background:#F59E0B"></i>Высокие</span><span><i style="background:#2563EB"></i>Остальные</span><span><i style="background:#10B981"></i>Исследование</span></div>${a.teams.length>6?`<button class="chart-expand" data-chart-teams>${showAll?'Свернуть':'Все команды · '+a.teams.length}</button>`:''}`;
}
