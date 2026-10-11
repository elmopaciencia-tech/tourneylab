import { computeStates, RESULTS, resultLabel } from './state.js';
import {
  assessMatch,
  normalizeTeamPolicy,
  teamRoster,
  teamRating,
  reportRating,
  teamMatchResult,
  latestCompletedTeamRound,
} from './team.js';
import { computeStandings, PERFORMANCE_DP } from './tiebreaks.js';
import { calculateRatingProjectionAfterRound } from './ratingProjection.js';
export function calculateTeamReport(
  t,
  upto = t.currentRound ?? 0,
  overrides = {},
) {
  const policy = normalizeTeamPolicy({ ...t.teamPolicy, ...overrides });
  const roster = t.rosterPlayers ?? [],
    byId = new Map(roster.map((p) => [p.id, p]));
  const memberships = new Map(
    (t.teams ?? []).flatMap((tm) =>
      teamRoster(t, tm.playerId).map((m) => [
        m.rosterId,
        { ...m, teamId: tm.playerId },
      ]),
    ),
  );
  const games = [],
    roundStats = [],
    history = new Map(roster.map((p) => [p.id, []]));
  const scoring = t.scoring ?? { win: 1, draw: 0.5, loss: 0 };
  const count = () => ({
    whiteWins: 0,
    draws: 0,
    blackWins: 0,
    forfeits: 0,
    pending: 0,
    total: 0,
  });
  for (
    let round = 1;
    round <= Math.min(upto, t.roundsData?.length ?? 0);
    round++
  ) {
    const rd = t.roundsData[round - 1],
      stats = count(),
      seen = new Set();
    for (const match of rd.pairings ?? [])
      for (const board of match.teamBoards ?? []) {
        const spec = RESULTS[board.result],
          terminal = !!spec && !spec.adjourned;
        const g = {
          ...board,
          round,
          match: match.board,
          id: `${round}.${match.board}.${board.board}`,
          whitePlayerId: board.whiteRosterId,
          blackPlayerId: board.blackRosterId,
          isRated:
            t.rated !== false &&
            board.rated !== false &&
            terminal &&
            !!spec.played,
          wasPlayedOverTheBoard: terminal && !!spec.played,
        };
        games.push(g);
        stats.total++;
        if (!terminal) stats.pending++;
        else if (spec.forfeit || !spec.played) stats.forfeits++;
        else if (spec.w === 'win') stats.whiteWins++;
        else if (spec.b === 'win') stats.blackWins++;
        else stats.draws++;
        for (const [id, opp, color, side] of [
          [board.whiteRosterId, board.blackRosterId, 'W', 'w'],
          [board.blackRosterId, board.whiteRosterId, 'B', 'b'],
        ]) {
          if (!byId.has(id)) continue;
          seen.add(id);
          history.get(id).push({
            round,
            board: board.board,
            match: match.board,
            opponentId: opp || null,
            color,
            result: board.result,
            terminal,
            played: g.wasPlayedOverTheBoard,
            rated: g.isRated,
            forfeit: !!spec?.forfeit,
            points: terminal ? scoring[spec[side]] : 0,
            label: terminal ? resultLabel(board.result) : 'Pending',
          });
        }
      }
    for (const p of roster)
      if (!seen.has(p.id))
        history.get(p.id).push({
          round,
          board: null,
          match: null,
          opponentId: null,
          color: '',
          result: '',
          terminal: false,
          played: false,
          rated: false,
          forfeit: false,
          points: 0,
          label: p.withdrawn ? 'Withdrawn' : 'Not fielded',
        });
    roundStats.push({ round, ...stats });
  }
  const projectionPlayers = roster.map((p) => ({
    ...p,
    rating: reportRating(p, policy),
    publishedRating: reportRating(p, policy),
    pairingRating: reportRating(p, policy),
  }));
  const projections = calculateRatingProjectionAfterRound(
    {
      ...t,
      players: projectionPlayers,
      ratingProjection: {
        kFactorMode: 'custom',
        customKFactor: policy.kFactor,
      },
    },
    upto,
    { games },
  );
  const players = roster.map((player) => {
    const hs = history.get(player.id),
      eligible = hs.filter(
        (g) => g.terminal && (policy.includeForfeits || !g.forfeit),
      );
    const averageGames = hs.filter(
      (g) => g.terminal && (g.played || policy.averageIncludeForfeits),
    );
    const ratings = averageGames
      .map(
        (g) =>
          reportRating(byId.get(g.opponentId), policy) ||
          Number(policy.opponentUnratedValue) ||
          0,
      )
      .filter((n) => n > 0);
    const perfGames = hs
      .filter(
        (g) => g.terminal && (g.played || policy.performanceIncludeForfeits),
      )
      .map((g) => ({
        ...g,
        opponentRating:
          reportRating(byId.get(g.opponentId), policy) ||
          Number(policy.opponentUnratedValue) ||
          0,
      }));
    const perfEligible = perfGames.filter((g) => g.opponentRating > 0);
    const performance =
      perfEligible.length && perfEligible.length === perfGames.length
        ? Math.round(
            perfEligible.reduce((s, g) => s + g.opponentRating, 0) /
              perfEligible.length +
              PERFORMANCE_DP[
                Math.max(
                  0,
                  Math.min(
                    100,
                    Math.round(
                      (100 * perfEligible.reduce((s, g) => s + g.points, 0)) /
                        (perfEligible.length * (scoring.win || 1)),
                    ),
                  ),
                )
              ],
          )
        : null;
    let cumulative = 0;
    hs.forEach((g) => {
      cumulative += g.points;
      g.cumulative = cumulative;
    });
    return {
      player,
      membership: memberships.get(player.id),
      history: hs,
      points: hs.reduce((s, g) => s + g.points, 0),
      awardPoints: eligible.reduce((s, g) => s + g.points, 0),
      scheduled: hs.filter((g) => g.board != null).length,
      completed: hs.filter((g) => g.terminal).length,
      played: hs.filter((g) => g.played).length,
      rated: hs.filter((g) => g.rated).length,
      eligibleGames: eligible.length,
      opponentAverage: ratings.length
        ? Math.round(ratings.reduce((s, r) => s + r, 0) / ratings.length)
        : null,
      performance,
      projection: projections.get(player.id),
    };
  });
  const byScore = players.slice().sort((a, b) => b.points - a.points);
  byScore.forEach(
    (row, i) =>
      (row.rank =
        i && byScore[i - 1].points === row.points
          ? byScore[i - 1].rank
          : i + 1),
  );
  const points = new Map(players.map((p) => [p.player.id, p.awardPoints]));
  const awardGroups = new Map();
  for (const row of players) {
    const boards =
      policy.boardGrouping === 'played'
        ? [
            ...new Set(
              row.history.filter((g) => g.terminal).map((g) => g.board),
            ),
          ]
        : [row.membership?.board];
    for (const board of boards) {
      if (!board) continue;
      const hs = row.history.filter(
        (g) =>
          g.terminal &&
          (policy.includeForfeits || !g.forfeit) &&
          (policy.boardGrouping !== 'played' || g.board === board),
      );
      if (hs.length < Number(policy.minimumGames)) continue;
      const manual = t.boardAwardManual?.[`${board}:${row.player.id}`];
      const tb = {
        MANUAL: manual?.value ?? 0,
        POINTS: hs.reduce((s, g) => s + g.points, 0),
        BH: hs.reduce((s, g) => s + (points.get(g.opponentId) ?? 0), 0),
        SB: hs.reduce(
          (s, g) => s + (points.get(g.opponentId) ?? 0) * g.points,
          0,
        ),
        WINS: hs.filter((g) => g.points === scoring.win).length,
      };
      const arr = awardGroups.get(board) ?? [];
      arr.push({
        ...row,
        awardBoard: board,
        awardGames: hs.length,
        tbs: tb,
        manualReason: manual?.reason ?? '',
      });
      awardGroups.set(board, arr);
    }
  }
  const codes = policy.awardTiebreaks;
  for (const rows of awardGroups.values()) {
    const compare = (a, b) => {
      for (const c of codes) {
        const d = (b.tbs[c] ?? 0) - (a.tbs[c] ?? 0);
        if (d) return d;
      }
      return 0;
    };
    rows.sort(
      (a, b) => compare(a, b) || (a.player.no ?? 0) - (b.player.no ?? 0),
    );
    rows.forEach((row, i) => {
      row.rank =
        i && compare(rows[i - 1], row) === 0 ? rows[i - 1].rank : i + 1;
    });
  }
  const standings = computeStandings(t, upto),
    states = computeStates(t, upto);
  const teams = standings.map((row) => {
    const id = row.player.id;
    let played = 0,
      wins = 0,
      draws = 0,
      losses = 0;
    for (const rd of (t.roundsData ?? []).slice(0, upto))
      for (const m of rd.pairings ?? []) {
        if (![m.whiteId, m.blackId].includes(id)) continue;
        const spec = RESULTS[teamMatchResult(t, m)];
        if (!spec || spec.adjourned) continue;
        played++;
        const outcome = spec[m.whiteId === id ? 'w' : 'b'];
        if (outcome === 'win') wins++;
        else if (outcome === 'draw') draws++;
        else losses++;
      }
    return {
      ...row,
      gamePoints: row.gamePoints ?? states.get(id)?.gamePoints ?? 0,
      averageRating: teamRating(t, id, policy, upto),
      played,
      wins,
      draws,
      losses,
      members: players.filter((p) => p.membership?.teamId === id),
    };
  });
  const statistics = { federations: {}, titles: {}, total: count() };
  for (const p of roster) {
    statistics.federations[p.fed || 'Unknown'] =
      (statistics.federations[p.fed || 'Unknown'] || 0) + 1;
    if (p.title)
      statistics.titles[p.title] = (statistics.titles[p.title] || 0) + 1;
  }
  for (const r of roundStats)
    for (const k of Object.keys(statistics.total)) statistics.total[k] += r[k];
  const reconciliation = (t.roundsData || [])
    .slice(0, upto)
    .flatMap((rd, i) =>
      (rd.pairings || [])
        .filter(
          (m) =>
            (m.result && m.boardDataVersion !== 1) ||
            assessMatch(t, m).errors.length,
        )
        .map((m) => ({
          round: i + 1,
          match: m.board,
          reason:
            m.boardDataVersion !== 1
              ? 'Legacy totals or unverified board detail'
              : 'Invalid board detail',
        })),
    );
  return {
    policy,
    round: upto,
    reconciliation,
    completedRound: Math.min(upto, latestCompletedTeamRound(t)),
    players,
    teams,
    awardGroups,
    games,
    roundStats,
    statistics,
  };
}
