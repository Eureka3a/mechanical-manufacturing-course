/* Keep compressed layers in the reading window. Only two adjacent pages keep
   decoded elements. Every foreground navigation owns its own abort signal. */
class PageBuffer {
  constructor(slides) {
    this.slides = slides;
    this.entries = new Map();
  }

  stop() {
    this.controller?.abort();
  }

  target(index, direction) {
    this.stop();
    this.controller = new AbortController();
    const offsets = [1, 2, -1, -2, 3, 4, 5];
    this.queue = offsets.map(offset => index + direction * offset)
      .filter(i => this.slides[i]);
    for (const [i, entry] of this.entries) {
      if (i !== index && !this.queue.includes(i)) this.entries.delete(i);
      else if (i !== index && !this.queue.slice(0, 2).includes(i)) entry.images = null;
    }
    return this.controller.signal;
  }

  async read(index, signal, foreground, decode) {
    const slide = this.slides[index];
    const urls = [slide.img, ...(slide.caps || []).map(c => c.src)];
    const saved = this.entries.get(index);
    if (saved && (!decode || saved.images)) return saved;
    const task = new AbortController();
    const abort = () => task.abort();
    const timer = setTimeout(abort, 18000);
    signal.addEventListener('abort', abort, {once:true});
    if (signal.aborted) abort();
    const check = () => { if (task.signal.aborted) throw new Error('Loading interrupted'); };
    try {
      check();
      const blobs = saved?.blobs || [];
      const images = [];
      // Serial background fetches include annotation layers in the same limit.
      async function loadLayer(url, j) {
        check();
        if (location.protocol !== 'file:' && !blobs[j]) {
          const response = await fetch(url, {signal:task.signal, priority:foreground?'high':'low'});
          if (!response.ok) throw new Error('HTTP ' + response.status);
          blobs[j] = await response.blob();
        }
        check();
        if (!decode) return;
        const image = new Image();
        const objectURL = blobs[j] && URL.createObjectURL(blobs[j]);
        const cancel = () => image.removeAttribute('src');
        task.signal.addEventListener('abort',cancel,{once:true});
        try {
          await new Promise((resolve,reject) => {
            const interrupted = () => reject(new Error('Image interrupted'));
            task.signal.addEventListener('abort',interrupted,{once:true});
            function finish(callback) {
              task.signal.removeEventListener('abort',interrupted);
              image.onload = image.onerror = null;
              callback();
            }
            if (!image.decode) image.onload = () => finish(resolve);
            image.onerror = () => finish(() => reject(new Error('Invalid image')));
            image.src = objectURL || url;
            if (image.decode) image.decode().then(() => finish(resolve), error => finish(() => reject(error)));
          });
          check();
          image.dataset.source = url;
          images[j] = image;
        } finally {
          task.signal.removeEventListener('abort',cancel);
          if (objectURL) URL.revokeObjectURL(objectURL);
        }
      }
      if (foreground) {
        await Promise.all(urls.map(loadLayer));
      } else {
        for (const [j, url] of urls.entries()) await loadLayer(url, j);
      }
      check();
      const entry = {blobs, images:decode ? images : null};
      this.entries.set(index, entry);
      return entry;
    } catch (error) {
      task.abort();
      if (!signal.aborted) this.entries.delete(index);
      throw error;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    }
  }

  async warm(signal, playing) {
    for (const [rank,index] of this.queue.entries()) {
      await new Promise(resolve => setTimeout(resolve, playing() ? 800 : rank < 2 ? 40 : 220));
      if (signal.aborted) return;
      if (location.protocol === 'file:' && rank >= 2) continue;
      try { await this.read(index, signal, false, rank < 2); } catch {}
    }
  }
}

