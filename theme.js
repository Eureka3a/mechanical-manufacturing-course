/* Applied synchronously before styles to avoid a theme flash. */
(()=>{
 const key='mechanical-course:theme';
 function apply(value){document.documentElement.dataset.theme=value==='day'?'day':'night';document.documentElement.style.colorScheme=value==='day'?'light':'dark';}
 try{apply(localStorage.getItem(key));}catch{apply('night');}
 const sun='<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>';
 const moon='<path d="M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10Z"/>';
 function sync(){const b=document.getElementById('btnTheme');if(!b)return;const day=document.documentElement.dataset.theme==='day';b.innerHTML='<svg viewBox="0 0 24 24">'+(day?sun:moon)+'</svg>';b.title=b.ariaLabel=(day?'当前白天模式；切换到夜晚模式':'当前夜晚模式；切换到白天模式');b.setAttribute('aria-pressed',String(day));}
 document.addEventListener('DOMContentLoaded',()=>{sync();document.getElementById('btnTheme')?.addEventListener('click',()=>{const v=document.documentElement.dataset.theme==='day'?'night':'day';apply(v);try{localStorage.setItem(key,v);}catch{}sync();});});
 window.addEventListener('storage',e=>{if(e.key===key){apply(e.newValue);sync();}});
})();

// Resolve against this shared root script, including repository subpaths.
if (location.protocol !== 'file:' && 'serviceWorker' in navigator) {
  const workerURL = new URL('sw.js', document.currentScript.src);
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(workerURL, {updateViaCache:'none'}).catch(()=>{});
  }, {once:true});
}
