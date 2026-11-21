const concepts={classic:{letter:'A',name:'МТС Классика',description:'Светлый фирменный интерфейс'},night:{letter:'B',name:'Ночная смена',description:'Графитовая тема для мониторинга'},focus:{letter:'C',name:'Пульт координатора',description:'Компактная таблица и режим фокуса'},digital:{letter:'D',name:'МТС Digital',description:'Выразительная модульная композиция'}};
Object.assign(concepts,{pulse:{letter:'E',name:'Пульс',description:'Хронология ситуации, очередь внимания и дайджест изменений'},orbit:{letter:'F',name:'Карта ответственности',description:'Продукты и назначенные команды в одной картине'},command:{letter:'G',name:'Командный центр',description:'Очередь, встроенная карточка и быстрые команды'}});
const dialog=document.querySelector('#review'),frame=document.querySelector('#review-frame'),stage=document.querySelector('#review-stage');
let current='pulse',lastTrigger=null,device=matchMedia('(max-width:700px)').matches?'mobile':'desktop';
function sizePreviews(){for(const el of document.querySelectorAll('.preview-viewport')){const scale=el.clientWidth/1380;if(!scale)continue;el.style.setProperty('--preview-scale',scale);el.querySelector('iframe').style.height=Math.max(1000,Math.ceil(el.clientHeight/scale))+'px';}}
const previewsObserver=new ResizeObserver(sizePreviews);document.querySelectorAll('.variants').forEach(el=>previewsObserver.observe(el));sizePreviews();
function setDevice(next){device=next;stage.classList.toggle('mobile',device==='mobile');stage.classList.toggle('desktop-view',device==='desktop'&&matchMedia('(max-width:700px)').matches);document.querySelectorAll('[data-device]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.device===device)));}
function showConcept(key){
  if(!Object.hasOwn(concepts,key))return;current=key;const c=concepts[key];
  document.querySelector('#review-name').textContent=c.name;document.querySelector('#review-letter').textContent=c.letter;document.querySelector('#review-description').textContent=c.description;
  const path='/concept/'+key+'?demo=1';frame.src=path;document.querySelector('#standalone').href=path;
  document.querySelectorAll('[data-switch]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.switch===key)));
  setDevice(device);if(!dialog.open){dialog.showModal();document.body.style.overflow='hidden';}
  history.replaceState(null,'','#'+key);
}
function closeReview(){dialog.close();}
dialog.addEventListener('close',()=>{frame.removeAttribute('src');document.body.style.overflow='';history.replaceState(null,'',location.pathname);lastTrigger?.focus();});
document.addEventListener('click',event=>{
  const open=event.target.closest('[data-open-concept]');if(open){lastTrigger=open;showConcept(open.dataset.openConcept);}
  const change=event.target.closest('[data-switch]');if(change)showConcept(change.dataset.switch);
  const size=event.target.closest('[data-device]');if(size)setDevice(size.dataset.device);
});
document.querySelector('#review-close').addEventListener('click',closeReview);
dialog.addEventListener('click',event=>{if(event.target===dialog)closeReview();});
const initial=location.hash.slice(1);if(Object.hasOwn(concepts,initial))showConcept(initial);
