import {normalizeLoginIdentifier,loginIdentifierError,registrationPasswordError,passwordLengthError} from '/auth-validation.js';
let registering=false,pending=false;
const element=id=>document.getElementById(id);
const submitLabel=()=>registering?'Создать аккаунт':'Войти';
function clearError(){element('login-error').hidden=true;for(const input of element('password-form').querySelectorAll('[aria-invalid]'))input.removeAttribute('aria-invalid');}
function showError(message,field,focus=true){
  const error=element('login-error');error.textContent=message;error.hidden=false;
  if(field)field.setAttribute('aria-invalid','true');
  if(focus){(field||error).focus();error.scrollIntoView({block:'nearest'});}
}
function updatePasswordError(){
  clearError();
  const password=element('password'),message=passwordLengthError(password.value);
  if(message)showError(message,password,false);
}
function mode(register){
  if(pending)return;registering=register;
  element('login-tab').setAttribute('aria-pressed',String(!register));element('register-tab').setAttribute('aria-pressed',String(register));
  element('display-name-field').hidden=!register;element('display-name').required=register;element('confirm-password-field').hidden=!register;element('confirm-password').required=register;element('password-rules').hidden=!register;element('registration-note').hidden=!register;
  element('password').autocomplete=register?'new-password':'current-password';element('password').minLength=register?10:1;
  element('entry-title').textContent=register?'Создать аккаунт':'Войти в МТС Ctrl';element('entry-description').textContent=register?'Ваш личный вход в командное пространство':'Войдите в аккаунт вашей команды';
  element('login-submit').textContent=submitLabel();updatePasswordError();
}
element('login-tab').addEventListener('click',()=>mode(false));element('register-tab').addEventListener('click',()=>mode(true));
for(const input of element('password-form').querySelectorAll('input'))input.addEventListener('input',updatePasswordError);
for(const button of document.querySelectorAll('[data-password-toggle]'))button.addEventListener('click',()=>{const input=element(button.dataset.passwordToggle),show=input.type==='password';input.type=show?'text':'password';button.setAttribute('aria-pressed',String(show));button.setAttribute('aria-label',(show?'Скрыть':'Показать')+(input.id==='password'?' пароль':' повтор пароля'));});
element('password-form').addEventListener('submit',async event=>{
  event.preventDefault();if(pending)return;clearError();
  const username=normalizeLoginIdentifier(element('username').value),password=element('password').value,displayName=element('display-name').value.trim();
  const identifierError=loginIdentifierError(username);if(identifierError)return showError(identifierError,element('username'));
  if(registering&&(displayName.length<2||displayName.length>80||/[\u0000-\u001f\u007f]/.test(displayName)))return showError('Укажите имя длиной от 2 до 80 символов.',element('display-name'));
  const passwordError=registering?registrationPasswordError(password):!password?'Введите пароль.':passwordLengthError(password);
  if(passwordError)return showError(passwordError,element('password'));
  if(registering&&password!==element('confirm-password').value)return showError('Пароли не совпадают. Введите одинаковый пароль в обоих полях.',element('confirm-password'));
  element('username').value=username;pending=true;element('password-form').setAttribute('aria-busy','true');element('login-submit').disabled=true;element('login-tab').disabled=true;element('register-tab').disabled=true;element('login-submit').textContent=registering?'Создаём аккаунт…':'Входим…';
  try{
    const response=await fetch(registering?'/api/auth/register':'/api/auth/login',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(20000),body:JSON.stringify({username,password,displayName,returnTo:new URL(location.href).searchParams.get('return_to')||'/'})});
    const data=await response.json();if(!response.ok)throw new Error(data.error||'Не удалось выполнить вход.');
    const destination=new URL(data.redirectTo||'/',location.origin);location.assign(destination.origin===location.origin?destination.pathname+destination.search+destination.hash:'/');
  }catch(reason){showError(reason.name==='TimeoutError'?'Сервер не ответил вовремя. Повторите попытку.':reason.message||'Не удалось связаться с сервером.');}
  finally{pending=false;element('password-form').removeAttribute('aria-busy');element('login-submit').disabled=false;element('login-tab').disabled=false;element('register-tab').disabled=false;element('login-submit').textContent=submitLabel();}
});
const story=document.querySelector('.auth-story');
if(matchMedia('(hover: hover) and (prefers-reduced-motion: no-preference)').matches){story.addEventListener('pointermove',event=>{const box=story.getBoundingClientRect();story.style.setProperty('--art-x',((event.clientX-box.left)/box.width-.5)*10+'px');story.style.setProperty('--art-y',((event.clientY-box.top)/box.height-.5)*8+'px');});story.addEventListener('pointerleave',()=>{story.style.setProperty('--art-x','0px');story.style.setProperty('--art-y','0px');});}
mode(new URL(location.href).searchParams.get('mode')==='register');
