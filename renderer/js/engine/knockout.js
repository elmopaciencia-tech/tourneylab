// TourneyLab knockout (KO) system (MIT, clean-room).
//
// Models single-elimination as described in the Swiss-Manager KO addendum and
// the research report: bracket size is the next power of two; "free tickets"
// (byes) in round 1 go to the strongest players when the field is not an exact
// power of two; each round pairs first vs last, second vs second-last, etc.;
// each mini-match may have a configurable number of replays; advancement when a
// mini-match is tied after the allotted replays follows an explicit policy
// (default: the player who had Black in the last game advances).

export function nextPowerOfTwo(n) {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

export function koRounds(n) {
  return Math.log2(nextPowerOfTwo(n));
}

// Build round 1 given seeded players (array ordered strongest-first, each
// { id, no, name, rating }). Returns { pairings:[{ slotA, slotB }], byes:[id] }
// where a bye advances the player directly to round 2.
export function koFirstRound(seeds) {
  const size = nextPowerOfTwo(seeds.length);
  const byeCount = size - seeds.length;
  // strongest `byeCount` players get free tickets
  const byes = seeds.slice(0, byeCount).map(p => p.id);
  const playing = seeds.slice(byeCount);
  // standard seeding: 1 vs last, 2 vs second-last, ...
  const pairings = [];
  for (let i = 0; i < playing.length / 2; i++) {
    const a = playing[i];
    const b = playing[playing.length - 1 - i];
    pairings.push({ aId: a.id, bId: b.id });
  }
  return { size, byes, pairings };
}

// Given the winners advancing into a round (array of ids in bracket order),
// pair them first vs last. Colours: the first non-excluded player selected gets
// White on the first game of the mini-match (the addendum's rule of thumb).
export function koPairRound(advancing) {
  const pairings = [];
  for (let i = 0; i < advancing.length / 2; i++) {
    const a = advancing[i];
    const b = advancing[advancing.length - 1 - i];
    pairings.push({ aId: a, bId: b });
  }
  return pairings;
}

// Decide the winner of a mini-match.
//   games: array of { whiteId, blackId, result } in play order (a 1-0/½-½/0-1
//          code per state.RESULTS). replays = configured games per round.
//   policy: { advancementRule: 'blackInLastGame'|'betterSeed'|'manual',
//            seedOf: id->number (lower = stronger) }
// Returns { winnerId, decided, reason }.
export function koMiniMatchWinner(aId, bId, games, scoring, policy = {}) {
  let aPts = 0, bPts = 0;
  for (const g of games) {
    if (!g.result) continue;
    const wIsA = g.whiteId === aId;
    const [wp, bp] = scoreFor(g.result, scoring);
    aPts += wIsA ? wp : bp;
    bPts += wIsA ? bp : wp;
  }
  if (aPts > bPts) return { winnerId: aId, decided: true, reason: 'score' };
  if (bPts > aPts) return { winnerId: bId, decided: true, reason: 'score' };

  // tie -> apply advancement rule
  const rule = policy.advancementRule ?? 'blackInLastGame';
  const playedGames = games.filter(g => g.result);
  if (rule === 'blackInLastGame' && playedGames.length) {
    const last = playedGames[playedGames.length - 1];
    return { winnerId: last.blackId, decided: true, reason: 'black in last game' };
  }
  if (rule === 'betterSeed' && policy.seedOf) {
    const sa = policy.seedOf(aId), sb = policy.seedOf(bId);
    return { winnerId: sa <= sb ? aId : bId, decided: true, reason: 'better seed' };
  }
  return { winnerId: null, decided: false, reason: 'manual decision required' };
}

function scoreFor(code, scoring) {
  // minimal local map to avoid a circular import with state.js
  switch (code) {
    case '1-0': case '1F-0F': return [scoring.win, scoring.loss];
    case '0-1': case '0F-1F': return [scoring.loss, scoring.win];
    case '1/2-1/2': case 'ADJ': return [scoring.draw, scoring.draw];
    case '0F-0F': case '0-0': return [scoring.loss, scoring.loss];
    case '1/2-0': return [scoring.draw, scoring.loss];
    case '0-1/2': return [scoring.loss, scoring.draw];
    default: return [0, 0];
  }
}
