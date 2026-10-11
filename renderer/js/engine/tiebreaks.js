import { computeTeamStandings, TEAM_TIEBREAKS } from './team-ranking.js';
// TourneyLab tie-breaks (MIT). Features §6.
//
// Unplayed-round handling implements FIDE Play-Off & Tie-Break Regulations
// (C.07) Article 16 "Unplayed Rounds Management", effective 1 March 2026, with
// a selectable legacy mode (pre-2023 "virtual opponent = own score, uncapped").
//
// Article 16 in brief (individual Swiss; team values use match+game points):
//   16.2 categories of unplayed round:
//        16.2.1 pairing-allocated bye (PAB)        -> "other", capped at draw*R
//        16.2.2 forfeit win                        -> "forfeit", capped at opp adj
//        16.2.3 requested/half/zero bye then play  -> "other", capped at draw*R
//        16.2.4 forfeit loss                       -> "forfeit", capped at opp adj
//        16.2.5 terminal requested bye / post-withdrawal -> "other", draw*R cap
//   16.3 a forfeit opponent's score is "adjusted": the absent player's score is
//        replaced, for this purpose, by the points they would have if every one
//        of their own unplayed rounds were drawn (capped likewise).
//   16.4 own tie-break: each unplayed round is a dummy with result = the points
//        awarded; the dummy's score is the player's own score, but capped at
//        16.4.1 the scheduled opponent's adjusted score, for forfeits;
//        16.4.2 draw-points x number-of-rounds, for all other categories.
//   16.5 in "cut"/"median" modifiers the contributions from Voluntary Unplayed
//        Rounds (VUR: half-bye, zero-bye, forfeit loss) are removed first.

import { computeStates, RESULTS, byePoints } from './state.js';

export const TIEBREAKS = {
  BH:    'Buchholz',
  BHC1:  'Buchholz cut 1',
  BHM:   'Buchholz median (cut 1 top & bottom)',
  MMED:  'Modified median',
  SOLK:  'Solkoff',
  CUM:   'Cumulative score',
  OCUM:  'Opponent cumulative score',
  FBH:   'Fore Buchholz (last round drawn)',
  SB:    'Sonneborn–Berger',
  KOYA:  'Koya (vs players with ≥50%)',
  WINS:  'Number of wins',
  WINSO: 'Wins with games played (over the board)',
  DE:    'Direct encounter',
  BLK:   'Most games with black',
  AROC:  'Average rating of opponents (cut)',
  PERF:  'Rating performance (TPR)',
  // Team tie-breaks (Article 13 / team regs):
  MP:    'Match points',
  GP:    'Game points',
  EMGSB: 'Extended SB (match×game)',
  EGMSB: 'Extended SB (game×match)',
  EMMSB: 'Extended SB (match×match)',
  EGGSB: 'Extended SB (game×game)',
  SSSC:  'Sum of scores of cut (Buchholz on match points)'
};

// Which tie-breaks need opponents' ratings present to be meaningful.
export const RATING_TIEBREAKS = new Set(['AROC', 'PERF']);

function playerRows(t, uptoRound) {
  const states = computeStates(t, uptoRound);
  const rows = t.players.map(p => ({ p, s: states.get(p.id) }));
  return { states, rows };
}

// performance: average opponent rating + dp from percentage (FIDE table).
export const PERFORMANCE_DP = [-800,-677,-589,-538,-501,-470,-444,-422,-401,-383,-366,-351,-336,-322,-309,-296,-284,-273,-262,-251,-240,-230,-220,-211,-202,-193,-184,-175,-166,-158,-149,-141,-133,-125,-117,-110,-102,-95,-87,-80,-72,-65,-57,-50,-43,-36,-29,-21,-14,-7,0,7,14,21,29,36,43,50,57,65,72,80,87,95,102,110,117,125,133,141,149,158,166,175,184,193,202,211,220,230,240,251,262,273,284,296,309,322,336,351,366,383,401,422,444,470,501,538,589,677,800];

// Default to FIDE 2026 unplayed-round management unless a tournament opts out.
function ruleVersion(t) {
  return t.tiebreakRules ?? (t.fideMode ? 'fide2026' : 'legacy');
}

export function visibleRankLabels(rows) {
  const labels = [];
  for (let i = 0; i < rows.length;) {
    const groupId = rows[i]?.tieGroupId || `row:${i}`;
    let j = i + 1;
    while (j < rows.length && (rows[j]?.tieGroupId || `row:${j}`) === groupId) j++;
    const label = j - i > 1 ? `${i + 1}-${j}` : String(i + 1);
    for (let k = i; k < j; k++) labels[k] = label;
    i = j;
  }
  return labels;
}

export function computeStandings(t, uptoRound) {
  if (['team-swiss','team-rr'].includes(t.type) && t.teamPolicy?.rankingVersion === 'team-v1') return computeTeamStandings(t, uptoRound);
  const { states, rows } = playerRows(t, uptoRound);
  const rules = ruleVersion(t);
  const isTeam = t.type === 'team-swiss' || t.type === 'team-rr';
  const scoreConfig = isTeam ? (t.matchScoring ?? t.scoring) : t.scoring;

  const scoreOf = id => states.get(id)?.score ?? 0;
  const gameScoreOf = id => states.get(id)?.gamePoints ?? 0;
  const ratingOf = id => t.players.find(x => x.id === id)?.rating ?? 0;
  const drawPts = scoreConfig.draw;
  const winPts = scoreConfig.win;
  const lossPts = scoreConfig.loss;
  const rounds = t.rounds || uptoRound;
  const tieBreakCodes = (t.tiebreaks ?? []).map(item => typeof item === 'string' ? item : item?.code).filter(Boolean);
  const tieBreakConfig = new Map((t.tiebreakConfig ?? [])
    .map(item => typeof item === 'string' ? { code: item } : item)
    .filter(item => item?.code)
    .map(item => [item.code, item]));

  // -------- per-player round-by-round record ----------------------------------
  // entry: { r, opp|null, out, played, color, unplayed:false }
  // unplayed entries carry { category, equiv } where equiv is the points awarded
  // to the player that round (win/draw/loss points), used as the dummy result.
  const rec = new Map(t.players.map(p => [p.id, new Map()]));
  for (let r = 1; r <= uptoRound; r++) {
    const rd = t.roundsData[r - 1];
    if (!rd) continue;
    for (const pr of rd.pairings) {
      if (Array.isArray(pr.games) && pr.games.length) {
        pr.games.forEach((code, index) => {
          const game = RESULTS[code];
          if (!game) return;
          const whiteId = index % 2 === 0 ? pr.whiteId : pr.blackId;
          const blackId = index % 2 === 0 ? pr.blackId : pr.whiteId;
          const w = rec.get(whiteId), b = rec.get(blackId);
          if (game.played) {
            w?.set(`${r}.${index}`, { r, opp: blackId, out: game.w, played: true, color: 'W' });
            b?.set(`${r}.${index}`, { r, opp: whiteId, out: game.b, played: true, color: 'B' });
          } else {
            w?.set(`${r}.${index}`, { r, opp: blackId, out: game.w, played: false, color: null, unplayed: true, category: game.w === 'win' ? 'forfeitWin' : 'forfeitLoss', equiv: game.w });
            b?.set(`${r}.${index}`, { r, opp: whiteId, out: game.b, played: false, color: null, unplayed: true, category: game.b === 'win' ? 'forfeitWin' : 'forfeitLoss', equiv: game.b });
          }
        });
        continue;
      }
      const spec = RESULTS[pr.result];
      if (!spec) continue;
      const w = rec.get(pr.whiteId), b = rec.get(pr.blackId);
      const game = isTeam && pr.matchScore ? { w: +pr.matchScore.w || 0, b: +pr.matchScore.b || 0 } : null;
      if (spec.played) {
        w?.set(r, { r, opp: pr.blackId, out: spec.w, played: true, color: 'W', game: game?.w });
        b?.set(r, { r, opp: pr.whiteId, out: spec.b, played: true, color: 'B', game: game?.b });
      } else {
        // Forfeit: unplayed for both. Winner = forfeit win (16.2.2), loser =
        // forfeit loss (16.2.4, a VUR). No colour history.
        w?.set(r, { r, opp: pr.blackId, out: spec.w, played: false, color: null,
          unplayed: true, category: spec.w === 'win' ? 'forfeitWin' : 'forfeitLoss',
          equiv: spec.w, game: game?.w });
        b?.set(r, { r, opp: pr.whiteId, out: spec.b, played: false, color: null,
          unplayed: true, category: spec.b === 'win' ? 'forfeitWin' : 'forfeitLoss',
          equiv: spec.b, game: game?.b });
      }
    }
    for (const bye of rd.byes ?? []) {
      const v = byePoints(bye.type, t);
      const equiv = v >= winPts ? 'win' : v <= lossPts ? 'loss' : 'draw';
      // PAB (16.2.1) and full-point requested bye are involuntary-ish; half/zero
      // requested byes are Voluntary Unplayed Rounds (VUR). Forfeit-style byes
      // never occur here. terminal vs followed-by-play decided below.
      const vur = bye.type === 'HPB' || bye.type === 'ZPB';
      rec.get(bye.playerId)?.set(r, {
        r, opp: null, out: equiv, played: false, color: null, unplayed: true,
        category: bye.type === 'PAB' ? 'pab' : 'requestedBye', byeType: bye.type,
        vur, equiv
      });
    }
  }
  // Mark terminal unplayed rounds (16.2.5): an unplayed round with no later
  // played game. Relevant only for classification symmetry; cap is the same as
  // other non-forfeit categories, so we fold it into "other".
  for (const [, m] of rec) {
    const playedRounds = [...m.values()].filter(e => e.played).map(e => e.r);
    const lastPlayed = playedRounds.length ? Math.max(...playedRounds) : 0;
    for (const e of m.values()) {
      if (e.unplayed && !e.color && e.r > lastPlayed && e.category === 'requestedBye') {
        e.terminal = true;
        e.vur = true; // a terminal requested/zero bye is voluntary
      }
    }
  }

  // -------- adjusted scores (16.3) -------------------------------------------
  // A player's "adjusted score" = real score, but each of *their* unplayed
  // rounds counted as a draw instead of its actual points (capped). Used as the
  // opponent value when computing a forfeit dummy's cap. Computed once per id.
  const adjustedCache = new Map();
  function adjustedScore(id) {
    if (adjustedCache.has(id)) return adjustedCache.get(id);
    const m = rec.get(id);
    let s = scoreOf(id);
    if (m) {
      for (const e of m.values()) {
        if (e.unplayed) {
          // replace its awarded points with draw points (16.3 simplification)
          const awarded = e.equiv === 'win' ? winPts : e.equiv === 'loss' ? lossPts : drawPts;
          s = s - awarded + drawPts;
        }
      }
    }
    adjustedCache.set(id, s);
    return s;
  }

  // Opponent value for an entry (played or unplayed), per the rule version.
  function opponentValue(ownId, e) {
    if (rules === 'legacy') {
      // pre-2023: real opponent score, or own score for any unplayed round.
      return e.opp != null ? scoreOf(e.opp) : scoreOf(ownId);
    }
    // FIDE 2026:
    if (!e.unplayed) return scoreOf(e.opp);
    // dummy opponent: own score, capped (16.4)
    let cap;
    if (e.category === 'forfeitWin' || e.category === 'forfeitLoss') {
      cap = e.opp != null ? adjustedScore(e.opp) : drawPts * rounds; // 16.4.1
    } else {
      cap = drawPts * rounds; // 16.4.2
    }
    return Math.min(scoreOf(ownId), cap);
  }

  // Result multiplier for SB-type sums: points the player scored that round.
  function ownResultPoints(e) {
    const o = e.unplayed ? e.equiv : e.out;
    return o === 'win' ? winPts : o === 'draw' ? drawPts : lossPts;
  }

  const ptsOf = out => out === 'win' ? winPts : out === 'draw' ? drawPts : lossPts;

  function cumulativeScore(id) {
    const entries = rec.get(id);
    let running = 0, total = 0;
    for (let round = 1; round <= uptoRound; round++) {
      const entry = entries?.get(round);
      if (entry) running += ownResultPoints(entry);
      total += running;
    }
    return total;
  }

  // ------------------------------------------------------------------ tie-breaks
  function tb(code, p, s, config = {}) {
    const m = rec.get(p.id);
    const entries = m ? [...m.values()].sort((a, b) => a.r - b.r) : [];

    switch (code) {
      case 'BH': case 'BHC1': case 'BHM': case 'MMED': case 'SOLK': case 'FBH': {
        // contributions, each tagged with whether it comes from a VUR (16.5).
        const contribs = entries.map(e => {
          let val = opponentValue(p.id, e);
          if (code === 'FBH' && e.played && e.r === uptoRound) {
            // Fore Buchholz: last-round paired games count as draws -> opponent's
            // score recomputed as if that game were a draw is approximated by the
            // opponent's score (their result vs us unchanged materially here); we
            // adjust our *own* dummy nothing. Standard simplification: treat the
            // opponent value as-is. (Full FBH would re-evaluate opponents.)
          }
          return { val, vur: !!e.vur };
        });
        // Fore Buchholz also needs the *current* player's own last-round game to
        // be considered a draw for ranking-as-you-play; opponents' values are
        // taken at face value here (documented simplification).
        let vals = contribs.slice();
        // cut/median: remove VUR contributions first (16.5), then by lowest.
        const cut = (arr, low, high) => {
          let a = arr.slice();
          const removeOne = pickHigh => {
            // prefer a VUR; among those (or all) pick lowest (or highest)
            const pool = a.some(x => x.vur) ? a.filter(x => x.vur) : a;
            let idx = -1, best = pickHigh ? -Infinity : Infinity;
            a.forEach((x, i) => {
              if (!pool.includes(x)) return;
              if (pickHigh ? x.val > best : x.val < best) { best = x.val; idx = i; }
            });
            if (idx >= 0) a.splice(idx, 1);
          };
          for (let i = 0; i < low; i++) removeOne(false);
          for (let i = 0; i < high; i++) removeOne(true);
          return a;
        };
        const defaultLow = code === 'BHC1' || code === 'BHM' || code === 'MMED' ? 1 : 0;
        const defaultHigh = code === 'BHM' || code === 'MMED' ? 1 : 0;
        const cutsLow = Number.isFinite(Number(config.cutsLow)) ? Number(config.cutsLow) : defaultLow;
        const cutsHigh = Number.isFinite(Number(config.cutsHigh)) ? Number(config.cutsHigh) : defaultHigh;
        if (cutsLow || cutsHigh) vals = cut(vals, Math.max(0, cutsLow), Math.max(0, cutsHigh));
        return vals.reduce((acc, x) => acc + x.val, 0);
      }

      case 'CUM': {
        let running = 0, total = 0;
        for (let r = 1; r <= uptoRound; r++) {
          const e = m?.get(r);
          if (e) running += ownResultPoints(e);
          total += running;
        }
        return total;
      }

      case 'OCUM':
        return entries.reduce((total, entry) => total + (entry.opp != null ? cumulativeScore(entry.opp) : 0), 0);

      case 'SSSC': {
        // Buchholz on match points for teams: sum of opponents' match-point
        // scores (here generalised: opponents' scores), cut-1.
        const vals = entries.map(e => ({ val: opponentValue(p.id, e), vur: !!e.vur }))
          .sort((a, b) => a.val - b.val);
        if (vals.length) vals.shift();
        return vals.reduce((acc, x) => acc + x.val, 0);
      }

      case 'SB': case 'EMMSB': {
        let v = 0;
        for (const e of entries) {
          const ov = opponentValue(p.id, e);
          v += ov * ownResultPoints(e);
        }
        return v;
      }

      case 'EGGSB': {
        let v = 0;
        for (const e of entries) {
          const ov = isTeam && e.opp != null ? gameScoreOf(e.opp) : opponentValue(p.id, e);
          v += ov * (e.game ?? ownResultPoints(e));
        }
        return v;
      }

      case 'KOYA': {
        const threshold = uptoRound * winPts / 2;
        let v = 0;
        for (const e of entries) {
          if (e.opp != null && e.played && scoreOf(e.opp) >= threshold) v += ptsOf(e.out);
        }
        return v;
      }

      case 'WINS':
        // all wins, including forfeit wins
        return entries.filter(e => (e.unplayed ? e.equiv : e.out) === 'win').length;
      case 'WINSO':
        // wins in games actually played over the board
        return entries.filter(e => e.played && e.out === 'win').length;
      case 'BLK':
        return entries.filter(e => e.played && e.color === 'B').length;

      case 'MP': return s.score;            // for individual events == score
      case 'GP': return isTeam ? (s.gamePoints ?? 0) : s.score;

      case 'AROC': {
        const rs = entries.filter(e => e.played && e.opp != null)
          .map(e => ratingOf(e.opp)).filter(x => x > 0).sort((a, b) => a - b);
        if (!rs.length) return 0;
        // cut the single lowest if there are enough games (AROC == "cut")
        const use = rs.length > 1 ? rs.slice(1) : rs;
        return Math.round(use.reduce((a, b) => a + b, 0) / use.length);
      }
      case 'PERF': {
        const played = entries.filter(e => e.played && e.opp != null);
        const rs = played.map(e => ratingOf(e.opp)).filter(x => x > 0);
        if (!rs.length) return 0;
        const avg = rs.reduce((a, b) => a + b, 0) / rs.length;
        const score = played.reduce((a, e) => a + ptsOf(e.out), 0);
        const pct = Math.round(100 * score / (played.length * winPts));
        return Math.round(avg + PERFORMANCE_DP[Math.max(0, Math.min(100, pct))]);
      }
      case 'DE': return 0; // resolved pairwise below
      default: return 0;
    }
  }

  const list = rows.map(({ p, s }) => {
    const row = { player: p, score: s.score + (p.addedPoints ?? 0), tbs: {} };
    for (const code of tieBreakCodes) row.tbs[code] = tb(code, p, s, tieBreakConfig.get(code));
    return row;
  });

  // Direct-encounter helper: did A and B actually play, and what did A score?
  function directEncounter(aId, bId) {
    const m = rec.get(aId);
    if (!m) return null;
    for (const e of m.values()) {
      if (e.opp === bId && e.played) {
        return ptsOf(e.out) - (e.out === 'win' ? lossPts : e.out === 'loss' ? winPts : drawPts);
      }
    }
    return null;
  }

  const compareOfficial = (A, B) => {
    if (B.score !== A.score) return B.score - A.score;
    for (const code of tieBreakCodes) {
      if (code === 'DE') {
        const d = directEncounter(A.player.id, B.player.id);
        if (d != null && d !== 0) return -d;
        continue;
      }
      const d = (B.tbs[code] ?? 0) - (A.tbs[code] ?? 0);
      if (d !== 0) return d;
    }
    const rc = (A.player.rankCorrection ?? 0) - (B.player.rankCorrection ?? 0);
    if (rc !== 0) return rc;
    return 0;
  };

  list.sort((A, B) => compareOfficial(A, B) || A.player.no - B.player.no);

  for (let i = 0; i < list.length;) {
    let j = i + 1;
    while (j < list.length && compareOfficial(list[j - 1], list[j]) === 0) j++;
    const groupId = `tie:${list.slice(i, j).map(row => row.player.id).join('|')}`;
    for (let k = i; k < j; k++) list[k].tieGroupId = groupId;
    i = j;
  }
  const rankLabels = visibleRankLabels(list);
  list.forEach((row, i) => {
    row.rank = i + 1;
    row.rankLabel = rankLabels[i];
  });
  return list;
}
