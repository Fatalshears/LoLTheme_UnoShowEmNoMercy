// Run: npm test
const assert = require('assert');
const E = require('../shared/engine.js');
const B = require('../shared/bot.js');

const total = st => st.drawPile.length + st.discard.length + st.tray.length +
  st.seats.reduce((a, s) => a + s.hand.length, 0);

// Deck composition
{
  const d = E.buildDeck();
  assert.strictEqual(d.length, 252);
  const count = f => d.filter(f).length;
  assert.strictEqual(count(c => c.color === 'wild'), 36);
  for (const col of E.COLORS) assert.strictEqual(count(c => c.color === col), 54, col);
  assert.strictEqual(count(c => c.kind === 'number' && c.value === 0), 12);
  assert.strictEqual(count(c => c.kind === 'skip'), 18);
  assert.strictEqual(count(c => c.kind === 'draw4'), 12);
  assert.strictEqual(count(c => c.kind === 'wildDraw10'), 6);
}

// Bot-vs-bot rounds: always end, conserve cards, nobody alive ever holds 26+.
let rounds = 0, kos = 0, maxActions = 0;
const reasons = {};
for (let seed = 1; seed <= 1500; seed++) {
  const n = 2 + (seed % 7);
  const st = E.newRound(Array.from({ length: n }, (_, i) => ({ name: 'Bot' + i })), seed);
  let steps = 0;
  while (st.phase !== 'over') {
    const seat = E.actor(st);
    E.act(st, seat, B.decide(st, seat));
    assert.strictEqual(total(st), 252, `card count seed ${seed}`);
    for (const s of st.seats) if (!s.out) assert.ok(s.hand.length < E.KNOCKOUT, `alive with 26+ seed ${seed}`);
    assert.ok(++steps < 20000, `round ${seed} did not end`);
  }
  rounds++;
  kos += st.knockouts.length;
  maxActions = Math.max(maxActions, steps);
  reasons[st.endReason] = (reasons[st.endReason] || 0) + 1;
}

// Helper to hand-craft a position.
function setup(n, hands, topCard, color) {
  const st = E.newRound(Array.from({ length: n }, (_, i) => ({ name: 'P' + i })), 99);
  let id = 1000;
  st.seats.forEach((s, i) => { st.drawPile.push(...s.hand); s.hand = (hands[i] || []).map(c => ({ id: id++, value: null, ...c })); });
  st.discard = [{ id: id++, value: null, ...topCard }];
  st.current = 0;
  st.activeColor = color || topCard.color;
  return st;
}

// Stacking: +2 -> +4 -> accept = 6 cards, loses turn
{
  const st = setup(3, [[{ color: 'red', kind: 'draw2' }, { color: 'red', kind: 'number', value: 1 }],
    [{ color: 'blue', kind: 'draw4' }, { color: 'blue', kind: 'number', value: 1 }], [{ color: 'red', kind: 'number', value: 2 }]],
    { color: 'red', kind: 'number', value: 5 });
  E.act(st, 0, { type: 'play', cardId: st.seats[0].hand[0].id });
  assert.strictEqual(st.phase, 'stack'); assert.strictEqual(st.stack.target, 1);
  // +2 cannot answer a +4 later, but +4 can answer +2
  E.act(st, 1, { type: 'play', cardId: st.seats[1].hand[0].id });
  assert.strictEqual(st.stack.total, 6); assert.strictEqual(st.stack.target, 2);
  E.act(st, 2, { type: 'acceptStack' });
  assert.strictEqual(st.seats[2].hand.length, 7);
  assert.strictEqual(st.current, 0);
}

// +6 cannot be answered by +4
{
  const st = setup(2, [[{ color: 'wild', kind: 'wildDraw6' }, { color: 'red', kind: 'number', value: 1 }],
    [{ color: 'green', kind: 'draw4' }]], { color: 'red', kind: 'number', value: 5 });
  E.act(st, 0, { type: 'play', cardId: st.seats[0].hand[0].id, color: 'green' });
  assert.deepStrictEqual(E.playableIds(st, 1), []);
}

// Wild Reverse +4 in 1v1 bounces back to the player
{
  const st = setup(2, [[{ color: 'wild', kind: 'wildReverseDraw4' }, { color: 'red', kind: 'number', value: 1 }],
    [{ color: 'green', kind: 'number', value: 3 }]], { color: 'red', kind: 'number', value: 5 });
  E.act(st, 0, { type: 'play', cardId: st.seats[0].hand[0].id, color: 'blue' });
  assert.strictEqual(st.stack.target, 0);
}

// Knockout at 26 while taking a stack
{
  const filler = Array.from({ length: 24 }, () => ({ color: 'green', kind: 'number', value: 3 }));
  const st = setup(3, [[{ color: 'wild', kind: 'wildDraw10' }, { color: 'red', kind: 'number', value: 1 }], filler, [{ color: 'red', kind: 'number', value: 2 }]],
    { color: 'red', kind: 'number', value: 5 });
  E.act(st, 0, { type: 'play', cardId: st.seats[0].hand[0].id, color: 'red' });
  E.act(st, 1, { type: 'acceptStack' });
  assert.ok(st.seats[1].out);
  assert.strictEqual(st.seats[1].hand.length, 0);
  assert.strictEqual(st.current, 2);
}

// One draw action draws up to 3 cards, then the turn is lost
{
  const st = setup(2, [[{ color: 'blue', kind: 'number', value: 1 }], [{ color: 'blue', kind: 'number', value: 2 }]],
    { color: 'red', kind: 'number', value: 5 });
  st.drawPile.push(...Array.from({ length: 4 }, (_, i) => ({ id: 5000 + i, color: 'green', kind: 'number', value: 3 })));
  E.act(st, 0, { type: 'draw' });
  assert.strictEqual(E.MAX_DRAW, 3);
  assert.strictEqual(st.events.find(e => e.type === 'draw').count, 3);
  assert.strictEqual(st.current, 1);
  assert.strictEqual(st.seats[0].hand.length, 4);
}

// Auto-draw stops at the first playable card
{
  const st = setup(2, [[{ color: 'blue', kind: 'number', value: 1 }], [{ color: 'blue', kind: 'number', value: 2 }]],
    { color: 'red', kind: 'number', value: 5 });
  st.drawPile.push({ id: 5100, color: 'green', kind: 'number', value: 3 }, { id: 5101, color: 'red', kind: 'number', value: 8 }, { id: 5102, color: 'green', kind: 'number', value: 4 });
  E.act(st, 0, { type: 'draw' });
  assert.strictEqual(st.events.find(e => e.type === 'draw').count, 2);
  assert.strictEqual(st.phase, 'mustPlayDrawn');
  assert.strictEqual(st.drawnCardId, 5101);
}

// Draw a playable card -> must play it
{
  const st = setup(2, [[{ color: 'blue', kind: 'number', value: 1 }], [{ color: 'blue', kind: 'number', value: 2 }]],
    { color: 'red', kind: 'number', value: 5 });
  st.drawPile.push({ id: 6000, color: 'red', kind: 'number', value: 8 });
  E.act(st, 0, { type: 'draw' });
  assert.strictEqual(st.phase, 'mustPlayDrawn');
  assert.deepStrictEqual(E.playableIds(st, 0), [6000]);
}

// Discard All dumps every card of that color
{
  const st = setup(2, [[{ color: 'green', kind: 'discardAll' }, { color: 'green', kind: 'number', value: 7 }, { color: 'green', kind: 'skip' }, { color: 'red', kind: 'number', value: 1 }],
    [{ color: 'blue', kind: 'number', value: 2 }]], { color: 'green', kind: 'number', value: 5 });
  E.act(st, 0, { type: 'play', cardId: st.seats[0].hand[0].id });
  assert.strictEqual(st.seats[0].hand.length, 1);
  assert.strictEqual(E.top(st).kind, 'discardAll');
}

// Seven swaps min(K, hands) cards, sizes unchanged
{
  const st = setup(3, [[{ color: 'red', kind: 'number', value: 7 }, ...Array.from({ length: 6 }, () => ({ color: 'red', kind: 'number', value: 1 }))],
    [{ color: 'blue', kind: 'number', value: 2 }, { color: 'blue', kind: 'number', value: 3 }], [{ color: 'blue', kind: 'number', value: 4 }]],
    { color: 'red', kind: 'number', value: 5 });
  E.act(st, 0, { type: 'play', cardId: st.seats[0].hand[0].id, target: 1 });
  const ev = st.events.find(e => e.type === 'seven');
  assert.strictEqual(ev.k, Math.min(ev.K, 2));
  const [mine0] = E.eventsFor(st.events, 0).filter(e => e.type === 'seven');
  const [mine2] = E.eventsFor(st.events, 2).filter(e => e.type === 'seven');
  assert.strictEqual(mine0.mine.length, ev.k);
  assert.ok(!('mine' in mine2) && !('fromSeat' in mine2));
  assert.strictEqual(st.seats[0].hand.length, 6);
  assert.strictEqual(st.seats[1].hand.length, 2);
}

// Zero rotates hands n times along the direction
{
  const st = setup(3, [[{ color: 'red', kind: 'number', value: 0 }, { color: 'red', kind: 'number', value: 1 }],
    [{ color: 'blue', kind: 'number', value: 2 }, { color: 'blue', kind: 'number', value: 2 }], [{ color: 'green', kind: 'number', value: 4 }, { color: 'green', kind: 'number', value: 4 }, { color: 'green', kind: 'number', value: 4 }]],
    { color: 'red', kind: 'number', value: 5 });
  E.act(st, 0, { type: 'play', cardId: st.seats[0].hand[0].id });
  const n = st.events.find(e => e.type === 'zero').n;
  assert.ok(n === 0 || n === 1);
  const sizes = st.seats.map(s => s.hand.length);
  const expected = [[1, 2, 3], [3, 1, 2]][n];
  assert.deepStrictEqual(sizes, expected);
}

// Roulette: victim flips until their color, takes all, loses turn
{
  const st = setup(3, [[{ color: 'wild', kind: 'wildRoulette' }, { color: 'red', kind: 'number', value: 1 }],
    [{ color: 'blue', kind: 'number', value: 2 }], [{ color: 'blue', kind: 'number', value: 3 }]], { color: 'red', kind: 'number', value: 5 });
  st.drawPile.push({ id: 7002, color: 'yellow', kind: 'number', value: 1 }, { id: 7001, color: 'wild', kind: 'wildDraw6' }, { id: 7000, color: 'red', kind: 'skip' });
  E.act(st, 0, { type: 'play', cardId: st.seats[0].hand[0].id });
  assert.strictEqual(st.phase, 'roulette');
  E.act(st, 1, { type: 'rouletteColor', color: 'yellow' });
  assert.strictEqual(st.seats[1].hand.length, 4);
  assert.strictEqual(st.activeColor, 'yellow');
  assert.strictEqual(st.current, 2);
}

// Winning with a +2: next player still draws it
{
  const st = setup(2, [[{ color: 'red', kind: 'draw2' }], [{ color: 'blue', kind: 'draw2' }]], { color: 'red', kind: 'number', value: 5 });
  E.act(st, 0, { type: 'play', cardId: st.seats[0].hand[0].id });
  assert.strictEqual(st.phase, 'over'); assert.strictEqual(st.winner, 0);
  assert.strictEqual(st.seats[1].hand.length, 3);
}

console.log(`ok: ${rounds} bot rounds, ${kos} Tới Số, max ${maxActions} actions/round, end reasons ${JSON.stringify(reasons)}; scenario tests passed`);
