// Visual effects: sprite-sheet player, flying cards, big text, spin wheel, emotes.
(function () {
  'use strict';
  const layer = () => document.getElementById('fxLayer');
  let meta = null;
  const ready = fetch('/assets/fx/fx.json').then(r => r.json()).then(m => {
    meta = m;
    for (const f of Object.values(m.fx)) { const i = new Image(); i.src = '/assets/fx/' + f.src; }
  }).catch(() => {});

  // Play a sprite effect centered at (x, y) in page pixels.
  function sprite(key, x, y, opts = {}) {
    if (!meta || !meta.fx[key]) return;
    const fx = meta.fx[key];
    const frames = fx.frames.slice(0, opts.maxFrames || fx.frames.length);
    const scale = (opts.scale || 3) * (innerWidth < 700 ? 0.55 : innerWidth < 1100 ? 0.8 : 1);
    const [, , w, h] = frames[0];
    const el = document.createElement('div');
    el.className = 'sprite';
    Object.assign(el.style, {
      width: w + 'px', height: h + 'px', left: x + 'px', top: y + 'px',
      backgroundImage: `url(/assets/fx/${fx.src})`,
      transform: `translate(-50%, -50%) scale(${scale}) rotate(${opts.rotate || 0}deg)`
    });
    layer().appendChild(el);
    let i = 0;
    const step = () => {
      if (i >= frames.length) { el.remove(); return; }
      const [fx0, fy0] = frames[i++];
      el.style.backgroundPosition = `-${fx0}px -${fy0}px`;
      setTimeout(step, 1000 / ((opts.fps) || meta.fps || 15));
    };
    step();
  }

  // Fly an image from one point to another.
  function fly(src, from, to, opts = {}) {
    const el = document.createElement('img');
    el.src = src;
    el.className = 'flying-card';
    const w = opts.width || 90;
    Object.assign(el.style, { width: w + 'px', left: from.x + 'px', top: from.y + 'px',
      transform: `translate(-50%, -50%) rotate(${opts.fromRot || 0}deg) scale(${opts.fromScale || 1})` });
    layer().appendChild(el);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      el.style.transition = `left ${opts.ms || 450}ms cubic-bezier(.2,.8,.2,1), top ${opts.ms || 450}ms cubic-bezier(.2,.8,.2,1), transform ${opts.ms || 450}ms ease, opacity 200ms ease ${(opts.ms || 450) - 150}ms`;
      el.style.left = to.x + 'px';
      el.style.top = to.y + 'px';
      el.style.transform = `translate(-50%, -50%) rotate(${opts.toRot || 0}deg) scale(${opts.toScale || 1})`;
      if (opts.fade !== false) el.style.opacity = '0';
    }));
    setTimeout(() => el.remove(), (opts.ms || 450) + 250);
  }

  function bigText(text, cls = '', ms = 1400) {
    const host = document.getElementById('bigText');
    const el = document.createElement('div');
    el.className = 'big ' + cls;
    el.textContent = text;
    host.appendChild(el);
    setTimeout(() => el.remove(), ms);
  }

  // Slot-style roll that slows down and lands on `result` (one of `values`), then holds
  // the result with a caption. Total time matches ToiBenPace.WHEEL_MS.
  function wheel(title, values, result, x, y, opts = {}) {
    const total = (window.ToiBenPace && window.ToiBenPace.WHEEL_MS) || 3800;
    const spinMs = Math.round(total * 0.6), holdMs = total - spinMs - 150;
    return new Promise(resolve => {
      const el = document.createElement('div');
      el.className = 'wheel';
      el.style.left = Math.max(150, Math.min(innerWidth - 150, x)) + 'px'; el.style.top = y + 'px';
      el.innerHTML = `<div class="wheel-title"></div><div class="wheel-num">?</div><div class="wheel-cap"></div>`;
      el.querySelector('.wheel-title').textContent = title;
      layer().appendChild(el);
      const num = el.querySelector('.wheel-num');
      // delays grow so the roll visibly slows down
      const delays = [];
      for (let t = 0, acc = 0; acc < spinMs; t++) { const d = 55 + t * t * 1.6; delays.push(d); acc += d; }
      let i = 0;
      const tick = () => {
        if (i < delays.length) {
          num.textContent = values[(i + values.indexOf(result) + 1) % values.length];
          num.classList.remove('roll'); void num.offsetWidth; num.classList.add('roll');
          setTimeout(tick, delays[i++]);
        } else {
          num.textContent = result;
          el.querySelector('.wheel-cap').textContent = opts.caption || '';
          el.classList.add('done');
          sprite('sparkle', x, y, { scale: 3 });
          setTimeout(() => { el.classList.add('out'); setTimeout(() => { el.remove(); resolve(); }, 150); }, holdMs);
        }
      };
      tick();
    });
  }

  // Coin toss for the 0: lands on face `result` (0 or 1), then shows `caption`.
  function coin(result, x, y, opts = {}) {
    const P = window.ToiBenPace || {};
    const total = P.COIN_MS || 2900, tossMs = 1700;
    const el = document.createElement('div');
    el.className = 'coin-wrap';
    el.style.left = x + 'px'; el.style.top = y + 'px';
    el.innerHTML = `<div class="coin"><div class="face f0"><b>0</b><span>GIỮ BÀI</span></div>
      <div class="face f1"><b>1</b><span>CHUYỀN BÀI</span></div></div><div class="coin-cap"></div>`;
    el.querySelector('.coin-cap').textContent = opts.caption || '';
    layer().appendChild(el);
    const c = el.querySelector('.coin');
    const end = 360 * 6 + (result ? 180 : 0);
    c.animate([
      { transform: 'translateY(0) rotateY(0deg) scale(.6)' },
      { transform: `translateY(-150px) rotateY(${end * 0.55}deg) scale(1.05)`, offset: 0.45, easing: 'ease-in' },
      { transform: `translateY(0) rotateY(${end - 25}deg) scale(1)`, offset: 0.85 },
      { transform: `translateY(-14px) rotateY(${end - 6}deg) scale(1)`, offset: 0.93 },
      { transform: `translateY(0) rotateY(${end}deg) scale(1)` }
    ], { duration: tossMs, easing: 'ease-out', fill: 'forwards' });
    setTimeout(() => {
      el.classList.add('done');
    }, tossMs);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 260); }, total - 250);
  }

  // Persistent card sprites that the caller moves around and removes.
  function place(src, x, y, opts = {}) {
    const el = document.createElement('img');
    el.src = src; el.className = 'fx-card';
    Object.assign(el.style, { width: (opts.width || 90) + 'px', left: x + 'px', top: y + 'px',
      transform: `rotate(${opts.rot || 0}deg) scale(${opts.scale || 1})` });
    layer().appendChild(el);
    return el;
  }
  function move(el, x, y, opts = {}) {
    const ms = opts.ms || 600;
    const go = () => {
      el.style.transition = `left ${ms}ms cubic-bezier(.4,0,.2,1), top ${ms}ms cubic-bezier(.4,0,.2,1), transform ${ms}ms ease, width ${ms}ms ease`;
      el.style.left = x + 'px'; el.style.top = y + 'px';
      if (opts.width) el.style.width = opts.width + 'px';
      el.style.transform = `rotate(${opts.rot || 0}deg) scale(${opts.scale || 1})`;
    };
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(go, opts.delay || 0)));
  }
  function drop(el, ms = 250) {
    el.style.transition = `opacity ${ms}ms`; el.style.opacity = '0';
    setTimeout(() => el.remove(), ms + 30);
  }

  function shake(ms = 400) {
    const t = document.getElementById('table');
    t.classList.remove('shake'); void t.offsetWidth; t.classList.add('shake');
    setTimeout(() => t.classList.remove('shake'), ms);
  }

  // ---- emotes ----
  const lottieCache = new Map();
  async function loadTgs(url) {
    if (!lottieCache.has(url)) {
      lottieCache.set(url, (async () => {
        const res = await fetch(url);
        const ds = res.body.pipeThrough(new DecompressionStream('gzip'));
        return JSON.parse(await new Response(ds).text());
      })());
    }
    return lottieCache.get(url);
  }

  function emoteNode(name, size, loop = true) {
    const url = '/assets/emotes/' + encodeURIComponent(name);
    const wrap = document.createElement('div');
    wrap.className = 'emote-media';
    wrap.style.width = wrap.style.height = size + 'px';
    if (/\.webm$/i.test(name)) {
      const v = document.createElement('video');
      Object.assign(v, { src: url, autoplay: true, muted: true, loop, playsInline: true });
      wrap.appendChild(v);
    } else if (/\.tgs$/i.test(name)) {
      loadTgs(url).then(data => {
        if (window.lottie) window.lottie.loadAnimation({ container: wrap, renderer: 'svg', loop, autoplay: true, animationData: data });
      }).catch(() => { wrap.textContent = '🙂'; });
    } else {
      const i = document.createElement('img');
      i.src = url; i.className = 'bounce';
      wrap.appendChild(i);
    }
    return wrap;
  }

  function showEmote(name, x, y) {
    const el = emoteNode(name, 140);
    el.classList.add('emote-pop');
    el.style.left = x + 'px'; el.style.top = y + 'px';
    layer().appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }

  window.FX = { ready, sprite, fly, bigText, wheel, coin, place, move, drop, shake, emoteNode, showEmote };
})();
