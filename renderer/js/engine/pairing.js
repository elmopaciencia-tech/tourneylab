// Chooses the pairing function for a section. Dutch stays the FIDE default.
import { pairRound } from './dutch.js';
import { allocateTeamColours } from './c046.js';
import { pairOlympiad } from './olympiad.js';
import { pairDoubleSwiss } from './double-swiss.js';

export function pairSection(t, round, options = {}) {
  const system = t.pairingSystem || 'fide-dutch';
  if (system === 'fide-double-swiss') return pairDoubleSwiss(t, round, options);
  if (system === 'olympiad') return pairOlympiad(t, round, options);
  const res = pairRound(t, round, options);
  if (!res.ok || system !== 'fide-c04.6') return res;
  const coloured = allocateTeamColours(t, round, res.pairings);
  return { ...res, pairings: coloured.pairings, log: [...res.log, ...coloured.log] };
}

export function pairSectionRemainder(t, round, roundData) {
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
  const res = pairSection(t, round, { excludeIds: exclude });
  if (!res.ok) {
    return { ok: false, kept, keptByes, pairings: [], bye: null, log: res.log, warnings: res.warnings };
  }
  return { ok: true, kept, keptByes, pairings: res.pairings, bye: res.bye, log: res.log, warnings: res.warnings };
}
