/* 教材分屏：左侧课件 / 右侧教材（可拖动、可互换），PDF 用 pdf.js 渲染 */
(() => {
  'use strict';

  const ME = document.currentScript;
  if (!ME) return;
  const SITE = new URL('../', ME.src);
  const PDF_URL = new URL('assets/textbook/mechanical-manufacturing-basics.pdf', SITE).href;
  const PDFJS = new URL('vendor/pdfjs/', SITE).href;
  const BOOK_TITLE = '机械制造技术基础教材';
  const BOOK_FILE = '机械制造技术基础教材.pdf';

  const standalone = document.body.classList.contains('book-only');
  const host = document.getElementById('stageWrap');
  if (!host || document.getElementById('paneBook')) return;

  const LS = {
    split: 'mm:bookSplit', swap: 'mm:bookSwap', page: 'mm:bookPage', zoom: 'mm:bookZoom',
  };
  const read = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } };
  const write = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

  /* ---------------- DOM ---------------- */
  const paneSlides = document.createElement('section');
  paneSlides.id = 'paneSlides';
  paneSlides.className = 'pane';
  while (host.firstChild) paneSlides.append(host.firstChild);
  host.append(paneSlides);
  host.classList.add('has-book');

  const splitter = document.createElement('div');
  splitter.id = 'splitter';
  splitter.hidden = true;
  splitter.setAttribute('role', 'separator');
  splitter.setAttribute('aria-label', '拖动调整两侧宽度');
  splitter.innerHTML = '<button id="btnSwap" title="交换左右" aria-label="交换左右">⇄</button>';

  const pane = document.createElement('section');
  pane.id = 'paneBook';
  pane.className = 'pane';
  pane.hidden = true;
  pane.innerHTML = `
    <div class="book-bar">
      <span class="book-title" title="${BOOK_TITLE}">${BOOK_TITLE}</span>
      <span class="book-pages"><input id="bookPageInput" type="text" inputmode="numeric" value="1" aria-label="教材页码"> / <b id="bookTotal">—</b></span>
      <span class="book-tools">
        <button class="book-btn" id="bookZoomOut" title="缩小" aria-label="缩小">−</button>
        <button class="book-btn" id="bookZoomIn" title="放大" aria-label="放大">+</button>
        <a class="book-dl" id="bookDownload" href="${PDF_URL}" download="${BOOK_FILE}" title="下载教材 PDF">
          <svg viewBox="0 0 24 24"><path d="M12 4v10m0 0 4-4m-4 4-4-4M5 18h14"/></svg><span>下载</span>
        </a>
        <button class="book-btn" id="bookClose" title="关闭教材" aria-label="关闭教材">×</button>
      </span>
    </div>
    <form class="book-search" id="bookSearchForm"><input id="bookQuery" type="search" placeholder="搜索教材文字" aria-label="搜索教材文字"><button class="book-btn" aria-label="查找下一处">查找</button><span id="bookSearchStatus" role="status"></span></form>
    <div class="book-scroll" id="bookScroll"><div class="book-pages-wrap" id="bookPages"></div></div>
    <div class="book-loading" id="bookLoading">
      <div class="ring"></div>
      <p id="bookLoadingText">正在打开教材…</p>
      <div class="bar"><i id="bookBar"></i></div>
    </div>`;

  host.append(splitter, pane);

  const btnBook = document.createElement('button');
  btnBook.className = 'tool';
  btnBook.id = 'btnBook';
  btnBook.title = '与课件并排看教材（B）';
  btnBook.setAttribute('aria-label', '打开教材');
  btnBook.innerHTML =
    '<svg viewBox="0 0 24 24"><path d="M4 5h7v14H4zM13 5h7v14h-7z"/><path d="M11 5v14"/></svg><span>教材</span>';
  const tools = document.querySelector('#bar .tools');
  (tools || document.body).prepend(btnBook);

  /* ---------------- 分屏状态 ---------------- */
  let open = false;
  let swapped = read(LS.swap, '0') === '1';
  let ratios = (() => {
    try { return JSON.parse(read(LS.split, '')) || {}; } catch { return {}; }
  })();

  function isVertical() { return innerWidth <= 900; }
  function ratioFor(vertical) {
    const v = vertical ? ratios.v : ratios.h;
    return Number.isFinite(v) ? Math.min(80, Math.max(20, v)) : (vertical ? 52 : 50);
  }
  let ratio = ratioFor(false);

  function applyLayout() {
    const vertical = open && isVertical();
    host.classList.toggle('standalone', standalone);
    ratio = ratioFor(vertical);
    host.classList.toggle('split', open);
    host.classList.toggle('v', vertical);
    pane.hidden = !open;
    splitter.hidden = !open;
    host.style.setProperty('--split-a', ratio + '%');
    host.style.setProperty('--split-ratio',ratio/100);
    splitter.style.setProperty('--split-a', ratio + '%');
    paneSlides.style.order = swapped ? 3 : 1;
    splitter.style.order = 2;
    pane.style.order = swapped ? 1 : 3;
    btnBook.classList.toggle('on', open);
    if (open) {
      book.relayout();
    }
    refit();
  }

  function refit() {
    if (window.__mmRefit) window.__mmRefit();
  }

  function setOpen(next) {
    if (standalone) next = true;
    if (next === open) return;
    open = next;
    applyLayout();
    if (open) book.ensure();
  }

  /* ---------------- 拖动 ---------------- */
  splitter.addEventListener('pointerdown', (e) => {
    if (e.target.closest('#btnSwap')) return;
    e.preventDefault();
    splitter.setPointerCapture(e.pointerId);
    splitter.classList.add('dragging');
    const vertical = host.classList.contains('v');

    const move = (ev) => {
      const r = host.getBoundingClientRect();
      const raw = vertical ? (ev.clientY - r.top) / r.height * 100 : (ev.clientX - r.left) / r.width * 100;
      ratio = Math.round(Math.max(vertical ? 25 : 20, Math.min(80, raw)));
      host.style.setProperty('--split-a', ratio + '%');
    host.style.setProperty('--split-ratio',ratio/100);
      book.rescale();
      refit();
    };
    const up = () => {
      splitter.classList.remove('dragging');
      splitter.removeEventListener('pointermove', move);
      splitter.removeEventListener('pointerup', up);
      splitter.removeEventListener('pointercancel', up);
      ratios[vertical ? 'v' : 'h'] = ratio;
      write(LS.split, JSON.stringify(ratios));
      book.relayout();
    };
    splitter.addEventListener('pointermove', move);
    splitter.addEventListener('pointerup', up);
    splitter.addEventListener('pointercancel', up);
  });

  splitter.addEventListener('dblclick', () => {
    const vertical = host.classList.contains('v');
    ratio = 50;
    host.style.setProperty('--split-a', ratio + '%');
    host.style.setProperty('--split-ratio',ratio/100);
    ratios[vertical ? 'v' : 'h'] = ratio;
    write(LS.split, JSON.stringify(ratios));
    book.relayout();
    refit();
  });

  document.getElementById('btnSwap').addEventListener('click', (e) => {
    e.stopPropagation();
    swapped = !swapped;
    write(LS.swap, swapped ? '1' : '0');
    applyLayout();
  });

  btnBook.addEventListener('click', () => setOpen(!open));
  document.getElementById('bookClose').addEventListener('click', () => {
    setOpen(false);
    btnBook.focus();
  });

  const layoutObserver = new ResizeObserver(() => applyLayout());
  layoutObserver.observe(host);

  /* ---------------- 教材阅读器 ---------------- */
  const book = (() => {
    let pdfDoc = null;
    let loading = false;
    let failed = false;
    let total = 0;
    let zoom = Math.min(2.4, Math.max(0.7, parseFloat(read(LS.zoom, '1')) || 1));
    let current = 1;
    let observer = null;
    let revision = 0;
    let searchRevision = 0;
    const tasks = new Map();
    const text = new Map();

    const els = new Map();      // n -> element
    const done = new Map();     // n -> canvas

    const el = (id) => document.getElementById(id);
    const scrollEl = () => el('bookScroll');
    const wrapEl = () => el('bookPages');

    function ensure() {
      if (pdfDoc || loading) { if (pdfDoc) el('bookLoading').hidden = true; return; }
      load();
    }

    function loadScript(src) {
      return new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = src; s.async = true;
        s.onload = res; s.onerror = () => rej(new Error('pdf.js 载入失败'));
        document.head.append(s);
      });
    }

    async function load() {
      loading = true;
      el('bookLoading').hidden = false;
      el('bookLoadingText').textContent = '正在打开教材…';
      try {
        await loadScript(PDFJS + 'pdf.min.js');
        if (!window.pdfjsLib) throw new Error('pdf.js 不可用');
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js';

        const task = window.pdfjsLib.getDocument({url:PDF_URL,disableStream:true,disableAutoFetch:true,rangeChunkSize:65536});
        task.onProgress = (p) => {
          if (p && p.total) {
            const pct = Math.min(100, Math.round(p.loaded / p.total * 100));
            el('bookBar').style.width = pct + '%';
            el('bookLoadingText').textContent = `正在载入教材 ${pct}%`;
          }
        };
        pdfDoc = await task.promise;
        total = pdfDoc.numPages;
        el('bookTotal').textContent = total;
        el('bookLoadingText').textContent = '正在排版…';
        build();
        el('bookLoading').hidden = true;
        failed = false;
        pane.querySelectorAll('.book-err').forEach(box => box.remove());
        const saved = parseInt(read(LS.page, '1'), 10);
        gotoPage(saved > 0 && saved <= total ? saved : 1, true);
      } catch (err) {
        failed = true;
        showError(err);
      } finally {
        loading = false;
      }
    }

    function showError(err) {
      el('bookLoading').hidden = true;
      pane.querySelectorAll('.book-err').forEach(box => box.remove());
      const box = document.createElement('div');
      box.className = 'book-err';
      box.innerHTML =
        `<div>教材没能加载。</div>` +
        `<div style="font-size:12px;opacity:.7;margin-top:6px">${String(err && err.message || err)}</div>` +
        `<div style="margin-top:14px"><a href="${PDF_URL}" download="${BOOK_FILE}">直接下载 PDF</a> 或用浏览器打开</div>`;
      pane.append(box);
    }

    function baseWidth() {
      const w = scrollEl().clientWidth - 24;
      return Math.max(220, w);
    }

    function pageWidth() { return Math.round(baseWidth() * zoom); }

    function build() {
      const wrap = wrapEl();
      wrap.replaceChildren();
      els.clear();
      const frag = document.createDocumentFragment();
      for (let n = 1; n <= total; n++) {
        const d = document.createElement('div');
        d.className = 'book-page';
        d.dataset.n = String(n);
        d.style.width = pageWidth() + 'px';
        d.innerHTML = `<div class="ph">${n}</div>`;
        els.set(n, d);
        frag.append(d);
      }
      wrap.append(frag);
      observe();
    }

    function observe() {
      if (observer) observer.disconnect();
      observer = new IntersectionObserver((entries) => {
        for (const en of entries) {
          if (!en.isIntersecting) continue;
          const n = Number(en.target.dataset.n);
          renderPage(n);
        }
        trim();
      }, { root: scrollEl(), rootMargin: '900px 0px' });
      els.forEach((d) => observer.observe(d));
    }

    async function renderPage(n) {
      if (!pdfDoc || done.has(n)) return;
      const box = els.get(n);
      if (!box || box.dataset.busy === '1') return;
      box.dataset.busy = '1';
      const version = revision;
      try {
        const page = await pdfDoc.getPage(n);
        if(version !== revision || !open) return;
        const base = page.getViewport({ scale: 1 });
        box.style.aspectRatio = base.width + '/' + base.height;
        const cssW = box.clientWidth || 600;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const vp = page.getViewport({ scale: (cssW * dpr) / base.width });
        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(vp.width);
        canvas.height = Math.floor(vp.height);
        const ctx = canvas.getContext('2d', { alpha: false });
        const task = page.render({canvasContext:ctx,viewport:vp});
        tasks.set(n,task);
        await task.promise;
        if(version !== revision || !open) { canvas.width=canvas.height=0; return; }
        box.append(canvas);
        box.classList.add('rendered');
        done.set(n, canvas);
        trim();
      } catch (_) {
        /* 单页失败不影响其它页 */
      }
      if(version === revision) { box.dataset.busy = ''; tasks.delete(n); }
    }

    function trim() {
      if (done.size <= 10) return;
      for (const [n, c] of [...done]) {
        if (Math.abs(n - current) > 7) {
          c.remove(); c.width=c.height=0;
          done.delete(n);
          els.get(n)?.classList.remove('rendered');
        }
      }
    }

    function gotoPage(n, instant) {
      n = Math.max(1, Math.min(total || 1, n | 0));
      const box = els.get(n);
      if (!box) return;
      current = n;
      el('bookPageInput').value = n;
      write(LS.page, n);
      scrollEl().scrollTo({top:Math.max(0,box.offsetTop),behavior:'auto'});
      renderPage(n);
      renderPage(n + 1);
      trim();
    }

    function step(delta) {
      if (!total) return;
      if (current + delta > total) return;
      gotoPage(current + delta);
    }

    let ticking = false;
    function onScroll() {
      if (!total || ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        const top = scrollEl().scrollTop + 60;
        let best = 1, bestD = Infinity;
        for (const [n, box] of els) {
          const d = Math.abs(box.offsetTop - top);
          if (d < bestD) { bestD = d; best = n; }
        }
        if (best !== current) {
          current = best;
          el('bookPageInput').value = best;
          write(LS.page, best);
          trim();
        }
      });
    }

    function rescale() {
      if (!total) return;
      const w = pageWidth();
      for (const box of els.values()) box.style.width = w + 'px';
    }

    function relayout() {
      if (!total) return;
      revision++;
      tasks.forEach(task => task.cancel()); tasks.clear();
      els.forEach(box => box.dataset.busy='');
      rescale();
      for (const [n, c] of [...done]) {
        c.remove(); c.width=c.height=0;
        done.delete(n);
        els.get(n)?.classList.remove('rendered');
      }
      scrollEl().scrollTop=els.get(current).offsetTop;
      observe();
      requestAnimationFrame(() => {
        renderPage(current);
        renderPage(current + 1);
      });
    }

    function setZoom(next) {
      zoom = Math.min(2.4, Math.max(0.7, next));
      write(LS.zoom, zoom);
      relayout();
    }

    el('bookScroll').addEventListener('scroll', onScroll, { passive: true });
    el('bookZoomIn').addEventListener('click', () => setZoom(zoom * 1.2));
    el('bookZoomOut').addEventListener('click', () => setZoom(zoom / 1.2));
    el('bookPageInput').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const n = parseInt(e.target.value, 10);
      if (n > 0) gotoPage(n);
      e.target.blur();
    });
    el('bookPageInput').addEventListener('blur', (e) => {
      e.target.value = current;
    });
    pane.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if(e.target.matches('input')) return;
      if (e.key === 'PageDown') { e.preventDefault(); step(1); }
      if (e.key === 'PageUp') { e.preventDefault(); step(-1); }
    });

    const normalize=value=>value.replace(/\s+/g,'').toLowerCase();
    el('bookQuery').addEventListener('input',()=>{searchRevision++;el('bookSearchStatus').textContent='';});
    el('bookSearchForm').addEventListener('submit',async event=>{
      event.preventDefault();
      if(!pdfDoc) return;
      const query=normalize(el('bookQuery').value);
      if(!query) return;
      const token=++searchRevision;
      const start=current;
      el('bookSearchStatus').textContent='正在查找…';
      try {
        for(let offset=1;offset<=total;offset++) {
          if(token!==searchRevision || !open) return;
          const n=(start-1+offset)%total+1;
          if(!text.has(n)) {
            const page=await pdfDoc.getPage(n);
            const content=await page.getTextContent();
            text.set(n,normalize(content.items.map(item=>item.str).join('')));
          }
          if(token!==searchRevision) return;
          if(text.get(n).includes(query)) {
            gotoPage(n,true);
            el('bookSearchStatus').textContent='命中第 '+n+' 页';
            return;
          }
          await new Promise(resolve=>setTimeout(resolve,0));
        }
        el('bookSearchStatus').textContent='未找到';
      } catch {el('bookSearchStatus').textContent='搜索失败，可重试';}
    });

    return { ensure, relayout, rescale, gotoPage, step, get total() { return total; }, get failed() { return failed; } };
  })();

  /* ---------------- 启动 ---------------- */
  applyLayout();

  const params = new URLSearchParams(location.search);
  if (standalone || params.get('book') === '1') {
    setOpen(true);
  }

  // 键盘：B 开关教材
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'b' && e.key !== 'B') return;
    if (/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) return;
    setOpen(!open);
  });
})();
