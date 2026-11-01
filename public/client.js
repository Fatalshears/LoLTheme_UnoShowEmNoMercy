// Chơi Tới Bến — browser client.
(function () {
  'use strict';
  const E = window.ToiBenEngine;
  const $ = id => document.getElementById(id);
  const socket = io();
  const store = {
    get: k => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } }
  };

  let S = null;            // last state from server
  let token = store.get('toiben_token');
  let emotes = [];
  let lastLogLen = 0;

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
    const prev = S;
    S = s;
    render(prev);
    playEvents(s.events || [], prev);
  });
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
    const rx = W * 0.42, ry = H * 0.36;
    const x = W / 2 + rx * Math.cos(ang), y = H * 0.44 + ry * Math.sin(ang);
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
      if (!s.out && s.count >= 22) el.classList.add('danger');
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
        </div>`;
      if (S.me && S.me.host && !p.bot && !s.out) {
        el.title = 'Chủ phòng: bấm đúp để bật/tắt tự đánh cho ghế này';
        el.ondblclick = () => socket.emit('toggleAuto', { id: p.id });
      }
      box.appendChild(el);
    }
  }

  function renderCenter() {
    const v = S.view;
    $('topCard').src = cardSrc(v.top);
    $('colorRing').style.boxShadow = `0 0 0 6px ${COLOR_HEX[v.activeColor] || '#888'}, 0 0 30px 8px ${COLOR_HEX[v.activeColor] || '#888'}`;
    $('drawCount').textContent = v.drawCount;
    $('dirRing').classList.toggle('ccw', v.direction < 0);
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
      if (v.drawnThisTurn > 0) return `Rút tiếp (${v.drawnThisTurn}/${v.maxDraw})…`;
      return 'Tới lượt bạn: đánh một lá hợp lệ hoặc rút bài.';
    }
    return `Lượt của ${name(v.current)}.`;
  }

  function renderHand() {
    const v = S.view, hand = v.hand || [];
    const box = $('hand');
    box.innerHTML = '';
    const n = hand.length;
    const playable = new Set(v.playable);
    const maxW = Math.min(innerWidth - 40, 1200);
    const cardW = Math.max(70, Math.min(120, innerWidth / 11));
    const step = n > 1 ? Math.min(cardW * 0.8, (maxW - cardW) / (n - 1)) : 0;
    const totalW = cardW + step * (n - 1);
    const sorted = hand.slice().sort(sortCards);
    sorted.forEach((c, i) => {
      const img = document.createElement('img');
      img.src = cardSrc(c);
      img.className = 'card hand-card';
      img.style.width = cardW + 'px';
      img.style.setProperty('--cw', cardW + 'px');
      img.style.left = `calc(50% - ${totalW / 2}px + ${i * step}px)`;
      img.style.zIndex = i;
      img.title = E.cardName(c);
      if (playable.has(c.id)) { img.classList.add('playable'); img.onclick = () => tryPlay(c); }
      else if (v.actor === mySeat()) img.classList.add('dim');
      box.appendChild(img);
    });
    const me = v.seats[mySeat()];
    box.classList.toggle('danger', !!me && !me.out && n >= 22);
    const chip = $('meChip');
    chip.classList.toggle('hidden', !me);
    if (me) {
      chip.className = 'seat-static' + (v.actor === me.seat && v.phase !== 'over' ? ' active' : '') + (!me.out && n >= 22 ? ' danger' : '');
      chip.innerHTML = `<div class="seat-info"><span class="avatar" style="background:${avatarColor(me.name)}">${me.out ? '💀' : initial(me.name)}</span>
        <span class="pname">${esc(me.name)} (bạn)</span><span class="count">${me.out ? 'TỚI SỐ' : n + ' lá'}</span></div>`;
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
    $('drawBtn').textContent = v.drawnThisTurn ? `Rút tiếp (${v.drawnThisTurn}/${v.maxDraw})` : 'Rút bài';
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
      endTimer = setTimeout(() => $('roundEnd').classList.remove('hidden'), 3200);
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
    renderLobby();
    if (!S.view || S.status === 'lobby') { $('roundEnd').classList.add('hidden'); return; }
    renderSeats(); renderCenter(); renderHand(); renderActions(); renderLog(); renderRoundEnd();
    if (S.view.phase === 'roulette' && S.view.roulette.victim === mySeat() && !$('modal').dataset.open) {
      chooseColor('Vòng Quay Tử Thần', 'Chọn một màu. Hệ thống sẽ lật bài đến khi ra đúng màu đó và bạn nhận hết.', false)
        .then(color => color && act({ type: 'rouletteColor', color }));
    }
  }
  addEventListener('resize', () => S && S.view && S.status !== 'lobby' && render());

  // ---------- actions ----------
  function act(a) { socket.emit('act', a); }
  $('drawBtn').onclick = () => act({ type: 'draw' });
  $('drawPile').onclick = () => { if ($('drawPile').classList.contains('clickable')) act({ type: 'draw' }); };
  $('acceptBtn').onclick = () => act({ type: 'acceptStack' });
  $('toiBenBtn').onclick = () => act({ type: 'callToiBen' });
  $('logBtn').onclick = () => $('logPanel').classList.toggle('hidden');
  $('emoteBtn').onclick = () => $('emotePanel').classList.toggle('hidden');

  async function tryPlay(c) {
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
    act(a);
  }

  // ---------- modal helpers ----------
  function openModal(title, text, cancellable, onCancel) {
    $('modalTitle').textContent = title;
    $('modalText').textContent = text;
    $('modalBody').innerHTML = '';
    $('modal').classList.remove('hidden');
    $('modal').dataset.open = '1';
    $('modalCancel').classList.toggle('hidden', !cancellable);
    $('modalCancel').onclick = () => { closeModal(); onCancel && onCancel(); };
  }
  function closeModal() { $('modal').classList.add('hidden'); delete $('modal').dataset.open; }

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
  function playEvents(events, prev) {
    const discard = () => centerOf($('discardPile'));
    const deck = () => centerOf($('drawPile'));
    const seatPos = s => (s === mySeat() ? { x: innerWidth / 2, y: innerHeight - 90 } : seatCenter(s));
    let delay = 0;
    const later = (fn, ms = 0) => setTimeout(fn, (delay += ms));
    for (const e of events) {
      switch (e.type) {
        case 'roundStart': FX.bigText('VÁN MỚI!', 'gold'); break;
        case 'play': {
          const from = seatPos(e.seat), to = discard();
          FX.fly(cardSrc(e.card), from, to, { width: 110, fromRot: -20, toRot: 0, fade: true });
          later(() => FX.sprite('impact', to.x, to.y, { scale: 2.5 }), 380);
          if (E.isWild(e.card) && E.needsColor(e.card)) later(() => FX.sprite('light', to.x, to.y, { scale: 1.6 }), 100);
          break;
        }
        case 'discardAll': if (e.count) {
          const from = seatPos(e.seat), to = discard();
          for (let i = 0; i < Math.min(e.count, 10); i++) setTimeout(() => FX.fly(BACK, from, to, { width: 80, fromRot: i * 20 }), delay + i * 70);
          later(() => FX.sprite('smoke', to.x, to.y, { scale: 3 }), 300);
          FX.bigText(`XẢ ${e.count + 1} LÁ!`, 'small');
        } break;
        case 'skip': for (const s of e.seats) { const p = seatPos(s); later(() => FX.sprite('skip', p.x, p.y, { scale: 1.6, maxFrames: 24, fps: 24 }), 0); } delay += 200; break;
        case 'reverse': { const c = discard(); later(() => FX.sprite('warp', c.x, c.y, { scale: 3 }), 200); FX.bigText('ĐẢO CHIỀU!', 'small'); break; }
        case 'stack': {
          const p = seatPos(e.target);
          if (e.value >= 10) { later(() => { FX.sprite('boom10', p.x, p.y, { scale: 2.5 }); FX.shake(600); }, 350); FX.bigText(`+${e.total}`, 'red huge'); }
          else if (e.value >= 6) { later(() => { FX.sprite('bolt', p.x, p.y - 60, { scale: 2.5 }); FX.sprite('lightning', p.x, p.y, { scale: 3 }); FX.shake(350); }, 350); FX.bigText(`+${e.total}`, 'red'); }
          else { later(() => FX.sprite('hit', p.x, p.y, { scale: 3 }), 350); FX.bigText(`+${e.total}`, 'red small'); }
          if (prev && prev.view && prev.view.phase === 'stack') later(() => FX.sprite('shield', seatPos(e.seat).x, seatPos(e.seat).y, { scale: 1.5 }), 0);
          break;
        }
        case 'takeStack': case 'draw': {
          const p = seatPos(e.seat), d = deck();
          const n = Math.min(e.count, 12);
          for (let i = 0; i < n; i++) setTimeout(() => FX.fly(BACK, d, p, { width: 70, ms: 350 }), delay + i * 60);
          if (e.type === 'takeStack') later(() => FX.sprite('absorb', p.x, p.y, { scale: 1.4 }), 200);
          break;
        }
        case 'drawFail': FX.bigText('MẤT LƯỢT', 'small'); break;
        case 'zero': { const c = discard(); FX.wheel('Số 0: chuyển bài', [0, 1, 2], e.n, c.x, c.y - 170);
          if (e.n > 0) setTimeout(() => { for (const s of e.order) { const a = seatPos(s), b = seatPos(e.order[(e.order.indexOf(s) + 1) % e.order.length]); FX.fly(BACK, a, b, { width: 80, ms: 700 }); } }, 1800);
          break; }
        case 'seven': { const c = discard(); FX.wheel('Số 7: tráo', [1, 2, 3, 4, 5], e.K, c.x, c.y - 170);
          setTimeout(() => { const a = seatPos(e.seat), b = seatPos(e.target); for (let i = 0; i < e.k; i++) { setTimeout(() => { FX.fly(BACK, a, b, { width: 70, ms: 600 }); FX.fly(BACK, b, a, { width: 70, ms: 600 }); }, i * 120); } }, 1800);
          break; }
        case 'rouletteStart': { const c = discard(); FX.sprite('sparkle2', c.x, c.y, { scale: 4 }); FX.bigText('VÒNG QUAY TỬ THẦN', 'purple'); break; }
        case 'roulette': {
          const c = discard(), p = seatPos(e.seat);
          e.flipped.forEach((card, i) => setTimeout(() => FX.fly(cardSrc(card), c, p, { width: 100, ms: 500, fromScale: 1.3 }), delay + i * 220));
          later(() => FX.sprite('sparkle', p.x, p.y, { scale: 3 }), e.flipped.length * 220);
          FX.bigText(`Lật ${e.flipped.length} lá!`, 'purple small');
          break;
        }
        case 'knockout': { const p = seatPos(e.seat);
          later(() => { FX.sprite('koBoom', p.x, p.y, { scale: 3 }); FX.sprite('skull', p.x, p.y - 30, { scale: 3 }); FX.shake(700); FX.bigText(`${S.view.seats[e.seat].name}: TỚI SỐ!`, 'red huge', 2000); }, 300);
          break; }
        case 'lastCard': { const p = seatPos(e.seat); FX.sprite('heartbeat', p.x, p.y - 50, { scale: 2 }); break; }
        case 'toiBen': { const p = seatPos(e.seat); FX.sprite('firework', p.x, p.y, { scale: 3 }); FX.bigText('TỚI BẾN!', 'gold huge'); break; }
        case 'reshuffle': FX.bigText('Trộn lại bài', 'small'); break;
        case 'win': { const p = seatPos(e.seat);
          later(() => { FX.sprite('firework2', p.x, p.y, { scale: 4 }); FX.sprite('crown', p.x, p.y - 80, { scale: 3, maxFrames: 30 });
            FX.bigText(e.seat === mySeat() ? 'CHIẾN THẮNG!' : `${S.view.seats[e.seat].name} THẮNG!`, 'gold huge', 2500); }, 600);
          if (e.seat !== mySeat() && mySeat() >= 0) later(() => FX.sprite('gameOver', innerWidth / 2, innerHeight * 0.3, { scale: 1.5, maxFrames: 30 }), 1500);
          break; }
      }
    }
  }

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
