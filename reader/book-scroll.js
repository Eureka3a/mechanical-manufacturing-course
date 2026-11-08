/* Scoped textbook momentum and an optional overlay scrollbar. */
class BookScrollController {
  constructor(scroll, pane, pageLabel) {
    this.scroll = scroll;
    this.samples = [];
    this.frame = 0;
    this.timer = 0;
    this.dragging = false;
    scroll.addEventListener('wheel', () => this.stop(), {passive:true});
    scroll.addEventListener('keydown', () => this.stop());
    scroll.tabIndex=0;
    scroll.addEventListener('pointerdown', event => {
      this.stop();
      if(event.pointerType==='mouse')scroll.focus({preventScroll:true});
    }, {passive:true});
    try {
      this.track = document.createElement('div');
      this.track.className = 'book-scroll-track';
      this.thumb = document.createElement('div');
      this.thumb.className = 'book-scroll-thumb';
      this.thumb.tabIndex = 0;
      this.thumb.setAttribute('role','scrollbar');
      this.thumb.setAttribute('aria-label','教材快速滚动');
      this.thumb.setAttribute('aria-orientation','vertical');
      this.thumb.setAttribute('aria-controls',scroll.id);
      this.tip = document.createElement('span');
      this.tip.className = 'book-scroll-tip';
      this.track.append(this.thumb, this.tip);
      pane.append(this.track);
      this.pageLabel = pageLabel;
      this.track.addEventListener('pointerdown', event => this.pointerDown(event));
      this.thumb.addEventListener('keydown', event => {
        const delta = {ArrowDown:50,ArrowUp:-50,PageDown:scroll.clientHeight*.85,PageUp:-scroll.clientHeight*.85};
        if (event.key in delta) {
          event.preventDefault(); event.stopPropagation(); this.stop();
          scroll.scrollTop += delta[event.key];
        }
      });
      scroll.addEventListener('scroll', () => this.update(true), {passive:true});
      this.observer = new ResizeObserver(() => this.update());
      this.observer.observe(scroll);
      this.observer.observe(scroll.firstElementChild);
      this.update();
      scroll.classList.add('overlay-scroll-ready');
    } catch {
      this.track?.remove();
      scroll.classList.remove('overlay-scroll-ready');
    }
  }

  stop() {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.scroll.dataset.motion = 'idle';
  }

  begin() {
    this.stop();
    this.samples = [];
    this.sample();
  }

  sample() {
    const now = performance.now();
    this.samples.push({time:now,x:this.scroll.scrollLeft,y:this.scroll.scrollTop});
    this.samples = this.samples.filter(item => now-item.time < 110);
  }

  release() {
    const now = performance.now();
    const last = this.samples.at(-1), first = this.samples[0];
    if (!last || !first || now-last.time>80 || last.time-first.time<12) return;
    const measuredX = (last.x-first.x)/(last.time-first.time);
    const measuredY = (last.y-first.y)/(last.time-first.time);
    const speed = Math.hypot(measuredX,measuredY);
    if (speed<.25) return;
    // Keep precise drags unchanged; only a clear flick gains extra momentum.
    const flick = Math.min(1,Math.max(0,(speed-.8)/1.5));
    const boost = 1 + .6*flick;
    const decayTime = 230 + 190*flick;
    let vx = Math.max(-7,Math.min(7,measuredX*boost));
    let vy = Math.max(-7,Math.min(7,measuredY*boost));
    const started = now;
    let previous = now;
    this.scroll.dataset.motion = 'inertia';
    const tick = time => {
      const dt = Math.min(64,time-previous);
      previous = time;
      const decay = Math.exp(-dt/decayTime);
      const x = this.scroll.scrollLeft, y = this.scroll.scrollTop;
      this.scroll.scrollLeft = x + vx*decayTime*(1-decay);
      this.scroll.scrollTop = y + vy*decayTime*(1-decay);
      vx = Math.abs(this.scroll.scrollLeft-x)<.1 ? 0 : vx*decay;
      vy = Math.abs(this.scroll.scrollTop-y)<.1 ? 0 : vy*decay;
      if (time-started>2200 || Math.hypot(vx,vy)<.035) { this.stop(); return; }
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  update(active = false) {
    if (!this.track) return;
    const scroll = this.scroll;
    this.track.style.top = scroll.offsetTop + 4 + 'px';
    this.track.style.height = Math.max(0,scroll.clientHeight-8) + 'px';
    const height = Math.max(0,scroll.clientHeight-8);
    const max = Math.max(0,scroll.scrollHeight-scroll.clientHeight);
    this.track.hidden = max<=1 || height<45;
    this.thumbHeight = Math.min(height,Math.max(40,height*scroll.clientHeight/Math.max(1,scroll.scrollHeight)));
    this.travel = Math.max(0,height-this.thumbHeight);
    this.thumb.style.height = this.thumbHeight+'px';
    this.thumb.style.transform = 'translateY('+(max ? scroll.scrollTop/max*this.travel : 0)+'px)';
    this.thumb.setAttribute('aria-valuemin','0');
    this.thumb.setAttribute('aria-valuemax',String(Math.round(max)));
    this.thumb.setAttribute('aria-valuenow',String(Math.round(scroll.scrollTop)));
    this.tip.textContent = this.pageLabel();
    if (active) {
      this.track.classList.add('active');
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.track.classList.remove('active'),1000);
    }
  }

  pointerDown(event) {
    if (!event.isPrimary) return;
    event.preventDefault(); event.stopPropagation(); this.stop();
    this.update(true);
    const rect = this.track.getBoundingClientRect();
    const top = this.scroll.scrollTop;
    const max = this.scroll.scrollHeight-this.scroll.clientHeight;
    const thumbTop = max ? top/max*this.travel : 0;
    const onThumb = event.clientY-rect.top>=thumbTop && event.clientY-rect.top<=thumbTop+this.thumbHeight;
    if (!onThumb) {
      this.scroll.scrollTop += (event.clientY-rect.top<thumbTop ? -1 : 1)*this.scroll.clientHeight*.85;
      return;
    }
    this.dragging = true;
    this.track.classList.add('dragging');
    this.track.setPointerCapture(event.pointerId);
    const start = event.clientY;
    const move = e => {
      this.scroll.scrollTop = Math.max(0,Math.min(max,top+(e.clientY-start)/Math.max(1,this.travel)*max));
      this.update(true);
    };
    const end = () => {
      this.dragging=false; this.track.classList.remove('dragging');
      this.track.removeEventListener('pointermove',move);
      this.track.removeEventListener('pointerup',end);
      this.track.removeEventListener('pointercancel',end);
      if(this.track.hasPointerCapture(event.pointerId))this.track.releasePointerCapture(event.pointerId);
    };
    this.track.addEventListener('pointermove',move);
    this.track.addEventListener('pointerup',end);
    this.track.addEventListener('pointercancel',end);
  }
}
