import {incidentGroups,isActiveIncident,isFinishedIncident,INCIDENT_COORDINATORS} from './incidents.mjs';
import {assignmentSignals,operationalEvidence} from './operations.mjs';
const labels={working:'Выполняется',assigned:'Назначен',investigating:'Исследование',resolved:'Завершён',closed:'Закрыт'};
const normalize=s=>String(s||'').toLocaleLowerCase('ru').replaceAll('ё','е');
const clock=t=>new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',hour:'2-digit',minute:'2-digit'}).format(t);
const shortTeam=t=>t===INCIDENT_COORDINATORS?'Координаторы':t;

function groupNames(i){return incidentGroups(i).map(key=>({critical:'Критические',coord:'На координаторах',high:'Высокий приоритет',research:'Исследование'})[key]);}
function remaining(i,now){if(isFinishedIncident(i))return `Инцидент завершён. Статус: ${labels[i.status]}.`;if(i.status==='investigating')return 'Статус — исследование ситуации; продолжается разбор причин.';if(i.dueAt===null)return 'Дедлайн в выгрузке не указан.';const minutes=Math.max(1,Math.ceil(Math.abs(i.dueAt-now)/60000));return i.dueAt<now?`Срок решения нарушен на ${minutes} мин.`:`До срока решения — ${minutes} мин (до ${clock(i.dueAt)} МСК).`;}
function row(i,now){return `${i.id} — ${i.title}\n${i.product} · ${labels[i.status]} · ${shortTeam(i.team)}\nИсполнитель: ${i.assignee}. ${remaining(i,now)}`;}
export function selectReferences(answer,incidents){const known=new Set(incidents.map(i=>i.id));return [...new Set(answer.match(/INC-?\d+/g)||[])].filter(x=>known.has(x)).slice(0,8);}

export function localAnswer(question,snapshot,history=[],now=Date.now()){
  const all=snapshot.incidents,q=normalize(question);
  const relations=/связ|похож|сходств|дубл|прецедент/.test(q);
  const anomalies=/аномал|странн.*назнач|ошиб.*назнач|повтор.*передач|необыч.*команд/.test(q);
  let id=q.match(/inc[-\s]?(\d+)/i)?.[0]?.toUpperCase().replace(/\s/g,'');
  if(!id&&(relations||anomalies))id=snapshot.selectedId;
  if(!id&&/(?:^|\s)(его|ему|нем|ним|он|этот|этому)(?:\s|[?.!,]|$)|сколько времени|кто решает|кому передать|объясни этот/.test(q)){
    id=snapshot.selectedId||history.filter(m=>m.role==='user').map(m=>m.content.match(/INC[-\s]?(\d+)/i)?.[0]?.toUpperCase().replace(/\s/g,'')).filter(Boolean).at(-1);
  }
  const focused=id?all.find(i=>i.id.replace(/^INC-?/,'')===id.replace(/^INC-?/,'')):null;
  if(id&&!focused)return `В текущем наборе нет инцидента ${id}. Проверьте ID или выберите карточку на дашборде.`;
  if(focused&&(relations||anomalies)){
    const evidence=operationalEvidence(focused,all,now);
    const links=(title,list,empty)=>title+'\n'+(list.length?list.map(link=>link.id+' · '+link.title+' ('+link.basis.join(', ')+')').join('\n'):empty);
    return [focused.id+' · '+focused.title,
      relations?links('Подтверждённые связи',evidence.confirmed,'Связанных ID среди доступных карточек нет.'):null,
      relations?links('Возможное сходство',evidence.similarities,'Похожих случаев по текущим полям не найдено.'):null,
      anomalies?'Аномалии назначения\n'+(evidence.assignment.length?evidence.assignment.map(signal=>signal.label+'. '+signal.evidence+(signal.ids?.length?' '+signal.ids.join(', '):'')).join('\n'):'По текущим данным аномалий назначения не выявлено.'):null
    ].filter(Boolean).join('\n\n');
  }
  if(anomalies){
    const flagged=all.flatMap(item=>{const signals=assignmentSignals(item,all,now);return signals.length?[{item,signals}]:[];});
    return flagged.length?'Проверки назначения по текущей выгрузке\n\n'+flagged.slice(0,8).map(({item,signals})=>item.id+' · '+signals.map(signal=>signal.label+'. '+signal.evidence).join(' ')).join('\n\n'):'По текущей выгрузке аномалий назначения не выявлено.';
  }
  if(relations)return 'Выберите инцидент в ИнциДНК или укажите его ID. Тогда я проверю подтверждённые связи и похожие случаи.';
  if(focused){
    if(/кому|переда|рекоменду|подключить команд/.test(q))return focused.recommendation?`${focused.id}: рекомендуется команда «${focused.recommendation}».\n\nОснование: продукт «${focused.product}» и описание проблемы: ${focused.description}\n\nСейчас назначен на «${shortTeam(focused.team)}». Аналитик отправляет назначение в SimpleOne.`:`${focused.id}: сейчас назначен на «${shortTeam(focused.team)}».\n\nВ выгрузке нет справочника владельцев продукта «${focused.product}», поэтому надёжно рекомендовать другую команду по этим данным нельзя. Координатору нужно уточнить владельца сервиса; команда по названию продукта не выдумывается.`;
    if(/кто|исполнител|ответствен|какая команда/.test(q))return `${focused.id} решает ${focused.assignee}, команда «${shortTeam(focused.team)}».\nСтатус: ${labels[focused.status]}. ${remaining(focused,now)}`;
    if(/врем|срок|дедлайн|sla/.test(q))return `${focused.id}: ${remaining(focused,now)}\nСоздан: ${clock(focused.createdAt)} МСК. Статус: ${labels[focused.status]}.`;
    return `${row(focused,now)}\n\n${focused.summary||focused.description}\n\nГруппы: ${groupNames(focused).join(', ')||(isFinishedIncident(focused)?'Завершённые':'Вне четырёх групп фокуса')}. Точная техническая причина в текущих данных не подтверждена.`;
  }
  const open=all.filter(isActiveIncident),critical=open.filter(i=>i.priority==='critical').sort((a,b)=>(a.dueAt??Infinity)-(b.dueAt??Infinity)),overdue=open.filter(i=>i.dueAt!==null&&i.dueAt<now),coord=all.filter(i=>i.team===INCIDENT_COORDINATORS&&!isFinishedIncident(i)),research=all.filter(i=>i.status==='investigating');
  const overview=()=>`Всего в снимке: ${all.length}. В фокусе ${all.filter(i=>groupNames(i).length).length} уникальных инцидентов.\n\nАктивных: ${open.length}.\nКритических: ${critical.length}.\nПросроченных: ${overdue.length}.\nНа координаторах: ${coord.length}.\nНа исследовании: ${research.length}.\nЗавершённых и закрытых: ${all.filter(isFinishedIncident).length}.\n\n${critical.length?`Ближайший критический дедлайн: ${critical[0].id}. ${remaining(critical[0],now)}`:'Критических инцидентов сейчас нет.'}\n\nОдин инцидент может входить в несколько групп, поэтому счётчики групп не складываются.`;
  if(/сводк/.test(q))return overview();
  if(/что такое.*sla|что значит.*sla|объясни.*sla|что такое.*срок/.test(q))return 'SLA — согласованный срок предоставления услуги или выполнения обязательства. На этом дашборде отслеживается срок решения инцидента: время до дедлайна или длительность просрочки. На этапе исследования сервис уже восстановлен; разбор причин показывается отдельно.';
  if(/нескольк.*групп|двух.*групп|дублир|почему.*групп/.test(q)){const overlap=all.filter(i=>groupNames(i).length>1);return 'Группы могут пересекаться, потому что проверяют разные признаки: приоритет, команду назначения и статус. Общий счётчик учитывает каждый ID один раз.\n\n'+(overlap.length?overlap.map(i=>`${i.id}: ${groupNames(i).join(', ')}.`).join('\n'):'В текущем снимке пересечений нет.');}
  if(/просроч|наруш.*срок/.test(q))return overdue.length?`Просроченных активных инцидентов: ${overdue.length}.\n\n${overdue.map(i=>row(i,now)).join('\n\n')}\n\nНужно уточнить прогресс ответственных и необходимость эскалации.`:'Сейчас просроченных активных инцидентов нет. Решённые инциденты и исследование не считаются активной просрочкой.';
  if(/координатор|передать/.test(q))return coord.length?`На координаторах ${coord.length} инцидента:\n\n${coord.map(i=>`${i.id} — ${i.title}\n${labels[i.status]}. Рекомендуемая команда: ${i.recommendation||'требуется уточнение'}.`).join('\n\n')}\n\nДля исследования передаются материалы разбора причин: сервис уже восстановлен.`:'У координаторов сейчас нет инцидентов для передачи.';
  if(/исслед|разбор причин/.test(q))return research.length?`На исследовании ${research.length} инцидента. Сервисы уже восстановлены:\n\n${research.map(i=>`${i.id} — ${i.title}\nКоманда: ${shortTeam(i.team)}. ${i.team===INCIDENT_COORDINATORS?'Нужно передать разбор профильной команде.':'Продолжается разбор причин.'}`).join('\n\n')}`:'Инцидентов на исследовании сейчас нет.';
  if(/решен|завершен|восстановлен|закрыт/.test(q)){const solved=all.filter(i=>isFinishedIncident(i)||i.status==='investigating');return solved.length?`Завершённые и исследуемые инциденты:\n\n${solved.map(i=>`${i.id} — ${i.product}. ${labels[i.status]}.`).join('\n')}`:'В текущем наборе нет завершённых инцидентов.';}
  if(/критич|сроч|важн|приоритет|первую очередь|сначала/.test(q)){
    const urgent=critical.length?critical:overdue.length?overdue:open.filter(i=>i.priority==='high');
    return urgent.length?`${critical.length?'Сначала — критические инциденты':'Приоритетное внимание'} (${urgent.length}):\n\n${urgent.slice(0,5).map(i=>row(i,now)).join('\n\n')}${critical.some(i=>i.team===INCIDENT_COORDINATORS)?'\n\nУ критического инцидента на координаторах нужно оперативно определить профильную команду.':''}`:'Активных критических и высокоприоритетных инцидентов сейчас нет.';
  }
  const product=all.filter(i=>[normalize(i.product),...(normalize(i.product).includes('банк')?['банк']:[]),...(i.product==='КИОН'?['кион']:[]),...(i.product==='Сообщения'?['sms','смс']:[]),...(i.product==='Мой МТС'?['мой мтс']:[])].some(name=>name&&q.includes(name)));
  if(product.length)return `По выбранному продукту:\n\n${product.map(i=>row(i,now)).join('\n\n')}`;
  if(/сводк|ситуац|обзор|сколько.*инцидент|количеств|что сломалось|что происходит/.test(q))return overview();
  return 'Сейчас включён демо-анализ по данным дашборда, без языковой модели. Я могу показать срочные и просроченные инциденты, объяснить карточку по ID, назвать исполнителя или рекомендуемую команду.\n\nНапример: «Что сейчас самое срочное?», «Какие инциденты просрочены?» или вопрос с ID из выбранной карточки. Для свободных вопросов требуется подключение модели.';
}
