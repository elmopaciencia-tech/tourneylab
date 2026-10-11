export function sectionHasActiveRound(section) {
  const rounds = Array.isArray(section?.roundsData) ? section.roundsData : [];
  if (!rounds.length) return false;

  const roundNumber = Number(section?.currentRound) || null;
  const currentRound = roundNumber == null
    ? rounds.at(-1)
    : rounds.find(round => Number(round?.round) === roundNumber)
      ?? rounds[roundNumber - 1]
      ?? rounds.at(-1);

  return (currentRound?.pairings ?? []).some(pairing => !String(pairing?.result ?? '').trim());
}
