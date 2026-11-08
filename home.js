(() => {'use strict';const C=window.COURSE,$=id=>document.getElementById(id);const groups=[['ch01'],['ch02a','ch02b'],['ch03'],['ch04'],['ch05'],['ch06'],['ch07'],['ch08'],['ch09']];const covers={ch01:3,ch02a:2,ch03:2,ch06:2};const topics=['机械制造技术概论','金属切削基础','金属切削原理','装夹布局与夹具','机械制造工艺规程的制定','机械加工精度','机械加工表面质量','机械装配工艺基础','先进制造技术'];const chapters=['第一章','第二章','第三章','第四章','第五章','第六章','第七章','第八章','第九章'];
  $('summary').textContent=`9 章 · ${C.total_pages} 页 · 动态演示与视频随页播放`;
  groups.forEach((slugs,i)=>{const decks=slugs.map(s=>C.decks.find(d=>d.slug===s));const card=document.createElement('article');card.className='chapter';const cover=document.createElement('a');cover.className='cover';cover.href=slugs[0]+'/index.html';cover.setAttribute('aria-label','打开'+chapters[i]);const im=new Image();im.src=slugs[0]+'/assets/thumbs/p'+String(covers[slugs[0]]||1).padStart(3,'0')+'.webp';im.alt=chapters[i]+'封面';im.loading='lazy';cover.append(im);const number=document.createElement('span');number.className='number';number.textContent='CHAPTER '+String(i+1).padStart(2,'0');cover.append(number);card.append(cover);const detail=document.createElement('div');detail.className='detail';const title=document.createElement('h3');title.textContent=chapters[i]+' · '+topics[i];const info=document.createElement('p');const count=decks.reduce((a,d)=>a+d.media_occurrences,0);info.textContent=decks.reduce((a,d)=>a+d.pages,0)+' 页'+(count?' · '+count+' 处动态媒体':' · 图文课件')+(decks.some(d=>d.missing_source_media.length)?' · 1 段外链视频缺失':'');detail.append(title,info);const links=document.createElement('div');links.className='open-links';decks.forEach((d,j)=>{const link=document.createElement('a');link.href=d.slug+'/index.html';link.textContent=decks.length>1?(j===0?'上篇':'下篇')+' · '+d.pages+' 页':'打开课件 →';links.append(link);});detail.append(links);card.append(detail);$('chapters').append(card);});
  try{const last=JSON.parse(localStorage.getItem('mechanical-course:last'));const deck=C.decks.find(d=>d.slug===last?.slug);if(deck&&Number.isInteger(last.page)&&last.page>=1&&last.page<=deck.pages){$('resume').hidden=false;$('resume').href=deck.slug+'/index.html#'+last.page;$('resume').textContent='继续阅读 · '+deck.title+' · 第 '+last.page+' 页 →';}}catch{}
  let timer;function search(){const q=$('courseSearch').value.trim().toLocaleLowerCase();const box=$('searchResults');box.replaceChildren();box.hidden=!q;if(!q)return;let count=0;for(const deck of C.decks){for(const page of deck.slides){const text=page.title+'\n'+page.text;const index=text.toLocaleLowerCase().indexOf(q);if(index<0)continue;count++;if(count>60)continue;const a=document.createElement('a');a.className='result';a.href=deck.slug+'/index.html#'+page.n;const meta=document.createElement('small');meta.textContent=deck.title+' / 第 '+page.n+' 页';const title=document.createElement('strong');title.textContent=page.title;const excerpt=document.createElement('p');excerpt.textContent=text.slice(Math.max(0,index-24),index+q.length+90).replace(/\n/g,' ');a.append(meta,title,excerpt);box.append(a);}}const summary=document.createElement('p');summary.className='empty';summary.textContent=count?`找到 ${count} 页${count>60?'，显示前 60 页':''}`:'未找到匹配页面';box.prepend(summary);}
  $('courseSearch').addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(search,100);});

  /* ---------------- 清理缓存 ---------------- */
  const EPOCH_KEY='mm:cacheEpoch';
  const BOOK_DB='mechanical-course-textbook:'+location.origin;
  const btnClear=$('btnClearCache');
  let toastEl=null,toastTimer=0;

  function toast(text){
    if(!toastEl){toastEl=document.createElement('div');toastEl.className='cache-toast';toastEl.setAttribute('role','status');document.body.append(toastEl);}
    toastEl.textContent=text;toastEl.classList.add('show');
    clearTimeout(toastTimer);toastTimer=setTimeout(()=>toastEl.classList.remove('show'),5200);
  }

  function askWorker(message){
    return new Promise(resolve=>{
      if(!('serviceWorker' in navigator))return resolve({ok:false,reason:'no-sw'});
      const timer=setTimeout(()=>resolve({ok:false,reason:'timeout'}),3000);
      navigator.serviceWorker.ready.then(reg=>{
        const target=reg.active||navigator.serviceWorker.controller;
        if(!target){clearTimeout(timer);return resolve({ok:false,reason:'no-sw'});}
        const channel=new MessageChannel();
        channel.port1.onmessage=event=>{clearTimeout(timer);resolve(event.data||{ok:false,reason:'empty'});};
        target.postMessage(message,[channel.port2]);
      }).catch(()=>{clearTimeout(timer);resolve({ok:false,reason:'no-sw'});});
    });
  }

  async function clearTextbook(){
    let exists=true;
    try{
      if(indexedDB.databases){const list=await indexedDB.databases();exists=list.some(db=>db.name===BOOK_DB);}
    }catch{}
    if(!exists)return {ok:true,existed:false};
    return new Promise(resolve=>{
      let req;
      try { req=indexedDB.deleteDatabase(BOOK_DB); }
      catch { resolve({ok:false,existed:true,reason:'error'}); return; }
      req.onsuccess=()=>resolve({ok:true,existed:true});
      req.onerror=()=>resolve({ok:false,existed:true,reason:'error'});
      req.onblocked=()=>resolve({ok:false,existed:true,reason:'blocked'});
    });
  }

  async function clearAll(){
    if(btnClear.disabled)return;
    if(!window.confirm('清理后，下次阅读需要重新下载。阅读进度和设置会保留。'))return;
    btnClear.classList.add('busy');btnClear.setAttribute('aria-busy','true');
    btnClear.disabled=true;
    toast('正在清理…');
    let epoch=Date.now();
    try{epoch=Math.max(epoch,(parseInt(localStorage.getItem(EPOCH_KEY),10)||0)+1);localStorage.setItem(EPOCH_KEY,String(epoch));}catch{}
    // 先通知其它标签页释放数据库连接，再删库
    try{const channel=new BroadcastChannel('mm-cache');channel.postMessage({type:'cleared',epoch});channel.close();}catch{}
    await new Promise(resolve=>setTimeout(resolve,180));

    const worker=await askWorker({type:'clear-cache',epoch});
    const book=await clearTextbook();
    btnClear.classList.remove('busy');btnClear.removeAttribute('aria-busy');
    btnClear.disabled=false;

    const done=[],failed=[];
    if(worker.ok)done.push('课件缓存 '+worker.removed+' 项');else failed.push('课件缓存（'+(worker.reason==='no-sw'?'页面尚未受 Service Worker 控制':worker.reason==='timeout'?'响应超时':'写入失败')+'）');
    if(book.ok)done.push(book.existed?'教材缓存':'教材缓存（本来就是空的）');
    else failed.push('教材缓存（'+(book.reason==='blocked'?'还有标签页正在阅读教材，请关闭后重试':'删除失败')+'）');

    if(!failed.length)toast('已清理：'+done.join('、')+'。阅读进度和设置已保留。');
    else if(done.length)toast('部分清理失败：'+failed.join('、')+'。已清理：'+done.join('、')+'。');
    else toast('清理失败：'+failed.join('、')+'。可以刷新页面后重试。');
  }

  btnClear.addEventListener('click',clearAll);
})();
