// FIDE Olympiad pairing rules. ECU team competitions use this same system.
// Board 1 is the team's colour. Lineups stay a later step.
import { computeStates, pairablePlayers, byePoints } from './state.js';

function scoreOf(states, player) {
  return states.get(player.id)?.score ?? 0;
}

function coloursOf(states, player) {
  return states.get(player.id)?.colors ?? [];
}

function colourDiff(colours) {
  const white = colours.filter(colour => colour === 'W').length;
  return white - (colours.length - white);
}

function violates(colours, next) {
  const diff = colourDiff(colours) + (next === 'W' ? 1 : -1);
  if (Math.abs(diff) > 2) return true;
  return colours.length >= 2 && colours[colours.length - 1] === next && colours[colours.length - 2] === next;
}

function repeat(states, a, b) {
  return states.get(a.id)?.opponents.has(b.id);
}

function sortRank(states, players) {
  return [...players].sort((a, b) => scoreOf(states, b) - scoreOf(states, a) || a.no - b.no);
}

function matchHalves(s1, s2, states, strict) {
  const used = new Array(s2.length).fill(false);
  const pairs = [];
  function search(index) {
    if (index === s1.length) return true;
    for (let j = 0; j < s2.length; j++) {
      if (used[j]) continue;
      const a = s1[index], b = s2[j];
      if (repeat(states, a, b)) continue;
      if (strict) {
        const ca = coloursOf(states, a), cb = coloursOf(states, b);
        const whiteOk = !violates(ca, 'W') && !violates(cb, 'B');
        const blackOk = !violates(ca, 'B') && !violates(cb, 'W');
        if (!whiteOk && !blackOk) continue;
      }
      used[j] = true;
      pairs.push([a, b]);
      if (search(index + 1)) return true;
      pairs.pop();
      used[j] = false;
    }
    return false;
  }
  return search(0) ? pairs : null;
}

function assignColours(t, states, pairs, roundOne) {
  const initial = t.initialColor === 'black' ? 'B' : 'W';
  if (roundOne) {
    const ranked = pairs.map(([higher]) => higher).sort((a, b) => a.no - b.no);
    const top = new Map(ranked.map((player, index) => [player.id, index]));
    return pairs.map(([higher, lower]) => {
      const odd = (top.get(higher.id) ?? 0) % 2 === 0;
      const higherColour = odd ? initial : (initial === 'W' ? 'B' : 'W');
      return higherColour === 'W'
        ? { whiteId: higher.id, blackId: lower.id }
        : { whiteId: lower.id, blackId: higher.id };
    });
  }
  return pairs.map(([a, b]) => {
    const ca = coloursOf(states, a), cb = coloursOf(states, b);
    const diffA = colourDiff(ca), diffB = colourDiff(cb);
    let aWhite;
    if (diffA !== diffB) aWhite = diffA < diffB;
    else {
      let previous = null;
      const limit = Math.min(ca.length, cb.length);
      for (let i = 1; i <= limit; i++) {
        const left = ca[ca.length - i], right = cb[cb.length - i];
        if (left !== right) { previous = left; break; }
      }
      if (previous) aWhite = previous === 'B';
      else if (ca.length) aWhite = ca[ca.length - 1] === 'B';
      else aWhite = a.no < b.no;
    }
    const legalA = aWhite ? !violates(ca, 'W') && !violates(cb, 'B') : !violates(ca, 'B') && !violates(cb, 'W');
    if (!legalA) aWhite = !aWhite;
    return aWhite
      ? { whiteId: a.id, blackId: b.id }
      : { whiteId: b.id, blackId: a.id };
  });
}

export function pairOlympiad(t, round, options = {}) {
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
    const pool = sortRank(states, eligible.length ? eligible : players);
    const chosen = pool[pool.length - 1];
    bye = { playerId: chosen.id, type: 'PAB' };
    players = players.filter(player => player.id !== chosen.id);
    log.push(`Round ${round}: pairing-allocated bye → ${chosen.name} (${byePoints('PAB', t)} pt).`);
    if (!eligible.length) warnings.push('No team is eligible for the pairing-allocated bye. Assigning it to the lowest team.');
  }

  const ranked = sortRank(states, players);
  const groups = [];
  for (const player of ranked) {
    const score = scoreOf(states, player);
    const last = groups[groups.length - 1];
    if (last && last.score === score) last.players.push(player);
    else groups.push({ score, players: [player] });
  }

  const raw = [];
  let carry = [];
  let relaxed = false;
  for (let i = 0; i < groups.length; i++) {
    let bracket = sortRank(states, [...carry, ...groups[i].players]);
    carry = [];
    if (bracket.length % 2 === 1 && i < groups.length - 1) {
      const floater = bracket[bracket.length - 1];
      carry = [floater];
      bracket = bracket.slice(0, -1);
      log.push(`Round ${round}: ${floater.name} floats down from scoregroup ${groups[i].score}.`);
    }
    if (!bracket.length) continue;
    if (bracket.length % 2 === 1) {
      return {
        ok: false, pairings: [], bye, log,
        warnings: [...warnings, 'Olympiad pairing could not place every team. The arbiter decides.']
      };
    }
    const half = bracket.length / 2;
    const s1 = bracket.slice(0, half);
    const s2 = bracket.slice(half);
    let matched = matchHalves(s1, s2, states, true);
    if (!matched) {
      matched = matchHalves(s1, s2, states, false);
      relaxed = true;
    }
    if (!matched) {
      return {
        ok: false, pairings: [], bye, log,
        warnings: [...warnings, 'Olympiad pairing found no legal match in a score group. The arbiter decides.']
      };
    }
    raw.push(...matched);
  }
  if (relaxed) log.push(`Round ${round}: board-1 colour limits were set aside so the group could be paired.`);
  const roundOne = ranked.every(player => coloursOf(states, player).length === 0);
  return { ok: true, pairings: assignColours(t, states, raw, roundOne), bye, log, warnings };
}
