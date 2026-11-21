const message=document.getElementById('account-message'),list=document.getElementById('account-list');
async function load(){
  try{
    const response=await fetch('/api/auth/accounts',{credentials:'same-origin',cache:'no-store'}),data=await response.json();
    if(!response.ok)throw new Error(data.error||'Нет доступа к учётным записям.');
    list.replaceChildren();list.hidden=false;message.hidden=data.users.length>0;if(!data.users.length)message.textContent='Пока нет зарегистрированных аккаунтов. Создайте аккаунт через страницу входа.';
    for(const user of data.users){
      const row=document.createElement('div');row.className='member';const identity=document.createElement('div'),name=document.createElement('strong'),login=document.createElement('small');name.textContent=user.displayName;login.textContent=user.username;identity.append(name,login);
      const form=document.createElement('form'),select=document.createElement('select'),button=document.createElement('button');select.setAttribute('aria-label','Роль '+user.username);
      for(const [value,label] of [['coordinator','Аналитик-координатор'],['editor','Редактор']]){const option=document.createElement('option');option.value=value;option.textContent=label;option.selected=user.role===value;select.append(option);}
      button.type='submit';button.textContent='Сохранить';form.append(select,button);row.append(identity,form);list.append(row);
      form.addEventListener('submit',async event=>{event.preventDefault();button.disabled=true;try{const result=await fetch('/api/auth/account-role',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:user.id,role:select.value})}),payload=await result.json();if(!result.ok)throw new Error(payload.error||'Не удалось изменить роль.');message.hidden=false;message.textContent='Права обновлены. Они применятся при следующей проверке сеанса.';}catch(error){message.hidden=false;message.textContent=error.message;}finally{button.disabled=false;}});
    }
  }catch(error){message.hidden=false;message.textContent=error.message;list.hidden=true;}
}
load();
