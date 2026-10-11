// TourneyLab main-content zoom levels and state helpers (MIT).

export const CONTENT_ZOOM_LEVELS = Object.freeze([0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]);
export const CONTENT_ZOOM_DEFAULT = 1;

export function normalizeContentZoom(value) {
  if (value == null || value === '') return CONTENT_ZOOM_DEFAULT;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return CONTENT_ZOOM_DEFAULT;
  return CONTENT_ZOOM_LEVELS.reduce((closest, level) =>
    Math.abs(level - numeric) < Math.abs(closest - numeric) ? level : closest
  , CONTENT_ZOOM_DEFAULT);
}

export function contentZoomForAction(current, action) {
  if (action === 'reset') return CONTENT_ZOOM_DEFAULT;
  const normalized = normalizeContentZoom(current);
  const index = CONTENT_ZOOM_LEVELS.indexOf(normalized);
  if (action === 'in') return CONTENT_ZOOM_LEVELS[Math.min(CONTENT_ZOOM_LEVELS.length - 1, index + 1)];
  if (action === 'out') return CONTENT_ZOOM_LEVELS[Math.max(0, index - 1)];
  return normalized;
}
