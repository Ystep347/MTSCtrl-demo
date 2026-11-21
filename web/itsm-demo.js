import {projectMtsSimulation} from '/mts-simulation.js';
import {isActiveIncident} from '/incidents.js';

const statuses = {
  working: 'Выполняется',
  assigned: 'Назначен',
  investigating: 'Исследование ситуации',
  resolved: 'Завершён',
  closed: 'Закрыт',
};
const priorities = {critical: 'Критический', high: 'Высокий', medium: 'Средний', low: 'Низкий'};
const formatter = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow',
  dateStyle: 'short',
  timeStyle: 'short',
});
const date = value => Number.isFinite(value) ? formatter.format(value) + ' МСК' : 'Не указан';
const element = id => document.getElementById(id);
const write = (id, value) => { element(id).textContent = value || 'Не указано'; };
const show = id => { element(id).hidden = false; };

function receiveLocalIncident(id, token) {
  const key = 'mts-simpleone-preview:' + token;
  const read = storage => JSON.parse(storage.getItem(key) || 'null');
  try {
    const cached = read(sessionStorage);
    if (cached?.id === id) return cached;
    const item = read(localStorage);
    if (item?.id === id) {
      try {
        sessionStorage.setItem(key, JSON.stringify(item));
        localStorage.removeItem(key);
      } catch { /* The current page can still show the received card. */ }
      return item;
    }
  } catch { /* A disabled store or invalid record leaves no local card. */ }
  throw new Error('Локальная карточка недоступна. Откройте её заново из «МТС Фокус».');
}

function renderIncident(item, source) {
  document.title = item.id + ' · SimpleOne Демо';
  write('incident-id', item.id);
  write('incident-title', item.title);
  write('incident-source', source);
  write('incident-status', statuses[item.status]);
  element('status-badge').dataset.state = item.status;
  write('incident-priority', priorities[item.priority]);
  element('priority-badge').dataset.state = item.priority;
  write('incident-product', item.product);
  write('incident-service', item.service);
  write('incident-created', date(item.createdAt));
  write('incident-deadline', date(item.dueAt));
  write('incident-description', item.description || item.summary);
  write('incident-team', item.team);
  write('incident-assignee', item.assignee);
  if (item.sysId) {
    write('incident-sysid', item.sysId);
    show('sysid-field');
  }
  if (!isActiveIncident(item) && Number.isFinite(item.resolvedAt)) {
    write('incident-recovered', date(item.resolvedAt));
    show('recovered-field');
  }
  if (!isActiveIncident(item) && item.solution) {
    write('incident-solution', item.solution);
    show('resolution');
  }
  for (const id of ['incident-id', 'properties', 'incident-source', 'incident-body']) show(id);
}

const query = new URLSearchParams(location.search);
const fromSource = query.get('dataset') === 'source';
if (fromSource) element('dashboard-link').href = '/?dataset=source';

try {
  const id = query.get('incident');
  if (!id || !/^INC-?\d{1,18}$/.test(id)) throw new Error('Выберите инцидент в «МТС Фокус» и откройте его в SimpleOne.');
  const preview = query.get('preview');
  if (preview) {
    renderIncident(receiveLocalIncident(id, preview), 'Локальная симуляция · снимок на момент перехода');
  } else {
    let snapshot;
    try {
      const response = await fetch('/api/incidents', {cache: 'no-store', signal: AbortSignal.timeout(10000)});
      if (!response.ok) throw new Error();
      snapshot = await response.json();
    } catch (error) {
      throw new Error(error.name === 'TimeoutError'
        ? 'Выгрузка не ответила вовремя. Обновите карточку.'
        : 'Выгрузка недоступна. Обновите карточку.');
    }
    const dataset = fromSource ? snapshot : projectMtsSimulation(snapshot);
    const item = dataset.incidents.find(row => row.id === id);
    if (!item) throw new Error('Инцидент отсутствует в текущей выгрузке. Выберите другую карточку в «МТС Фокус».');
    const source = fromSource ? 'Исходная выгрузка' : 'Симуляция МТС';
    renderIncident(item, source + (snapshot.sourceWarning ? ' · сохранённая версия' : ''));
  }
} catch (error) {
  write('error', error.message);
  show('error');
} finally {
  element('loading').hidden = true;
  element('record').setAttribute('aria-busy', 'false');
}
