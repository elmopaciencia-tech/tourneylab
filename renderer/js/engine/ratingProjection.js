// TourneyLab rating projection (MIT).
//
// Display-only FIDE-style rating projection. This module is deliberately pure:
// it reads tournament-start ratings and completed rated games, then returns
// provisional values without mutating players or feeding anything into pairing.

import { RESULTS } from './state.js';

export const FIDE_EXPECTED_SCORE_TABLE = [
  { min: 0, max: 3, higher: 0.50 },
  { min: 4, max: 10, higher: 0.51 },
  { min: 11, max: 17, higher: 0.52 },
  { min: 18, max: 25, higher: 0.53 },
  { min: 26, max: 32, higher: 0.54 },
  { min: 33, max: 39, higher: 0.55 },
  { min: 40, max: 46, higher: 0.56 },
  { min: 47, max: 53, higher: 0.57 },
  { min: 54, max: 61, higher: 0.58 },
  { min: 62, max: 68, higher: 0.59 },
  { min: 69, max: 76, higher: 0.60 },
  { min: 77, max: 83, higher: 0.61 },
  { min: 84, max: 91, higher: 0.62 },
  { min: 92, max: 98, higher: 0.63 },
  { min: 99, max: 106, higher: 0.64 },
  { min: 107, max: 113, higher: 0.65 },
  { min: 114, max: 121, higher: 0.66 },
  { min: 122, max: 129, higher: 0.67 },
  { min: 130, max: 137, higher: 0.68 },
  { min: 138, max: 145, higher: 0.69 },
  { min: 146, max: 153, higher: 0.70 },
  { min: 154, max: 162, higher: 0.71 },
  { min: 163, max: 170, higher: 0.72 },
  { min: 171, max: 179, higher: 0.73 },
  { min: 180, max: 188, higher: 0.74 },
  { min: 189, max: 197, higher: 0.75 },
  { min: 198, max: 206, higher: 0.76 },
  { min: 207, max: 215, higher: 0.77 },
  { min: 216, max: 225, higher: 0.78 },
  { min: 226, max: 235, higher: 0.79 },
  { min: 236, max: 245, higher: 0.80 },
  { min: 246, max: 256, higher: 0.81 },
  { min: 257, max: 267, higher: 0.82 },
  { min: 268, max: 278, higher: 0.83 },
  { min: 279, max: 290, higher: 0.84 },
  { min: 291, max: 302, higher: 0.85 },
  { min: 303, max: 315, higher: 0.86 },
  { min: 316, max: 328, higher: 0.87 },
  { min: 329, max: 344, higher: 0.88 },
  { min: 345, max: 357, higher: 0.89 },
  { min: 358, max: 374, higher: 0.90 },
  { min: 375, max: 391, higher: 0.91 },
  { min: 392, max: 411, higher: 0.92 },
  { min: 412, max: 432, higher: 0.93 },
  { min: 433, max: 456, higher: 0.94 },
  { min: 457, max: 484, higher: 0.95 },
  { min: 485, max: 517, higher: 0.96 },
  { min: 518, max: 559, higher: 0.97 },
  { min: 560, max: 619, higher: 0.98 },
  { min: 620, max: 735, higher: 0.99 },
  { min: 736, max: Number.POSITIVE_INFINITY, higher: 1.00 }
];

function clean(value, places = 2) {
  const factor = 10 ** places;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function positiveRating(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function projectionBaseRating(player) {
  return positiveRating(player?.publishedRating)
    ?? positiveRating(player?.pairingRating)
    ?? positiveRating(player?.rating)
    ?? null;
}

function ratingStatus(player) {
  if (player?.ratingStatus === 'unrated') return 'unrated';
  if (player?.ratingStatus === 'rated') return projectionBaseRating(player) == null ? 'insufficient-data' : 'rated';
  return projectionBaseRating(player) == null ? 'unrated' : 'rated';
}

function tournamentYear(t) {
  const raw = t?.startDate || t?.endDate || '';
  const year = Number.parseInt(String(raw).slice(0, 4), 10);
  return Number.isFinite(year) && year > 0 ? year : new Date().getFullYear();
}

export function effectiveRatingDifferenceForPlayer(playerRating, opponentRating) {
  const raw = playerRating - opponentRating;
  const abs = Math.abs(raw);
  const effectiveAbs = playerRating < 2650 ? Math.min(abs, 400) : abs;
  return raw >= 0 ? effectiveAbs : -effectiveAbs;
}

export function expectedScoreFide(playerRating, opponentRating) {
  const diff = effectiveRatingDifferenceForPlayer(playerRating, opponentRating);
  const absDiff = Math.abs(diff);
  const row = FIDE_EXPECTED_SCORE_TABLE.find(r => absDiff >= r.min && absDiff <= r.max);
  if (!row) throw new Error(`No FIDE expected-score row for rating diff ${absDiff}`);
  return diff >= 0 ? row.higher : clean(1 - row.higher);
}

export function roundFideRatingChange(value) {
  if (value > 0) return Math.floor(value + 0.5);
  if (value < 0) return Math.ceil(value - 0.5);
  return 0;
}

export function resolveBaseKFactor(player, year) {
  if (Number.isFinite(+player?.fideKFactor) && +player.fideKFactor > 0) return +player.fideKFactor;

  const rating = projectionBaseRating(player);
  const birthYear = Number.parseInt(player?.birthYear ?? player?.byear ?? '', 10);
  if (birthYear && year <= birthYear + 18 && rating != null && rating < 2300) return 40;
  if (player?.hasReached2400) return 10;
  if (rating != null && rating >= 2400) return 10;
  return 20;
}

export function applyFideKCap(baseK, ratedGamesInRatingPeriod) {
  if (ratedGamesInRatingPeriod <= 0 || baseK * ratedGamesInRatingPeriod <= 700) return baseK;
  return Math.floor(700 / ratedGamesInRatingPeriod);
}

export function resolveProjectionKFactor(t, player, year, ratedGamesInRatingPeriod) {
  const mode = String(t?.ratingProjection?.kFactorMode ?? 'auto');
  if (mode === '10' || mode === '20' || mode === '40') return Number(mode);
  if (mode === 'custom') {
    const requested = Number(t?.ratingProjection?.customKFactor);
    return Number.isFinite(requested) && requested > 0
      ? Math.min(100, Math.max(1, Math.round(requested)))
      : 20;
  }
  return applyFideKCap(resolveBaseKFactor(player, year), ratedGamesInRatingPeriod);
}

export function actualScoreForPlayer(game, playerId) {
  if (game.result === '1-0') return game.whitePlayerId === playerId ? 1 : 0;
  if (game.result === '0-1') return game.blackPlayerId === playerId ? 1 : 0;
  if (game.result === '1/2-1/2') return 0.5;
  return null;
}

function ratedGamesFromTournament(t, upToRound) {
  const games = [];
  for (let r = 1; r <= upToRound; r++) {
    const rd = t.roundsData?.[r - 1];
    if (!rd) continue;
    for (const pr of rd.pairings ?? []) {
      const spec = RESULTS[pr.result];
      if (!spec?.played || spec.adjourned || pr.rated === false) continue;
      games.push({
        id: `${r}.${pr.board ?? games.length + 1}`,
        round: r,
        whitePlayerId: pr.whiteId,
        blackPlayerId: pr.blackId,
        result: pr.result,
        isRated: true,
        wasPlayedOverTheBoard: true
      });
    }
  }
  return games;
}

export function calculateRatingProjectionAfterRound(t, upToRound = t.currentRound ?? 0, options = {}) {
  const players = t.players ?? [];
  const games = options.games ?? ratedGamesFromTournament(t, upToRound);
  const year = options.tournamentYear ?? tournamentYear(t);
  const extraGamesByPlayer = options.knownExtraRatedGamesInPeriodByPlayerId ?? {};
  const playerById = new Map(players.map(p => [p.id, p]));
  const rawRowsByPlayer = new Map(players.map(p => [p.id, []]));

  for (const game of games) {
    if (game.round > upToRound || !game.isRated || !game.wasPlayedOverTheBoard) continue;
    const white = playerById.get(game.whitePlayerId);
    const black = playerById.get(game.blackPlayerId);
    if (!white || !black) continue;

    const whiteRating = projectionBaseRating(white);
    const blackRating = projectionBaseRating(black);
    if (ratingStatus(white) !== 'rated' || ratingStatus(black) !== 'rated' || whiteRating == null || blackRating == null) continue;

    addRawProjectionRow(rawRowsByPlayer, game, white, black, whiteRating, blackRating);
    addRawProjectionRow(rawRowsByPlayer, game, black, white, blackRating, whiteRating);
  }

  const projections = new Map();
  for (const player of players) {
    const baseRating = projectionBaseRating(player);
    const status = ratingStatus(player);
    if (status !== 'rated' || baseRating == null) {
      projections.set(player.id, {
        playerId: player.id,
        baseRating,
        projectedChangeRaw: null,
        projectedChangeRounded: null,
        projectedRatingRaw: null,
        projectedRatingRounded: null,
        kFactor: null,
        rows: [],
        status
      });
      continue;
    }

    const rawRows = rawRowsByPlayer.get(player.id) ?? [];
    const ratedGamesInRatingPeriod = rawRows.length + (extraGamesByPlayer[player.id] ?? 0);
    const kFactor = resolveProjectionKFactor(t, player, year, ratedGamesInRatingPeriod);
    const rows = rawRows.map(row => ({
      ...row,
      kFactor,
      ratingChangeForGame: clean(kFactor * row.deltaBeforeK)
    }));
    const projectedChangeRaw = clean(rows.reduce((sum, row) => sum + row.ratingChangeForGame, 0));
    const projectedChangeRounded = roundFideRatingChange(projectedChangeRaw);

    projections.set(player.id, {
      playerId: player.id,
      baseRating,
      projectedChangeRaw,
      projectedChangeRounded,
      projectedRatingRaw: clean(baseRating + projectedChangeRaw),
      projectedRatingRounded: baseRating + projectedChangeRounded,
      kFactor,
      rows,
      status: 'rated'
    });
  }
  return projections;
}

function addRawProjectionRow(rowsByPlayer, game, player, opponent, playerRating, opponentRating) {
  const actualScore = actualScoreForPlayer(game, player.id);
  if (actualScore == null) return;

  const expectedScore = expectedScoreFide(playerRating, opponentRating);
  const deltaBeforeK = clean(actualScore - expectedScore);
  rowsByPlayer.get(player.id)?.push({
    playerId: player.id,
    round: game.round,
    opponentId: opponent.id,
    playerRating,
    opponentRating,
    expectedScore,
    actualScore,
    deltaBeforeK
  });
}
