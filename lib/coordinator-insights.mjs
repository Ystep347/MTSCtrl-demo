import {isActiveIncident,isFinishedIncident,INCIDENT_COORDINATORS} from './incidents.mjs';

const missingTeam=i=>!i.team?.trim()||i.team==='Команда не назначена';
const missingAssignee=i=>!i.assignee?.trim()||i.assignee==='Исполнитель не назначен';
const noDeadline=i=>!Number.isFinite(i.dueAt);

// These are checks of the current card, not a prediction or a model answer.
// No update-age rule: the export has no reliable last-change timestamp.
export function coordinatorAdvice(i,now=Date.now()){
  const active=isActiveIncident(i),finished=isFinishedIncident(i),research=i.status==='investigating';
  const coordinator=i.team===INCIDENT_COORDINATORS;
  const overdue=active&&!noDeadline(i)&&i.dueAt<now;
  const soon=active&&!noDeadline(i)&&i.dueAt>=now&&i.dueAt-now<=15*60000;
  const checks=[];
  if(!finished){
    if(missingTeam(i))checks.push({code:'team',label:'Нет команды',kind:'missing',reason:'В карточке не указана команда назначения.'});
    else if(coordinator)checks.push({code:'routing',label:'Уточнить передачу',kind:'coordination',reason:research?'Исследование остаётся на координаторах; сервис уже восстановлен.':'Инцидент назначен координаторам, профильную команду нужно определить.'});
    if(missingAssignee(i))checks.push({code:'assignee',label:'Нет исполнителя',kind:'missing',reason:'В карточке не указан исполнитель.'});
    if(active&&noDeadline(i))checks.push({code:'deadline',label:'Нет срока',kind:'missing',reason:'Срок восстановления не указан. Это нехватка данных, а не просрочка.'});
    if(research)checks.push({code:'research',label:'Разбор причин',kind:'follow-up',reason:'Сервис восстановлен; исследование причин ещё не завершено.'});
  }
  let action,reason;
  if(finished){action='Проверить зафиксированное решение перед использованием в похожем случае.';reason='Карточка завершена; активный контроль восстановления не требуется.';}
  else if(missingTeam(i)){action=research?'Определить владельца исследования и согласовать передачу материалов.':'Определить владельца сервиса и согласовать назначение профильной команды.';reason='Команда назначения отсутствует; название подходящей команды нельзя вывести из этой выгрузки.';}
  else if(coordinator){action=research?'Уточнить владельца продукта и передать материалы исследования профильной команде.':'Уточнить владельца продукта и согласовать передачу профильной команде.';reason=research?'Исследование назначено координаторам. Сервис восстановлен, требуется разбор причин.':'Текущая команда — координаторы. Справочник владельцев продуктов не подключён.';}
  else if(research){action='Запросить у назначенной команды результат разбора причин и оставшиеся действия.';reason='Сервис восстановлен, но исследование продолжается; срок восстановления здесь не оценивается.';}
  else if(i.priority==='critical'){action='Связаться с назначенной командой и согласовать ближайшее обновление по восстановлению.';reason='Активный инцидент имеет критический приоритет.'+(noDeadline(i)?' Дополнительно нужно уточнить срок.':overdue?' Срок восстановления уже нарушен.':'');}
  else if(overdue){action='Запросить прогресс у назначенной команды и оценить необходимость эскалации.';reason='Активный инцидент имеет срок восстановления раньше текущего времени.';}
  else if(noDeadline(i)){action='Уточнить срок восстановления у назначенной команды.';reason='В карточке нет срока; длительность просрочки определить нельзя.';}
  else if(soon){action='Запросить статус и подтвердить, успевает ли команда к сроку.';reason='До срока восстановления осталось не более 15 минут.';}
  else if(missingAssignee(i)){action='Уточнить ответственного исполнителя у назначенной команды.';reason='Команда указана, исполнитель в карточке отсутствует.';}
  else{action='Продолжать контроль статуса и срока назначенной команды.';reason='В карточке есть команда, исполнитель и срок; дополнительных оснований для эскалации по этим правилам нет.';}
  return {action,reason,checks,active,overdue,soon,mode:'rules'};
}

export function coordinationChecks(items,now=Date.now()){
  return items.map(incident=>({incident,...coordinatorAdvice(incident,now)}))
    .filter(row=>row.checks.length)
    .sort((a,b)=>Number(b.active&&b.incident.priority==='critical')-Number(a.active&&a.incident.priority==='critical')||Number(b.active)-Number(a.active)||Number(b.overdue)-Number(a.overdue)||b.checks.length-a.checks.length||a.incident.id.localeCompare(b.incident.id));
}
