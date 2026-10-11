// FIDE C.04.6 colour allocation (1 February 2026). The Dutch engine still
// chooses which teams meet. This pass only decides who has White on board 1.
import { computeStates } from './state.js';

function initialColour(t) {
  return t.initialColor === 'black' ? 'B' : 'W';
}

function opposite(colour) {
  return colour === 'W' ? 'B' : 'W';
}

function teamRecord(state) {
  const colours = state?.colors ?? [];
  const white = colours.filter(colour => colour === 'W').length;
  return {
    colours,
    diff: white - (colours.length - white),
    last: colours[colours.length - 1] ?? null,
    lastTwo: colours.length >= 2 ? colours.slice(-2) : null
  };
}

function preference(record, kind, round, rounds) {
  if (kind === 'none' || !record.colours.length) return null;
  const { diff, last, lastTwo } = record;
  const twoBlack = lastTwo && lastTwo[0] === 'B' && lastTwo[1] === 'B';
  const twoWhite = lastTwo && lastTwo[0] === 'W' && lastTwo[1] === 'W';
  if (diff < -1 || ((diff === 0 || diff === -1) && twoBlack)) {
    return { colour: 'W', strong: true };
  }
  if (diff > 1 || ((diff === 0 || diff === 1) && twoWhite)) {
    return { colour: 'B', strong: true };
  }
  if (kind !== 'B') return null;
  const lastRound = round === (rounds || round);
  if (diff === -1 || (diff === 0 && !lastRound && last === 'B')) return { colour: 'W', strong: false };
  if (diff === 1 || (diff === 0 && !lastRound && last === 'W')) return { colour: 'B', strong: false };
  return null;
}

function firstTeamIsA(a, b, states) {
  const sa = states.get(a.id), sb = states.get(b.id);
  if (sa.score !== sb.score) return sa.score > sb.score;
  const ga = sa.gamePoints ?? 0, gb = sb.gamePoints ?? 0;
  if (ga !== gb) return ga > gb;
  return a.no < b.no;
}

function differentRound(a, b) {
  const limit = Math.min(a.length, b.length);
  for (let i = 1; i <= limit; i++) {
    const left = a[a.length - i], right = b[b.length - i];
    if (left !== right) return left;
  }
  return null;
}

// Returns the colour the first team receives, or null when a later rule applies.
function colourForFirst(first, other, firstRec, otherRec, prefA, prefB, kind, initial) {
  if (!firstRec.colours.length && !otherRec.colours.length) {
    return first.no % 2 === 1 ? initial : opposite(initial);
  }
  if (prefA && !prefB) return prefA.colour;
  if (prefB && !prefA) return opposite(prefB.colour);
  if (prefA && prefB && prefA.colour !== prefB.colour) return prefA.colour;
  if (kind === 'B' && prefA?.strong && !prefB?.strong) return prefA.colour;
  if (kind === 'B' && prefB?.strong && !prefA?.strong) return opposite(prefB.colour);
  if (firstRec.diff !== otherRec.diff) return firstRec.diff < otherRec.diff ? 'W' : 'B';
  const previous = differentRound(firstRec.colours, otherRec.colours);
  if (previous) return opposite(previous);
  if (prefA) return prefA.colour;
  if (firstRec.last) return opposite(firstRec.last);
  if (otherRec.last) return otherRec.last;
  return initial;
}

export function allocateTeamColours(t, round, pairings) {
  const states = computeStates(t, round - 1);
  const kind = t.teamColourPreference === 'B' || t.teamColourPreference === 'none'
    ? t.teamColourPreference
    : 'A';
  const rounds = t.finalRound || t.rounds;
  const initial = initialColour(t);
  const players = new Map(t.players.map(player => [player.id, player]));
  const log = [];
  const coloured = pairings.map(pairing => {
    const a = players.get(pairing.whiteId);
    const b = players.get(pairing.blackId);
    if (!a || !b) return pairing;
    const firstIsA = firstTeamIsA(a, b, states);
    const first = firstIsA ? a : b;
    const other = firstIsA ? b : a;
    const firstRec = teamRecord(states.get(first.id));
    const otherRec = teamRecord(states.get(other.id));
    const prefA = preference(firstRec, kind, round, rounds);
    const prefB = preference(otherRec, kind, round, rounds);
    const colour = colourForFirst(first, other, firstRec, otherRec, prefA, prefB, kind, initial);
    const white = colour === 'W' ? first : other;
    const black = white === first ? other : first;
    if (white.id !== pairing.whiteId) {
      log.push(`C.04.6: ${white.name} has White on board 1 against ${black.name}.`);
    }
    return { ...pairing, whiteId: white.id, blackId: black.id };
  });
  return { pairings: coloured, log };
}
