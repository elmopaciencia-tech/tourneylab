// TourneyLab content-only zoom shortcut recognition (MIT).

function contentZoomAction(input = {}, platform = process.platform) {
  if (input.type !== 'keyDown' || input.alt) return null;
  const hasPlatformModifier = platform === 'darwin' ? input.meta : input.control;
  if (!hasPlatformModifier) return null;

  const key = String(input.key ?? '').toLowerCase();
  const code = String(input.code ?? '');
  if (key === '+' || key === '=' || code === 'Equal' || code === 'NumpadAdd') return 'in';
  if (key === '-' || key === '_' || code === 'Minus' || code === 'NumpadSubtract') return 'out';
  if (key === '0' || code === 'Digit0' || code === 'Numpad0') return 'reset';
  return null;
}

module.exports = { contentZoomAction };
