import {SIMPLEONE_DEMO_KEY, availableWorkflowActions, completeWorkflowDelivery, escalationAssessment, incidentConnections, incidentPrecedents, nextWorkflowState, possibleConsequences, relevanceOrder, teamAssessment, workGroupKeys, workflowPhases} from '/operations.js';

const $=selector=>document.querySelector(selector);
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const demoKey=SIMPLEONE_DEMO_KEY;
const guestActor={userId:'guest',displayName:'Гость · аналитик-координатор',role:'coordinator'};
const actionLabels={assign:'Передать команде',retry:'Повторить отправку',resolve:'Подтвердить решение',investigate:'На расследование','finish-investigation':'Завершить расследование',close:'Закрыть инцидент'};
const deliveryLabels={sending:'Отправляется в SimpleOne',sent:'Принято SimpleOne',demo:'Принято учебным SimpleOne',failed:'SimpleOne не подтвердил доставку'};
const riskLabels={high:'Повышенный риск эскалации',medium:'Умеренный риск эскалации',low:'Низкая оценка риска'};
const key=item=>item.id+'|'+(item.sysId||'');
const parse=(store,name,fallback)=>{try{return JSON.parse(store.getItem(name))??fallback;}catch{return fallback;}};
const write=(store,name,value)=>{try{store.setItem(name,JSON.stringify(value));}catch{}};
const option=(value,label)=>`<option value="${escape(value)}">${escape(label)}</option>`;

export function createOperations(get,refresh,notify){
  let demo=parse(localStorage,demoKey,{rows:{},incidents:[]});
  let model={},modelKey='',analysisBusy=false,actionBusy=false,dialogAction=null;
  const groupOrder=[];
  const form=$('#workflow-form'),dialog=$('#workflow-dialog');

  function actor(){
    const {auth}=get();
    return auth.user||(!auth.checking?guestActor:null);
  }
  const isGuest=()=>actor()===guestActor;
  const usesDemo=()=>isGuest();
  const demos=()=>usesDemo()?demo.incidents:[];
  function book(items=get().items){
    const {auth,snapshot}=get();
    const rows=new Map((snapshot?.workflow||[]).map(row=>[key(row),row]));
    return Object.fromEntries(items.flatMap(item=>{
      const row=(!auth.user&&usesDemo()?demo.rows[key(item)]:null)||rows.get(key(item));
      return row?[[item.id,row]]:[];
    }));
  }
  const guestRow=item=>demo.rows[key(item)];
  function pending(item,rows){
    const awaiting=rows[item.id]?.pending??item.isNew;
    return Boolean(awaiting)&&workGroupKeys(item).some(group=>['coord','critical','high'].includes(group));
  }
  function assignment(item,rows=book()){
    const row=rows[item.id],dispatch=row?.dispatch;
    const superseded=dispatch&&row.team!==item.team&&['sent','demo'].includes(dispatch.state);
    let phase=null;
    if(item.status==='investigating'&&item.researchCompletedAt)phase='Расследование завершено';
    else if(get().isOpen(item)&&!superseded)phase=dispatch?deliveryLabels[dispatch.state]:workflowPhases[row?.phase];
    return {team:item.team,person:item.assignee,phase,pending:pending(item,rows)};
  }
  function validateModel(){
    const {revision,view}=get(),context=revision+'|'+view;
    if(modelKey!==context){model={};modelKey=context;}
  }
  function order(list,mode='relevance'){
    validateModel();
    return relevanceOrder(list,{mode,workflow:book(),model});
  }
  function groups(list,definitions,{wall=false,mode='relevance'}={}){
    const {items}=get(),rows=book();
    const present=definitions.filter(group=>items.some(group.test));
    let ordered=present;
    if(wall){
      const existing=groupOrder.filter(id=>present.some(group=>group.key===id));
      const appeared=present.filter(group=>!existing.includes(group.key)).sort((a,b)=>
        Number(items.some(i=>b.test(i)&&pending(i,rows)))-Number(items.some(i=>a.test(i)&&pending(i,rows))));
      groupOrder.splice(0,groupOrder.length,...appeared.map(group=>group.key),...existing);
      ordered=groupOrder.map(id=>definitions.find(group=>group.key===id));
    }
    return ordered.flatMap(group=>{
      const entries=list.filter(group.test);
      const members=wall?relevanceOrder(entries,{workflow:rows}):order(entries,mode);
      if(!members.length)return [];
      const waiting=members.filter(item=>pending(item,rows));
      const criticalAlert=waiting.some(item=>get().isOpen(item)&&item.priority==='critical');
      return [{...group,members,urgent:waiting.length>0,criticalAlert}];
    });
  }
  function renderAlerts(){
    const {items,esc,screen}=get(),el=$('#workflow-alerts'),rows=book();
    const list=items.filter(item=>pending(item,rows)).sort((a,b)=>Number(b.priority==='critical')-Number(a.priority==='critical')||b.createdAt-a.createdAt);
    const signature=JSON.stringify([screen,...list.map(i=>[i.id,i.title,rows[i.id]?.version])]);
    if(el.dataset.signature===signature)return;
    el.dataset.signature=signature;el.hidden=!list.length;
    el.innerHTML=list.length?`<strong>${list.length===1?'Инцидент ждёт реакции':'Инциденты ждут реакции · '+list.length}</strong><ul>${list.slice(0,screen==='wallboard'?1:3).map(item=>`<li>${screen==='wallboard'?escape(item.id)+' · '+escape(item.title):`<button data-open="${esc(item.id)}">${escape(item.id)} · ${escape(item.title)}</button>`}</li>`).join('')}</ul>`:'';
  }
  function details(item,{showPrecedents=false}={}){
    const {items,auth,frozen}=get(),rows=book(),row=rows[item.id],current=assignment(item,rows);
    const allowed=frozen&&!isGuest()?[]:availableWorkflowActions(item,row,actor());
    validateModel();
    const rule=escalationAssessment(item),estimate=model[item.id],level=estimate?.level||rule.level;
    const risk=`<div class="escalation-assessment risk-${level}"><strong>${escape(estimate?riskLabels[level]:rule.label)}</strong><small>${estimate?'Модель Яндекса':'По данным карточки'}</small>${rule.evidence.length?`<ul>${rule.evidence.map(reason=>`<li>${escape(reason)}</li>`).join('')}</ul>`:''}${estimate?`<p>${escape(estimate.reason)}</p>`:''}</div>`;
    const precedents=showPrecedents?incidentPrecedents(item,items):[];
    return `<section class="workflow-detail" aria-label="Назначение и оценка эскалации">
      <h3>Назначение и риск эскалации</h3>
      <p>${escape(current.team)} · ${escape(current.person)}${current.phase?' · '+escape(current.phase):''}</p>
      ${item.assignmentConflict?`<p class="assignment-conflict" role="status">${escape(item.assignmentConflict)}</p>`:''}
      ${allowed.length?`<div class="workflow-actions">${allowed.map(action=>`<button type="button" class="button ${action==='resolve'||action==='assign'?'button-primary':'button-secondary'}" data-workflow-act="${action}" data-workflow-id="${escape(item.id)}">${actionLabels[action]}</button>`).join('')}</div>`:''}
      ${row?.dispatch&&['sending','failed'].includes(row.dispatch.state)?`<p>Команда назначения · ${escape(row.team)}</p>`:''}
      ${risk}
      ${auth.user&&rule.level!=='none'?`<button class="button button-secondary" data-work-analysis="${escape(item.id)}" ${analysisBusy?'disabled':''}>Оценить с ИИ</button>`:''}
      ${row?.report?`<details><summary>Отчёт о передаче · ${row.reportSource==='yandex'?'с черновиком ИИ':'по карточке'}</summary><pre>${escape(row.report)}</pre><button class="button button-secondary" data-work-report="${escape(item.id)}">Скопировать отчёт</button></details>`:''}
      ${showPrecedents?`<details class="workflow-precedents"><summary>Похожие завершённые инциденты${precedents.length?' · '+precedents.length:''}</summary>${precedents.length?precedents.map(({item:prior,basis})=>`<article><button data-open="${escape(prior.id)}">${escape(prior.id)} · ${escape(prior.title)}</button><small>${escape(basis.join(' · '))}</small><p>${escape(prior.solution)}</p></article>`).join(''):'<p>Схожих записей с зафиксированным решением среди завершённых пока нет.</p>'}</details>`:''}
    </section>`;
  }
  function renderDna(){
    const {items,selected,workGroups}=get();
    const picker=$('#dna-incident-picker'),category=$('#dna-category'),graph=$('#dna-graph');
    const fold=value=>String(value||'').toLocaleLowerCase('ru').replaceAll('ё','е');
    const terms=fold($('#dna-search').value).trim().split(/\s+/).filter(Boolean);
    const buckets=new Map(workGroups.map(group=>[group.key,[]]));
    for(const item of items)for(const group of workGroupKeys(item))buckets.get(group).push(item);
    const categories=workGroups.filter(group=>buckets.get(group.key).length);
    const categoryOptions=option('all','Все категории')+categories.map(group=>option(group.key,group.title+' · '+buckets.get(group.key).length)).join('');
    if(category.dataset.options!==categoryOptions){
      const previous=category.value;
      category.innerHTML=categoryOptions;category.dataset.options=categoryOptions;
      category.value=buckets.get(previous)?.length?previous:'all';
    }
    const listed=new Set();
    const choices=categories.filter(group=>category.value==='all'||group.key===category.value).map(group=>{
      const members=buckets.get(group.key).filter(item=>{
        if(listed.has(item.id))return false;
        listed.add(item.id);
        if(!terms.length)return true;
        const text=fold([item.id,item.title,item.summary,item.description,item.product,item.service,item.team].join(' '));
        return terms.every(term=>text.includes(term));
      }).sort((a,b)=>b.createdAt-a.createdAt||a.id.localeCompare(b.id));
      return {...group,members};
    }).filter(group=>group.members.length);
    const options=choices.map(group=>`<optgroup label="${escape(group.title)}">${group.members.map(i=>option(i.id,i.id+' · '+i.title)).join('')}</optgroup>`).join('')||option('','Нет совпадений');
    if(picker.dataset.options!==options){picker.innerHTML=options;picker.dataset.options=options;}
    const matched=choices.flatMap(group=>group.members);
    const item=matched.find(i=>i.id===selected)||matched[0];
    picker.disabled=!item;picker.value=item?.id||'';
    if(!item){graph.innerHTML='<p>Нет инцидентов по выбранным условиям.</p>';delete graph.dataset.incident;return;}
    const all=incidentConnections(item,items),confirmed=all.filter(row=>row.kind==='confirmed'),suggested=all.filter(row=>row.kind==='suggested');
    const flags=[['isMaster','Мастер-инцидент'],['isDuplicate','Дубль'],['isEffect','Причина дочерних'],['isReason','Дочерний'],['isRootIncident','Корневой']].filter(([flag])=>item[flag]).map(([,label])=>label);
    const pointers=(item.linkedIncidentIds||[]).filter(id=>!items.some(other=>other.id===id||other.sysId===id));
    const branch=(title,rows,kind,empty)=>`<section class="dna-branch dna-${kind}"><h3>${title}</h3>${rows.length?`<ul>${rows.map(({item:related,basis})=>`<li><button data-dna-incident="${escape(related.id)}" title="Показать связи этого инцидента"><b>${escape(related.id)}</b> ${escape(related.title)}</button><small>${escape(basis.join(' · '))}</small></li>`).join('')}</ul>`:`<p>${empty}</p>`}</section>`;
    const consequences=possibleConsequences(item,all);
    const signature=JSON.stringify([item.id,item.title,flags,pointers,all.map(r=>[r.item.id,r.item.title,r.kind,r.basis]),consequences.map(r=>[r.item.id,r.basis])]);
    if(graph.dataset.incident===signature)return;
    graph.dataset.incident=signature;
    graph.innerHTML=`<div class="dna-node"><button data-open="${escape(item.id)}" title="Открыть карточку">${escape(item.id)} · ${escape(item.title)}</button>${flags.length?`<small>${flags.join(' · ')}</small>`:''}${pointers.length?`<small>Нет карточек для ID ${escape(pointers.join(', '))}</small>`:''}</div><div class="dna-branches">${branch('Связи из выгрузки',confirmed,'confirmed','Связанных ID в выгрузке нет.')}${branch('Сходные инциденты',suggested,'suggested','Сходства по нескольким признакам пока не найдены.')}${branch('Возможные следствия',consequences,'consequence','Подходящих более поздних событий в пределах суток нет.')}</div>`;
  }
  function overview(){
    const {items}=get(),teams=teamAssessment(items);
    renderDna();
    const flagged=teams.filter(team=>team.findings.length),quiet=teams.filter(team=>!team.findings.length);
    const teamButton=team=>`<button class="button button-secondary" data-active-team data-team="${escape(team.name)}">Задачи команды · ${team.count}</button>`;
    const alerts=flagged.map(team=>`<article class="team-assessment"><header><h3>${escape(team.name)}</h3>${teamButton(team)}</header>
      <ul>${team.findings.map(f=>`<li><strong>${escape(f.fact)}</strong> ${escape(f.action)}${f.incidentId?` <button class="team-dna-link" data-dna-incident="${escape(f.incidentId)}">Открыть ${escape(f.incidentId)} в ИнциДНК</button>`:''}</li>`).join('')}</ul></article>`).join('');
    const list=quiet.map(team=>`<li><span>${escape(team.name)}</span>${teamButton(team)}</li>`).join('');
    const panel=$('#team-workload'),content=`<h2>Состояние команд</h2>${alerts||(teams.length?'<p>Среди активных задач нет просрочек, критических инцидентов, близких сроков или всплесков назначений.</p>':'<p>Активных задач нет.</p>')}${quiet.length?`<details><summary>Без сигналов нагрузки · ${quiet.length}</summary><ul class="team-quiet">${list}</ul></details>`:''}`;
    if(panel.dataset.content!==content){
      const expanded=panel.querySelector('details')?.open;
      panel.innerHTML=content;panel.dataset.content=content;
      if(expanded&&panel.querySelector('details'))panel.querySelector('details').open=true;
    }
  }
  async function post(path,payload){
    const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(24000)});
    const data=await response.json();
    if(!response.ok)throw new Error(data.error||'Не удалось выполнить действие.');
    return data;
  }

  async function transition(item,input){
    if(actionBusy)return false;
    actionBusy=true;
    try{
      const row=book()[item.id],body={...input,id:item.id,version:input.version??row?.version??0,view:get().view};
      let next;
      if(isGuest()){
        demo=parse(localStorage,demoKey,demo);
        const current=demo.rows[key(item)]||row;
        const source=demo.incidents.find(i=>key(i)===key(item))||get().baseItems.find(i=>key(i)===key(item))||item;
        next=nextWorkflowState(source,current,body,actor());
        if(['assign','retry'].includes(body.action)){
          demo.rows[key(item)]=next;write(localStorage,demoKey,demo);
          let delivered='failed';
          try{
            const receipt=await post('/api/simpleone/demo',{incidentId:item.id,sysId:item.sysId||'',team:next.team,dispatchId:next.dispatch.id});
            if(receipt.received&&receipt.dispatchId===next.dispatch.id)delivered='demo';
          }catch{}
          demo=parse(localStorage,demoKey,demo);
          if(demo.rows[key(item)]?.version!==next.version||demo.rows[key(item)]?.dispatch?.id!==next.dispatch.id)throw Error('Назначение изменилось. Откройте актуальную карточку.');
          next=completeWorkflowDelivery(next,delivered,actor());
        }
        demo.rows[key(item)]=next;write(localStorage,demoKey,demo);refresh(true);
      }else{
        const result=await post('/api/workflow',body);
        next=result.workflow;
        await get().applyWorkflow(next);
      }
      const dispatch=['assign','retry'].includes(body.action)?next.dispatch:null;
      const label=dispatch?deliveryLabels[dispatch.state]:actionLabels[body.action];
      if(body.action==='resolve'&&item.priority==='critical'){
        if(!isGuest())await get().reload();
      }else notify(label,item.id,dispatch?.state==='failed'?'changed':'success');
      return true;
    }finally{actionBusy=false;}
  }

  function openWorkflowForm(item,action){
    const row=book()[item.id],{items,snapshot}=get();
    const transfer=action==='assign';
    const connection=isGuest()?{mode:'demo'}:snapshot?.integrations?.simpleOne;
    const available=connection?.mode==='live'?connection.teams:items.map(i=>i.team);
    const teams=[...new Set((available||[]).filter(team=>team&&team!==get().coordinatorTeam&&team!=='Команда не назначена'))].sort((a,b)=>a.localeCompare(b,'ru'));
    if(transfer&&(connection?.mode==='unavailable'||!teams.length)){
      notify('Нет команд для отправки','Проверьте настройки SimpleOne и справочник команд.','changed');
      return;
    }
    dialogAction={item,action,version:row?.version||0};
    $('#workflow-dialog-title').textContent=actionLabels[action];
    $('#workflow-dialog-incident').textContent=item.id+' · '+item.title;
    $('#workflow-dialog-connection').hidden=!transfer;
    $('#workflow-dialog-connection').textContent=connection?.mode==='live'?'Живой SimpleOne · изменение назначения в карточке':'Учебный SimpleOne · демонстрационная передача';
    $('#workflow-dialog-error').hidden=true;
    $('#workflow-team-field').hidden=!transfer;
    form.elements.team.required=transfer;
    form.elements.team.innerHTML=option('','Выберите команду')+teams.map(team=>option(team,team)).join('');
    form.elements.team.value='';
    form.elements.note.required=['resolve','finish-investigation'].includes(action);
    $('#workflow-note-label').textContent={resolve:'Подтверждённое решение','finish-investigation':'Результат расследования'}[action]||'Комментарий';
    form.querySelector('[type=submit]').textContent=transfer?'Отправить':actionLabels[action];
    form.elements.note.value='';
    dialog.showModal();
  }
  $('#workflow-cancel').addEventListener('click',()=>{if(!actionBusy)dialog.close();});
  dialog.addEventListener('cancel',event=>{if(actionBusy)event.preventDefault();});
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    if(!dialogAction||actionBusy)return;
    const {item,action,version}=dialogAction,button=form.querySelector('[type=submit]');
    button.disabled=true;$('#workflow-dialog-error').hidden=true;
    try{if(await transition(item,{action,version,team:form.elements.team.value,note:form.elements.note.value}))dialog.close();}
    catch(error){$('#workflow-dialog-error').textContent=error.message;$('#workflow-dialog-error').hidden=false;}
    finally{button.disabled=false;}
  });
  document.addEventListener('click',async event=>{
    const button=event.target.closest('button');if(!button)return;
    if(button.dataset.workReport){
      const report=book()[button.dataset.workReport]?.report;
      if(report)try{await navigator.clipboard.writeText(report);notify('Отчёт скопирован',button.dataset.workReport,'success');}catch{notify('Не удалось скопировать','Выделите текст в отчёте и скопируйте его.','changed');}
    }
    if(button.hasAttribute('data-work-analysis')&&!analysisBusy){
      analysisBusy=true;validateModel();const context=modelKey;
      refresh();
      try{
        const data=await post('/api/workflow/analysis',{id:button.dataset.workAnalysis||null,view:get().view});
        validateModel();
        if(modelKey===context&&data.revision===get().revision)Object.assign(model,data.model||{});
        notify(data.source==='yandex'?'Получена оценка модели':'Показана оценка по карточке',button.dataset.workAnalysis||'Сортировка групп','success');
      }catch(error){notify('Оценка недоступна',error.message,'changed');}
      finally{analysisBusy=false;refresh();}
    }
    if(button.dataset.workflowAct){
      const item=get().items.find(i=>i.id===button.dataset.workflowId),action=button.dataset.workflowAct;
      if(!item||actionBusy)return;
      if(action!=='retry'){if(!dialog.open)openWorkflowForm(item,action);return;}
      try{await transition(item,{action});}catch(error){await get().reload();notify('Действие недоступно',error.message,'changed');}
    }
  });
  window.addEventListener('storage',event=>{if(event.key===demoKey){demo=parse(localStorage,demoKey,{rows:{},incidents:[]});if(usesDemo())refresh(true);}});
  const addDemo=item=>{demo=parse(localStorage,demoKey,demo);demo.incidents=[item,...demo.incidents.filter(old=>old.id!==item.id)].slice(0,20);write(localStorage,demoKey,demo);};
  const clearDemo=()=>{demo={rows:{},incidents:[]};write(localStorage,demoKey,demo);};
  const rankingButton=()=>get().auth.user?`<button class="button button-secondary" data-work-analysis="" ${analysisBusy?'disabled':''}>Уточнить релевантность с ИИ</button>`:'';
  return {actor,isGuest,guestRow,demos,book,pending,assignment,groups,order,renderAlerts,details,renderDna,overview,addDemo,clearDemo,rankingButton};
}
