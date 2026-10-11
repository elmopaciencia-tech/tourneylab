// Setup menu option catalogs and tournament presets (MIT).

export const EVENT_TYPES = [
  { id: 'swiss', label: 'Individual Swiss' },
  { id: 'team-swiss', label: 'Team Swiss' },
  { id: 'roundrobin', label: 'Round robin' },
  { id: 'team-rr', label: 'Team round robin' },
  { id: 'ko', label: 'Knockout (KO)' }
];

export const RATING_TYPES = [
  { id: 'standard', label: 'Standard' },
  { id: 'rapid', label: 'Rapid' },
  { id: 'blitz', label: 'Blitz' },
  { id: 'national', label: 'National / local' },
  { id: 'unrated', label: 'Unrated' }
];

export const RATING_SOURCES = [
  { id: 'rating', label: 'Resolved rating' },
  { id: 'fideStandard', label: 'FIDE standard' },
  { id: 'fideRapid', label: 'FIDE rapid' },
  { id: 'fideBlitz', label: 'FIDE blitz' },
  { id: 'national', label: 'National rating' },
  { id: 'local', label: 'Local/club rating' }
];

export const TIEBREAK_PRESETS = [
  { id: 'fide-swiss', label: 'FIDE Swiss default', codes: ['BH', 'BHC1', 'SB', 'WINS'] },
  { id: 'swiss-manager', label: 'Swiss-Manager style', codes: ['BH', 'BHC1', 'SB', 'WINS', 'BLK'] },
  { id: 'team-swiss', label: 'Team Swiss', codes: ['MP', 'GP', 'EMMSB', 'EGGSB'] },
  { id: 'round-robin', label: 'Round robin', codes: ['SB', 'WINS', 'BLK'] },
  { id: 'uscf-style', label: 'SwissSys / USCF-style', codes: ['MMED', 'SOLK', 'CUM', 'WINS'] }
];

export function presetForType(type) {
  if (type === 'team-swiss' || type === 'team-rr') return TIEBREAK_PRESETS.find(p => p.id === 'team-swiss');
  if (type === 'roundrobin' || type === 'team-rr') return TIEBREAK_PRESETS.find(p => p.id === 'round-robin');
  return TIEBREAK_PRESETS.find(p => p.id === 'fide-swiss');
}
