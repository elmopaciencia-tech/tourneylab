// FIDE C.07 (March 2026), Articles 6, 13, 14, 16. Legacy ranking remains opt-in separately.
import { RESULTS, byePoints } from './state.js';
import { teamMatchResult, assessMatch } from './team.js';
export const TEAM_TIEBREAKS = {
  MP: 'Match points',
  GP: 'Game points',
  DE: 'Direct encounter (tied group)',
  BH: 'Buchholz',
  BHC1: 'Buchholz cut 1',
  BHM: 'Buchholz median',
  SB: 'Sonneborn–Berger',
  EMMSB: 'Opponent MP × earned MP',
  EMGSB: 'Opponent MP × earned GP',
  EGMSB: 'Opponent GP × earned MP',
  EGGSB: 'Opponent GP × earned GP',
  WINS: 'Matches won',
  WINSO: 'Matches won over the board',
};
export function teamRecords(t, upto) {
  const records = new Map((t.players ?? []).map((p) => [p.id, []])),
    mp = t.matchScoring ?? { win: 2, draw: 1, loss: 0 },
    gp = t.scoring ?? { win: 1, draw: 0.5, loss: 0 };
  for (let r = 1; r <= upto; r++) {
    const rd = t.roundsData?.[r - 1];
    if (!rd) continue;
    const involved = new Set();
    for (const m of rd.pairings ?? []) {
      const spec = RESULTS[teamMatchResult(t, m)];
      involved.add(m.whiteId);
      involved.add(m.blackId);
      if (!spec || spec.adjourned) continue;
      const score =
        m.boardDataVersion === 1
          ? assessMatch(t, m).score
          : (m.matchScore ?? { w: 0, b: 0 });
      for (const [id, opp, side] of [
        [m.whiteId, m.blackId, 'w'],
        [m.blackId, m.whiteId, 'b'],
      ])
        records
          .get(id)
          ?.push({
            round: r,
            opponent: opp,
            mp: mp[spec[side]],
            gp: Number(score[side]) || 0,
            played: spec.played,
            forfeit: !!spec.forfeit,
            vur: spec.forfeit && spec[side] === 'loss',
            outcome: spec[side],
            color: side === 'w' ? 'W' : 'B',
          });
    }
    for (const p of t.players ?? []) {
      if (involved.has(p.id)) continue;
      const bye = rd.byes?.find((b) => b.playerId === p.id);
      if (!bye && !p.withdrawn && p.active !== false) continue;
      const type = bye?.type || 'ZPB',
        points = byePoints(type, t),
        game =
          type === 'PAB'
            ? (t.teamByeMatchScore?.game ?? t.boardsPerMatch * gp.win)
            : type === 'FPB'
              ? t.boardsPerMatch * gp.win
              : type === 'HPB'
                ? t.boardsPerMatch * gp.draw
                : 0;
      records
        .get(p.id)
        .push({
          round: r,
          opponent: null,
          mp: points,
          gp: game,
          played: false,
          requested: ['HPB', 'ZPB'].includes(type),
          vur: ['HPB', 'ZPB'].includes(type),
          outcome:
            points === mp.win ? 'win' : points === mp.draw ? 'draw' : 'loss',
          color: '',
        });
    }
  }
  return records;
}
export function rankGroups(rows, configs, value, encounters, maxScore = 2) {
  // Reapply DE inside newly separated subsets; never use a non-transitive pairwise comparator.
  const partition = (group, key) => {
    const sorted = group.slice().sort((a, b) => key(b) - key(a));
    const buckets = [];
    for (const row of sorted) {
      const last = buckets.at(-1);
      if (last && key(last[0]) === key(row)) last.push(row);
      else buckets.push([row]);
    }
    return buckets;
  };
  const direct = (group) => {
    if (group.length < 2) return [group];
    const ids = new Set(group.map((r) => r.player.id));
    const scores = new Map(
      group.map((r) => {
        const games = encounters(r.player.id).filter((x) =>
          ids.has(x.opponent),
        );
        const byOpp = new Map();
        for (const x of games) {
          const vals = byOpp.get(x.opponent) ?? [];
          vals.push(x.value);
          byOpp.set(x.opponent, vals);
        }
        return [
          r.player.id,
          {
            score: [...byOpp.values()].reduce(
              (s, v) => s + v.reduce((a, b) => a + b, 0) / v.length,
              0,
            ),
            missing: group.length - 1 - byOpp.size,
          },
        ];
      }),
    );
    group.forEach((r) => (r.tbs.DE = scores.get(r.player.id).score));
    if ([...scores.values()].every((s) => !s.missing)) {
      const parts = partition(group, (r) => scores.get(r.player.id).score);
      return parts.length > 1
        ? parts.flatMap((p) => (p.length < group.length ? direct(p) : [p]))
        : [group];
    }
    const winner = group.find((r) =>
      group.every(
        (other) =>
          other === r ||
          scores.get(r.player.id).score >
            scores.get(other.player.id).score +
              scores.get(other.player.id).missing * maxScore,
      ),
    );
    return winner
      ? [[winner], ...direct(group.filter((r) => r !== winner))]
      : [group];
  };
  const apply = (group, i) => {
    if (group.length < 2 || i >= configs.length) return [group];
    const c = configs[i];
    const parts =
      c.code === 'DE' ? direct(group) : partition(group, (r) => value(r, c));
    return parts.flatMap((p) => apply(p, i + 1));
  };
  const groups = apply(rows, 0);
  let count = 0;
  return groups.flatMap((g, index) => {
    const rank = count + 1;
    count += g.length;
    return g
      .sort((a, b) => (a.player.no ?? 0) - (b.player.no ?? 0))
      .map((row) => ({
        ...row,
        rank,
        rankLabel: g.length > 1 ? `${rank}-${count}` : String(rank),
        tieGroupId: `team-tie-${index}`,
      }));
  });
}
export function computeTeamStandings(t, upto) {
  const rec = teamRecords(t, upto),
    totals = new Map(
      [...rec].map(([id, games]) => [
        id,
        {
          mp: games.reduce((s, g) => s + g.mp, 0),
          gp: games.reduce((s, g) => s + g.gp, 0),
        },
      ]),
    );
  const mp = t.matchScoring ?? { win: 2, draw: 1, loss: 0 },
    gp = t.scoring ?? { win: 1, draw: 0.5, loss: 0 };
  const configs = (
    t.tiebreakConfig?.length
      ? t.tiebreakConfig
      : (t.tiebreaks ?? ['MP', 'GP', 'DE', 'BH', 'EMGSB'])
  ).map((c) => (typeof c === 'string' ? { code: c } : c));
  const draw = (basis) =>
    basis === 'game' ? gp.draw * (t.boardsPerMatch || 4) : mp.draw;
  const key = (basis) => (basis === 'game' ? 'gp' : 'mp');
  const adjusted = (id, basis) => {
    const games = rec.get(id) ?? [];
    return games.reduce(
      (sum, g, i) =>
        sum +
        (g.requested && games.slice(i + 1).every((later) => later.vur)
          ? draw(basis)
          : g[key(basis)]),
      0,
    );
  };
  const rows = (t.players ?? []).map((player) => ({
    player,
    score: (totals.get(player.id)?.mp ?? 0) + (player.addedPoints || 0),
    gamePoints: totals.get(player.id)?.gp ?? 0,
    tbs: {},
    breakdown: {},
    games: rec.get(player.id) ?? [],
  }));
  const calc = (row, c) => {
    const code = c.code,
      games = row.games;
    if (code === 'MP') return row.score;
    if (code === 'GP') return row.gamePoints;
    if (code === 'WINS' || code === 'WINSO')
      return games.filter(
        (g) => g.outcome === 'win' && (code === 'WINS' || g.played),
      ).length;
    if (code === 'DE') return row.tbs.DE ?? 0;
    const esb = ['EMMSB', 'EMGSB', 'EGMSB', 'EGGSB'].includes(code),
      sb = code === 'SB' || esb;
    const basis = c.scoreBasis || (code.startsWith('EG') ? 'game' : 'match');
    const multiplier =
      c.multiplierBasis ||
      (code === 'EMGSB' || code === 'EGGSB' ? 'game' : 'match');
    const mode = c.unplayed || 'fide2026';
    const vals = games.map((g) => {
      let opponent = totals.get(g.opponent)?.[key(basis)] ?? 0;
      if (mode === 'zero' && !g.played) opponent = 0;
      else if (mode === 'fide2026' && t.type !== 'team-rr') {
        if (g.played) opponent = adjusted(g.opponent, basis);
        else
          opponent = Math.min(
            totals.get(row.player.id)?.[key(basis)] ?? 0,
            g.forfeit
              ? adjusted(g.opponent, basis)
              : draw(basis) * (t.rounds || upto),
          );
      }
      return {
        round: g.round,
        opponent: g.opponent,
        opponentScore: opponent,
        multiplier: sb ? g[key(multiplier)] : 1,
        value: opponent * (sb ? g[key(multiplier)] : 1),
        vur: g.vur,
        cut: false,
      };
    });
    const low = Number(
        c.cutsLow ?? (code === 'BHC1' || code === 'BHM' ? 1 : 0),
      ),
      high = Number(c.cutsHigh ?? (code === 'BHM' ? 1 : 0));
    const least = (a, b) =>
      sb
        ? a.opponentScore - b.opponentScore || a.value - b.value
        : a.value - b.value;
    for (let i = 0; i < low + high; i++) {
      const pool = vals.filter((v) => !v.cut);
      if (!pool.length) break;
      pool.sort(least);
      let pick = i < low ? pool[0] : pool.at(-1);
      if (i < low && mode === 'fide2026' && t.type !== 'team-rr') {
        const vur = pool
          .filter((v) => v.vur)
          .sort((a, b) => a.value - b.value)[0];
        if (vur && (!sb || vur.value >= pick.value)) pick = vur;
      }
      pick.cut = true;
    }
    row.breakdown[code] = vals;
    return vals.filter((v) => !v.cut).reduce((sum, v) => sum + v.value, 0);
  };
  for (const row of rows)
    for (const c of configs) {
      if (!TEAM_TIEBREAKS[c.code])
        throw new Error(
          `Unsupported team tie-break ${c.code}; select a supported team policy.`,
        );
      row.tbs[c.code] = calc(row, c);
    }
  return rankGroups(
    rows,
    [{ code: 'MP' }, ...configs],
    (r, c) => r.tbs[c.code] ?? calc(r, c),
    (id) =>
      (rec.get(id) ?? [])
        .filter(
          (g) =>
            g.opponent &&
            (g.played ||
              t.type === 'team-rr' ||
              t.teamPolicy?.directIncludeForfeits),
        )
        .map((g) => ({ opponent: g.opponent, value: g.mp })),
    mp.win,
  );
}
