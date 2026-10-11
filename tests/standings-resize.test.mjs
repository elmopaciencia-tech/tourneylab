import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const viewsSource = fs.readFileSync(new URL('../renderer/js/views.js', import.meta.url), 'utf8');
const stylesSource = fs.readFileSync(new URL('../renderer/styles.css', import.meta.url), 'utf8');

test('standings table has resizable headers and rating/pRating mode support', () => {
  const columnBlock = viewsSource.match(/function standingsColumns\(t\) \{([\s\S]*?)\n\}/);

  assert.ok(columnBlock, 'standings columns should be declared by standingsColumns');
  for (const key of ['rank', 'number', 'name', 'fed', 'rating', 'points']) {
    assert.match(columnBlock[1], new RegExp(`key:\\s*'${key}'`));
  }
  assert.match(columnBlock[1], /key:\s*`tb-\$\{c\}`/);
  assert.match(columnBlock[1], /width:\s*70/);
  assert.match(columnBlock[1], /min:\s*52/);

  assert.match(viewsSource, /STANDINGS_WIDTHS_KEY/);
  assert.match(viewsSource, /STANDINGS_RATING_MODE_KEY/);
  assert.match(viewsSource, /function standingsHeaderCell/);
  assert.match(viewsSource, /columns\.map\(col => standingsHeaderCell\(col, ratingMode\)\)/);
  assert.match(viewsSource, /onpointerdown:\s*e => resizeStandingsColumn\(e, col\)/);
  assert.match(viewsSource, /function toggleStandingsRatingMode/);
  assert.match(viewsSource, /calculateRatingProjectionAfterRound\(t, upto\)/);
  assert.match(viewsSource, /h\('table', \{ class: 'db standings-table'/);
  assert.match(viewsSource, /const ratingMode = standingsRatingMode\(\);[\s\S]*standingsHTML\(t, upto, \{ ratingMode(?:, event)? \}\)/);
  assert.match(viewsSource, /standingsCSV\(t, upto, \{ ratingMode \}\)/);
  assert.match(viewsSource, /tournamentReportHTML\(t, \{[\s\S]*ratingMode/);
});

test('standings resizing has scoped table and grip styles', () => {
  assert.match(stylesSource, /\.db\.standings-table/);
  assert.match(stylesSource, /table-layout:\s*fixed/);
  assert.match(stylesSource, /\.standings-table\s+th\.resizable/);
  assert.match(stylesSource, /\.standings-table\s+\.rating-switch/);
});
