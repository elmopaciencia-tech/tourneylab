// Rating-source resolution for setup and pairing-number administration (MIT).

export function ratingValue(player, policy = {}) {
  const ratings = player?.ratings ?? {};
  const candidates = [
    policy.primary,
    policy.fallback,
    'rating'
  ].filter(Boolean);

  for (const key of candidates) {
    const value = key === 'rating' ? player?.rating : ratings[key];
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }

  const unrated = Number(policy.unratedValue ?? 0);
  return Number.isFinite(unrated) ? unrated : 0;
}

export function applyRatingPolicy(section) {
  const policy = section?.ratingPolicy ?? {};
  for (const player of section?.players ?? []) {
    player.rating = ratingValue(player, policy);
  }
  return section;
}

export function ratingPolicyLabel(policy = {}) {
  const source = policy.primary || 'rating';
  return {
    rating: 'Resolved rating',
    fideStandard: 'FIDE standard',
    fideRapid: 'FIDE rapid',
    fideBlitz: 'FIDE blitz',
    national: 'National rating',
    local: 'Local/club rating'
  }[source] ?? source;
}
