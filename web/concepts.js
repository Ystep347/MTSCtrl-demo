// Optional presentation layer for /concept/* only. The main dashboard is unchanged.
const root=document.documentElement;
const query=new URLSearchParams(location.search);
root.dataset.thumbnail=query.get('thumbnail')==='1'?'true':'false';
const focusButton=document.querySelector('#concept-focus');
const updateFocus=()=>{const on=root.dataset.quiet==='true';focusButton.setAttribute('aria-pressed',String(on));focusButton.textContent=on?'Вернуть панели':'Режим фокуса';};
focusButton.addEventListener('click',()=>{root.dataset.quiet=root.dataset.quiet==='true'?'false':'true';updateFocus();});updateFocus();
// The ordinary demo handler changes the current tab only, never shared records.
let initialized=false;
const prepare=()=>{
  if(initialized||!document.querySelector('#data-status strong')?.textContent.includes('инцидент'))return;
  initialized=true;observer.disconnect();
  if(root.dataset.design==='focus')document.querySelector('[data-layout="table"]')?.click();
  if(query.get('demo')==='1')document.querySelector('#concept-critical')?.click();
};
const observer=new MutationObserver(prepare);observer.observe(document.querySelector('#data-status'),{childList:true,subtree:true});prepare();
document.querySelector('#concept-guide').addEventListener('click',()=>document.querySelector('#about-button').click());

