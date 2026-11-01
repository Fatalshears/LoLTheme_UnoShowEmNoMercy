// Chơi Tới Bến — rules engine (luật bản 4).
// Pure logic, no I/O. Works in Node (require) and the browser (window.ToiBenEngine).
(function (root) {
  'use strict';

  const COLORS = ['red', 'yellow', 'green', 'blue'];
  const KNOCKOUT = 27;          // Tới Số at this many cards
  const HAND_SIZE = 7;
  const MAX_DRAW = 5;           // draw at most 5 per turn looking for a playable card
  const SEVEN_MAX = 5;          // the 7 swaps K in 1..5 cards
  const STACK_VALUE = { draw2: 2, draw4: 4, wildReverseDraw4: 4, wildDraw6: 6, wildDraw10: 10 };
  const WILD_KINDS = ['wildReverseDraw4', 'wildRoulette', 'wildDraw6', 'wildDraw10'];

  const NAMES = {
    skip: 'Cấm Lượt', reverse: 'Đảo Chiều', draw2: 'Rút Hai (+2)', draw4: 'Rút Bốn (+4)',
    discardAll: 'Xả Toàn Bộ', skipEveryone: 'Cấm Cả Bàn', wildReverseDraw4: 'Đa Sắc Đảo Chiều +4',
    wildRoulette: 'Vòng Quay Tử Thần', wildDraw6: 'Đa Sắc +6', wildDraw10: 'Đa Sắc +10'
  };
  const COLOR_NAMES = { red: 'Đỏ', yellow: 'Vàng', green: 'Xanh Lá', blue: 'Xanh Dương', wild: 'Đa Sắc' };

  function cardName(c) {
    if (c.kind === 'number') return `${c.value} ${COLOR_NAMES[c.color]}`;
    if (c.color === 'wild') return NAMES[c.kind];
    return `${NAMES[c.kind]} ${COLOR_NAMES[c.color]}`;
  }

  function cardPoints(c) {
    if (c.kind === 'number') return c.value;
    return c.color === 'wild' ? 50 : 20;
  }

  const isWild = c => c.color === 'wild';
  const isStackCard = c => c.kind in STACK_VALUE;

  // 252 cards: per color 0×3, 1–9×3, Skip/+2/Reverse/Discard All 4 or 5, +4×3, Skip Everyone×3;
  // wild: Reverse+4×12, Roulette×12, +6×6, +10×6.
  function buildDeck() {
    const deck = [];
    let id = 0;
    const add = (color, kind, value = null) => deck.push({ id: id++, color, kind, value });
    for (const c of COLORS) {
      const redYellow = c === 'red' || c === 'yellow';
      for (let n = 0; n <= 9; n++) for (let i = 0; i < 3; i++) add(c, 'number', n);
      const counts = {
        skip: redYellow ? 5 : 4, draw2: redYellow ? 5 : 4,
        reverse: redYellow ? 4 : 5, discardAll: redYellow ? 4 : 5,
        draw4: 3, skipEveryone: 3
      };
      for (const [k, n] of Object.entries(counts)) for (let i = 0; i < n; i++) add(c, k);
    }
    for (const [k, n] of [['wildReverseDraw4', 12], ['wildRoulette', 12], ['wildDraw6', 6], ['wildDraw10', 6]]) {
      for (let i = 0; i < n; i++) add('wild', k);
    }
    return deck;
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  const randInt = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));

  // players: [{ name }]. Seat 0 is "Ghế 1" and starts.
  function newRound(players, seed) {
    if (players.length < 2 || players.length > 8) throw new Error('Cần 2–8 người chơi');
    const rng = mulberry32(seed ?? (Date.now() ^ Math.floor(Math.random() * 1e9)));
    const drawPile = shuffle(buildDeck(), rng);
    const seats = players.map((p, i) => ({ seat: i, name: p.name, hand: [], out: false }));
    for (let r = 0; r < HAND_SIZE; r++) for (const s of seats) s.hand.push(drawPile.pop());
    let top;
    for (;;) {
      top = drawPile.pop();
      if (top.kind === 'number') break;
      drawPile.splice(Math.floor(rng() * drawPile.length), 0, top); // bury it in the middle
    }
    const st = {
      seats, drawPile, discard: [top], tray: [],
      current: 0, direction: 1, activeColor: top.color,
      phase: 'play',          // play | mustPlayDrawn | stack | roulette | over
      drawnThisTurn: 0, drawnCardId: null,
      stack: null,            // { total, last, target }
      roulette: null,         // { victim, final }
      winner: null, endReason: null, knockouts: [],
      rng, events: [], log: [], turnId: 1
    };
    say(st, `Ván mới. Lá mở màn: ${cardName(top)}. ${seats[0].name} đi trước.`);
    return st;
  }

  function say(st, msg) { st.log.push(msg); if (st.log.length > 300) st.log.shift(); }
  function emit(st, ev) { st.events.push(ev); }
  const top = st => st.discard[st.discard.length - 1];
  const alive = st => st.seats.filter(s => !s.out);

  function nextSeat(st, from, steps = 1) {
    let i = from;
    const n = st.seats.length;
    for (let k = 0; k < steps; k++) {
      let guard = 0;
      do { i = (i + st.direction + n) % n; } while (st.seats[i].out && ++guard <= n);
    }
    return i;
  }

  function canMatch(st, c) {
    if (isWild(c)) return true;
    if (c.color === st.activeColor) return true;
    const t = top(st);
    if (t.kind === 'number' && c.kind === 'number') return t.value === c.value;
    return t.kind === c.kind;
  }

  // Cards the seat may play right now (empty when it isn't their move).
  function playableIds(st, seat) {
    const s = st.seats[seat];
    if (st.phase === 'over' || s.out) return [];
    if (st.phase === 'stack') {
      if (st.stack.target !== seat) return [];
      return s.hand.filter(c => isStackCard(c) && STACK_VALUE[c.kind] >= st.stack.last).map(c => c.id);
    }
    if (st.current !== seat) return [];
    if (st.phase === 'mustPlayDrawn') return [st.drawnCardId];
    if (st.phase !== 'play' || st.drawnThisTurn > 0) return [];
    return s.hand.filter(c => canMatch(st, c)).map(c => c.id);
  }

  // Whose input the game is waiting for.
  function actor(st) {
    if (st.phase === 'over') return null;
    if (st.phase === 'stack') return st.stack.target;
    if (st.phase === 'roulette') return st.roulette.victim;
    return st.current;
  }

  // ---- drawing & knockouts ----

  function refill(st) {
    if (st.drawPile.length) return true;
    const t = st.discard.pop();
    const pool = st.discard.concat(st.tray);
    st.discard = [t];
    st.tray = [];
    if (!pool.length) return false;
    st.drawPile = shuffle(pool, st.rng);
    say(st, 'Chồng Rút hết, trộn lại Khay Bài Loại và Chồng Đánh.');
    emit(st, { type: 'reshuffle' });
    return true;
  }

  // Draw one card into a seat's hand. Returns the card, or null if the deck is truly empty.
  function drawOne(st, seat) {
    if (!refill(st)) { fallbackEnd(st); return null; }
    const c = st.drawPile.pop();
    st.seats[seat].hand.push(c);
    return c;
  }

  // Returns true if the seat was knocked out.
  function checkKnockout(st, seat, by) {
    const s = st.seats[seat];
    if (s.out || s.hand.length < KNOCKOUT) return false;
    s.out = true;
    st.tray.push(...s.hand);
    const n = s.hand.length;
    s.hand = [];
    st.knockouts.push({ seat, by });
    say(st, `💥 ${s.name} chạm ${n} lá và bị TỚI SỐ!`);
    emit(st, { type: 'knockout', seat, by });
    return true;
  }

  // Draw n cards one by one, stopping at a knockout. Returns cards drawn.
  function drawMany(st, seat, n, by) {
    let got = 0;
    for (let i = 0; i < n; i++) {
      if (st.phase === 'over') break;
      if (!drawOne(st, seat)) break;
      got++;
      if (checkKnockout(st, seat, by)) break;
    }
    return got;
  }

  // ---- ending ----

  function finish(st, winner, reason) {
    if (st.phase === 'over') return;
    st.phase = 'over';
    st.winner = winner;
    st.endReason = reason;
    st.stack = null;
    st.roulette = null;
    const w = st.seats[winner];
    let points = 250 * st.knockouts.length;
    for (const s of st.seats) if (s.seat !== winner && !s.out) for (const c of s.hand) points += cardPoints(c);
    st.points = points;
    say(st, `🏆 ${w.name} thắng ván (${reason}) và nhận ${points} điểm.`);
    emit(st, { type: 'win', seat: winner, reason, points });
  }

  function fallbackEnd(st) {
    const live = alive(st);
    live.sort((a, b) => a.hand.length - b.hand.length ||
      a.hand.reduce((x, c) => x + cardPoints(c), 0) - b.hand.reduce((x, c) => x + cardPoints(c), 0));
    finish(st, live[0].seat, 'hết bài để rút, ít bài nhất');
  }

  function checkLastStanding(st) {
    const live = alive(st);
    if (live.length === 1 && st.phase !== 'over') { finish(st, live[0].seat, 'kẻ sống sót cuối cùng'); return true; }
    return st.phase === 'over';
  }

  // ---- turn flow ----

  function beginTurn(st, seat) {
    st.current = seat;
    st.phase = 'play';
    st.drawnThisTurn = 0;
    st.drawnCardId = null;
    st.turnId++;
  }

  function passTurn(st, fromSeat, steps = 1) {
    if (checkLastStanding(st)) return;
    beginTurn(st, nextSeat(st, fromSeat, steps));
  }

  function takeCard(s, id) {
    const i = s.hand.findIndex(c => c.id === id);
    return i < 0 ? null : s.hand.splice(i, 1)[0];
  }

  function tuckUnderTop(st, cards) {
    const t = st.discard.pop();
    st.discard.push(...cards, t);
  }

  // ---- actions ----

  function act(st, seat, a) {
    st.events = [];
    if (st.phase === 'over') throw new Error('Ván đã kết thúc');
    if (actor(st) !== seat && a.type !== 'callToiBen') throw new Error('Chưa tới lượt bạn');
    switch (a.type) {
      case 'play': play(st, seat, a); break;
      case 'draw': draw(st, seat); break;
      case 'acceptStack': acceptStack(st, seat); break;
      case 'rouletteColor': rouletteColor(st, seat, a.color); break;
      case 'callToiBen': callToiBen(st, seat); break;
      default: throw new Error('Hành động không hợp lệ');
    }
    return st.events;
  }

  function callToiBen(st, seat) {
    const s = st.seats[seat];
    if (s.out || s.hand.length !== 1) throw new Error('Chỉ hô khi còn đúng 1 lá');
    say(st, `📣 ${s.name}: TỚI BẾN!`);
    emit(st, { type: 'toiBen', seat });
  }

  function draw(st, seat) {
    if (st.phase !== 'play') throw new Error('Không thể rút lúc này');
    if (st.drawnThisTurn >= MAX_DRAW) throw new Error('Đã rút tối đa');
    const c = drawOne(st, seat);
    if (!c) return;
    st.drawnThisTurn++;
    const s = st.seats[seat];
    emit(st, { type: 'draw', seat, count: 1 });
    if (checkKnockout(st, seat, null)) { passTurn(st, seat); return; }
    if (canMatch(st, c)) {
      st.phase = 'mustPlayDrawn';
      st.drawnCardId = c.id;
      say(st, `${s.name} rút ${st.drawnThisTurn} lá và phải đánh ngay lá vừa rút.`);
    } else if (st.drawnThisTurn >= MAX_DRAW) {
      say(st, `${s.name} rút ${MAX_DRAW} lá không ra bài, mất lượt.`);
      emit(st, { type: 'drawFail', seat });
      passTurn(st, seat);
    }
  }

  function needsColor(c) { return isWild(c) && c.kind !== 'wildRoulette'; }

  function play(st, seat, a) {
    const s = st.seats[seat];
    if (!playableIds(st, seat).includes(a.cardId)) throw new Error('Không đánh được lá này');
    const card = s.hand.find(c => c.id === a.cardId);
    if (needsColor(card) && !COLORS.includes(a.color)) throw new Error('Hãy chọn màu');
    if (card.kind === 'number' && card.value === 7 && s.hand.length > 1) {
      const t = st.seats[a.target];
      if (!t || t.out || a.target === seat) throw new Error('Hãy chọn người để tráo bài');
    }
    takeCard(s, card.id);
    st.discard.push(card);
    if (needsColor(card)) st.activeColor = a.color;
    else if (!isWild(card)) st.activeColor = card.color;
    say(st, `${s.name} đánh ${cardName(card)}${needsColor(card) ? `, chọn màu ${COLOR_NAMES[a.color]}` : ''}.`);
    emit(st, { type: 'play', seat, card, color: st.activeColor });

    if (card.kind === 'discardAll') {
      const dump = s.hand.filter(c => c.color === card.color);
      for (const c of dump) takeCard(s, c.id);
      if (dump.length) {
        tuckUnderTop(st, dump);
        say(st, `${s.name} xả kèm ${dump.length} lá ${COLOR_NAMES[card.color]}.`);
      }
      emit(st, { type: 'discardAll', seat, count: dump.length, color: card.color });
    }

    const emptied = s.hand.length === 0;
    if (s.hand.length === 1) emit(st, { type: 'lastCard', seat });

    // Stack cards (+2/+4/+6/+10/Reverse +4)
    if (isStackCard(card)) {
      const v = STACK_VALUE[card.kind];
      if (card.kind === 'wildReverseDraw4') {
        st.direction *= -1;
        emit(st, { type: 'reverse', seat, direction: st.direction });
      }
      const total = (st.phase === 'stack' ? st.stack.total : 0) + v;
      let target;
      if (card.kind === 'wildReverseDraw4' && alive(st).length === 2) target = seat; // bounces back in 1v1
      else target = nextSeat(st, seat);
      st.stack = { total, last: v, target };
      emit(st, { type: 'stack', seat, target, total, value: v });
      if (emptied) {
        // Winner's last card: the target must take it, no defense.
        say(st, `${st.seats[target].name} phải nhận ${total} lá phạt cuối cùng.`);
        if (target !== seat) {
          const got = drawMany(st, target, total, seat);
          emit(st, { type: 'takeStack', seat: target, count: got });
        }
        finish(st, seat, 'hết bài');
        return;
      }
      st.phase = 'stack';
      st.current = target;
      say(st, `Chuỗi cộng dồn: +${total} nhắm vào ${st.seats[target].name}.`);
      return;
    }

    if (card.kind === 'wildRoulette') {
      const victim = nextSeat(st, seat);
      st.phase = 'roulette';
      st.roulette = { victim, by: seat, final: emptied };
      st.current = victim;
      emit(st, { type: 'rouletteStart', seat, victim });
      say(st, `${st.seats[victim].name} phải chọn màu cho Vòng Quay Tử Thần.`);
      return;
    }

    if (emptied) { finish(st, seat, 'hết bài'); return; }

    switch (card.kind) {
      case 'skip': {
        const skipped = nextSeat(st, seat);
        emit(st, { type: 'skip', seats: [skipped] });
        passTurn(st, seat, 2);
        break;
      }
      case 'reverse':
        st.direction *= -1;
        emit(st, { type: 'reverse', seat, direction: st.direction });
        if (alive(st).length === 2) { emit(st, { type: 'skip', seats: [nextSeat(st, seat)] }); beginTurn(st, seat); }
        else passTurn(st, seat);
        break;
      case 'skipEveryone':
        emit(st, { type: 'skip', seats: alive(st).filter(x => x.seat !== seat).map(x => x.seat) });
        beginTurn(st, seat);
        break;
      case 'number':
        if (card.value === 0) zeroPass(st, seat);
        else if (card.value === 7) sevenSwap(st, seat, a.target);
        passTurn(st, seat);
        break;
      default:
        passTurn(st, seat);
    }
  }

  function zeroPass(st, seat) {
    const n = randInt(st.rng, 0, 2);
    const order = [];
    let i = seat;
    do { order.push(i); i = nextSeat(st, i); } while (i !== seat);
    for (let k = 0; k < n; k++) {
      const hands = order.map(x => st.seats[x].hand);
      order.forEach((x, idx) => { st.seats[order[(idx + 1) % order.length]].hand = hands[idx]; });
    }
    say(st, n === 0 ? 'Số 0 quay ra 0: không chuyển bài.' : `Số 0 quay ra ${n}: cả bàn chuyển bài ${n} lần.`);
    emit(st, { type: 'zero', seat, n, order });
  }

  function sevenSwap(st, seat, target) {
    const me = st.seats[seat], them = st.seats[target];
    const K = randInt(st.rng, 1, SEVEN_MAX);
    const k = Math.min(K, me.hand.length, them.hand.length);
    const pick = s => {
      const out = [];
      for (let i = 0; i < k; i++) out.push(s.hand.splice(Math.floor(st.rng() * s.hand.length), 1)[0]);
      return out;
    };
    const fromMe = pick(me), fromThem = pick(them);
    me.hand.push(...fromThem);
    them.hand.push(...fromMe);
    say(st, `Số 7 quay ra ${K}: ${me.name} và ${them.name} đổi ${k} lá ngẫu nhiên.`);
    emit(st, { type: 'seven', seat, target, K, k });
  }

  function acceptStack(st, seat) {
    if (st.phase !== 'stack') throw new Error('Không có chuỗi phạt');
    const { total } = st.stack;
    const got = drawMany(st, seat, total, null);
    if (st.phase === 'over') return;
    say(st, `${st.seats[seat].name} ôm ${got} lá phạt và mất lượt.`);
    emit(st, { type: 'takeStack', seat, count: got });
    st.stack = null;
    passTurn(st, seat);
  }

  function rouletteColor(st, seat, color) {
    if (st.phase !== 'roulette') throw new Error('Không có Vòng Quay');
    if (!COLORS.includes(color)) throw new Error('Màu không hợp lệ');
    const { by, final } = st.roulette;
    const s = st.seats[seat];
    const flipped = [];
    let hit = false;
    while (!hit) {
      const c = drawOne(st, seat);
      if (!c) return;
      flipped.push(c);
      hit = c.color === color;
      if (checkKnockout(st, seat, by)) break;
    }
    st.activeColor = color;
    say(st, `${s.name} chọn ${COLOR_NAMES[color]}, lật ${flipped.length} lá và nhận hết.`);
    emit(st, { type: 'roulette', seat, color, flipped });
    st.roulette = null;
    if (final) { finish(st, by, 'hết bài'); return; }
    passTurn(st, seat);
  }

  // What the given seat is allowed to see.
  function viewFor(st, seat) {
    return {
      seats: st.seats.map(s => ({ seat: s.seat, name: s.name, count: s.hand.length, out: s.out })),
      hand: seat != null && st.seats[seat] ? st.seats[seat].hand : [],
      playable: seat != null ? playableIds(st, seat) : [],
      top: top(st), activeColor: st.activeColor, direction: st.direction,
      drawCount: st.drawPile.length, phase: st.phase, current: st.current, actor: actor(st),
      drawnThisTurn: st.drawnThisTurn, maxDraw: MAX_DRAW,
      stack: st.stack, roulette: st.roulette && { victim: st.roulette.victim },
      winner: st.winner, endReason: st.endReason, points: st.points ?? 0,
      knockouts: st.knockouts, log: st.log.slice(-40), turnId: st.turnId
    };
  }

  const api = {
    COLORS, KNOCKOUT, MAX_DRAW, STACK_VALUE, WILD_KINDS, COLOR_NAMES,
    buildDeck, newRound, act, playableIds, actor, nextSeat, canMatch, viewFor,
    cardName, cardPoints, isWild, isStackCard, needsColor, top, alive
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ToiBenEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
