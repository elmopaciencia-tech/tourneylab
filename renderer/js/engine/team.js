// Team identities, lineups and board completion. Pure except explicit save helpers.
import { RESULTS } from './state.js';
export const isTeamEvent = (t) => ['team-swiss', 'team-rr'].includes(t?.type);
const copy = (x) => JSON.parse(JSON.stringify(x));
export function normalizeTeamPolicy(p = {}) {
  return {
    version: 1,
    rankingVersion: 'legacy',
    ratingBasis: 'starters',
    ratingSource: 'rating',
    unratedValue: 0,
    opponentUnratedValue: 0,
    averageIncludeForfeits: false,
    performanceIncludeForfeits: false,
    kFactor: 20,
    boardGrouping: 'registered',
    minimumGames: 1,
    includeForfeits: true,
    awardTiebreaks: ['MANUAL', 'POINTS', 'BH', 'SB'],
    ...p,
  };
}
export function teamRoster(t, id) {
  const players = new Map((t.rosterPlayers ?? []).map((p) => [p.id, p]));
  return ((t.teams ?? []).find((tm) => tm.playerId === id)?.members ?? [])
    .map((m) => ({
      ...m,
      rosterId: m.rosterId ?? m.playerId,
      player: players.get(m.rosterId ?? m.playerId),
    }))
    .filter((m) => m.player)
    .sort((a, b) => a.board - b.board || a.rosterId.localeCompare(b.rosterId));
}
export function reportRating(player, policy) {
  const value = Number(
    policy.ratingSource === 'rating'
      ? player?.rating
      : player?.ratings?.[policy.ratingSource],
  );
  return Number.isFinite(value) && value > 0 ? value : 0;
}
export function teamRating(
  t,
  id,
  policy = normalizeTeamPolicy(t.teamPolicy),
  round = t.currentRound,
) {
  let members = teamRoster(t, id);
  if (policy.ratingBasis === 'lineup') {
    const m = t.roundsData?.[round - 1]?.pairings?.find((m) =>
      [m.whiteId, m.blackId].includes(id),
    );
    const ids = new Set(
      (m?.teamBoards ?? []).flatMap((b) => [b.whiteRosterId, b.blackRosterId]),
    );
    members = members.filter((m) => ids.has(m.rosterId));
  } else if (policy.ratingBasis === 'topRated')
    members.sort(
      (a, b) => reportRating(b.player, policy) - reportRating(a.player, policy),
    );
  else members = members.filter((m) => !m.reserve);
  members = members.slice(0, Math.max(1, t.boardsPerMatch || 4));
  return members.length
    ? Math.round(
        members.reduce(
          (s, m) =>
            s +
            (reportRating(m.player, policy) ||
              Number(policy.unratedValue) ||
              0),
          0,
        ) / members.length,
      )
    : null;
}
export function boardOneColour(t, match) {
  if (match.boardOneColor) return match.boardOneColor;
  const first = match.teamBoards?.find((b) => Number(b.board) === 1);
  if (first?.homeColor) return first.homeColor;
  const ids = new Set(teamRoster(t, match.whiteId).map((m) => m.rosterId));
  return first && ids.has(first.blackRosterId) ? 'B' : 'W';
}
export function homeColour(match, board) {
  return (match.boardOneColor === 'B' ? board % 2 === 0 : board % 2 === 1)
    ? 'W'
    : 'B';
}
export function seedBoards(t, match, { previous = false, round = 0 } = {}) {
  const n = Math.max(1, Number(t.boardsPerMatch) || 4);
  const roster = (id) =>
    teamRoster(t, id).filter(
      (m) => !m.player.withdrawn && m.player.active !== false,
    );
  const lineup = (id) => {
    if (previous)
      for (let r = round - 2; r >= 0; r--) {
        const old = t.roundsData?.[r]?.pairings?.find((m) =>
          [m.whiteId, m.blackId].includes(id),
        );
        if (old?.teamBoards?.length) {
          const ids = new Set(roster(id).map((m) => m.rosterId));
          return old.teamBoards
            .slice()
            .sort((a, b) => a.board - b.board)
            .map((b) =>
              ids.has(b.whiteRosterId)
                ? b.whiteRosterId
                : ids.has(b.blackRosterId)
                  ? b.blackRosterId
                  : '',
            );
        }
      }
    return roster(id)
      .filter((m) => !m.reserve)
      .map((m) => m.rosterId);
  };
  const a = lineup(match.whiteId),
    b = lineup(match.blackId);
  return Array.from({ length: n }, (_, i) => {
    if (!previous && match.teamBoards?.find((b) => b.board === i + 1))
      return copy(match.teamBoards.find((b) => b.board === i + 1));
    const c = homeColour(match, i + 1);
    return {
      board: i + 1,
      homeColor: c,
      whiteRosterId: (c === 'W' ? a[i] : b[i]) || '',
      blackRosterId: (c === 'W' ? b[i] : a[i]) || '',
      result: '',
      rated: true,
    };
  });
}
export function assessMatch(t, match) {
  const n = Math.max(1, Number(t.boardsPerMatch) || 4),
    errors = [],
    seen = new Set(),
    numbers = new Set();
  const rosters = [teamRoster(t, match.whiteId), teamRoster(t, match.blackId)];
  const memberTeam = new Map(
    rosters.flatMap((ms, i) => ms.map((m) => [m.rosterId, i])),
  );
  const orders = [[], []];
  let completed = 0,
    w = 0,
    b = 0;
  for (const board of match.teamBoards ?? []) {
    const no = Number(board.board);
    if (!Number.isInteger(no) || no < 1 || no > n || numbers.has(no))
      errors.push(`Invalid or duplicate board number ${board.board}.`);
    numbers.add(no);
    const colour =
      board.homeColor ||
      (memberTeam.has(board.whiteRosterId)
        ? memberTeam.get(board.whiteRosterId) === 0
          ? 'W'
          : 'B'
        : homeColour(match, no));
    const ids = [board.whiteRosterId, board.blackRosterId],
      sides = colour === 'W' ? [0, 1] : [1, 0];
    ids.forEach((id, i) => {
      if (!id) return;
      if (seen.has(id))
        errors.push(
          `Player ${t.rosterPlayers?.find((p) => p.id === id)?.name || id} appears more than once.`,
        );
      seen.add(id);
      if (memberTeam.get(id) !== sides[i])
        errors.push(`Board ${no}: player is not on the assigned team.`);
      const member = rosters[sides[i]].find((m) => m.rosterId === id);
      if (member)
        orders[sides[i]].push({
          playing: no,
          registered: Number(member.board),
        });
    });
    const spec = RESULTS[board.result];
    if (board.result && (!spec || (t.fideMode && spec.unusual)))
      errors.push(`Board ${no}: invalid result.`);
    if (spec && !spec.adjourned) {
      if (!ids[0] && (!spec.forfeit || spec.w !== 'loss'))
        errors.push(`Board ${no}: vacant White must have a forfeit loss.`);
      if (!ids[1] && (!spec.forfeit || spec.b !== 'loss'))
        errors.push(`Board ${no}: vacant Black must have a forfeit loss.`);
      const points = (out) =>
        Number(t.scoring?.[out] ?? { win: 1, draw: 0.5, loss: 0 }[out]);
      if (colour === 'W') {
        w += points(spec.w);
        b += points(spec.b);
      } else {
        w += points(spec.b);
        b += points(spec.w);
      }
      completed++;
    }
  }
  if (t.teamBoardOrderCheck !== false)
    for (const order of orders) {
      order.sort((a, b) => a.playing - b.playing);
      if (order.some((x, i) => i && x.registered <= order[i - 1].registered))
        errors.push('Lineup violates registered board order.');
    }
  const allForfeits =
    (match.teamBoards ?? []).length === n &&
    match.teamBoards.every((b) => RESULTS[b.result]?.forfeit);
  const complete = errors.length === 0 && numbers.size === n && completed === n;
  return {
    complete,
    completed,
    required: n,
    errors,
    score: { w, b },
    result: complete
      ? allForfeits && w === 0 && b === 0
        ? '0F-0F'
        : w > b
          ? allForfeits
            ? '1F-0F'
            : '1-0'
          : w < b
            ? allForfeits
              ? '0F-1F'
              : '0-1'
            : '1/2-1/2'
      : '',
  };
}
export function saveMatchBoards(
  t,
  match,
  boards,
  { reason = '', round = 0 } = {},
) {
  const roundData = t.roundsData?.[round - 1];
  const assigned = new Set(
    boards.flatMap((b) => [b.whiteRosterId, b.blackRosterId]).filter(Boolean),
  );
  for (const other of roundData?.pairings || []) {
    if (
      other === match ||
      (other.board === match.board &&
        other.whiteId === match.whiteId &&
        other.blackId === match.blackId)
    )
      continue;
    if (
      other.teamBoards?.some(
        (b) => assigned.has(b.whiteRosterId) || assigned.has(b.blackRosterId),
      )
    )
      throw new Error(
        'A selected player is already assigned to another match in this round.',
      );
  }
  const candidate = { ...match, teamBoards: copy(boards) };
  const status = assessMatch(t, candidate);
  if (status.errors.length) throw new Error(status.errors.join('\n'));
  if (
    match.result &&
    JSON.stringify(match.teamBoards) !== JSON.stringify(boards)
  ) {
    if (!reason.trim())
      throw new Error('Enter a reason for correcting a completed match.');
    (match.corrections ??= []).push({
      at: new Date().toISOString(),
      round,
      reason: reason.trim(),
      before: copy(match.teamBoards ?? []),
      previousScore: copy(match.matchScore ?? null),
    });
  }
  Object.assign(match, {
    teamBoards: copy(boards),
    matchScore: status.score,
    result: status.result,
    boardStatus: status.complete ? 'complete' : 'draft',
    boardDataVersion: 1,
  });
  return status;
}
export function teamMatchResult(t, m) {
  // Legacy aggregates remain readable; new or explicitly reconciled records are board-authoritative.
  return m.boardDataVersion === 1 ? assessMatch(t, m).result : m.result;
}
export function latestCompletedTeamRound(t) {
  let r = 0;
  for (const rd of t.roundsData ?? []) {
    if ((rd.pairings ?? []).some((m) => !teamMatchResult(t, m))) break;
    r++;
  }
  return r;
}
