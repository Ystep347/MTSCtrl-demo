// Links are derived from deployment settings; raw incident data and its revision
// stay intact. productUrl identifies a product and is never an incident URL.
export function itsmTemplate(value) {
  if (typeof value !== 'string' || value.length > 2048 || /[\s\\<>"']/.test(value)) return null;
  if (!/\{(?:id|sysId)\}/.test(value) || /[{}]/.test(value.replace(/\{(?:id|sysId)\}/g, ''))) return null;
  try {
    const url = new URL(value.replaceAll('{id}', 'INC123').replaceAll('{sysId}', '123'));
    const authority = value.match(/^https:\/\/([^/?#]+)/i)?.[1];
    if (url.protocol !== 'https:' || url.username || url.password || !authority || /[{}]/.test(authority)) return null;
    return value;
  } catch { return null; }
}

export function incidentItsmLink(item, template) {
  const valid = itsmTemplate(template);
  if (!valid || valid.includes('{sysId}') && !item.sysId || valid.includes('{id}') && !item.id) return null;
  return valid.replaceAll('{id}', encodeURIComponent(item.id || '')).replaceAll('{sysId}', encodeURIComponent(item.sysId || ''));
}

export async function attachItsmLinks(dataset, env = {}) {
  const template = itsmTemplate(env.ITSM_INCIDENT_URL_TEMPLATE);
  const incidents = dataset.incidents.map(item => ({...item, itsmUrl: incidentItsmLink(item, template)}));
  // ETag describes the representation, including configured links. The raw
  // revision still serves as the optimistic concurrency guard for imports.
  const suffix = template ? Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(template)))).map(x => x.toString(16).padStart(2, '0')).join('').slice(0, 16) : '';
  return {...dataset, incidents, representationRevision: dataset.revision + (suffix ? '-' + suffix : ''), integrations: {itsm: {configured: Boolean(template)}}};
}
