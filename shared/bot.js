// Simple bot / auto-play for Chơi Tới Bến. Returns one action for the seat that must act.
(function (root) {
  'use strict';
  const E = typeof module !== 'undefined' && module.exports ? require('./engine.js') : root.ToiBenEngine;

  function favoriteColor(hand) {
    const n = { red: 0, yellow: 0, green: 0, blue: 0 };
    for (const c of hand) if (c.color in n) n[c.color]++;
    return Object.keys(n).sort((a, b) => n[b] - n[a])[0];
  }

  function fewestCardsOpponent(st, seat) {
    return E.alive(st).filter(s => s.seat !== seat).sort((a, b) => a.hand.length - b.hand.length)[0].seat;
  }

  function score(st, seat, c) {
    const hand = st.seats[seat].hand;
    const next = st.seats[E.nextSeat(st, seat)];
    const danger = next.hand.length <= 3;
    if (c.kind === 'discardAll') return 40 + 5 * hand.filter(x => x.color === c.color).length;
    if (E.isStackCard(c)) return (danger ? 60 : 15) - (E.isWild(c) ? 10 : 0);
    if (c.kind === 'skipEveryone') return 35;
    if (c.kind === 'skip' || c.kind === 'reverse') return danger ? 45 : 20;
    if (c.kind === 'wildRoulette') return danger ? 50 : 5;
    if (c.kind === 'number' && c.value === 7) {
      const me = hand.length, least = st.seats[fewestCardsOpponent(st, seat)].hand.length;
      return me > least + 2 ? 30 : 8;
    }
    if (c.kind === 'number') return 22 + c.value * 0.2;
    return 10;
  }

  function optsFor(st, seat, c) {
    const a = { type: 'play', cardId: c.id };
    const rest = st.seats[seat].hand.filter(x => x.id !== c.id);
    if (E.needsColor(c)) a.color = favoriteColor(rest.length ? rest : st.seats[seat].hand);
    if (c.kind === 'number' && c.value === 7) a.target = fewestCardsOpponent(st, seat);
    return a;
  }

  function decide(st, seat) {
    const hand = st.seats[seat].hand;
    if (st.phase === 'roulette') return { type: 'rouletteColor', color: favoriteColor(hand) };
    const ids = E.playableIds(st, seat);
    if (st.phase === 'stack') {
      if (!ids.length) return { type: 'acceptStack' };
      // deflect with the smallest card that is allowed
      const cards = hand.filter(c => ids.includes(c.id)).sort((a, b) => E.STACK_VALUE[a.kind] - E.STACK_VALUE[b.kind]);
      return optsFor(st, seat, cards[0]);
    }
    if (st.phase === 'mustPlayDrawn') return optsFor(st, seat, hand.find(c => c.id === st.drawnCardId));
    if (!ids.length) return { type: 'draw' };
    const cards = hand.filter(c => ids.includes(c.id)).sort((a, b) => score(st, seat, b) - score(st, seat, a));
    return optsFor(st, seat, cards[0]);
  }

  const api = { decide };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ToiBenBot = api;
})(typeof window !== 'undefined' ? window : globalThis);
