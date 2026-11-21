let registering=false,pending=false;
const element=id=>document.getElementById(id);
const passwordInput=element('password'),error=element('login-error');
const tooLongMessage='Пароль слишком длинный. Сократите его.';
const passwordEncoder=new TextEncoder();
function checkPasswordLength(){
  const value=passwordInput.value;
  const tooLong=value.length>72||passwordEncoder.encode(value).length>72;
  if(tooLong){
    if(error.textContent!==tooLongMessage)error.textContent=tooLongMessage;
    error.hidden=false;
  }else if(error.textContent===tooLongMessage){
    error.hidden=true;
  }
  return !tooLong;
}
function mode(register){
  if(pending)return;registering=register;
  element('login-tab').setAttribute('aria-pressed',String(!register));element('register-tab').setAttribute('aria-pressed',String(register));
  element('display-name-field').hidden=!register;element('display-name').required=register;element('confirm-password-field').hidden=!register;element('confirm-password').required=register;element('password-rules').hidden=!register;
  passwordInput.autocomplete=register?'new-password':'current-password';passwordInput.minLength=register?10:1;element('login-submit').textContent=register?'Создать аккаунт':'Войти в Фокус';error.hidden=true;checkPasswordLength();
}
element('login-tab').addEventListener('click',()=>mode(false));element('register-tab').addEventListener('click',()=>mode(true));
passwordInput.addEventListener('input',checkPasswordLength);
element('password-form').addEventListener('submit',async event=>{
  event.preventDefault();if(pending)return;
  error.hidden=true;
  const password=passwordInput.value;
  if(!checkPasswordLength())return;
  if(registering&&password!==element('confirm-password').value){error.textContent='Пароли не совпадают.';error.hidden=false;return;}
  pending=true;element('login-submit').disabled=true;element('login-submit').textContent=registering?'Создаём аккаунт…':'Входим…';
  try{
    const response=await fetch(registering?'/api/auth/register':'/api/auth/login',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(20000),body:JSON.stringify({username:element('username').value,password,displayName:element('display-name').value,returnTo:new URL(location.href).searchParams.get('return_to')||'/'})});
    const data=await response.json();if(!response.ok)throw new Error(data.error||'Не удалось выполнить вход.');
    const destination=new URL(data.redirectTo||'/',location.origin);location.assign(destination.origin===location.origin?destination.pathname+destination.search+destination.hash:'/');
  }catch(reason){error.textContent=reason.name==='TimeoutError'?'Сервер не ответил вовремя. Повторите попытку.':reason.message||'Не удалось связаться с сервером.';error.hidden=false;}
  finally{pending=false;element('login-submit').disabled=false;element('login-submit').textContent=registering?'Создать аккаунт':'Войти в Фокус';}
});
mode(new URL(location.href).searchParams.get('mode')==='register');
