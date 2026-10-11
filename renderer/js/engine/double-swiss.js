// FIDE C.04.5 Double-Swiss. Each pairing is two games. The player given
// White plays White in the first game and Black in the second.
import { computeStates, pairablePlayers, byePoints, RESULTS } from './state.js';

function initialColour(t) {
  return t.initialColor === 'black' ? 'B' : 'W';
}

function identifier(pairs) {
  const ordered = pairs.map(([a, b]) => a.no < b.no ? [a, b] : [b, a])
    .sort((a, b) => a[0].no - b[0].no);
  return [...ordered.map(([top]) => top.no), ...ordered.map(([, bottom]) => bottom.no)];
}

function compareIds(a, b) {
  const left = identifier(a), right = identifier(b);
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return 0;
}

function firstLegal(players, blocked) {
  const sorted = [...players].sort((a, b) => a.no - b.no);
  let best = null;
  let nodes = 0;
  function search(remaining, pairs) {
    if (nodes++ > 250000) return;
    if (!remaining.length) {
      if (!best || compareIds(pairs, best) < 0) best = pairs.map(pair => [...pair]);
      return;
    }
    const top = remaining[0];
    const rest = remaining.slice(1);
    for (let i = 0; i < rest.length; i++) {
      if (blocked(top, rest[i])) continue;
      search(rest.filter((_, index) => index !== i), [...pairs, [top, rest[i]]]);
    }
  }
  search(sorted, []);
  return best;
}

function whites(state) {
  return (state?.colors ?? []).filter(colour => colour === 'W').length;
}

function allocate(t, states, pairs) {
  const initial = initialColour(t);
  return pairs.map(([a, b]) => {
    const sa = states.get(a.id), sb = states.get(b.id);
    const hrpIsA = sa.score > sb.score || (sa.score === sb.score && a.no < b.no);
    const hrp = hrpIsA ? a : b;
    const other = hrpIsA ? b : a;
    const hs = states.get(hrp.id), os = states.get(other.id);
    let colour;
    if (!hs.colors.length && !os.colors.length) {
      colour = hrp.no % 2 === 1 ? initial : (initial === 'W' ? 'B' : 'W');
    } else if (whites(hs) !== whites(os)) {
      colour = whites(hs) < whites(os) ? 'W' : 'B';
    } else {
      let previous = null;
      const limit = Math.min(hs.colors.length, os.colors.length);
      for (let i = 1; i <= limit; i++) {
        const left = hs.colors[hs.colors.length - i];
        const right = os.colors[os.colors.length - i];
        if (left !== right) { previous = left; break; }
      }
      if (previous) colour = previous === 'W' ? 'B' : 'W';
      else if (hs.colors.length) colour = hs.colors[hs.colors.length - 1] === 'W' ? 'B' : 'W';
      else colour = os.colors[os.colors.length - 1] === 'W' ? 'W' : 'B';
    }
    const white = colour === 'W' ? hrp : other;
    const black = white === hrp ? other : hrp;
    return { whiteId: white.id, blackId: black.id, games: ['', ''] };
  });
}

export function matchIsDoubleForfeit(pairing) {
  const games = pairing?.games;
  if (!Array.isArray(games) || games.length < 2 || games.some(code => !RESULTS[code])) return false;
  const specs = games.map(code => RESULTS[code]);
  const forfeitedBoth = side => specs.every(spec => !spec.played && spec[side] === 'loss');
  return forfeitedBoth('w') || forfeitedBoth('b');
}

export function pairDoubleSwiss(t, round, options = {}) {
  const log = [], warnings = [];
  const states = computeStates(t, round - 1);
  const exclude = options.excludeIds instanceof Set
    ? options.excludeIds
    : new Set(options.excludeIds ?? []);
  let players = pairablePlayers(t, round).filter(player => !exclude.has(player.id));
  if (!players.length) return { ok: false, pairings: [], bye: null, log, warnings: ['No pairable players.'] };

  let bye = null;
  if (players.length % 2 === 1) {
    const eligible = players.filter(player => {
      const state = states.get(player.id);
      return !state.hadPAB && !state.fullPointUnplayed;
    });
    const pool = [...(eligible.length ? eligible : players)].sort((a, b) =>
      (states.get(a.id).score - states.get(b.id).score) ||
      (states.get(b.id).gamesPlayed - states.get(a.id).gamesPlayed) ||
      (b.no - a.no));
    const chosen = pool[0];
    bye = { playerId: chosen.id, type: 'PAB' };
    players = players.filter(player => player.id !== chosen.id);
    log.push(`Round ${round}: pairing-allocated bye → ${chosen.name} (${byePoints('PAB', t)} pt).`);
    if (!eligible.length) warnings.push('No player is eligible for the pairing-allocated bye. Assigning it to the lowest player.');
  }

  const blocked = (a, b) => states.get(a.id).opponents.has(b.id);
  const pairs = firstLegal(players, blocked);
  if (!pairs || pairs.length * 2 !== players.length) {
    return {
      ok: false, pairings: [], bye, log,
      warnings: [...warnings, 'Double Swiss cannot pair the field. The Chief Arbiter decides.']
    };
  }
  return { ok: true, pairings: allocate(t, states, pairs), bye, log, warnings };
}
