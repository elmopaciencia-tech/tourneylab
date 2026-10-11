export function createTournamentAccordion(initialExpandedId = null) {
  let expandedTournamentId = initialExpandedId;

  return {
    expandedId() {
      return expandedTournamentId;
    },

    isExpanded(tournamentId) {
      return expandedTournamentId === tournamentId;
    },

    select(tournamentId) {
      expandedTournamentId = tournamentId ?? null;
      return expandedTournamentId;
    },

    toggle(tournamentId) {
      expandedTournamentId = expandedTournamentId === tournamentId ? null : tournamentId;
      return expandedTournamentId;
    }
  };
}
