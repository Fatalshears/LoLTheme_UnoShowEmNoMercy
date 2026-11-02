// Chơi Tới Bến — browser client.
(function () {
  'use strict';
  const E = window.ToiBenEngine;
  const Pace = window.ToiBenPace;
  const $ = id => document.getElementById(id);
  const socket = io();
  window.__sock = socket;
  const store = {
    get: k => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } }
  };

  let S = null;            // last state from server
  let token = store.get('toiben_token');
  let emotes = [];
  let timer = null;        // { seat, end, total } for the awaited decision
  const queue = [];        // states waiting for the previous animations to finish
  let busy = false;

  // ---------- card art ----------
  const KIND_FILE = { skip: 'skip', reverse: 'reverse', draw2: 'drawTwo', draw4: 'drawFour', discardAll: 'discardAll', skipEveryone: 'skipEveryone' };
  const WILD_FILE = { wildReverseDraw4: 'wild_reverseDraw4', wildRoulette: 'wild_colorRoulette', wildDraw6: 'wild_draw6', wildDraw10: 'wild_draw10' };
  function cardSrc(c) {
    if (!c) return '/assets/cards/wild_backside.jpg';
    if (c.kind === 'number') return `/assets/cards/${c.color}${c.value}.jpg`;
    if (c.color === 'wild') return `/assets/cards/${WILD_FILE[c.kind]}.jpg`;
    const prefix = c.color === 'blue' && (c.kind === 'draw2' || c.kind === 'draw4') ? 'bule' : c.color;
    return `/assets/cards/${prefix}_${KIND_FILE[c.kind]}.jpg`;
  }
  const BACK = '/assets/cards/wild_backside.jpg';
  const COLOR_HEX = { red: '#de0c0a', yellow: '#e0af06', green: '#08682c', blue: '#063c9f' };

  // ---------- connection ----------
  socket.on('connect', () => {
    if (token) socket.emit('hello', { token, name: store.get('toiben_name') });
    else socket.emit('hello', {});
  });
  socket.on('welcome', d => {
    if (d.token) { token = d.token; store.set('toiben_token', token); }
  });
  socket.on('toast', t => toast(t.text, t.type));
  socket.on('state', s => {
    timer = s.timer ? { seat: s.timer.seat, end: performance.now() + s.timer.leftMs, total: s.timer.totalMs } : null;
    queue.push(s);
    pump();
  });

  // States are shown one at a time: play the events' animations, then show the new table.
  function pump() {
    if (busy || !queue.length) return;
    const s = queue.shift();
    const prev = S;
    const evs = s.events || [];
    const instant = !prev || !prev.view || !s.view || s.status === 'lobby' || prev.round !== s.round ||
      !evs.length || queue.length >= 3 || document.hidden;
    if (instant) {
      S = s; render(prev);
      if (evs.length && !(queue.length >= 3) && !document.hidden) playEvents(s, prev);
      pump();
      return;
    }
    busy = true;
    const total = playEvents(s, prev);
    setTimeout(() => { S = s; render(prev); busy = false; pump(); }, total);
  }
  socket.on('emote', e => {
    const pos = e.seat >= 0 ? seatCenter(e.seat) : { x: innerWidth / 2, y: innerHeight / 2 };
    FX.showEmote(e.name, pos.x, pos.y - 70);
  });
  fetch('/api/emotes').then(r => r.json()).then(list => { emotes = list; buildEmotePanel(); }).catch(() => {});

  // ---------- lobby ----------
  $('nameInput').value = store.get('toiben_name') || '';
  $('joinBtn').onclick = join;
  $('nameInput').onkeydown = e => { if (e.key === 'Enter') join(); };
  function join() {
    const name = $('nameInput').value.trim();
    if (!name) { $('nameInput').focus(); return; }
    store.set('toiben_name', name);
    socket.emit('hello', { token, name });
  }
  $('addBotBtn').onclick = () => socket.emit('addBot');
  $('startBtn').onclick = () => socket.emit('start');
  $('nextRoundBtn').onclick = () => socket.emit('start');
  $('lobbyBtn').onclick = () => socket.emit('backToLobby');
  $('claimBtn').onclick = () => {
    const offline = S.players.filter(p => !p.bot && !p.connected);
    if (!offline.length) return toast('Không có ghế nào đang trống');
    pick('Lấy lại ghế', 'Chọn ghế của bạn (đang mất kết nối):',
      offline.map(p => ({ label: p.name, value: p.id })), id => socket.emit('claimSeat', { id }));
  };

  function renderLobby() {
    const inLobby = S.status === 'lobby';
    const joined = !!S.me;
    $('lobby').classList.toggle('hidden', !(inLobby || !joined));
    $('lobby').classList.toggle('overlay', !inLobby);
    $('table').classList.toggle('hidden', inLobby || !S.view);
    $('joinBox').classList.toggle('hidden', joined || !inLobby);
    $('lobbyInfo').classList.toggle('hidden', !inLobby);
    $('spectatorNote').classList.toggle('hidden', inLobby || joined);
    $('lobbyCount').textContent = `(${S.players.length}/8)`;
    const isHost = S.me && S.me.host;
    $('hostControls').classList.toggle('hidden', !isHost);
    $('waitHost').classList.toggle('hidden', !joined || isHost);
    $('startBtn').disabled = S.players.length < 2;
    $('lobbyPlayers').innerHTML = '';
    for (const p of S.players) {
      const li = document.createElement('li');
      li.innerHTML = `<span class="avatar" style="background:${avatarColor(p.name)}">${initial(p.name)}</span>
        <span class="pname">${esc(p.name)}</span>
        ${p.host ? '<span class="tag gold">Chủ phòng</span>' : ''}${p.bot ? '<span class="tag">Bot</span>' : ''}
        ${!p.connected ? '<span class="tag warn">Mất kết nối</span>' : ''}
        <span class="score">${p.score} điểm</span>`;
      if (isHost && !p.host) {
        const b = document.createElement('button');
        b.className = 'link'; b.textContent = 'Mời ra';
        b.onclick = () => socket.emit('kick', { id: p.id });
        li.appendChild(b);
      }
      $('lobbyPlayers').appendChild(li);
    }
  }

  // ---------- table layout ----------
  function mySeat() { return S && S.me ? S.me.seat : -1; }
  function seatOrder() {
    const n = S.view.seats.length;
    const me = mySeat() >= 0 ? mySeat() : 0;
    return Array.from({ length: n }, (_, i) => (me + i) % n);
  }
  // Seat i positions on an ellipse; my seat at the bottom, the rest clockwise.
  function seatCenter(seat) {
    const n = S.view.seats.length;
    const order = seatOrder();
    const k = order.indexOf(seat);
    const W = innerWidth, H = innerHeight;
    if (k === 0) return { x: W / 2, y: H - 70 };
    const ang = (90 + (k * 360) / n) * Math.PI / 180;
    const rx = W * 0.42, ry = H * 0.33;
    const x = W / 2 + rx * Math.cos(ang), y = H * 0.42 + ry * Math.sin(ang);
    const half = W < 700 ? 66 : 100; // keep seat chips on screen
    return { x: Math.min(W - half, Math.max(half, x)), y: Math.max(60, y) };
  }
  function centerOf(el) { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }

  function renderSeats() {
    const v = S.view;
    const box = $('seats');
    box.innerHTML = '';
    for (const s of v.seats) {
      if (s.seat === mySeat()) continue;
      const p = S.players.find(x => x.seat === s.seat) || {};
      const pos = seatCenter(s.seat);
      const el = document.createElement('div');
      el.className = 'seat';
      if (v.actor === s.seat && v.phase !== 'over') el.classList.add('active');
      if (s.out) el.classList.add('out');
      if (!s.out && s.count >= DANGER) el.classList.add('danger');
      el.style.left = pos.x + 'px'; el.style.top = pos.y + 'px';
      el.dataset.seat = s.seat;
      const fan = Math.min(s.count, 8);
      let backs = '';
      for (let i = 0; i < fan; i++) backs += `<img src="${BACK}" style="transform:rotate(${(i - fan / 2) * 7}deg) translateY(${Math.abs(i - fan / 2) * 1.5}px)">`;
      el.innerHTML = `
        <div class="mini-fan">${s.out ? '' : backs}</div>
        <div class="seat-info">
          <span class="avatar" style="background:${avatarColor(s.name)}">${s.out ? '💀' : initial(s.name)}</span>
          <span class="pname">${esc(s.name)}</span>
          <span class="count">${s.out ? 'TỚI SỐ' : s.count + ' lá'}</span>
          ${p.bot ? '<span class="tag">Bot</span>' : ''}${p.connected === false ? '<span class="tag warn">Mất mạng</span>' : ''}${p.auto && !p.bot ? '<span class="tag">Tự đánh</span>' : ''}
          ${timerBadge(s.seat)}
        </div>`;
      if (S.me && S.me.host && !p.bot && !s.out) {
        el.title = 'Chủ phòng: bấm đúp để bật/tắt tự đánh cho ghế này';
        el.ondblclick = () => socket.emit('toggleAuto', { id: p.id });
      }
      box.appendChild(el);
    }
  }

  // Stable pseudo-random spot for a card on the table, so it never jumps between renders.
  function scatter(id) {
    let h = (Math.imul(id + 1, 2654435761) ^ 0x9e3779b9) >>> 0;
    const r = () => { h ^= h << 13; h >>>= 0; h ^= h >>> 17; h ^= h << 5; h >>>= 0; return h / 4294967296; };
    const k = innerWidth < 700 ? 0.6 : 1;
    return { dx: (r() - 0.5) * 76 * k, dy: (r() - 0.5) * 56 * k, rot: (r() - 0.5) * 60 };
  }
  const FADE = [1, 0.92, 0.78, 0.6, 0.42, 0.25, 0.1];
  function pileCardWidth() { return innerWidth <= 700 ? 91 : Math.max(100, Math.min(156, innerWidth * 0.108)); }

  function renderCenter(v = S.view) {
    const col = COLOR_HEX[v.activeColor] || '#888';
    $('center').style.setProperty('--active', col);
    $('colorTag').textContent = 'Màu: ' + (E.COLOR_NAMES[v.activeColor] || '—');
    $('drawCount').textContent = v.drawCount;
    $('dirArrows').classList.toggle('ccw', v.direction < 0);
    const box = $('pileCards');
    const want = v.recent && v.recent.length ? v.recent : (v.top ? [v.top] : []);
    const have = new Map([...box.children].map(el => [el.dataset.id, el]));
    want.forEach((c, i) => {
      const age = want.length - 1 - i;
      let el = have.get(String(c.id));
      if (!el) {
        el = document.createElement('img');
        el.className = 'card pile-card' + (S && S.view ? ' fresh' : '');
        el.dataset.id = c.id;
        el.src = cardSrc(c);
        el.alt = E.cardName(c);
        const sc = scatter(c.id);
        el.style.transform = `translate(${sc.dx}px, ${sc.dy}px) rotate(${sc.rot}deg)`;
        el.addEventListener('animationend', () => el.classList.remove('fresh'));
        box.appendChild(el);
      }
      have.delete(String(c.id));
      el._card = c;
      el.style.zIndex = i + 1;
      el.style.opacity = FADE[age] ?? 0;
      el.classList.toggle('top', age === 0);
    });
    for (const el of have.values()) el.remove();
    const sb = $('stackBadge');
    if (v.stack && v.phase === 'stack') {
      sb.classList.remove('hidden');
      sb.textContent = '+' + v.stack.total;
    } else sb.classList.add('hidden');
  }

  function statusText() {
    const v = S.view, me = mySeat();
    const name = i => (v.seats[i] || {}).name;
    if (v.phase === 'over') return `${name(v.winner)} thắng ván!`;
    if (v.phase === 'stack') return v.stack.target === me
      ? `Bạn bị phạt +${v.stack.total}! Đỡ bằng lá phạt ≥ +${v.stack.last} hoặc chịu phạt.`
      : `${name(v.stack.target)} đang bị phạt +${v.stack.total}…`;
    if (v.phase === 'roulette') return v.roulette.victim === me
      ? 'Vòng Quay Tử Thần! Chọn một màu.' : `${name(v.roulette.victim)} đang chọn màu cho Vòng Quay…`;
    if (v.current === me) {
      if (v.phase === 'mustPlayDrawn') return 'Bạn rút được lá đánh được, phải đánh ngay!';
      return `Tới lượt bạn: đánh một lá hợp lệ hoặc rút bài (tự rút tối đa ${v.maxDraw} lá).`;
    }
    return `Lượt của ${name(v.current)}.`;
  }

  const handCardWidth = () => Math.max(84, Math.min(144, innerWidth / 9.17));
  const DANGER = E.KNOCKOUT - 5;
  let fanIn = false;   // next hand render spreads the cards out from a stack
  function renderHand() {
    const v = S.view, hand = v.hand || [];
    const box = $('hand');
    box.innerHTML = '';
    const n = hand.length;
    const playable = new Set(v.playable);
    const maxW = Math.min(innerWidth - 40, 1200);
    const cardW = handCardWidth();
    const step = n > 1 ? Math.min(cardW * 0.8, (maxW - cardW) / (n - 1)) : 0;
    const totalW = cardW + step * (n - 1);
    const sorted = hand.slice().sort(sortCards);
    sorted.forEach((c, i) => {
      const img = document.createElement('img');
      img.src = cardSrc(c);
      img.className = 'card hand-card';
      img.style.width = cardW + 'px';
      img.style.setProperty('--cw', cardW + 'px');
      const left = `calc(50% - ${totalW / 2}px + ${i * step}px)`;
      if (fanIn) {
        img.style.left = `calc(50% - ${cardW / 2}px + ${i * 1.5}px)`;
        img.classList.add('fan-in');
        requestAnimationFrame(() => requestAnimationFrame(() => { img.style.left = left; }));
        setTimeout(() => img.classList.remove('fan-in'), 700);
      } else img.style.left = left;
      img.style.zIndex = i;
      img._card = c;
      img.dataset.tip = '1';
      if (playable.has(c.id)) { img.classList.add('playable'); img.onclick = () => tryPlay(c, img); }
      else if (v.actor === mySeat()) img.classList.add('dim');
      box.appendChild(img);
    });
    fanIn = false;
    box.classList.remove('passing');
    const me = v.seats[mySeat()];
    box.classList.toggle('danger', !!me && !me.out && n >= DANGER);
    const chip = $('meChip');
    chip.classList.toggle('hidden', !me);
    if (me) {
      chip.className = 'seat-static' + (v.actor === me.seat && v.phase !== 'over' ? ' active' : '') + (!me.out && n >= DANGER ? ' danger' : '');
      chip.innerHTML = `<div class="seat-info"><span class="avatar" style="background:${avatarColor(me.name)}">${me.out ? '💀' : initial(me.name)}</span>
        <span class="pname">${esc(me.name)} (bạn)</span><span class="count">${me.out ? 'TỚI SỐ' : n + ' lá'}</span>${timerBadge(me.seat)}</div>`;
    }
  }
  const ORDER = { red: 0, yellow: 1, green: 2, blue: 3, wild: 4 };
  function sortCards(a, b) {
    return ORDER[a.color] - ORDER[b.color] || (a.kind === 'number' ? a.value : 20) - (b.kind === 'number' ? b.value : 20) || a.kind.localeCompare(b.kind);
  }

  function renderActions() {
    const v = S.view, me = mySeat();
    const myTurn = v.actor === me && v.phase !== 'over' && me >= 0;
    $('drawBtn').classList.toggle('hidden', !(myTurn && v.phase === 'play'));
    $('drawBtn').textContent = 'Rút bài';
    $('acceptBtn').classList.toggle('hidden', !(myTurn && v.phase === 'stack'));
    $('acceptBtn').textContent = v.stack ? `Chịu phạt +${v.stack.total}` : 'Chịu phạt';
    const meSeat = v.seats[me];
    $('toiBenBtn').classList.toggle('hidden', !(meSeat && !meSeat.out && meSeat.count === 1 && v.phase !== 'over'));
    $('drawPile').classList.toggle('clickable', myTurn && v.phase === 'play');
    $('status').textContent = statusText();
    $('status').classList.toggle('mine', myTurn);
  }

  function renderLog() {
    const log = S.view.log;
    $('logList').innerHTML = log.map(l => `<li>${esc(l)}</li>`).join('');
    $('logList').scrollTop = 1e9;
  }

  let endShownRound = null, endTimer = null;
  function renderRoundEnd() {
    const v = S.view;
    const show = S.status === 'roundEnd' && v;
    if (!show) { $('roundEnd').classList.add('hidden'); clearTimeout(endTimer); endShownRound = null; return; }
    // let the win animation play before the score sheet appears
    if (endShownRound !== S.round) {
      endShownRound = S.round;
      clearTimeout(endTimer);
      endTimer = setTimeout(() => $('roundEnd').classList.remove('hidden'), 900);
    }
    const w = v.seats[v.winner];
    $('endTitle').textContent = v.winner === mySeat() ? '🏆 Bạn thắng!' : `🏆 ${w.name} thắng!`;
    $('endText').textContent = `Lý do: ${v.endReason}. Nhận ${v.points} điểm (gồm ${v.knockouts.length} lần Tới Số × 250).`;
    const rows = S.players.slice().sort((a, b) => b.score - a.score)
      .map(p => `<tr><td>${esc(p.name)}</td><td>${p.seat >= 0 && v.seats[p.seat].out ? '💀 Tới Số' : (p.seat >= 0 ? v.seats[p.seat].count + ' lá' : '')}</td><td>${p.score} điểm</td></tr>`);
    $('scoreTable').innerHTML = '<tr><th>Người chơi</th><th>Cuối ván</th><th>Tổng</th></tr>' + rows.join('');
    const isHost = S.me && S.me.host;
    $('endHost').classList.toggle('hidden', !isHost);
    $('endWait').classList.toggle('hidden', !!isHost);
  }

  function render(prev) {
    locked = false;
    renderLobby();
    hideTip();
    if (!S.view || S.status === 'lobby') { $('roundEnd').classList.add('hidden'); return; }
    // the server may have played for us (timer ran out): drop a stale colour/target prompt
    if ($('modal').dataset.open === 'turn' && S.view.actor !== mySeat()) cancelModal();
    renderSeats(); renderCenter(); renderHand(); renderActions(); renderLog(); renderRoundEnd(); tickTimer();
    if (S.view.phase === 'roulette' && S.view.roulette.victim === mySeat() && !$('modal').dataset.open) {
      chooseColor('Vòng Quay Tử Thần', 'Chọn một màu. Hệ thống sẽ lật bài đến khi ra đúng màu đó và bạn nhận hết.', false)
        .then(color => color && act({ type: 'rouletteColor', color }));
    }
  }
  addEventListener('resize', () => S && S.view && S.status !== 'lobby' && render());

  // ---------- actions ----------
  // One action per shown state: wait for the server's answer (and its animation) before the next.
  let locked = false;
  const canAct = () => !locked && !busy && !queue.length;
  function act(a) { if (!canAct()) return; locked = true; socket.emit('act', a); setTimeout(() => (locked = false), 4000); }
  socket.on('toast', () => (locked = false));
  $('drawBtn').onclick = () => act({ type: 'draw' });
  $('drawPile').onclick = () => { if ($('drawPile').classList.contains('clickable')) act({ type: 'draw' }); };
  $('acceptBtn').onclick = () => act({ type: 'acceptStack' });
  $('toiBenBtn').onclick = () => act({ type: 'callToiBen' });
  $('logBtn').onclick = () => $('logPanel').classList.toggle('hidden');
  $('emoteBtn').onclick = () => $('emotePanel').classList.toggle('hidden');
  $('helpBtn').onclick = openHelp;
  $('lobbyHelpBtn').onclick = openHelp;
  $('helpClose').onclick = () => $('help').classList.add('hidden');
  $('help').onclick = e => { if (e.target === $('help')) $('help').classList.add('hidden'); };
  addEventListener('keydown', e => { if (e.key === 'Escape') $('help').classList.add('hidden'); });

  async function tryPlay(c, img) {
    if (!canAct()) return;
    const a = { type: 'play', cardId: c.id };
    if (E.needsColor(c)) {
      a.color = await chooseColor('Chọn màu', `Bạn đánh ${E.cardName(c)}.`, true);
      if (!a.color) return;
    }
    const handSize = S.view.hand.length;
    if (c.kind === 'number' && c.value === 7 && handSize > 1) {
      const opts = S.view.seats.filter(s => !s.out && s.seat !== mySeat())
        .map(s => ({ label: `${s.name} (${s.count} lá)`, value: s.seat }));
      a.target = await new Promise(res => pick('Tráo bài số 7', 'Chọn người để đổi ngẫu nhiên 1–5 lá:', opts, res, () => res(null)));
      if (a.target == null) return;
    }
    if (img) img.classList.add('leaving');
    act(a);
  }

  // ---------- modal helpers ----------
  let modalCancel = null;
  function openModal(title, text, cancellable, onCancel) {
    $('modalTitle').textContent = title;
    $('modalText').textContent = text;
    $('modalBody').innerHTML = '';
    $('modal').classList.remove('hidden');
    $('modal').dataset.open = 'turn';
    $('modalCancel').classList.toggle('hidden', !cancellable);
    modalCancel = onCancel || null;
    $('modalCancel').onclick = cancelModal;
  }
  function closeModal() { $('modal').classList.add('hidden'); delete $('modal').dataset.open; modalCancel = null; }
  function cancelModal() { const f = modalCancel; closeModal(); f && f(); }

  function chooseColor(title, text, cancellable) {
    return new Promise(res => {
      openModal(title, text, cancellable, () => res(null));
      const grid = document.createElement('div');
      grid.className = 'color-grid';
      for (const c of E.COLORS) {
        const b = document.createElement('button');
        b.className = 'color-btn';
        b.innerHTML = `<img src="/assets/cards/${c}_backside.jpg" alt=""><span>${E.COLOR_NAMES[c]}</span>`;
        b.onclick = () => { closeModal(); res(c); };
        grid.appendChild(b);
      }
      $('modalBody').appendChild(grid);
    });
  }

  function pick(title, text, options, onPick, onCancel) {
    openModal(title, text, true, onCancel);
    const list = document.createElement('div');
    list.className = 'pick-list';
    for (const o of options) {
      const b = document.createElement('button');
      b.className = 'btn';
      b.textContent = o.label;
      b.onclick = () => { closeModal(); onPick(o.value); };
      list.appendChild(b);
    }
    $('modalBody').appendChild(list);
  }

  // ---------- emotes ----------
  function buildEmotePanel() {
    const p = $('emotePanel');
    p.innerHTML = '';
    for (const name of emotes) {
      const b = document.createElement('button');
      b.className = 'emote-btn';
      b.title = name.replace(/\.\w+$/, '').replace(/_/g, ' ');
      b.dataset.name = name;
      b.onclick = () => { socket.emit('emote', { name }); p.classList.add('hidden'); };
      p.appendChild(b);
    }
  }
  // Only load emote media while the picker is open.
  new MutationObserver(() => {
    const p = $('emotePanel');
    const open = !p.classList.contains('hidden');
    for (const b of p.children) {
      if (open && !b.firstChild) b.appendChild(FX.emoteNode(b.dataset.name, 64));
      if (!open) b.innerHTML = '';
    }
  }).observe($('emotePanel'), { attributes: true, attributeFilter: ['class'] });

  // ---------- event animations ----------
  // Events play one after another; each one gets Pace.eventMs(e) of screen time.
  // Returns the total time, after which the caller shows the new table state.
  function playEvents(s, prev) {
    const v = s.view;
    const nameOf = i => (v && v.seats[i] ? v.seats[i].name : '');
    const pileC = () => centerOf($('discardPile'));
    const deck = () => centerOf($('drawPile').querySelector('.d1'));
    const seatPos = st => (st === mySeat() ? { x: innerWidth / 2, y: innerHeight - 90 } : seatCenter(st));
    let t = 0;
    const at = (ms, fn) => { const when = t + ms; setTimeout(fn, when); };
    for (const e of s.events || []) {
      switch (e.type) {
        case 'roundStart': at(0, () => FX.bigText('VÁN MỚI!', 'gold')); break;
        case 'play': {
          at(0, () => {
            const from = seatPos(e.seat), c = pileC(), sc = scatter(e.card.id);
            const to = { x: c.x + sc.dx, y: c.y + sc.dy };
            FX.fly(cardSrc(e.card), from, to, { width: pileCardWidth(), ms: 620, fromRot: -25, toRot: sc.rot, fromScale: 0.8, fade: false });
            setTimeout(() => {
              renderCenter(v);
              FX.sprite('impact', to.x, to.y, { scale: 2.2 });
              if (E.needsColor(e.card)) FX.sprite('light', to.x, to.y, { scale: 1.6 });
            }, 620);
          });
          break;
        }
        case 'discardAll': if (e.count) {
          at(0, () => {
            const from = seatPos(e.seat), to = pileC();
            FX.bigText(`XẢ ${e.count + 1} LÁ!`, 'small');
            for (let i = 0; i < Math.min(e.count, 10); i++) setTimeout(() => FX.fly(BACK, from, to, { width: 96, ms: 550, fromRot: i * 20 }), i * 110);
          });
          at(Pace.eventMs(e) - 600, () => { const c = pileC(); FX.sprite('smoke', c.x, c.y, { scale: 3 }); });
        } break;
        case 'skip': at(0, () => {
          for (const st of e.seats) { const p = seatPos(st); FX.sprite('skip', p.x, p.y, { scale: 1.6, maxFrames: 24, fps: 20 }); }
          FX.bigText(e.seats.length > 1 ? 'CẤM CẢ BÀN!' : `${nameOf(e.seats[0])} MẤT LƯỢT`, 'small', 1300);
        }); break;
        case 'reverse': at(0, () => {
          const c = pileC();
          $('dirArrows').classList.toggle('ccw', e.direction < 0);
          $('dirArrows').classList.add('flash');
          setTimeout(() => $('dirArrows').classList.remove('flash'), 1000);
          FX.sprite('warp', c.x, c.y, { scale: 3 });
          FX.bigText('ĐẢO CHIỀU!', 'small');
        }); break;
        case 'stack': at(0, () => {
          const p = seatPos(e.target);
          if (prev && prev.view && prev.view.phase === 'stack') { const q = seatPos(e.seat); FX.sprite('shield', q.x, q.y, { scale: 1.5 }); }
          if (e.value >= 10) { FX.bigText(`+${e.total}`, 'red huge'); setTimeout(() => { FX.sprite('boom10', p.x, p.y, { scale: 2.5 }); FX.shake(600); }, 350); }
          else if (e.value >= 6) { FX.bigText(`+${e.total}`, 'red'); setTimeout(() => { FX.sprite('bolt', p.x, p.y - 60, { scale: 2.5 }); FX.sprite('lightning', p.x, p.y, { scale: 3 }); FX.shake(350); }, 350); }
          else { FX.bigText(`+${e.total}`, 'red small'); setTimeout(() => FX.sprite('hit', p.x, p.y, { scale: 3 }), 350); }
        }); break;
        case 'takeStack': case 'draw': at(0, () => {
          const p = seatPos(e.seat), d = deck();
          const n = Math.min(e.count, 12);
          const gap = e.type === 'draw' ? 300 : 120;
          for (let i = 0; i < n; i++) setTimeout(() => FX.fly(BACK, d, p, { width: 84, ms: e.type === 'draw' ? 550 : 450 }), i * gap);
          if (e.type === 'draw') FX.bigText(`Rút ${e.count} lá`, 'small', 1000);
          if (e.type === 'takeStack') { FX.bigText(`${nameOf(e.seat)} nhận ${e.count} lá`, 'red small', 1300); setTimeout(() => FX.sprite('absorb', p.x, p.y, { scale: 1.4 }), n * gap); }
        }); break;
        case 'drawFail': at(0, () => FX.bigText(`Rút ${v ? v.maxDraw : 3} lá không ra: MẤT LƯỢT`, 'small', 1300)); break;
        case 'zero': {
          const caption = e.n === 0 ? 'Mặt 0: giữ nguyên bài' : 'Mặt 1: chuyền cả xấp bài cho người kế tiếp';
          at(0, () => { const c = pileC(); FX.coin(e.n, c.x, c.y, { caption }); });
          if (e.n > 0) {
            // 1) every hand tidies into a neat stack
            at(Pace.COIN_MS, () => {
              const cw = handCardWidth();
              [...$('hand').children].forEach((img, i) => {
                img.classList.remove('playable', 'dim');
                img.classList.add('gather');
                img.style.left = `calc(50% - ${cw / 2}px + ${i * 1.5}px)`;
              });
              for (const el of document.querySelectorAll('.seat')) el.classList.add('gathered');
            });
            // 2) each stack moves to the next player along the current direction
            at(Pace.COIN_MS + Pace.GATHER_MS, () => {
              const cw = handCardWidth();
              $('hand').classList.add('passing');
              for (const el of document.querySelectorAll('.seat')) el.classList.add('passing');
              e.order.forEach((st, i) => {
                const a = st === mySeat() ? { x: innerWidth / 2, y: innerHeight - cw * 0.67 - 6 } : seatPos(st);
                const nx = e.order[(i + 1) % e.order.length];
                const b = nx === mySeat() ? { x: innerWidth / 2, y: innerHeight - cw * 0.67 - 6 } : seatPos(nx);
                const w = st === mySeat() ? cw : 60, w2 = nx === mySeat() ? cw : 60;
                const count = Math.min(4, Math.max(1, (v.seats[st] || {}).count || 1));
                for (let j = 0; j < count; j++) {
                  const el = FX.place(BACK, a.x + j * 2, a.y - j * 2, { width: w });
                  FX.move(el, b.x + j * 2, b.y - j * 2, { ms: Pace.PASS_MS - 100, width: w2 });
                  setTimeout(() => FX.drop(el, 200), Pace.PASS_MS + 150);
                }
              });
              fanIn = true;
            });
          }
          break;
        }
        case 'seven': {
          const caption = `${nameOf(e.seat)} ⇄ ${nameOf(e.target)}: đổi ${e.k} lá` + (e.k < e.K ? ` (không đủ ${e.K})` : '');
          at(0, () => { const c = pileC(); FX.wheel('Số 7: số lá tráo', [1, 2, 3, 4, 5], e.K, c.x, c.y, { caption }); });
          const groups = {};
          // 1) the chosen cards leave each hand and line up neatly
          at(Pace.WHEEL_MS, () => {
            const c = pileC();
            for (const side of [e.seat, e.target]) {
              const els = [];
              const mine = side === mySeat() && e.mine;
              const cw = handCardWidth();
              const stage = side === mySeat()
                ? { x: innerWidth / 2, y: innerWidth < 700 ? (c.y + innerHeight - cw * 1.34) / 2 + 40 : innerHeight - cw * 1.34 - 120 }
                : (() => { const p = seatPos(side); return { x: p.x + (c.x - p.x) * 0.38, y: p.y + (c.y - p.y) * 0.38 }; })();
              if (mine) {
                const imgs = [...$('hand').children];
                e.mine.forEach((card, i) => {
                  const img = imgs.find(x => x._card && x._card.id === card.id);
                  const r = img ? img.getBoundingClientRect() : { left: stage.x, top: innerHeight - 60, width: cw, height: cw * 1.34 };
                  if (img) img.classList.add('picked');
                  const el = FX.place(cardSrc(card), r.left + r.width / 2, r.top + r.height / 2, { width: r.width });
                  const mid = (e.mine.length - 1) / 2;
                  FX.move(el, stage.x + (i - mid) * cw * 0.42, stage.y + Math.abs(i - mid) * 4, { ms: 650, delay: i * 90, rot: (i - mid) * 5, scale: 0.85 });
                  els.push(el);
                });
              } else {
                const from = seatPos(side);
                for (let i = 0; i < e.k; i++) {
                  const el = FX.place(BACK, from.x, from.y, { width: 46 });
                  FX.move(el, stage.x + i * 3, stage.y - i * 3, { ms: 650, delay: i * 90, width: 84, rot: (i % 2 ? 3 : -3) });
                  els.push(el);
                }
              }
              groups[side] = { els, stage };
            }
            const a = seatPos(e.seat), b = seatPos(e.target);
            FX.sprite('sparkle', a.x, a.y, { scale: 2 }); FX.sprite('sparkle', b.x, b.y, { scale: 2 });
          });
          // 2) the two lined-up piles swap owners
          at(Pace.WHEEL_MS + Pace.PICK_MS + 500, () => {
            for (const [from, to] of [[e.seat, e.target], [e.target, e.seat]]) {
              const g = groups[from]; if (!g) continue;
              const dest = to === mySeat() ? { x: innerWidth / 2, y: innerHeight - 90 } : seatPos(to);
              const dx = dest.x - g.stage.x, dy = dest.y - g.stage.y;
              g.els.forEach((el, i) => {
                FX.move(el, parseFloat(el.style.left) + dx, parseFloat(el.style.top) + dy, { ms: Pace.SWAP_MS - 200, delay: i * 40, scale: 0.8 });
                setTimeout(() => FX.drop(el, 200), Pace.SWAP_MS);
              });
            }
          });
          break;
        }
        case 'rouletteStart': at(0, () => { const c = pileC(); FX.sprite('sparkle2', c.x, c.y, { scale: 4 }); FX.bigText('VÒNG QUAY TỬ THẦN', 'purple', 1500); }); break;
        case 'roulette': {
          at(0, () => FX.bigText(`${nameOf(e.seat)} chọn ${E.COLOR_NAMES[e.color]}`, 'purple small', 1200));
          e.flipped.forEach((card, i) => at(600 + i * 380, () => {
            const c = pileC(), p = seatPos(e.seat);
            FX.fly(cardSrc(card), c, p, { width: 120, ms: 600, fromScale: 1.3 });
          }));
          at(600 + e.flipped.length * 380, () => { const p = seatPos(e.seat); FX.sprite('sparkle', p.x, p.y, { scale: 3 }); FX.bigText(`Lật ${e.flipped.length} lá!`, 'purple small', 1100); });
          break;
        }
        case 'knockout': at(200, () => {
          const p = seatPos(e.seat);
          FX.sprite('koBoom', p.x, p.y, { scale: 3 }); FX.sprite('skull', p.x, p.y - 30, { scale: 3 }); FX.shake(700);
          FX.bigText(`${nameOf(e.seat)}: TỚI SỐ!`, 'red huge', 2000);
        }); break;
        case 'lastCard': at(0, () => { const p = seatPos(e.seat); FX.sprite('heartbeat', p.x, p.y - 50, { scale: 2 }); }); break;
        case 'toiBen': at(0, () => { const p = seatPos(e.seat); FX.sprite('firework', p.x, p.y, { scale: 3 }); FX.bigText('TỚI BẾN!', 'gold huge'); }); break;
        case 'reshuffle': at(0, () => FX.bigText('Trộn lại bài', 'small')); break;
        case 'win': at(0, () => {
          const p = seatPos(e.seat);
          FX.sprite('firework2', p.x, p.y, { scale: 4 }); FX.sprite('crown', p.x, p.y - 80, { scale: 3, maxFrames: 30 });
          FX.bigText(e.seat === mySeat() ? 'CHIẾN THẮNG!' : `${nameOf(e.seat)} THẮNG!`, 'gold huge', 2500);
          if (e.seat !== mySeat() && mySeat() >= 0) setTimeout(() => FX.sprite('gameOver', innerWidth / 2, innerHeight * 0.3, { scale: 1.5, maxFrames: 30 }), 900);
        }); break;
      }
      t += Pace.eventMs(e);
    }
    return t;
  }

  // ---------- turn timer ----------
  function timerLeft(seat) {
    if (!timer || !S || !S.view || timer.seat !== seat || S.view.actor !== seat || S.view.phase === 'over') return null;
    return Math.max(0, timer.end - performance.now());
  }
  function timerBadge(seat) {
    return timerLeft(seat) == null ? '' : `<span class="tmr" data-seat="${seat}"><b></b></span>`;
  }
  function tickTimer() {
    if (!S || !S.view) return;
    for (const el of document.querySelectorAll('.tmr')) {
      const left = timerLeft(Number(el.dataset.seat));
      if (left == null) { el.remove(); continue; }
      const sec = Math.min(Math.ceil(left / 1000), Math.round(timer.total / 1000));
      el.querySelector('b').textContent = sec;
      el.style.setProperty('--p', Math.min(1, left / timer.total));
      el.classList.toggle('low', sec <= 10);
    }
    const mine = timerLeft(mySeat());
    const st = $('status');
    if (mine == null) delete st.dataset.left;
    else {
      const sec = Math.min(Math.ceil(mine / 1000), Math.round(timer.total / 1000));
      st.dataset.left = sec;
      st.classList.toggle('low', sec <= 10);
    }
  }
  setInterval(tickTimer, 250);

  // ---------- card help + tooltips ----------
  const EFFECT = {
    number: 'Không có hiệu ứng. Đánh khi trùng màu hoặc trùng số.',
    zero: 'Tung đồng xu: ra 1 thì mọi người chuyển cả xấp bài cho người kế tiếp theo chiều đánh, ra 0 thì giữ nguyên.',
    seven: 'Chọn 1 đối thủ. Hệ thống quay K (1–5) rồi đổi ngẫu nhiên K lá giữa hai bên (ít hơn nếu một bên không đủ bài).',
    skip: 'Người kế tiếp mất lượt.',
    reverse: 'Đảo chiều vòng đánh. Còn 2 người thì như Cấm Lượt.',
    draw2: 'Cộng +2 vào chuỗi phạt. Người bị nhắm đỡ bằng lá phạt từ +2 trở lên, hoặc rút hết.',
    draw4: 'Lá phạt +4 có màu. Trong chuỗi, đè được lên +2/+4 bất kể màu.',
    discardAll: 'Xả luôn mọi lá cùng màu trên tay.',
    skipEveryone: 'Mọi người khác mất lượt, bạn đánh tiếp ngay.',
    wildReverseDraw4: 'Chọn màu, đảo chiều, người kế tiếp theo chiều mới chịu +4. Còn 2 người thì phạt quay về chính bạn.',
    wildDraw6: 'Chọn màu, cộng +6 vào chuỗi. Chỉ đỡ được bằng +6 hoặc +10.',
    wildDraw10: 'Chọn màu, cộng +10 vào chuỗi. Chỉ đỡ được bằng +10.',
    wildRoulette: 'Người kế tiếp chọn 1 màu, lật bài đến khi ra màu đó, nhận hết và mất lượt. Không đỡ được, không dùng để đỡ.'
  };
  const effectOf = c => c.kind === 'number' ? (c.value === 0 ? EFFECT.zero : c.value === 7 ? EFFECT.seven : EFFECT.number) : EFFECT[c.kind];
  const HELP_CARDS = [
    [{ color: 'red', kind: 'number', value: 5 }, 'Lá số 1–6, 8, 9', 'number'],
    [{ color: 'yellow', kind: 'number', value: 0 }, 'Số 0: Chuyển Bài', 'zero'],
    [{ color: 'green', kind: 'number', value: 7 }, 'Số 7: Tráo Bài', 'seven'],
    [{ color: 'red', kind: 'skip' }, 'Cấm Lượt', 'skip'],
    [{ color: 'blue', kind: 'reverse' }, 'Đảo Chiều', 'reverse'],
    [{ color: 'yellow', kind: 'draw2' }, 'Rút Hai (+2)', 'draw2'],
    [{ color: 'green', kind: 'draw4' }, 'Rút Bốn (+4)', 'draw4'],
    [{ color: 'blue', kind: 'discardAll' }, 'Xả Toàn Bộ', 'discardAll'],
    [{ color: 'red', kind: 'skipEveryone' }, 'Cấm Cả Bàn', 'skipEveryone'],
    [{ color: 'wild', kind: 'wildReverseDraw4' }, 'Đa Sắc Đảo Chiều +4', 'wildReverseDraw4'],
    [{ color: 'wild', kind: 'wildDraw6' }, 'Đa Sắc +6', 'wildDraw6'],
    [{ color: 'wild', kind: 'wildDraw10' }, 'Đa Sắc +10', 'wildDraw10'],
    [{ color: 'wild', kind: 'wildRoulette' }, 'Vòng Quay Tử Thần', 'wildRoulette']
  ];
  function openHelp() {
    $('helpRules').innerHTML = `<ul>
      <li>Đánh lá trùng <b>màu</b>, trùng <b>số/ký hiệu</b>, hoặc lá <b>Đa Sắc</b>.</li>
      <li>Không đánh được thì bấm Rút bài: hệ thống tự rút đến khi ra lá đánh được (phải đánh ngay) hoặc đủ <b>${E.MAX_DRAW} lá</b> (mất lượt).</li>
      <li>Lá phạt cộng dồn: đỡ bằng lá phạt <b>bằng hoặc lớn hơn</b> (+2 ≤ +4 ≤ +6 ≤ +10), không cần trùng màu.</li>
      <li>Chạm <b>${E.KNOCKOUT} lá</b> là <b>Tới Số</b> (bị loại). Hết bài hoặc là người cuối cùng còn sống thì thắng.</li>
      <li>Mỗi lượt có <b>${Math.round(Pace.TURN_MS / 1000)} giây</b>; hết giờ hệ thống tự đánh thay.</li>
    </ul>`;
    $('helpGrid').innerHTML = HELP_CARDS.map(([c, name, key]) => `
      <div class="help-item"><img src="${cardSrc(c)}" alt=""><div><h4>${name}</h4><p>${EFFECT[key]}</p>
      <span class="pts">${E.cardPoints(c)} điểm khi kẹt trên tay</span></div></div>`).join('');
    $('help').classList.remove('hidden');
  }

  function showTip(el) {
    const c = el._card;
    if (!c) return;
    const tip = $('tip');
    const col = c.color === 'wild' ? 'linear-gradient(90deg,#de0c0a,#e0af06,#08682c,#063c9f)' : COLOR_HEX[c.color];
    const playable = el.classList.contains('playable');
    tip.innerHTML = `<div class="tip-head"><span class="tip-dot" style="background:${col}"></span><h4>${esc(E.cardName(c))}</h4></div>
      <p>${effectOf(c)}</p>
      <div class="tip-foot"><span>${E.cardPoints(c)} điểm</span>${el.classList.contains('hand-card') ? (playable ? '<span class="ok">Đánh được</span>' : '<span class="no">Chưa đánh được</span>') : ''}</div>`;
    tip.classList.remove('hidden');
    const r = el.getBoundingClientRect();
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let x = r.left + r.width / 2 - tw / 2, y = r.top - th - 14;
    if (y < 8) y = r.bottom + 14;
    x = Math.max(8, Math.min(innerWidth - tw - 8, x));
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  }
  function hideTip() { $('tip').classList.add('hidden'); }
  document.addEventListener('mouseover', e => {
    const el = e.target.closest && e.target.closest('.hand-card, .pile-card.top');
    if (el && matchMedia('(hover: hover)').matches) showTip(el); else hideTip();
  });

  // ---------- utils ----------
  function toast(text, type) {
    const t = $('toast');
    t.textContent = text; t.className = 'show ' + (type || '');
    clearTimeout(t._h); t._h = setTimeout(() => (t.className = ''), 2600);
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function initial(n) { return esc((n || '?').trim().charAt(0).toUpperCase()); }
  function avatarColor(n) { let h = 0; for (const ch of n || '') h = (h * 31 + ch.charCodeAt(0)) % 360; return `hsl(${h} 55% 40%)`; }
})();
