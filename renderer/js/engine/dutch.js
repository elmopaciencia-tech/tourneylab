// TourneyLab Dutch Swiss pairing engine (MIT, clean-room).
//
// Implements the decision tree in pairingLogic.md (Steps 3–10), following
// FIDE Handbook C.04.1 (Basic Rules for Swiss Systems) and C.04.3 (FIDE
// Dutch System). No code from JaVaFo or bbpPairings is used; bbpPairings'
// idea of scoring candidates with weighted criteria is followed conceptually.
//
// Entry point: pairRound(t, round, options?) →
//   { ok, pairings:[{whiteId, blackId}], bye:{playerId,type}|null,
//     log:[string], warnings:[string] }
// options.excludeIds (Set or array) leaves those players out of this call.
// pairRemainder keeps an existing round's pairs and pairs only the rest.

import { computeStates, pairablePlayers, byePoints } from './state.js';
import { computeStandings } from './tiebreaks.js';

const SEARCH_NODE_CAP = 250000; // bound for bracket backtracking

// Quality-criterion weights, in the priority order of spec Step 7:
// pairs are maximized structurally; then downfloater score, future
// pairability, colour failures, repeated floats.
const W = {
  ABS_COLOR: 1e6,     // absolute-colour clash between non-topscorers → hard
  TOPSCORER_ABS: 800, // absolute clash allowed for topscorers, but costly
  STRONG_COLOR: 40,
  MILD_COLOR: 8,
  REFLOAT_DOWN_1: 120, // downfloated last round, floats again
  REFLOAT_DOWN_2: 60,  // downfloated two rounds ago
  REFLOAT_UP_1: 100,
  REFLOAT_UP_2: 50,
  SOFT_RESTRICTION: 20000,
  TRANSPOSE: 0.001     // tiny: prefer earlier Dutch transposition order
};

// ----------------------------------------------------------------- helpers

function rankValue(rankOf, player) {
  return rankOf ? rankOf(player) : player.no;
}

function byPairingOrder(states, accel, rankOf) {
  // Spec Step 4/5: score (with acceleration) descending, pairing number asc.
  // A non-FIDE tie-break order replaces the pairing number, not the score.
  return (a, b) =>
    (effScore(states, accel, b) - effScore(states, accel, a)) ||
    (rankValue(rankOf, a) - rankValue(rankOf, b));
}

function effScore(states, accel, p) {
  return states.get(p.id).score + (accel.get(p.id) ?? 0);
}

// Baku acceleration (FIDE C.04.5.1, simplified per the FIDE-report note that
// it applies to 9+ round tournaments with standard scoring): the top half of
// the initial ranking receives 1 virtual point for the first ⌈rounds/2⌉
// rounds.
export function bakuVirtualPoints(t, round, rankOf = null) {
  const accel = new Map();
  if (t.acceleration !== 'baku') return accel;
  if (t.rounds < 9 || t.scoring.win !== 1 || t.scoring.draw !== 0.5) return accel;
  if (round > Math.ceil(t.rounds / 2)) return accel;
  const ranked = [...t.players].sort((a, b) => rankValue(rankOf, a) - rankValue(rankOf, b));
  let half = Math.ceil(ranked.length / 2);
  if (half % 2 === 1) half += 1; // group 1 rounded up to an even size
  for (let i = 0; i < Math.min(half, ranked.length); i++) accel.set(ranked[i].id, 1);
  return accel;
}

function administrativeRestriction(t, a, b) {
  if ((t.forbidden ?? []).some(([x, y]) =>
    (x === a.id && y === b.id) || (x === b.id && y === a.id))) return 'forbidden pairing';
  if (t.clubProtection && a.club && a.club === b.club) return 'same club (club protection)';
  return null;
}

// Hard (absolute) constraints — spec Step 6.
function illegal(t, states, a, b, topscorers, skipColour = false) {
  const sa = states.get(a.id), sb = states.get(b.id);
  if (sa.opponents.has(b.id)) return 'repeat opponent';
  const restriction = administrativeRestriction(t, a, b);
  if (restriction && t.restrictionPolicy !== 'soft') return restriction;
  if (!skipColour && sa.pref.type === 'absolute' && sb.pref.type === 'absolute' &&
      sa.pref.color === sb.pref.color &&
      !(topscorers.has(a.id) || topscorers.has(b.id))) return 'absolute colour clash';
  return null;
}

// Colour-related penalty if a and b are paired (colours allocated by
// allocateColors later; penalty estimates unsatisfiable preferences).
function colorPenalty(states, a, b, topscorers, skipColour = false) {
  if (skipColour) return 0;
  const pa = states.get(a.id).pref, pb = states.get(b.id).pref;
  if (!pa.color || !pb.color || pa.color !== pb.color) return 0;
  // same colour wanted — the weaker preference will be violated
  const rank = { absolute: 3, strong: 2, mild: 1, none: 0 };
  const weaker = rank[pa.type] <= rank[pb.type] ? pa : pb;
  if (pa.type === 'absolute' && pb.type === 'absolute') return W.TOPSCORER_ABS;
  if (weaker.type === 'strong') return W.STRONG_COLOR;
  if (weaker.type === 'mild') return W.MILD_COLOR;
  return 0;
}

function refloatPenalty(states, p, dir, round) {
  const s = states.get(p.id);
  let pen = 0;
  for (const f of s.floats) {
    if (f.dir !== dir) continue;
    if (f.round === round - 1) pen += dir === 'down' ? W.REFLOAT_DOWN_1 : W.REFLOAT_UP_1;
    else if (f.round === round - 2) pen += dir === 'down' ? W.REFLOAT_DOWN_2 : W.REFLOAT_UP_2;
  }
  return pen;
}

// ----------------------------------------------------------------- brackets

// Pair one bracket (residents + moved-down players), spec Step 8.
// Returns { pairs:[[a,b],...], floaters:[players], penalty } or null.
function pairBracket(t, states, bracket, nextPool, topscorers, round, skipColour = false) {
  const n = bracket.length;
  if (n === 0) return { pairs: [], floaters: [], penalty: 0 };
  const target = Math.floor(n / 2);

  // S1 = top half, S2 = rest (Dutch homogeneous treatment; heterogeneous
  // brackets are approximated by the same split since moved-down players sort
  // to the top by score).
  let best = null;
  let nodes = 0;

  // Backtracking over assignments S1[i] ↔ S2[j] in Dutch transposition order,
  // also deciding which players float when a perfect set is impossible.
  function search(idx, available, skipped, pairs, penalty, wantPairs) {
    if (best && penalty >= best.penalty) return;
    if (nodes++ > SEARCH_NODE_CAP) return;
    if (pairs.length === wantPairs) {
      const floaters = [...skipped, ...available];
      let pen = penalty;
      for (const f of floaters) {
        pen += refloatPenalty(states, f, 'down', round);
        // Preserve future pairability (spec Step 7): a floater must have at
        // least one legal partner in the next pool; otherwise heavy penalty.
        if (nextPool.length &&
            !nextPool.some(q => !illegal(t, states, f, q, topscorers, skipColour))) {
          pen += 5000;
        }
      }
      if (!best || pen < best.penalty) {
        best = { pairs: pairs.slice(), floaters, penalty: pen };
      }
      return;
    }
    if (available.length < 2 * (wantPairs - pairs.length)) return;
    const a = available[0];
    const rest = available.slice(1);
    // Dutch S1/S2 fold: with `remaining` pairs still to make, S1 is the top
    // `remaining` of the available players and S2 the rest, so the natural
    // partner for `a` (top of S1) is the first player of S2, i.e.
    // rest[remaining - 1]. Later S2 players emulate transpositions; S1
    // players come last (exchanges). Each step away from the natural partner
    // adds a tiny ordering penalty so earlier choices are preferred.
    const remaining = wantPairs - pairs.length;
    const order = [];
    for (let j = remaining - 1; j < rest.length; j++) order.push(j); // S2 in order
    for (let j = 0; j < remaining - 1; j++) order.push(j);           // then S1
    for (let oi = 0; oi < order.length; oi++) {
      const j = order[oi];
      const b = rest[j];
      if (b === undefined) continue;
      if (illegal(t, states, a, b, topscorers, skipColour)) continue;
      const restrictionPenalty = administrativeRestriction(t, a, b) ? W.SOFT_RESTRICTION : 0;
      const pen = colorPenalty(states, a, b, topscorers, skipColour) + restrictionPenalty + oi * W.TRANSPOSE;
      search(idx + 1, rest.filter((_, k) => k !== j), skipped,
        [...pairs, [a, b]], penalty + pen, wantPairs);
    }
    // allow `a` itself to float (kept as a floater, counted at completion)
    if (available.length - 1 >= 2 * (wantPairs - pairs.length)) {
      search(idx + 1, rest, [...skipped, a], pairs, penalty, wantPairs);
    }
  }

  // Maximize number of pairs first (highest-priority quality criterion).
  for (let wantPairs = target; wantPairs >= 0; wantPairs--) {
    best = null; nodes = 0;
    search(0, bracket, [], [], 0, wantPairs);
    if (best) return best;
  }
  return { pairs: [], floaters: bracket.slice(), penalty: 0 };
}

// Attempt to pair a full list of players (no bye among them) — spec Step 5.
// Returns { pairs, leftover } where leftover are players that could not be
// paired even after collapsing the lowest brackets.
function pairField(t, states, players, accel, topscorers, round, log, rankOf = null, skipColour = false) {
  const sorted = [...players].sort(byPairingOrder(states, accel, rankOf));
  // group into scoregroups by effective score
  const groups = [];
  for (const p of sorted) {
    const sc = effScore(states, accel, p);
    const g = groups[groups.length - 1];
    if (g && g.score === sc) g.players.push(p);
    else groups.push({ score: sc, players: [p] });
  }

  function run(grps) {
    const pairs = [];
    let carry = [];
    let penalty = 0;
    for (let gi = 0; gi < grps.length; gi++) {
      const bracket = [...carry, ...grps[gi].players]
        .sort(byPairingOrder(states, accel, rankOf));
      const nextPool = grps.slice(gi + 1).flatMap(g => g.players);
      const res = pairBracket(t, states, bracket, nextPool, topscorers, round, skipColour);
      pairs.push(...res.pairs);
      penalty += res.penalty;
      carry = res.floaters;
      if (carry.length && gi < grps.length - 1) {
        log.push(`Round ${round}: ${carry.map(p => p.name).join(', ')} float down from scoregroup ${grps[gi].score}.`);
      }
    }
    return { pairs, leftover: carry, penalty };
  }

  let attempt = run(groups);
  // Collapse the lowest brackets progressively if the field cannot complete
  // (last-bracket completion, spec Step 10 fallback before arbiter action).
  let collapsed = groups;
  while (attempt.leftover.length > 0 && collapsed.length > 1) {
    const last = collapsed.pop();
    const prev = collapsed.pop();
    collapsed.push({ score: prev.score, players: [...prev.players, ...last.players] });
    log.push(`Round ${round}: collapsing lowest scoregroups to complete the pairing.`);
    attempt = run(collapsed);
  }
  return attempt;
}

// ----------------------------------------------------------------- colours

// Spec Step 9 / FIDE C.04.3 art. 5: grant compatible preferences; otherwise
// grant the stronger; otherwise alternate w.r.t. the latest round in which
// the two players had different colours; otherwise grant the higher-ranked
// player's preference; with no history (round 1), alternate from the
// tournament's initial colour down the pairing order.
function allocateColors(t, states, pairs, accel, round, rankOf = null, skipColour = false) {
  const out = [];
  const order = [...pairs].sort((p, q) => {
    const s = Math.max(effScore(states, accel, q[0]), effScore(states, accel, q[1])) -
              Math.max(effScore(states, accel, p[0]), effScore(states, accel, p[1]));
    return s || (Math.min(rankValue(rankOf, p[0]), rankValue(rankOf, p[1])) -
      Math.min(rankValue(rankOf, q[0]), rankValue(rankOf, q[1])));
  });
  let firstColor = t.initialColor === 'black' ? 'B' : 'W';
  let alt = 0;

  for (const [a, b] of order) {
    const sa = states.get(a.id), sb = states.get(b.id);
    let whiteFor = null; // 'a' | 'b'
    const pa = skipColour ? { type: 'none', color: null } : sa.pref;
    const pb = skipColour ? { type: 'none', color: null } : sb.pref;

    if (pa.color && pb.color && pa.color !== pb.color) {
      whiteFor = pa.color === 'W' ? 'a' : 'b';
    } else if (pa.color && !pb.color) {
      whiteFor = pa.color === 'W' ? 'a' : 'b';
    } else if (pb.color && !pa.color) {
      whiteFor = pb.color === 'W' ? 'b' : 'a';
    } else if (pa.color && pb.color && pa.color === pb.color) {
      const rank = { absolute: 3, strong: 2, mild: 1 };
      if (rank[pa.type] !== rank[pb.type]) {
        const strongIsA = rank[pa.type] > rank[pb.type];
        const granted = strongIsA ? pa : pb;
        const who = strongIsA ? 'a' : 'b';
        whiteFor = granted.color === 'W' ? who : (who === 'a' ? 'b' : 'a');
      } else {
        // alternate w.r.t. latest round with different colours
        const ca = sa.colors, cb = sb.colors;
        let dec = null;
        for (let i = 1; i <= Math.min(ca.length, cb.length); i++) {
          const x = ca[ca.length - i], y = cb[cb.length - i];
          if (x !== y) { dec = x === 'W' ? 'b' : 'a'; break; } // swap colours
        }
        if (dec) whiteFor = dec;
        else {
          // higher-ranked player's preference (rank = score, then no)
          const hiIsA = (effScore(states, accel, a) > effScore(states, accel, b)) ||
            (effScore(states, accel, a) === effScore(states, accel, b) && rankValue(rankOf, a) < rankValue(rankOf, b));
          const granted = hiIsA ? pa : pb;
          const who = hiIsA ? 'a' : 'b';
          whiteFor = granted.color === 'W' ? who : (who === 'a' ? 'b' : 'a');
        }
      }
    } else {
      // no preferences (typically round 1): alternate from initial colour,
      // higher-ranked player of the pair gets the alternating colour
      const hiIsA = rankValue(rankOf, a) < rankValue(rankOf, b);
      const color = (alt++ % 2 === 0) ? firstColor : (firstColor === 'W' ? 'B' : 'W');
      whiteFor = (color === 'W') === hiIsA ? 'a' : 'b';
    }

    out.push(whiteFor === 'a'
      ? { whiteId: a.id, blackId: b.id }
      : { whiteId: b.id, blackId: a.id });
  }
  return out;
}

// Preferred colour orientation for one arbiter-chosen pair, plus the swap.
// Does not search for a round pairing.
export function suggestPairColours(t, round, aId, bId) {
  const a = t.players.find(p => p.id === aId);
  const b = t.players.find(p => p.id === bId);
  if (!a || !b || aId === bId) return null;
  const states = computeStates(t, round - 1);
  const rankOf = !t.fideMode && t.pairByTiebreak ? standingsRank(t, round) : null;
  const accel = bakuVirtualPoints(t, round, rankOf);
  const [preferred] = allocateColors(t, states, [[a, b]], accel, round, rankOf, !t.fideMode && !!t.ignoreColour);
  return {
    preferred,
    alternative: { whiteId: preferred.blackId, blackId: preferred.whiteId }
  };
}

// ----------------------------------------------------------------- PAB

// Spec Step 7: from the bottom of the pairing order upward, pick the first
// eligible bye candidate whose removal still allows the rest of the field to
// be completely paired. Non-FIDE option "bye weakest participant" picks by
// fewest points + worst starting rank (still requiring no prior bye /
// forfeit win); in FIDE mode that option is always inactive.
function chooseByeCandidates(t, states, players, accel, rankOf = null) {
  const weaker = (a, b) => rankValue(rankOf, b) - rankValue(rankOf, a);
  const eligible = players.filter(p => {
    const s = states.get(p.id);
    return !s.hadPAB && !s.fullPointUnplayed;
  });
  const order = [...eligible].sort((a, b) =>
    (effScore(states, accel, a) - effScore(states, accel, b)) || weaker(a, b));
  if (!t.fideMode && t.byeWeakest) {
    order.sort((a, b) =>
      (states.get(a.id).score - states.get(b.id).score) || weaker(a, b));
  }
  // Fallback: if literally nobody is eligible, all players (lowest first) —
  // the arbiter is warned by the caller.
  return order.length ? { list: order, fallback: false }
    : { list: [...players].sort((a, b) =>
        (effScore(states, accel, a) - effScore(states, accel, b)) || weaker(a, b)),
        fallback: true };
}

function standingsRank(t, round) {
  const rows = computeStandings(t, Math.max(0, round - 1));
  const map = new Map(rows.map((row, index) => [row.player.id, index + 1]));
  return player => map.get(player.id) ?? player.no;
}

function dutchAdjustments(t, round, options) {
  const requestedColour = !!(options.ignoreColour || t.ignoreColour);
  const requestedTiebreak = !!(options.pairByTiebreak || t.pairByTiebreak);
  return {
    skipColour: !t.fideMode && requestedColour,
    rankOf: !t.fideMode && requestedTiebreak ? standingsRank(t, round) : null
  };
}

// ----------------------------------------------------------------- main

export function pairRound(t, round, options = {}) {
  const log = [], warnings = [];
  const { skipColour, rankOf } = dutchAdjustments(t, round, options);
  const states = computeStates(t, round - 1);
  const accel = bakuVirtualPoints(t, round, rankOf);
  if (accel.size) log.push(`Round ${round}: Baku acceleration in effect (+1 virtual point for the top half).`);

  const exclude = options.excludeIds instanceof Set
    ? options.excludeIds
    : new Set(options.excludeIds ?? []);
  const players = pairablePlayers(t, round).filter(p => !exclude.has(p.id));
  if (players.length === 0) {
    return { ok: false, pairings: [], bye: null, log, warnings: ['No pairable players.'] };
  }

  // Topscorers (last round only): score > 50% of the maximum possible —
  // they may be involved in absolute-colour exceptions.
  const topscorers = new Set();
  if (round === (t.finalRound || t.rounds)) {
    const maxPossible = (round - 1) * t.scoring.win;
    for (const p of players) {
      if (states.get(p.id).score > maxPossible / 2) topscorers.add(p.id);
    }
  }

  let bye = null;
  let field = players;

  if (players.length % 2 === 1) {
    const { list, fallback } = chooseByeCandidates(t, states, players, accel, rankOf);
    if (fallback) warnings.push('No player is eligible for the pairing-allocated bye (all have a previous PAB or unplayed full-point win). Assigning to the lowest player — arbiter review recommended.');
    let chosen = null, chosenResult = null;
    for (const cand of list) {
      const rest = players.filter(p => p.id !== cand.id);
      const res = pairField(t, states, rest, accel, topscorers, round, [], rankOf, skipColour);
      if (res.leftover.length === 0) { chosen = cand; chosenResult = res; break; }
    }
    if (!chosen) {
      return {
        ok: false, pairings: [], bye: null, log,
        warnings: [...warnings, 'No valid round pairing exists with any bye choice. Chief Arbiter intervention required (manual pairing).']
      };
    }
    bye = { playerId: chosen.id, type: 'PAB' };
    field = players.filter(p => p.id !== chosen.id);
    log.push(`Round ${round}: pairing-allocated bye → ${chosen.name} (${byePoints('PAB', t)} pt).`);
    addSoftRestrictionWarnings(t, chosenResult.pairs, warnings);
    const colored = allocateColors(t, states, chosenResult.pairs, accel, round, rankOf, skipColour);
    return { ok: true, pairings: colored, bye, log, warnings };
  }

  const res = pairField(t, states, field, accel, topscorers, round, log, rankOf, skipColour);
  if (res.leftover.length > 0) {
    return {
      ok: false, pairings: [], bye: null, log,
      warnings: [...warnings,
        `Cannot complete the round: ${res.leftover.map(p => p.name).join(', ')} have no legal opponents. Chief Arbiter intervention required.`]
    };
  }
  addSoftRestrictionWarnings(t, res.pairs, warnings);
  const colored = allocateColors(t, states, res.pairs, accel, round, rankOf, skipColour);
  return { ok: true, pairings: colored, bye, log, warnings };
}

// Keep pairs the arbiter already set, and pair only the players left over.
// A pairing-allocated bye is released back into that field. Half-point,
// full-point and zero-point byes stay put. Does not mutate roundData.
export function pairRemainder(t, round, roundData) {
  const exclude = new Set();
  const kept = [...(roundData?.pairings ?? [])];
  for (const pairing of kept) {
    exclude.add(pairing.whiteId);
    exclude.add(pairing.blackId);
  }
  const keptByes = [];
  for (const bye of roundData?.byes ?? []) {
    if (bye.type === 'PAB') continue;
    exclude.add(bye.playerId);
    keptByes.push(bye);
  }
  const res = pairRound(t, round, { excludeIds: exclude });
  if (!res.ok) {
    return { ok: false, kept, keptByes, pairings: [], bye: null, log: res.log, warnings: res.warnings };
  }
  return { ok: true, kept, keptByes, pairings: res.pairings, bye: res.bye, log: res.log, warnings: res.warnings };
}

// Validate a manual pairing against engine constraints (used by the UI to
// warn — manual changes are allowed but flagged, per spec rule of thumb 6).
export function checkManualPair(t, round, aId, bId) {
  const states = computeStates(t, round - 1);
  const a = t.players.find(p => p.id === aId);
  const b = t.players.find(p => p.id === bId);
  if (!a || !b) return ['Unknown player.'];
  const issues = [];
  const why = illegal(t, states, a, b, new Set(), !t.fideMode && !!t.ignoreColour);
  if (why) issues.push(`Constraint violated: ${why}.`);
  const restriction = administrativeRestriction(t, a, b);
  if (!why && restriction) issues.push(`Soft restriction used: ${restriction}.`);
  const sa = states.get(aId).score, sb = states.get(bId).score;
  if (sa !== sb) issues.push(`Score difference ${Math.abs(sa - sb)} (cross-scoregroup pairing creates float history).`);
  return issues;
}

function addSoftRestrictionWarnings(t, pairs, warnings) {
  if (t.restrictionPolicy !== 'soft') return;
  for (const [a, b] of pairs) {
    const reason = administrativeRestriction(t, a, b);
    if (reason) warnings.push(`Soft restriction used for ${a.name} vs ${b.name}: ${reason}.`);
  }
}
