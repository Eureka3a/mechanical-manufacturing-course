/* 机械制造技术 — DeepSeek 阅读界面，支持分层视频媒体
   背景页为 LibreOffice 渲染的静态画面，动图按原始坐标叠加在页面上播放。 */
(() => {
  'use strict';

  const D = window.DECK;
  const S = D.slides;
  const N = S.length;
  const $ = (id) => document.getElementById(id);

  const stage = $('stage');
  const wrap = $('stageWrap');
  const buffer = new PageBuffer(S);
  const feedback = $('loadFeedback');
  let direction = 1;
  const ovl = $('ovl');
  const caps = $('caps');
  const badge = $('gifBadge');
  const counter = $('counter');
  const progress = document.querySelector('#progress i');

  let cur = -1;
  let searchIndex = null;
  let toastTimer = 0;
  let generation = 0;
  let overlayFocus = null;
  const storageKey = `reader:${D.id}:page`;
  const mediaOf = s => s.media || s.gifs || [];

  function releaseMedia() {
    ovl.querySelectorAll('video').forEach(v => {v.pause();v.removeAttribute('src');v.load();});
    ovl.replaceChildren();
  }

  function addMedia(m, version) {
    const box = document.createElement('div');
    box.className = 'media-item';
    box.style.cssText = `left:${m.x}%;top:${m.y}%;width:${m.w}%;height:${m.h}%;`;
    if(m.kind==='unavailable'){
      box.classList.add('media-unavailable');const note=document.createElement('span');note.textContent='视频未随课件提供';box.append(note);box.title=m.label;ovl.append(box);return;
    }
    if (!m.kind || m.format==='gif' || m.format==='webp') {
      const image = new Image(); image.src=m.src; image.alt='动态演示';
      image.style.cssText='position:static;width:100%;height:100%';box.append(image);
    } else {
      const video=document.createElement('video');video.src=m.src;video.poster=m.poster;
      video.playsInline=true;video.preload='metadata';
      video.setAttribute('aria-label',m.kind==='animation'?'切屑形成动态演示':'课件视频');
      if(m.kind==='animation'){video.muted=true;video.autoplay=true;video.loop=true;}
      else video.controls=true;
      box.append(video);
      video.addEventListener('error',()=>{if(version===generation)toast('媒体未能载入，请检查文件是否完整');});
      if(m.kind==='animation'){
        const play=document.createElement('button');play.className='play-fallback';play.textContent='▶ 播放动态演示';play.hidden=true;box.append(play);
        const attempt=()=>video.play().then(()=>play.hidden=true).catch(()=>{if(version===generation)play.hidden=false;});
        play.addEventListener('click',attempt);attempt();
      }
    }
    if(m.fit){const child=box.querySelector('video,img');if(child)child.style.objectFit=m.fit;}
    if(m.radius)box.style.borderRadius=`${m.radius}%`;
    if(m.rotation || m.flipH || m.flipV)box.style.transform=`rotate(${m.rotation||0}deg) scale(${m.flipH?-1:1},${m.flipV?-1:1})`;
    if(m.crop){
      const c=m.crop,w=1-c.left-c.right,h=1-c.top-c.bottom,child=box.querySelector('video,img');
      if(w>0&&h>0&&child)Object.assign(child.style,{position:'absolute',width:`${100/w}%`,height:`${100/h}%`,left:`${-c.left/w*100}%`,top:`${-c.top/h*100}%`});
    }
    ovl.append(box);
  }

  let zoom=1, panX=0, panY=0, suppressClick=0;
  function transform(){
    const host = stage.parentElement || wrap;
    const cs=getComputedStyle(host);
    const aw=host.clientWidth-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight);
    const ah=host.clientHeight-parseFloat(cs.paddingTop)-parseFloat(cs.paddingBottom);
    const bx=Math.max(0,(stage.offsetWidth*zoom-aw)/2),by=Math.max(0,(stage.offsetHeight*zoom-ah)/2);
    panX=Math.max(-bx,Math.min(bx,panX));panY=Math.max(-by,Math.min(by,panY));
    stage.style.transform=`translate(${panX}px,${panY}px) scale(${zoom})`;
  }
  function resetView(){zoom=1;panX=panY=0;transform();}
  $('btnFit').addEventListener('click',resetView);
  /* ---------------- layout ---------------- */
  function fit() {
    const host = stage.parentElement || wrap;
    const cs = getComputedStyle(host);
    const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const aspect = D.width / D.height;
    const availW = host.clientWidth - padX;
    const availH = host.clientHeight - padY;
    const w = Math.max(1, Math.min(availW, availH * aspect));
    const h = w / aspect;
    stage.style.width = Math.floor(w) + 'px';
    stage.style.height = Math.floor(h) + 'px';
    transform();
  }

  /* ---------------- rendering ---------------- */
  function render(i, opts = {}) {
    i = Math.max(0, Math.min(N - 1, i));
    if (i === cur && !opts.force) return;
    if (cur >= 0 && i !== cur) direction = Math.sign(i-cur);
    cur = i;
    resetView();
    const s = S[i];

    const version = ++generation;
    const signal = buffer.target(i, direction);
    releaseMedia();
    caps.replaceChildren();
    const placeholder = new Image();
    placeholder.id = 'slideImg';
    placeholder.draggable = false;
    placeholder.fetchPriority = 'low';
    placeholder.alt = `第 ${s.n} 页：${s.title}`;
    if (!buffer.entries.get(i)?.images) placeholder.src = s.thumb;
    $('slideImg').replaceWith(placeholder);
    showPage(i, version, signal);

    if (mediaOf(s).length) {
      badge.hidden = false;
      badge.textContent = mediaOf(s).some(m=>m.kind==='unavailable') ? '有资源缺失' : (mediaOf(s).some(m=>m.kind==='animation'||!m.kind) ? '动态演示' : '含视频');
    } else {
      badge.hidden = true;
    }

    $('pageInput').value = i+1;
    $('pageTotal').textContent=N;
    document.title=`${i+1} / ${N} · ${D.chapter||'课件'} · ${D.title}`;
    progress.style.width = `${((i + 1) / N) * 100}%`;
    $('btnPrev').disabled = i === 0;
    $('btnNext').disabled = i === N - 1;
    $('btnPrev').style.opacity = i === 0 ? 0.35 : 1;
    $('btnNext').style.opacity = i === N - 1 ? 0.35 : 1;

    if (!opts.fromHash && location.hash !== `#${i + 1}`) {
      history.replaceState(null, '', `#${i + 1}`);
    }
    if (!$('notes').hidden) fillNotes();
    try {localStorage.setItem(storageKey,String(i+1));} catch {}
    try {localStorage.setItem('mechanical-course:last',JSON.stringify({slug:D.slug,page:i+1,title:D.chapter}));}catch{}
    document.querySelectorAll('#gridBody figure').forEach(f=>f.classList.toggle('cur',+f.dataset.i===i));

  }

  function loadState(state, message) {
    stage.dataset.loadState = state;
    stage.setAttribute('aria-busy', String(state==='loading'));
    feedback.hidden = state==='ready';
    $('loadMessage').textContent = message;
    $('retryPage').hidden = state!=='error';
  }

  async function showPage(index, version, signal) {
    const slide = S[index];
    const start = performance.now();
    const hit = buffer.entries.has(index);
    loadState('loading', '正在加载第 '+slide.n+' 页…');
    for (let attempt=1; attempt<=3; attempt++) {
      if (signal.aborted || version!==generation) return;
      let entry;
      try {
        entry = await buffer.read(index, signal, true, true);
      } catch {
        if (signal.aborted || version!==generation) return;
        stage.dataset.attempt = attempt;
        if (attempt===3) {
          loadState('error','第 '+slide.n+' 页加载失败');
          return;
        }
        loadState('loading','第 '+slide.n+' 页加载失败，正在重试…');
        await new Promise(resolve=>setTimeout(resolve,400 * 2**(attempt-1)));
        continue;
      }
      if (signal.aborted || version!==generation) return;
      const [base,...annotations] = entry.images;
      base.id='slideImg';
      base.draggable=false;
      base.alt=$('slideImg').alt;
      $('slideImg').replaceWith(base);
      annotations.forEach((image,j)=>{
        const c=slide.caps[j];
        image.alt='';
        Object.assign(image.style,{left:c.x+'%',top:c.y+'%',width:c.w+'%',height:c.h+'%',objectFit:'fill'});
      });
      caps.replaceChildren(...annotations);
      for (const media of mediaOf(slide)) addMedia(media,version);
      Object.assign(stage.dataset,{page:slide.n,bufferHit:hit,attempt,loadMs:Math.round(performance.now()-start)});
      loadState('ready','');
      buffer.warm(signal,()=>Array.from(ovl.querySelectorAll('video')).some(v=>!v.paused));
      return;
    }
  }

  $('retryPage').addEventListener('click',e=>{
    e.stopPropagation();
    render(cur,{force:true});
  });

  function go(delta) {
    const next = Math.max(0, Math.min(N - 1, cur + delta));
    if (next !== cur) render(next);
  }

  /* ---------------- overlays ---------------- */
  function openOverlay(id) {
    overlayFocus=document.activeElement;
    closeOverlays();
    $(id).hidden = false;
    document.body.dataset.overlay = id;
    syncTools();
    if(id==='grid')requestAnimationFrame(()=>{const active=$('gridBody').querySelector('.cur');active?.focus();active?.scrollIntoView({block:'nearest'});});
  }
  function closeOverlays() {
    const wasOpen=!!document.body.dataset.overlay;
    for (const id of ['grid', 'search']) {
      const el = $(id);
      if (el && !el.hidden) el.hidden = true;
    }
    delete document.body.dataset.overlay;
    syncTools();
    if(wasOpen)overlayFocus?.focus();
  }

  function syncTools() {
    $('btnGrid').classList.toggle('on', !$('grid').hidden);
    $('btnNotes').classList.toggle('on', !$('notes').hidden);
  }

  /* ---------------- grid ---------------- */
  let gridBuilt = false;
  function buildGrid() {
    if (gridBuilt) return;
    gridBuilt = true;
    const body = $('gridBody');
    const frag = document.createDocumentFragment();
    S.forEach((s, i) => {
      const fig = document.createElement('figure');
      fig.dataset.i = i;
      fig.tabIndex=0;fig.setAttribute('role','button');fig.setAttribute('aria-label',`第 ${s.n} 页：${s.title}`);
      fig.innerHTML =
        `<img src="${s.thumb}" alt="" loading="lazy">` +
        `<figcaption>${String(s.n).padStart(2, '0')}</figcaption>` +
        (mediaOf(s).length ? `<span class="gifdot">${mediaOf(s).some(m=>m.kind==='animation'||!m.kind)?'动图':'视频'}</span>` : '');
      fig.addEventListener('click', () => {
        render(i);
        closeOverlays();
      });
      fig.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();fig.click();}});
      frag.appendChild(fig);
    });
    body.appendChild(frag);
    $('gridCount').textContent = `共 ${N} 页`;
  }

  /* ---------------- search ---------------- */
  function ensureIndex() {
    if (searchIndex) return searchIndex;
    searchIndex = S.map((s) => `${s.title}\n${s.text}`.toLowerCase());
    return searchIndex;
  }

  function esc(t) {
    return t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function runSearch(q) {
    const box = $('searchResults');
    q = q.trim();
    if (!q) {
      box.innerHTML = `<p class="empty">输入关键词，检索 ${N} 页课件里的文字。</p>`;
      return;
    }
    const idx = ensureIndex();
    const needle = q.toLowerCase();
    const hits = [];
    for (let i = 0; i < N && hits.length < 60; i++) {
      const pos = idx[i].indexOf(needle);
      if (pos < 0) continue;
      const raw = `${S[i].title}\n${S[i].text}`;
      const start = Math.max(0, pos - 26);
      const snippet = raw.slice(start, pos + needle.length + 70).replace(/\s+/g, ' ');
      const safe = esc(snippet).replace(
        new RegExp(esc(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
        (m) => `<mark>${m}</mark>`
      );
      hits.push({ i, safe });
    }
    if (!hits.length) {
      box.innerHTML = '<p class="empty">没有找到匹配的文字。</p>';
      return;
    }
    box.innerHTML = hits
      .map(
        (h) =>
          `<button data-i="${h.i}"><span class="chip">${h.i + 1}</span>` +
          `<span class="snip">${h.safe}</span></button>`
      )
      .join('');
    box.querySelectorAll('button').forEach((b) =>
      b.addEventListener('click', () => {
        render(+b.dataset.i);
        closeOverlays();
      })
    );
  }

  /* ---------------- notes ---------------- */
  function fillNotes() {
    const s = S[cur];
    $('notesTitle').textContent = s.title || `第 ${s.n} 页`;
    $('notesText').textContent = s.text || '（本页没有可提取的文字）';
    const old = document.querySelector('.notes-gif');
    if (old) old.remove();
    if (mediaOf(s).length) {
      const p = document.createElement('p');
      p.className = 'notes-gif';
      const missing=mediaOf(s).filter(m=>m.kind==='unavailable').length;
      p.textContent = missing ? `本页有 ${missing} 段视频未随原课件提供，暂无法播放；其他已提供的媒体正常显示。` : `本页含 ${mediaOf(s).length} 个动态媒体，请在画面中观看。`;
      $('notesText').after(p);
    }
  }

  /* ---------------- toast ---------------- */
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 1400);
  }

  /* ---------------- events ---------------- */
  $('btnNext').addEventListener('click', () => go(1));
  $('btnPrev').addEventListener('click', () => go(-1));
  $('pageForm').addEventListener('submit',e=>{e.preventDefault();const n=Number($('pageInput').value);if(!Number.isInteger(n)||n<1||n>N){toast(`请输入 1–${N} 的页码`);$('pageInput').value=cur+1;return;}render(n-1);$('pageInput').blur();});
  $('pageInput').addEventListener('focus',e=>e.target.select());

  stage.addEventListener('click', (e) => {
    if (document.body.dataset.overlay || zoom>1.01 || Date.now()<suppressClick) return;
    if(e.target.closest('.media-item'))return;
    const r = stage.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    if (x < 0.34) go(-1);
    else go(1);
  });

  $('btnGrid').addEventListener('click', () => {
    buildGrid();
    if ($('grid').hidden) {
      document.querySelectorAll('#gridBody figure').forEach((f) =>
        f.classList.toggle('cur', +f.dataset.i === cur)
      );
      openOverlay('grid');
    } else closeOverlays();
    syncTools();
  });

  function setNotes(open) {
    $('notes').hidden = !open;
    document.body.classList.toggle('notes-open', open);
    if (open) fillNotes();
    syncTools();
    fit();
  }

  $('btnNotes').addEventListener('click', () => setNotes($('notes').hidden));

  $('btnSearch').addEventListener('click', () => {
    openOverlay('search');
    if (!$('searchResults').children.length) runSearch('');
    $('searchInput').focus();
    $('searchInput').select();
  });

  $('btnFull').addEventListener('click', toggleFull);

  function toggleFull() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.().catch(() => toast('浏览器未允许全屏'));
  }

  document.querySelectorAll('.close').forEach((b) =>
    b.addEventListener('click', () => {
      const p = b.closest('.overlay, .drawer');
      if (p.id === 'notes') setNotes(false);
      else closeOverlays();
    })
  );

  document.querySelectorAll('.overlay').forEach((o) =>
    o.addEventListener('click', (e) => {
      if (e.target === o) closeOverlays();
    })
  );

  let sTimer = 0;
  $('searchInput').addEventListener('input', (e) => {
    clearTimeout(sTimer);
    const v = e.target.value;
    sTimer = setTimeout(() => runSearch(v), 110);
  });
  $('searchInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const first = $('searchResults').querySelector('button');
      if (first) first.click();
    }
  });

  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|VIDEO|SELECT)$/.test(document.activeElement.tagName) || document.activeElement.isContentEditable;
    const overlay = document.body.dataset.overlay;

    if (e.key === 'Escape') {
      if (overlay) closeOverlays();
      else if (!$('notes').hidden) setNotes(false);
      else if (document.fullscreenElement) document.exitFullscreen();
      return;
    }
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (overlay) return;

    switch (e.key) {
      case 'ArrowRight': case 'ArrowDown': case 'PageDown': case ' ': case 'n':
        e.preventDefault(); go(1); break;
      case 'ArrowLeft': case 'ArrowUp': case 'PageUp': case 'p':
        e.preventDefault(); go(-1); break;
      case 'Home': render(0); break;
      case 'End': render(N - 1); break;
      case 'g': case 'G': $('btnGrid').click(); break;
      case 't': case 'T': $('btnNotes').click(); break;
      case 'f': case 'F': toggleFull(); break;
      case '/': e.preventDefault(); $('btnSearch').click(); break;
    }
  });

  let wheelLock = 0;
  stage.addEventListener(
    'wheel',
    (e) => {
      if (document.body.dataset.overlay || zoom>1.01 || e.ctrlKey) return;
      if(e.target.closest('.media-item'))return;
      const now = Date.now();
      if (now - wheelLock < 420) return;
      if (Math.abs(e.deltaY) < 8) return;
      wheelLock = now;
      go(e.deltaY > 0 ? 1 : -1);
    },
    { passive: true }
  );

  let gesture=null;
  const point=t=>({x:t.clientX,y:t.clientY});
  function beginPinch(e){
    const a=point(e.touches[0]),b=point(e.touches[1]),r=stage.getBoundingClientRect();
    const cx=(a.x+b.x)/2,cy=(a.y+b.y)/2;
    gesture={mode:'pinch',distance:Math.hypot(a.x-b.x,a.y-b.y),zoom,
      anchorX:(cx-r.left-r.width/2)/zoom,anchorY:(cy-r.top-r.height/2)/zoom,
      centerX:r.left+r.width/2-panX,centerY:r.top+r.height/2-panY};
  }
  stage.addEventListener('touchstart',e=>{
    if(document.body.dataset.overlay)return;
    if(e.touches.length>=2){e.preventDefault();suppressClick=Date.now()+700;beginPinch(e);return;}
    if(e.target.closest('.media-item') && (zoom<=1.01 || e.target.closest('button') || e.target.closest('.media-item').querySelector('video[controls]'))){gesture=null;return;}
    const p=point(e.touches[0]);gesture={mode:zoom>1.01?'pan':'swipe',x:p.x,y:p.y,px:panX,py:panY};
  },{passive:false});
  stage.addEventListener('touchmove',e=>{
    if(!gesture)return;
    e.preventDefault();suppressClick=Date.now()+700;
    if(e.touches.length>=2){
      if(gesture.mode!=='pinch')beginPinch(e);
      const a=point(e.touches[0]),b=point(e.touches[1]);
      zoom=Math.max(1,Math.min(4,gesture.zoom*Math.hypot(a.x-b.x,a.y-b.y)/Math.max(1,gesture.distance)));
      panX=(a.x+b.x)/2-gesture.centerX-gesture.anchorX*zoom;
      panY=(a.y+b.y)/2-gesture.centerY-gesture.anchorY*zoom;transform();
    }else if(gesture.mode==='pan'){
      panX=gesture.px+e.touches[0].clientX-gesture.x;panY=gesture.py+e.touches[0].clientY-gesture.y;transform();
    }
  },{passive:false});
  stage.addEventListener('touchend',e=>{
    if(!gesture)return;
    const g=gesture;
    if(e.touches.length){gesture={mode:'blocked'};return;}
    gesture=null;
    if(g.mode==='swipe'){
      const t=e.changedTouches[0],dx=t.clientX-g.x,dy=t.clientY-g.y;
      if(Math.abs(dx)>45&&Math.abs(dx)>Math.abs(dy)*1.4){suppressClick=Date.now()+700;go(dx<0?1:-1);}
    }else suppressClick=Date.now()+700;
  },{passive:true});

  window.addEventListener('hashchange', () => {
    const n = parseInt(location.hash.slice(1), 10);
    if (Number.isFinite(n) && n >= 1 && n <= N) render(n - 1, { fromHash: true });
  });

  window.addEventListener('resize', fit);
  window.addEventListener('pagehide',()=>{buffer.stop(); releaseMedia();});
  window.addEventListener('pageshow',e=>{if(e.persisted)render(cur,{force:true});});
  stage.addEventListener('touchcancel',()=>{gesture=null;suppressClick=Date.now()+700;},{passive:true});
  document.addEventListener('keydown',e=>{
    const id=document.body.dataset.overlay;
    if(e.key!=='Tab'||!id)return;
    const items=[...$(id).querySelectorAll('button,input,[tabindex="0"]')];
    if(!items.length)return;
    const first=items[0],last=items[items.length-1];
    if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
    else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
  });

  /* ---------------- boot ---------------- */
  $('deckTitle').textContent = D.title;
  $('deckSub').textContent = D.subtitle || `${D.chapter} · 课件（含动态演示）`;

  fit();
  window.__mmRefit = fit;
  const hash=location.hash.slice(1);
  let start=/^\d+$/.test(hash)?Number(hash):0;
  if(start<1||start>N){try{start=Number(localStorage.getItem(storageKey));}catch{}}
  render(Number.isInteger(start)&&start>=1&&start<=N?start-1:0,{force:true});
})();
