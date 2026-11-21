// Shared by the password API, browser form and local account administrator.
// An email here is a login identifier, not proof that the mailbox is owned.
export function normalizeLoginIdentifier(value){return typeof value==='string'?value.trim().toLowerCase():'';}
export function loginIdentifierError(value){
  const login=normalizeLoginIdentifier(value);
  if(!login)return 'Введите логин или почту.';
  if(login.includes('@')){
    const parts=login.split('@'),local=parts[0],domain=parts[1]||'';
    const valid=login.length<=254&&parts.length===2&&local.length>0&&local.length<=64&&
      /^[a-z0-9!#$%&'*+/=?^_`{|}~.-]+$/.test(local)&&!local.startsWith('.')&&!local.endsWith('.')&&!local.includes('..')&&
      domain.includes('.')&&domain.split('.').every(label=>label.length<=63&&/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label));
    return valid?'':'Проверьте почту: например, name@example.ru. Пробелы внутри адреса не допускаются.';
  }
  return /^[a-z][a-z0-9._-]{2,31}$/.test(login)?'':'Логин: 3–32 латинских символа, начиная с буквы. Можно цифры, точку, дефис и подчёркивание. Или укажите почту.';
}
export function registrationPasswordError(value){
  if(typeof value!=='string'||value.length<10)return 'Придумайте пароль минимум из 10 символов.';
  return passwordLengthError(value);
}
export function passwordLengthError(value){
  return value.length>72||new TextEncoder().encode(value).length>72?'Пароль слишком длинный. Сократите его.':'';
}
