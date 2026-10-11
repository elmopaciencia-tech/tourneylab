import { assessMatch, isTeamEvent, teamMatchResult } from './team.js';
// TourneyLab pairing-state module (MIT, clean-room).
// Implements "What the Pairing Engine Actually Uses" + Step 2 of pairingLogic.md:
// a result is not just a score — it creates score, opponent, colour, bye,
// unplayed and float consequences.

// ---------------------------------------------------------------- result types

// Game results stored on a pairing (white vs black).
export const RESULTS = {
  '1-0':     { w: 'win',  b: 'loss', played: true  },
  '1/2-1/2': { w: 'draw', b: 'draw', played: true  },
  '0-1':     { w: 'loss', b: 'win',  played: true  },
  '1F-0F':   { w: 'win',  b: 'loss', played: false, forfeit: true },
  '0F-1F':   { w: 'loss', b: 'win',  played: false, forfeit: true },
  '0F-0F':   { w: 'loss', b: 'loss', played: false, forfeit: true },
  // Adjourned: temporarily a draw for the immediate pairing phase only.
  'ADJ':     { w: 'draw', b: 'draw', played: true, adjourned: true },
  // Unusual scores (blocked in FIDE mode), entered as played:
  '0-0':     { w: 'loss', b: 'loss', played: true, unusual: true },
  '1/2-0':   { w: 'draw', b: 'loss', played: true, unusual: true },
  '0-1/2':   { w: 'loss', b: 'draw', played: true, unusual: true }
};

// Keyboard mapping from the Swiss-Manager manual: 1..7.
export const RESULT_KEYS = {
  '1': '1-0', '2': '1/2-1/2', '3': '0-1',
  '4': '1F-0F', '5': '0F-1F', '6': '0F-0F', '7': 'ADJ'
};

// Byes stored on a round (player without opponent).
// PAB value is configurable (win by default) per FIDE C.04.1 / spec Step 3.
export const BYE_TYPES = ['PAB', 'FPB', 'HPB', 'ZPB'];

export function resultLabel(code) {
  return ({
    '1-0': '1 – 0', '1/2-1/2': '½ – ½', '0-1': '0 – 1',
    '1F-0F': '+ / –', '0F-1F': '– / +', '0F-0F': '– / –',
    'ADJ': 'Adj.', '0-0': '0 – 0', '1/2-0': '½ – 0', '0-1/2': '0 – ½',
    '': '·'
  })[code] ?? code;
}

export function byeLabel(t) {
  return ({ PAB: 'Bye (paired)', FPB: 'Bye 1', HPB: 'Bye ½', ZPB: 'Bye 0' })[t] ?? t;
}

// Points for an outcome under a scoring config {win, draw, loss}.
function pts(outcome, scoring) {
  return outcome === 'win' ? scoring.win : outcome === 'draw' ? scoring.draw : scoring.loss;
}

export function byePoints(type, t) {
  const s = scoringFor(t);
  switch (type) {
    case 'FPB': return s.win;
    case 'HPB': return s.draw;
    case 'ZPB': return s.loss;
    case 'PAB':
      if (t.pairingSystem === 'fide-double-swiss') {
        if (t.pabValue === 'draw') return s.draw;
        if (typeof t.pabValue === 'number') return t.pabValue;
        return s.win + s.draw;
      }
      return t.pabValue === 'draw' ? s.draw : s.win;
    default: return 0;
  }
}

function scoringFor(t) {
  return (t.type === 'team-swiss' || t.type === 'team-rr') ? (t.matchScoring ?? t.scoring) : t.scoring;
}

function gamePointsFromTeamBoards(t, pr) {
  if (pr.boardDataVersion === 1) return assessMatch(t, pr).score;
  if (pr.matchScore) return pr.matchScore;
  if (!pr.teamBoards?.length) return null;
  const rosterTeam = new Map();
  for (const tm of t.teams ?? []) for (const m of tm.members ?? []) rosterTeam.set(m.rosterId, tm.playerId);
  let w = 0, b = 0;
  for (const board of pr.teamBoards) {
    const spec = RESULTS[board.result];
    if (!spec) continue;
    const whiteSide = rosterTeam.get(board.whiteRosterId);
    const blackSide = rosterTeam.get(board.blackRosterId);
    const wp = pts(spec.w, t.scoring);
    const bp = pts(spec.b, t.scoring);
    if (whiteSide === pr.whiteId) w += wp; else b += wp;
    if (blackSide === pr.whiteId) w += bp; else b += bp;
  }
  return { w, b };
}

// ---------------------------------------------------------------- player state

// Compute the pairing state of every player after rounds 1..uptoRound.
// Returns Map<playerId, state> with:
//   score, opponents:Set, colors:[‘W’|’B’ for *played* games], lastPlayedColors,
//   colorDiff, pref {type:'absolute'|'strong'|'mild'|'none', color},
//   hadPAB, fullPointUnplayed, byeRounds, floats:[{round, dir:'down'|'up'}],
//   gamesPlayed, results:[{round, kind, ...}]
export function computeStates(t, uptoRound) {
  const isTeam = t.type === 'team-swiss' || t.type === 'team-rr';
  const scoring = scoringFor(t);
  const states = new Map();
  for (const p of t.players) {
    states.set(p.id, {
      id: p.id, score: 0, opponents: new Set(), colors: [],
      colorDiff: 0, pref: { type: 'none', color: null },
      hadPAB: false, fullPointUnplayed: false, byeRounds: [],
      floats: [], gamesPlayed: 0, gamePoints: 0, results: [], unresolvedAdjourned: []
    });
  }

  for (let r = 1; r <= uptoRound; r++) {
    const rd = t.roundsData[r - 1];
    if (!rd) continue;
    // score snapshot *before* this round, for float detection
    const before = new Map([...states].map(([id, s]) => [id, s.score]));

    for (const pr of rd.pairings) {
      const sw = states.get(pr.whiteId), sb = states.get(pr.blackId);
      if (!sw || !sb) continue;
      if (Array.isArray(pr.games)) {
        if (pr.games.some(code => !RESULTS[code])) {
          sw.results.push({ round: r, kind: 'pending', opp: pr.blackId, color: 'W' });
          sb.results.push({ round: r, kind: 'pending', opp: pr.whiteId, color: 'B' });
          continue;
        }
        const specs = pr.games.map(code => RESULTS[code]);
        for (const spec of specs) {
          sw.score += pts(spec.w, scoring);
          sb.score += pts(spec.b, scoring);
        }
        const forfeitedBoth = side => specs.every(spec => !spec.played && spec[side] === 'loss');
        const doubleForfeit = forfeitedBoth('w') || forfeitedBoth('b');
        const anyPlayed = specs.some(spec => spec.played);
        if (!doubleForfeit) {
          sw.opponents.add(pr.blackId);
          sb.opponents.add(pr.whiteId);
        }
        if (anyPlayed) {
          sw.colors.push('W');
          sb.colors.push('B');
          sw.gamesPlayed++;
          sb.gamesPlayed++;
        } else if (specs.every(spec => spec.w === 'win')) {
          sw.fullPointUnplayed = true;
        } else if (specs.every(spec => spec.b === 'win')) {
          sb.fullPointUnplayed = true;
        }
        sw.results.push({ round: r, kind: anyPlayed ? 'game' : 'forfeit', opp: pr.blackId, color: anyPlayed ? 'W' : null, code: pr.games[0] });
        sb.results.push({ round: r, kind: anyPlayed ? 'game' : 'forfeit', opp: pr.whiteId, color: anyPlayed ? 'B' : null, code: pr.games[0] });
        continue;
      }
      const spec = RESULTS[isTeam ? teamMatchResult(t, pr) : pr.result];
      // The pairing exists even without a result: opponents are recorded once a
      // result exists; an empty result blocks the next round (Step 1) and is
      // surfaced by roundReadiness() instead.
      if (!spec) {
        sw.results.push({ round: r, kind: 'pending', opp: pr.blackId, color: 'W' });
        sb.results.push({ round: r, kind: 'pending', opp: pr.whiteId, color: 'B' });
        continue;
      }
      sw.score += pts(spec.w, scoring);
      sb.score += pts(spec.b, scoring);
      if (isTeam) {
        const gp = gamePointsFromTeamBoards(t, pr);
        if (gp) {
          sw.gamePoints += +gp.w || 0;
          sb.gamePoints += +gp.b || 0;
        }
      }
      // Opponent history: the pairing exists for both played games and forfeits
      // ("players should not play each other more than once" — repeats are
      // checked against all recorded pairings, played or not).
      sw.opponents.add(pr.blackId);
      sb.opponents.add(pr.whiteId);
      if (spec.played) {
        sw.colors.push('W'); sb.colors.push('B');
        sw.gamesPlayed++; sb.gamesPlayed++;
      } else {
        // Forfeit: no colour history; a full-point win without playing marks
        // the winner ineligible for a future PAB (spec §Forfeits, Step 6/7).
        if (spec.w === 'win') sw.fullPointUnplayed = true;
        if (spec.b === 'win') sb.fullPointUnplayed = true;
      }
      if (spec.adjourned) {
        sw.unresolvedAdjourned.push(r);
        sb.unresolvedAdjourned.push(r);
      }
      sw.results.push({ round: r, kind: spec.played ? 'game' : 'forfeit', opp: pr.blackId, color: spec.played ? 'W' : null, outcome: spec.w, code: pr.result });
      sb.results.push({ round: r, kind: spec.played ? 'game' : 'forfeit', opp: pr.whiteId, color: spec.played ? 'B' : null, outcome: spec.b, code: pr.result });
    }

    for (const bye of rd.byes ?? []) {
      const s = states.get(bye.playerId);
      if (!s) continue;
      const v = byePoints(bye.type, t);
      s.score += v;
      s.byeRounds.push({ round: r, type: bye.type });
      if (bye.type === 'PAB') {
        s.hadPAB = true;
        if (v >= t.scoring.win) s.fullPointUnplayed = true;
      }
      if (bye.type === 'FPB') s.fullPointUnplayed = true;
      s.results.push({ round: r, kind: 'bye', byeType: bye.type, color: null });
    }

    // Float history (spec §6): paired outside own scoregroup → down/up floater.
    // A PAB or any unplayed result worth more than a loss also counts as a
    // downfloat.
    for (const pr of rd.pairings) {
      const scored = Array.isArray(pr.games) ? pr.games.every(code => RESULTS[code]) : !!RESULTS[pr.result];
      if (!scored) continue;
      const a = before.get(pr.whiteId), b = before.get(pr.blackId);
      if (a == null || b == null) continue;
      if (a > b) {
        states.get(pr.whiteId).floats.push({ round: r, dir: 'down' });
        states.get(pr.blackId).floats.push({ round: r, dir: 'up' });
      } else if (b > a) {
        states.get(pr.blackId).floats.push({ round: r, dir: 'down' });
        states.get(pr.whiteId).floats.push({ round: r, dir: 'up' });
      }
    }
    for (const bye of rd.byes ?? []) {
      if (byePoints(bye.type, t) > t.scoring.loss) {
        states.get(bye.playerId)?.floats.push({ round: r, dir: 'down', bye: true });
      }
    }
  }

  // Colour preference (FIDE C.04.3 art. 5 / spec Step 9): depends only on
  // games actually played with colours.
  for (const s of states.values()) {
    const w = s.colors.filter(c => c === 'W').length;
    const b = s.colors.length - w;
    s.colorDiff = w - b;
    const last = s.colors[s.colors.length - 1] ?? null;
    const last2same = s.colors.length >= 2 &&
      s.colors[s.colors.length - 1] === s.colors[s.colors.length - 2];
    if (s.colors.length === 0) {
      s.pref = { type: 'none', color: null };
    } else if (Math.abs(s.colorDiff) > 1) {
      s.pref = { type: 'absolute', color: s.colorDiff > 0 ? 'B' : 'W' };
    } else if (last2same) {
      s.pref = { type: 'absolute', color: last === 'W' ? 'B' : 'W' };
    } else if (s.colorDiff !== 0) {
      s.pref = { type: 'strong', color: s.colorDiff > 0 ? 'B' : 'W' };
    } else {
      s.pref = { type: 'mild', color: last === 'W' ? 'B' : 'W' };
    }
  }
  return states;
}

// JaVaFo checklist symbol for the colour preference already stored on a state.
// Due colour follows the same order as the preference block above.
function preferenceSymbol(state) {
  const colors = state.colors;
  if (!colors.length) return '';
  const diff = state.colorDiff;
  const last = colors[colors.length - 1];
  const last2same = colors.length >= 2 && last === colors[colors.length - 2];
  const beyond = Math.abs(diff) > 1;
  const due = beyond || (!last2same && diff !== 0)
    ? (diff > 0 ? 'B' : 'W')
    : (last === 'W' ? 'B' : 'W');
  if (beyond && last2same) return due === 'W' ? 'WWW' : 'BBB';
  if (beyond) return due === 'W' ? 'WW' : 'BB';
  if (last2same) return `${due}1`;
  if (diff !== 0) return due;
  return due === 'W' ? '(w)' : '(b)';
}

function floatDir(state, round) {
  if (round < 1) return '';
  return state.floats.find(float => float.round === round)?.dir ?? '';
}

// Arbiter checklist for `round`: the pairing state after round-1, which is the
// state the round was paired from. Swiss and team Swiss only. Opponent numbers
// are pairing numbers of games actually played, in round order.
export function pairingChecklist(t, round) {
  if (t.type !== 'swiss' && t.type !== 'team-swiss') return [];
  const states = computeStates(t, round - 1);
  const numbers = new Map(t.players.map(player => [player.id, player.no]));
  const rows = [];
  for (const player of t.players) {
    const state = states.get(player.id);
    if (!state) continue;
    const opponents = [];
    for (const result of state.results) {
      if (result.kind !== 'game') continue;
      const no = numbers.get(result.opp);
      if (no != null) opponents.push(no);
    }
    rows.push({
      id: player.id,
      no: player.no,
      name: player.name || '',
      score: state.score,
      colors: state.colors.join(''),
      preference: preferenceSymbol(state),
      float1: floatDir(state, round - 1),
      float2: floatDir(state, round - 2),
      opponents,
      noPab: state.hadPAB || state.fullPointUnplayed
    });
  }
  rows.sort((a, b) => b.score - a.score || (a.no ?? 0) - (b.no ?? 0));
  return rows;
}

// ---------------------------------------------------------------- readiness

// Step 1 — check whether the next round can be paired.
// Returns { ok, blockers:[], warnings:[], summary }.
export function roundReadiness(t, roundToPair) {
  const blockers = [], warnings = [];
  const missingByRound = new Map();
  const adjournedByRound = new Map();
  const invalidByRound = new Map();
  const unpairedByRound = new Map();
  const increment = (counts, round) => counts.set(round, (counts.get(round) ?? 0) + 1);
  for (let r = 1; r < roundToPair; r++) {
    const rd = t.roundsData[r - 1];
    if (!rd) continue;
    const covered = new Set();
    for (const pr of rd.pairings) {
      covered.add(pr.whiteId);
      covered.add(pr.blackId);
    }
    for (const bye of rd.byes ?? []) covered.add(bye.playerId);
    const unpaired = pairablePlayers(t, r).filter(p => !covered.has(p.id));
    if (unpaired.length) {
      const names = unpaired.map(p => p.name || 'Unnamed').join(', ');
      blockers.push(`Round ${r}: ${names} ${unpaired.length === 1 ? 'is' : 'are'} neither paired nor given a bye.`);
      unpairedByRound.set(r, unpaired.length);
    }
    for (const pr of rd.pairings) {
      if (isTeamEvent(t)) {
        const status = assessMatch(t, pr);
        if (!status.complete || pr.boardDataVersion !== 1) {
          blockers.push(`Round ${r}, match ${pr.board}: reconcile all ${status.required} boards (${status.completed} entered) and confirm the lineup colours.`);
          increment(missingByRound, r);
        }
        continue;
      }
      if (Array.isArray(pr.games)) {
        const missing = pr.games.filter(code => !code).length;
        if (missing) {
          blockers.push(`Round ${r}, board ${pr.board}: result is empty. Results of all pairings are required before the next round can be paired.`);
          increment(missingByRound, r);
        }
        continue;
      }
      if (!pr.result) {
        blockers.push(`Round ${r}, board ${pr.board}: result is empty. Results of all pairings are required before the next round can be paired.`);
        increment(missingByRound, r);
      } else if (pr.result === 'ADJ') {
        if (r === roundToPair - 1) {
          warnings.push(`Round ${r}, board ${pr.board}: adjourned game is treated as a draw for this pairing only. Enter the real result before pairing further rounds.`);
        } else {
          blockers.push(`Round ${r}, board ${pr.board}: adjourned game must be resolved — only the round immediately after an adjournment may be paired provisionally.`);
          increment(adjournedByRound, r);
        }
      }
      if (t.fideMode && RESULTS[pr.result]?.unusual) {
        blockers.push(`Round ${r}, board ${pr.board}: result ${pr.result} is not allowed in FIDE mode.`);
        increment(invalidByRound, r);
      }
    }
  }
  const actions = [];
  for (const [round, count] of missingByRound) {
    actions.push(`Enter ${count} missing result${count === 1 ? '' : 's'} in Round ${round}`);
  }
  for (const [round, count] of adjournedByRound) {
    actions.push(`Resolve ${count} adjourned game${count === 1 ? '' : 's'} in Round ${round}`);
  }
  for (const [round, count] of invalidByRound) {
    actions.push(`Replace ${count} FIDE-ineligible result${count === 1 ? '' : 's'} in Round ${round}`);
  }
  for (const [round, count] of unpairedByRound) {
    actions.push(`Pair or bye ${count} unpaired player${count === 1 ? '' : 's'} in Round ${round}`);
  }
  const summary = blockers.length
    ? `${actions.join('; ')}.`
    : '';
  return { ok: blockers.length === 0, blockers, warnings, summary };
}

// Pairable players for a round (Step 3): active, not withdrawn, not excluded
// for this round, and not holding a requested bye this round.
export function pairablePlayers(t, round) {
  return t.players.filter(p =>
    p.active !== false &&
    !p.withdrawn &&
    !(p.excludedRounds ?? []).includes(round) &&
    !(p.requestedByes ?? {})[round]
  );
}
