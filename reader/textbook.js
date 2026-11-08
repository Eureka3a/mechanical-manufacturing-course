/* 教材分屏：左侧课件 / 右侧教材（可拖动、可互换），PDF 用 pdf.js 渲染 */
(() => {
  'use strict';

  const ME = document.currentScript;
  if (!ME) return;
  const SITE = new URL('../', ME.src);
  const PDF_REVISION = 'c3f3213c173762a5';
  const PDF_BYTES = 11230584;            // 构建时注入：PDF 字节数
  const PDF_SHA256 = 'c3f3213c173762a516339dd9869238644976135f3a085956bfc03c71a946fab1';          // 构建时注入：PDF 完整 SHA-256
  const pdfURL = new URL('assets/textbook/mechanical-manufacturing-basics.pdf', SITE);
  pdfURL.searchParams.set('v',PDF_REVISION);
  const PDF_URL = pdfURL.href;
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

  /* ---------------- 教材离线缓存 ----------------
     独立数据库：不和课件的 50 MiB 图片预算互相挤占，只保留当前版本 +
     上一个版本（最多约 22 MiB）。写入前校验字节数与整本 SHA-256。 */
  const CACHE_DB = 'mechanical-course-textbook:' + location.origin;
  const CACHE_STORE = 'pdf';
  const CACHE_MAX = 2;
  const EPOCH_KEY = 'mm:cacheEpoch';
  const CLEAR_CHANNEL = 'mm-cache';
  let cacheEpoch = (() => { try { return parseInt(localStorage.getItem(EPOCH_KEY), 10) || 0; } catch { return 0; } })();
  let cacheAllowed = true;

  function canCache(epoch) {
    let stored = cacheEpoch;
    try { stored = Number(localStorage.getItem(EPOCH_KEY)) || 0; } catch {}
    return cacheAllowed && epoch === cacheEpoch && epoch === stored;
  }

  const sha256hex = async (buffer) => {
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  };

  const tbCache = (() => {
    let opening = null;
    let db = null;
    function open() {
      if (!opening) {
        const at = cacheEpoch;
        opening = new Promise((resolve, reject) => {
          const req = indexedDB.open(CACHE_DB, 1);
          req.onupgradeneeded = () => req.result.createObjectStore(CACHE_STORE, { keyPath: 'rev' });
          req.onerror = req.onblocked = () => reject(req.error || new Error('storage unavailable'));
          req.onsuccess = () => {
            if (!canCache(at)) {
              req.result.close();
              reject(new Error('Cache session cleared'));
              return;
            }
            db = req.result;
            db.onversionchange = () => { db.close(); db = null; opening = null; };
            resolve(db);
          };
        }).catch((error) => { opening = null; throw error; });
      }
      return opening;
    }
    function tx(mode, run) {
      return open().then((database) => new Promise((resolve, reject) => {
        const t = database.transaction(CACHE_STORE, mode);
        const store = t.objectStore(CACHE_STORE);
        let value;
        let failure;
        t.oncomplete = () => resolve(value);
        t.onabort = t.onerror = () => reject(failure || t.error || new Error('transaction aborted'));
        const fail = error => { failure = error; t.abort(); };
        try { run(store, (v) => { value = v; }, fail); } catch (error) { fail(error); }
      }));
    }
    return {
      async get(rev) {
        return tx('readwrite', (s, done, fail) => {
          const r = s.get(rev);
          r.onsuccess = () => {
            const row = r.result;
            try { if (row) s.put({...row,used:Date.now()}); } catch (error) { fail(error); return; }
            done(row || null);
          };
        });
      },
      async put(rev, buffer, sha, at) {
        return tx('readwrite', (s, done, fail) => {
          if (!canCache(at)) { done(false); return; }
          const r = s.getAll();
          r.onsuccess = () => {
            if (!canCache(at)) { done(false); return; }
            const rows = r.result || [];
            const keep = rows.filter(row => row.rev !== rev)
              .sort((a,b) => (b.used || 0) - (a.used || 0)).slice(0,CACHE_MAX-1);
            try {
              rows.filter(row => !keep.includes(row)).forEach(row => s.delete(row.rev));
              s.put({rev,bytes:buffer,size:buffer.byteLength,sha,storedAt:Date.now(),used:Date.now()});
            } catch (error) { fail(error); return; }
            done(true);
          };
        });
      },
      async clear() {
        await tx('readwrite', (s, done) => { s.clear(); done(null); });
      },
      close() {
        try { if (db) db.close(); } catch {}
        db = null;
        opening = null;
      },
    };
  })();

  function forgetCache(epoch) {
    cacheEpoch = Math.max(cacheEpoch, Number(epoch) || 0);
    cacheAllowed = false;      // 清理前就在读的会话不再自动补缓存
    window.__textbookCache = {state:'paused',rev:PDF_REVISION};
    tbCache.close();           // 放开连接，避免清理方删库时被阻塞
  }
  if ('BroadcastChannel' in window) {
    try {
      new BroadcastChannel(CLEAR_CHANNEL).addEventListener('message', (event) => {
        if (event.data && event.data.type === 'cleared') forgetCache(event.data.epoch);
      });
    } catch {}
  }
  window.addEventListener('storage', (event) => {
    if (event.key === EPOCH_KEY) forgetCache(event.newValue);
  });

  /* 复用 PDF.js 已经下载到内存的完整数据，不额外发起整本请求 */
  function cacheWholePdf(proxy, epochAtStart) {
    const run = async () => {
      try {
        if (!canCache(epochAtStart) || !PDF_BYTES) return;
        window.__textbookCache = { state: 'saving', rev: PDF_REVISION };
        if (navigator.storage && navigator.storage.persist) {
          try { await navigator.storage.persist(); } catch {}
        }
        const bytes = await proxy.getData();
        if (!bytes || bytes.byteLength !== PDF_BYTES) throw new Error('size mismatch');
        if (!canCache(epochAtStart)) return;
        const copy = bytes.slice();
        const sha = await sha256hex(copy.buffer);
        if (sha !== PDF_SHA256) throw new Error('checksum mismatch');
        if (!canCache(epochAtStart)) return;
        const saved = await tbCache.put(PDF_REVISION, copy.buffer, sha, epochAtStart);
        if (!saved || !canCache(epochAtStart)) return;
        window.__textbookCache = { state: 'saved', rev: PDF_REVISION, bytes: copy.byteLength };
      } catch (error) {
        if (!canCache(epochAtStart)) return;
        window.__textbookCache = { state: 'failed', error: String((error && error.message) || error) };
      }
    };
    const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1200));
    idle(run, { timeout: 4000 });
  }

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
        <button class="book-btn" id="bookFit" title="适应宽度" aria-label="教材适应宽度"><svg viewBox="0 0 24 24"><path d="M4 5v14M20 5v14M9 8l-4 4 4 4M15 8l4 4-4 4M5 12h14"/></svg></button>
        <a class="book-dl" id="bookDownload" href="${PDF_URL}" download="${BOOK_FILE}" title="下载教材 PDF">
          <svg viewBox="0 0 24 24"><path d="M12 4v10m0 0 4-4m-4 4-4-4M5 18h14"/></svg><span>下载</span>
        </a>
        <button class="book-btn" id="bookClose" title="关闭教材" aria-label="关闭教材">×</button>
      </span>
    </div>
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
  const home = document.querySelector('#bar .course-home');
  home.after(btnBook);

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
    else book.suspend();
  }

  /* ---------------- 拖动 ---------------- */
  let stopDivider = null;
  let multiTouch = false;
  host.addEventListener('touchstart', event => {
    if (event.touches.length < 2) return;
    multiTouch = true;
    stopDivider?.(true);
  }, {capture:true,passive:true});
  host.addEventListener('touchend', event => {
    if (!event.touches.length) multiTouch = false;
  }, {capture:true,passive:true});
  host.addEventListener('touchcancel', () => { multiTouch=false; stopDivider?.(true); }, {capture:true,passive:true});
  splitter.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary || multiTouch) return;
    if (e.target.closest('#btnSwap')) return;
    e.preventDefault();
    splitter.setPointerCapture(e.pointerId);
    splitter.classList.add('dragging');
    const vertical = host.classList.contains('v');
    const originalRatio = ratio;

    const move = (ev) => {
      const r = host.getBoundingClientRect();
      const raw = vertical ? (ev.clientY - r.top) / r.height * 100 : (ev.clientX - r.left) / r.width * 100;
      ratio = Math.round(Math.max(vertical ? 25 : 20, Math.min(80, raw)));
      host.style.setProperty('--split-a', ratio + '%');
    host.style.setProperty('--split-ratio',ratio/100);
      book.rescale();
      refit();
    };
    const up = (cancelled = false) => {
      cancelled = cancelled === true;
      splitter.classList.remove('dragging');
      splitter.removeEventListener('pointermove', move);
      splitter.removeEventListener('pointerup', up);
      splitter.removeEventListener('pointercancel', up);
      stopDivider = null;
      if (splitter.hasPointerCapture(e.pointerId)) splitter.releasePointerCapture(e.pointerId);
      if (cancelled) {
        ratio = originalRatio;
        host.style.setProperty('--split-ratio',ratio/100);
        host.style.setProperty('--split-a',ratio+'%');
        book.rescale();
        refit();
        return;
      }
      ratios[vertical ? 'v' : 'h'] = ratio;
      write(LS.split, JSON.stringify(ratios));
      book.relayout();
    };
    stopDivider = up;
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

  let layoutSize = '';
  const layoutObserver = new ResizeObserver(entries => {
    const rect = entries[0].contentRect;
    const size = Math.round(rect.width) + 'x' + Math.round(rect.height);
    if (size === layoutSize) return;
    layoutSize = size;
    applyLayout();
  });
  layoutObserver.observe(host);

  /* ---------------- 教材阅读器 ---------------- */
  const book = (() => {
    let pdfDoc = null;
    let loading = false;
    let failed = false;
    let total = 0;
    let zoom = Math.min(3.5, Math.max(0.7, parseFloat(read(LS.zoom, '1')) || 1));
    let current = 1;
    let observer = null;
    let revision = 0;
    let pinching = false;
    let lastLayout = '';
    let zoomFrame = 0;
    const tasks = new Map();

    const els = new Map();      // n -> element
    const done = new Map();     // n -> canvas

    const el = (id) => document.getElementById(id);
    const scrollEl = () => el('bookScroll');
    const wrapEl = () => el('bookPages');

    function ensure() {
      if (pdfDoc || loading) {
        if (pdfDoc) { el('bookLoading').hidden = true; observe(); renderPage(current); }
        return;
      }
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
        if (!window.pdfjsLib) await loadScript(PDFJS + 'pdf.min.js');
        if (!window.pdfjsLib) throw new Error('pdf.js 不可用');
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js';

        const cached = cacheAllowed ? await tbCache.get(PDF_REVISION).catch(() => null) : null;
        let offline = null;
        if (cached && cached.bytes && cached.size === PDF_BYTES &&
            cached.bytes.byteLength === PDF_BYTES && cached.sha === PDF_SHA256 &&
            await sha256hex(cached.bytes).catch(() => '') === PDF_SHA256) {
          offline = new Uint8Array(cached.bytes.slice(0));   // 复制一份，pdf.js 会转移这份数据
          window.__textbookCache = { state: 'hit', rev: PDF_REVISION, bytes: cached.size };
        } else {
          window.__textbookCache = { state: 'miss', rev: PDF_REVISION };
        }

        const task = window.pdfjsLib.getDocument(offline ? {data:offline} : {url:PDF_URL});
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
        if (!offline) cacheWholePdf(pdfDoc, cacheEpoch);
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
      return Math.max(120, w);
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
        d.innerHTML = `<div class="ph">${n}</div>`;
        els.set(n, d);
        frag.append(d);
      }
      wrap.append(frag);
      rescale();
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

    const renderQueue = new Set();
    let renderRunning = 0;
    function renderPage(n) {
      if (!els.has(n) || done.has(n) || els.get(n).dataset.busy==='1') return;
      renderQueue.add(n);
      pumpRenders();
    }
    function pumpRenders() {
      if (!open || pinching) return;
      while (renderRunning<2 && renderQueue.size) {
        const n=[...renderQueue].sort((a,b)=>Math.abs(a-current)-Math.abs(b-current))[0];
        renderQueue.delete(n);
        if (Math.abs(n-current)>3) continue;
        renderRunning++;
        paintPage(n).finally(()=>{renderRunning--;pumpRenders();});
      }
    }
    async function paintPage(n) {
      if (!pdfDoc || pinching || done.has(n)) return;
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
        box.querySelectorAll('canvas').forEach(previous => {
          previous.remove(); previous.width=previous.height=0;
        });
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
      // Pixel placeholders retained during pinch are not decoded-cache entries.
      for (const [n, box] of els) {
        if (Math.abs(n-current)<=7 || done.has(n)) continue;
        box.querySelectorAll('canvas').forEach(canvas => {
          canvas.remove(); canvas.width=canvas.height=0;
        });
        box.classList.remove('rendered');
      }
      if (done.size <= 8) return;
      for (const [n, c] of [...done]) {
        if (Math.abs(n - current) > 3) {
          c.remove(); c.width=c.height=0;
          done.delete(n);
          els.get(n)?.classList.remove('rendered');
        }
      }
    }

    function gotoPage(n, instant) {
      motion.stop();
      renderQueue.clear();
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
      if (!total || ticking || pinching) return;
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
          renderQueue.clear();
          tasks.forEach((task,n)=>{if(Math.abs(n-current)>3)task.cancel();});
          trim();
          renderPage(current);renderPage(current+1);
        }
        motion.update(true);
      });
    }

    function position() {
      const scroll = scrollEl();
      let page = 1;
      for (const [n, box] of els) {
        if (box.offsetTop > scroll.scrollTop) break;
        page = n;
      }
      const box = els.get(page);
      return {
        page,
        fraction: box ? (scroll.scrollTop - box.offsetTop) / box.offsetHeight : 0,
        left: scroll.scrollLeft / Math.max(1, pageWidth()),
      };
    }

    function restorePosition(anchor) {
      const box = els.get(anchor.page);
      if (!box) return;
      scrollEl().scrollTop = box.offsetTop + anchor.fraction * box.offsetHeight;
      scrollEl().scrollLeft = anchor.left * pageWidth();
    }

    function rescale() {
      if (!total) return;
      const anchor = pinching ? null : position();
      wrapEl().style.setProperty('--book-page-width', pageWidth() + 'px');
      if (anchor) restorePosition(anchor);
    }

    function relayout(anchor = position(), keepPixels = false) {
      motion.stop();
      renderQueue.clear();
      if (!total || pinching) return;
      const key = pageWidth() + ':' + scrollEl().clientHeight;
      if (key === lastLayout) return;
      lastLayout = key;
      revision++;
      tasks.forEach(task => task.cancel());
      tasks.clear();
      els.forEach(box => box.dataset.busy = '');
      rescale();
      for (const [n, canvas] of done) {
        if (!keepPixels) {
          canvas.remove();
          canvas.width = canvas.height = 0;
          els.get(n)?.classList.remove('rendered');
        }
      }
      done.clear();
      restorePosition(anchor);
      observe();
      requestAnimationFrame(() => {
        renderPage(current);
        renderPage(current + 1);
      });
    }

    function suspend() {
      motion.stop();
      renderQueue.clear();
      revision++;
      tasks.forEach(task => task.cancel());
      tasks.clear();
      els.forEach(box => box.dataset.busy = '');
    }

    function setZoom(next) {
      motion.stop();
      const anchor = position();
      zoom = Math.min(3.5, Math.max(0.7, next));
      write(LS.zoom, zoom);
      relayout(anchor);
    }

    const scroll = scrollEl();
    scroll.style.overflowAnchor = 'none';
    const motion = new BookScrollController(scroll,pane,()=> '第 '+current+' / '+total+' 页');
    let gesture = null;
    let pendingZoom = null;
    function applyPendingZoom() {
      if (!pendingZoom) return;
      const update = pendingZoom;
      pendingZoom = null;
      zoom = update.zoom;
      rescale();
      const box = els.get(gesture.page);
      scroll.scrollLeft = gesture.x*zoom-update.centerX;
      scroll.scrollTop = box.offsetTop+gesture.fraction*box.offsetHeight-update.centerY;
    }
    function beginBookGesture(event) {
      if (!total || !open) return;
      motion.stop();
      if (event.touches.length < 2) {
        if (event.target.closest('#bookScroll') && !gesture) {
          const finger=event.touches[0];
          gesture={mode:'pan',x:finger.clientX,y:finger.clientY,left:scroll.scrollLeft,top:scroll.scrollTop};
          motion.begin();
        }
        return;
      }
      if (![...event.touches].some(touch=>touch.target.closest('#bookScroll'))) return;
      if (event.cancelable) event.preventDefault();
      const [a, b] = event.touches;
      const rect = scroll.getBoundingClientRect();
      pinching = true;
      revision++;
      tasks.forEach(task => task.cancel());
      tasks.clear();
      els.forEach(box => box.dataset.busy = '');
      const centerY=(a.clientY+b.clientY)/2-rect.top;
      const anchorY=scroll.scrollTop+centerY;
      let page=1;
      for (const [n,box] of els) { if (box.offsetTop>anchorY) break; page=n; }
      const box=els.get(page);
      gesture = {
        mode:'pinch', page, fraction:(anchorY-box.offsetTop)/box.offsetHeight,
        distance: Math.max(1, Math.hypot(a.clientX-b.clientX, a.clientY-b.clientY)),
        zoom,
        x: ((a.clientX+b.clientX)/2-rect.left+scroll.scrollLeft)/zoom,
      };
    }
    host.addEventListener('touchstart', beginBookGesture, {capture:true,passive:false});
    host.addEventListener('touchmove', event => {
      if (!gesture) return;
      if (event.cancelable) event.preventDefault();
      if (event.touches.length === 1) {
        applyPendingZoom();
        const finger=event.touches[0];
        if (gesture.mode!=='pan') {
          gesture={mode:'pan',x:finger.clientX,y:finger.clientY,left:scroll.scrollLeft,top:scroll.scrollTop};
          motion.begin();
        }
        scroll.scrollLeft=gesture.left+gesture.x-finger.clientX;
        scroll.scrollTop=gesture.top+gesture.y-finger.clientY;
        motion.sample();
        return;
      }
      if (gesture.mode!=='pinch') beginBookGesture(event);
      const [a, b] = event.touches;
      const rect = scroll.getBoundingClientRect();
      const next = Math.min(3.5, Math.max(.7,
        gesture.zoom*Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY)/gesture.distance));
      cancelAnimationFrame(zoomFrame);
      pendingZoom={zoom:next,centerX:(a.clientX+b.clientX)/2-rect.left,centerY:(a.clientY+b.clientY)/2-rect.top};
      zoomFrame = requestAnimationFrame(applyPendingZoom);
    }, {passive:false});
    function finishPinch(event) {
      if (!gesture || event.touches.length) return;
      cancelAnimationFrame(zoomFrame);
      applyPendingZoom();
      gesture = null;
      const redraw = pinching;
      pinching = false;
      write(LS.zoom,zoom);
      // Canvas pixels are rerendered only after the gesture.
      if (redraw) {
        const anchor=position();
        requestAnimationFrame(()=>{ relayout(anchor,true); onScroll(); });
      } else {
        onScroll();
        if(event.type!=='touchcancel')motion.release();
      }
    }
    host.addEventListener('touchend', finishPinch);
    host.addEventListener('touchcancel', finishPinch);
    el('bookFit').addEventListener('click', () => setZoom(1));

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

    return { ensure, relayout, rescale, gotoPage, step, suspend, get total() { return total; }, get failed() { return failed; } };
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
