import { assessMatch, teamMatchResult, boardOneColour } from './engine/team.js';
import { calculateTeamReport } from './engine/team-reports.js';
import { teamRecords } from './engine/team-ranking.js';
import { resultLabel } from './engine/state.js';
export function teamReportTables(t, upto = t.currentRound ?? 0) {
  const r = calculateTeamReport(t, upto),
    name = (id) => t.players.find((p) => p.id === id)?.name || '—',
    person = (id) => t.rosterPlayers?.find((p) => p.id === id),
    tb = t.tiebreaks ?? [];
  const tables = [];
  const add = (id, title, headers, rows) =>
    tables.push({ id, title, headers, rows });
  add(
    'teams',
    'Team starting list',
    [
      'SNo',
      'Team',
      'Group',
      'School / club',
      'Captain',
      'Federation',
      'Average rating',
    ],
    r.teams
      .slice()
      .sort((a, b) => a.player.no - b.player.no)
      .map((x) => [
        x.player.no,
        x.player.name,
        x.player.group || '',
        t.listOptions?.showClub === false ? '' : x.player.club || '',
        x.player.captain ||
          (t.teams ?? []).find((tm) => tm.playerId === x.player.id)?.captain ||
          '',
        t.listOptions?.showFederation === false ? '' : x.player.fed || '',
        x.averageRating ?? '',
      ]),
  );
  add(
    'standings',
    `Team standings through Round ${r.completedRound}`,
    [
      'Rank',
      'SNo',
      'Team',
      'Group',
      'Matches',
      'Wins',
      'Draws',
      'Losses',
      'MP',
      'GP',
      ...tb,
    ],
    calculateTeamReport(t, r.completedRound).teams.map((x) => [
      x.rankLabel || x.rank,
      x.player.no,
      x.player.name,
      x.player.group || '',
      x.played,
      x.wins,
      x.draws,
      x.losses,
      x.score,
      x.gamePoints ?? 0,
      ...tb.map((c) => x.tbs[c] ?? 0),
    ]),
  );
  const rec = teamRecords(t, r.completedRound);
  add(
    'crosstable',
    `Team crosstable through Round ${r.completedRound}`,
    [
      'SNo',
      'Team',
      ...Array.from({ length: upto }, (_, i) => `Round ${i + 1}`),
    ],
    r.teams.map((x) => [
      x.player.no,
      x.player.name,
      ...Array.from({ length: upto }, (_, i) => {
        const m = t.roundsData?.[i]?.pairings?.find((m) =>
          [m.whiteId, m.blackId].includes(x.player.id),
        );
        const g = rec.get(x.player.id)?.find((g) => g.round === i + 1);
        return m
          ? `${name(m.whiteId === x.player.id ? m.blackId : m.whiteId)} · ${(m.whiteId === x.player.id) === (boardOneColour(t, m) !== 'B') ? 'W' : 'B'} on board 1 · ${g ? g.gp : 'Pending'}`
          : g
            ? 'Bye'
            : '—';
      }),
    ]),
  );
  const listHeaders = [
    'No',
    'Title',
    'Player',
    'FIDE ID',
    'Rating',
    'National rating',
    'Federation',
    'Team',
    'Registered board',
    'Reserve',
    'Club / school',
    ...(t.listOptions?.showBirthYear ? ['Born'] : []),
  ];
  const playerRows = (ps) =>
    ps.map((x) => [
      x.player.no,
      t.listOptions?.showTitles === false ? '' : x.player.title || '',
      x.player.name,
      t.listOptions?.showFideId === false ? '' : x.player.fideId || '',
      x.player.rating || 0,
      x.player.ratings?.national || 0,
      t.listOptions?.showFederation === false ? '' : x.player.fed || '',
      name(x.membership?.teamId),
      x.membership?.board || '',
      x.membership?.reserve ? 'Yes' : '',
      t.listOptions?.showClub === false ? '' : x.player.club || '',
      ...(t.listOptions?.showBirthYear ? [x.player.byear || ''] : []),
    ]);
  add(
    'players',
    'Individual players by rating',
    listHeaders,
    playerRows(
      r.players
        .slice()
        .sort((a, b) => (b.player.rating || 0) - (a.player.rating || 0)),
    ),
  );
  add(
    'alphabetical',
    'Individual players alphabetically',
    listHeaders,
    playerRows(
      r.players
        .slice()
        .sort((a, b) => a.player.name.localeCompare(b.player.name)),
    ),
  );
  add(
    'composition',
    'Team composition and round results',
    [
      'Team',
      'Order',
      'Reserve',
      'Title',
      'Player',
      'Rating',
      'FED',
      'FIDE ID',
      ...Array.from({ length: upto }, (_, i) => `R${i + 1}`),
      'Points',
      'Scheduled',
      'Completed',
      'Played',
      'Rated',
      'Opponent average',
      'Performance',
      'Estimated rating change',
    ],
    r.players
      .slice()
      .sort(
        (a, b) =>
          name(a.membership?.teamId).localeCompare(
            name(b.membership?.teamId),
          ) || (a.membership?.board || 0) - (b.membership?.board || 0),
      )
      .map((x) => [
        name(x.membership?.teamId),
        x.membership?.board || '',
        x.membership?.reserve ? 'R' : '',
        t.listOptions?.showTitles === false ? '' : x.player.title || '',
        x.player.name,
        x.player.rating || 0,
        t.listOptions?.showFederation === false ? '' : x.player.fed || '',
        t.listOptions?.showFideId === false ? '' : x.player.fideId || '',
        ...x.history.map((g) =>
          g.label === 'Not fielded' || g.label === 'Withdrawn'
            ? g.label
            : g.terminal
              ? `${g.forfeit ? 'Forfeit ' : ''}${g.points} (${g.color})`
              : `Pending (${g.color})`,
        ),
        x.points,
        x.scheduled,
        x.completed,
        x.played,
        x.rated,
        x.opponentAverage ?? '',
        x.performance ?? '',
        x.projection?.rows?.length ? x.projection.projectedChangeRaw : '',
      ]),
  );
  for (let round = 1; round <= upto; round++) {
    const before = calculateTeamReport(t, round - 1),
      mp = new Map(before.teams.map((x) => [x.player.id, x.score]));
    add(
      `pairings-${round}`,
      `Round ${round}: team pairings`,
      [
        'Match',
        'Home SNo',
        'Home team',
        'MP before',
        'Board score',
        'MP before',
        'Away team',
        'Away SNo',
      ],
      (t.roundsData?.[round - 1]?.pairings ?? []).map((m) => [
        m.board,
        t.players.find((p) => p.id === m.whiteId)?.no,
        name(m.whiteId),
        mp.get(m.whiteId) || 0,
        `${(m.boardDataVersion === 1 ? assessMatch(t, m).score : m.matchScore)?.w ?? 0} : ${(m.boardDataVersion === 1 ? assessMatch(t, m).score : m.matchScore)?.b ?? 0}${teamMatchResult(t, m) ? '' : ' (provisional)'}`,
        mp.get(m.blackId) || 0,
        name(m.blackId),
        t.players.find((p) => p.id === m.blackId)?.no,
      ]),
    );
    add(
      `boards-${round}`,
      `Round ${round}: board pairings`,
      [
        'Board',
        'White title',
        'White',
        'White rating',
        'White FED',
        'Result',
        'Black title',
        'Black',
        'Black rating',
        'Black FED',
      ],
      r.games
        .filter((g) => g.round === round)
        .map((g) => [
          `${g.match}.${g.board}`,
          person(g.whitePlayerId)?.title || '',
          person(g.whitePlayerId)?.name || 'Vacant',
          person(g.whitePlayerId)?.rating || 0,
          person(g.whitePlayerId)?.fed || '',
          g.result ? resultLabel(g.result) : 'Pending',
          person(g.blackPlayerId)?.title || '',
          person(g.blackPlayerId)?.name || 'Vacant',
          person(g.blackPlayerId)?.rating || 0,
          person(g.blackPlayerId)?.fed || '',
        ]),
    );
  }
  for (const [board, rows] of r.awardGroups)
    add(
      `awards-${board}`,
      `Board ${board} awards`,
      [
        'Rank',
        'Player',
        'Team',
        'Registered board',
        'Rating',
        'Eligible results',
        ...r.policy.awardTiebreaks,
        'Manual reason',
      ],
      rows.map((x) => [
        x.rank,
        x.player.name,
        name(x.membership?.teamId),
        x.membership?.board,
        x.player.rating || 0,
        x.awardGames,
        ...r.policy.awardTiebreaks.map((c) => x.tbs[c]),
        x.manualReason,
      ]),
    );
  add(
    'federations',
    'Player federation statistics',
    ['Federation', 'Players'],
    Object.entries(r.statistics.federations),
  );
  add(
    'titles',
    'Player title statistics',
    ['Title', 'Players'],
    Object.entries(r.statistics.titles),
  );
  add(
    'game-statistics',
    'Board-game statistics',
    [
      'Round',
      'White wins',
      'Draws',
      'Black wins',
      'Forfeits',
      'Pending',
      'Total',
    ],
    [
      ...r.roundStats.map((s) => [
        s.round,
        s.whiteWins,
        s.draws,
        s.blackWins,
        s.forfeits,
        s.pending,
        s.total,
      ]),
      [
        'Total',
        ...[
          'whiteWins',
          'draws',
          'blackWins',
          'forfeits',
          'pending',
          'total',
        ].map((k) => r.statistics.total[k]),
      ],
    ],
  );
  add(
    'tie-breaks',
    'Team tie-break contribution audit',
    [
      'Team',
      'Tie-break',
      'Round',
      'Opponent',
      'Opponent value',
      'Multiplier',
      'Contribution',
      'Cut',
    ],
    r.teams.flatMap((x) =>
      Object.entries(x.breakdown ?? {}).flatMap(([code, vals]) =>
        vals.map((v) => [
          x.player.name,
          code,
          v.round,
          name(v.opponent),
          v.opponentScore,
          v.multiplier,
          v.value,
          v.cut ? 'Yes' : 'No',
        ]),
      ),
    ),
  );
  add(
    'player-histories',
    'Individual board-game histories',
    [
      'Player',
      'Team',
      'Round',
      'Board',
      'Colour',
      'Opponent',
      'Opponent rating',
      'Result / status',
      'Points',
      'Cumulative',
      'Played',
      'Rated',
    ],
    r.players.flatMap((p) =>
      p.history.map((g) => [
        p.player.name,
        name(p.membership?.teamId),
        g.round,
        g.board ? `${g.match}.${g.board}` : '',
        g.color,
        person(g.opponentId)?.name || '',
        person(g.opponentId)?.rating ?? '',
        g.label,
        g.terminal ? g.points : '',
        g.cumulative,
        g.played ? 'Yes' : 'No',
        g.rated ? 'Yes' : 'No',
      ]),
    ),
  );
  add(
    'match-statistics',
    'Team match statistics',
    ['Team', 'Completed matches', 'Won', 'Drawn', 'Lost'],
    r.teams.map((x) => [x.player.name, x.played, x.wins, x.draws, x.losses]),
  );
  add(
    'schedule',
    'Playing schedule',
    ['Round', 'Date', 'Time', 'Venue'],
    Array.from({ length: t.rounds }, (_, i) => [
      i + 1,
      t.roundsData?.[i]?.date || t.roundSchedule?.[i]?.date || '',
      t.roundsData?.[i]?.time || t.roundSchedule?.[i]?.time || '',
      t.roundSchedule?.[i]?.site || t.site || '',
    ]),
  );
  add(
    'policies',
    'Calculation definitions',
    ['Setting', 'Value'],
    [
      ...Object.entries(r.policy).map(([key, value]) => [
        key,
        Array.isArray(value) ? value.join(', ') : String(value),
      ]),
      ...(t.tiebreakConfig || []).map((c, i) => [
        `Team tie-break ${i + 1}`,
        JSON.stringify(c),
      ]),
      [
        'Performance',
        'Opponent average + FIDE percentage-score table; estimate only',
      ],
      [
        'Board awards BH / SB',
        'Actual opponent award points, with selected forfeit policy',
      ],
      [
        'Roster rank',
        'Competition rank by individual board points across this section',
      ],
    ],
  );
  add(
    'record-status',
    'Historical board reconciliation',
    ['Round', 'Match', 'Status'],
    r.reconciliation.map((m) => [m.round, m.match, m.reason]),
  );
  return { report: r, tables };
}
