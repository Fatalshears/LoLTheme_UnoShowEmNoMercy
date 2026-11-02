// Chơi Tới Bến — animation pacing shared by server and client.
// The client plays events one after another using these durations; the server waits
// the same amount before a bot acts or a turn timer starts, so nobody acts mid-animation.
(function (root) {
  'use strict';

  const TURN_MS = 45000;   // per-decision turn timer for human players
  const WHEEL_MS = 3800;   // 7 random wheel: spin + hold on the result
  const COIN_MS = 2900;    // 0 coin flip: toss + hold on the result
  const GATHER_MS = 800;   // hands tidy into a stack before they move
  const PASS_MS = 1100;    // stacks travel to the next player
  const PICK_MS = 1000;    // the 7's chosen cards leave the hands and line up
  const SWAP_MS = 1100;    // the two piles change owners
  const PICK_SPIN_MS = 3000;  // round start: name wheel spins and slows down
  const PICK_HOLD_MS = 1300;  // ...then holds on who goes first

  // How long the client spends on one event, in ms.
  function eventMs(e) {
    switch (e.type) {
      case 'roundStart': return 1200 + PICK_SPIN_MS + PICK_HOLD_MS;
      case 'play': return 800;
      case 'discardAll': return 700 + Math.min(e.count || 0, 10) * 110;
      case 'skip': return 900;
      case 'reverse': return 1100;
      case 'stack': return 1100;
      case 'takeStack': return 450 + Math.min(e.count || 1, 12) * 120;
      case 'draw': return 500 + Math.min(e.count || 1, 12) * 300;
      case 'drawFail': return 1000;
      case 'zero': return COIN_MS + (e.n > 0 ? GATHER_MS + PASS_MS + 300 : 300);
      case 'seven': return WHEEL_MS + PICK_MS + 500 + SWAP_MS + 300;
      case 'rouletteStart': return 1500;
      case 'roulette': return 600 + (e.flipped ? e.flipped.length : 1) * 380 + 600;
      case 'knockout': return 2200;
      case 'lastCard': return 300;
      case 'reshuffle': return 900;
      case 'win': return 2600;
      default: return 0;
    }
  }

  const totalMs = events => (events || []).reduce((a, e) => a + eventMs(e), 0);

  const api = { TURN_MS, PICK_SPIN_MS, PICK_HOLD_MS, WHEEL_MS, COIN_MS, GATHER_MS, PASS_MS, PICK_MS, SWAP_MS, eventMs, totalMs };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ToiBenPace = api;
})(typeof window !== 'undefined' ? window : globalThis);
