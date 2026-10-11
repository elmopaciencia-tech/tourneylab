import { h, modal, render, toast } from './app.js';
import { store } from './store.js';
import { normalizeTeamPolicy } from './engine/team.js';
import { TIEBREAKS } from './engine/tiebreaks.js';
import { TEAM_TIEBREAKS } from './engine/team-ranking.js';
import { teamReportTables } from './team-report-tables.js';
const field = (name, node, help = '') => {
  if (!node.hasAttribute('aria-label')) node.setAttribute('aria-label', name);
  return h(
    'label',
    { class: 'team-field' },
    h('span', {}, name),
    node,
    help ? h('small', { class: 'muted' }, help) : null,
  );
};
const choose = (value, options) =>
  h(
    'select',
    {},
    options.map(([key, label]) =>
      h(
        'option',
        { value: key, selected: String(value) === String(key) },
        label,
      ),
    ),
  );
const num = (value) =>
  h('input', { type: 'number', min: 0, value: value ?? 0 });
const commit = () => {
  store.emit();
  render();
};
export function teamPolicyEditor(t) {
  const policy = normalizeTeamPolicy(t.teamPolicy),
    body = h('div', {}),
    fields = {};
  const add = (key, label, node, help) => {
    fields[key] = node;
    return field(label, node, help);
  };
  const configs = structuredClone(
      t.tiebreakConfig?.length
        ? t.tiebreakConfig
        : (t.tiebreaks || []).map((code) => ({ code })),
    ),
    rules = h('div', {});
  const draw = () => {
    rules.replaceChildren();
    configs.forEach((c, i) => {
      const code = choose(c.code, Object.entries({...TIEBREAKS, ...TEAM_TIEBREAKS})),
        basis = choose(
          c.scoreBasis || (c.code.startsWith('EG') ? 'game' : 'match'),
          [
            ['match', 'Opponent match points'],
            ['game', 'Opponent game points'],
          ],
        ),
        mult = choose(
          c.multiplierBasis ||
            (['EMGSB', 'EGGSB'].includes(c.code) ? 'game' : 'match'),
          [
            ['match', 'Earned match points'],
            ['game', 'Earned game points'],
          ],
        ),
        unplayed = choose(c.unplayed || 'fide2026', [
          ['fide2026', 'FIDE March 2026'],
          ['actual', 'Actual scores'],
          ['zero', 'Zero for unplayed'],
        ]),
        low = num(c.cutsLow),
        high = num(c.cutsHigh);
      for (const [el, k] of [
        [code, 'code'],
        [basis, 'scoreBasis'],
        [mult, 'multiplierBasis'],
        [unplayed, 'unplayed'],
        [low, 'cutsLow'],
        [high, 'cutsHigh'],
      ])
        el.addEventListener(
          'change',
          () => (c[k] = el.type === 'number' ? Number(el.value) : el.value),
        );
      rules.append(
        h(
          'fieldset',
          {},
          h('legend', {}, `Tie-break ${i + 1}`),
          h(
            'div',
            { class: 'setup-grid' },
            field('Calculation', code),
            field('Score basis', basis),
            field('SB multiplier', mult),
            field('Unplayed games', unplayed),
            field('Cut lowest', low),
            field('Cut highest', high),
          ),
          h(
            'button',
            {
              class: 'btn ghost',
              onclick: () => {
                configs.splice(i, 1);
                draw();
              },
            },
            'Remove',
          ),
        ),
      );
    });
  };
  draw();
  const err = h('p', { role: 'alert', hidden: true, class: 'callout err' });
  body.append(
    h(
      'p',
      {},
      'Match points rank teams first. Rules below break ties in the displayed order. Changing policy recalculates reports and retains all pairings.',
    ),
    h(
      'div',
      { class: 'setup-grid' },
      add(
        'rankingVersion',
        'Ranking rules',
        choose(policy.rankingVersion, [
          ['legacy', 'Legacy tournament calculations'],
          ['team-v1', 'Parameterized team rules (March 2026)'],
        ]),
      ),
      add(
        'ratingBasis',
        'Team average from',
        choose(policy.ratingBasis, [
          ['starters', 'Registered starters'],
          ['topRated', 'Top-rated roster members'],
          ['lineup', 'Reporting-round lineup'],
        ]),
      ),
      add(
        'ratingSource',
        'Rating source',
        choose(policy.ratingSource, [
          ['rating', 'Section rating'],
          ['fideStandard', 'FIDE standard'],
          ['fideRapid', 'FIDE rapid'],
          ['fideBlitz', 'FIDE blitz'],
          ['national', 'National'],
          ['local', 'Local'],
        ]),
      ),
      add(
        'unratedValue',
        'Unrated value for team averages',
        num(policy.unratedValue),
        '0 leaves unrated ratings at zero; this never changes player ratings.',
      ),
      add(
        'opponentUnratedValue',
        'Unrated value for opponent averages / performance',
        num(policy.opponentUnratedValue),
        '0 excludes unrated opponents from averages and leaves incomplete performance estimates blank.',
      ),
      add('kFactor', 'Rating estimate K-factor', num(policy.kFactor)),
      add(
        'boardGrouping',
        'Board-award groups',
        choose(policy.boardGrouping, [
          ['registered', 'Registered board'],
          ['played', 'Actual playing board'],
        ]),
      ),
      add(
        'minimumGames',
        'Minimum completed results for awards',
        num(policy.minimumGames),
      ),
      ...[
        ['includeForfeits', 'Count forfeit points in board awards'],
        ['averageIncludeForfeits', 'Include forfeits in opponent average'],
        ['performanceIncludeForfeits', 'Include forfeits in performance'],
        ['directIncludeForfeits', 'Include forfeits in direct encounter'],
      ].map(([key, label]) =>
        add(
          key,
          label,
          h('input', { type: 'checkbox', checked: !!policy[key] }),
        ),
      ),
      add(
        'awardTiebreaks',
        'Board-award tie-break order',
        h('input', { value: policy.awardTiebreaks.join(', ') }),
        'Comma-separated: POINTS, MANUAL, BH, SB, WINS. BH/SB use actual opponent award scores; separate from team rules.',
      ),
    ),
    h(
      'p',
      { class: 'muted' },
      'Performance uses average opponent rating plus the FIDE percentage-score table. Rating changes exclude forfeits and are estimates, not official FIDE updates.',
    ),
    h('h2', { class: 'sec' }, 'Team tie-breaks'),
    rules,
    h(
      'button',
      {
        class: 'btn',
        onclick: () => {
          configs.push({
            code: 'BH',
            scoreBasis: 'game',
            unplayed: 'fide2026',
          });
          draw();
        },
      },
      'Add tie-break',
    ),
    h(
      'button',
      {
        class: 'btn',
        onclick: () => {
          configs.splice(
            0,
            configs.length,
            ...['GP', 'DE', 'BH', 'EMGSB'].map((code) => ({
              code,
              ...(code === 'BH' ? { scoreBasis: 'game' } : {}),
              unplayed: 'fide2026',
            })),
          );
          fields.rankingVersion.value = 'team-v1';
          draw();
        },
      },
      'Use MP / GP / DE / game-BH / EMGSB preset',
    ),
    h(
      'p',
      { class: 'muted' },
      'Sonneborn–Berger variants: EMMSB = opponent MP × earned MP; EMGSB = opponent MP × earned GP; EGMSB = opponent GP × earned MP; EGGSB = opponent GP × earned GP. Cuts remove opponent contributions. Legacy mode retains the previous engine; its rules are not relabeled as these formulas.',
    ),
    err,
  );
  modal(
    'Team calculation policies',
    body,
    [
      { label: 'Cancel' },
      {
        label: 'Save policies',
        kind: 'primary',
        onClick: () => {
          const next = { ...policy };
          for (const [k, el] of Object.entries(fields))
            next[k] =
              el.type === 'checkbox'
                ? el.checked
                : el.type === 'number'
                  ? +el.value
                  : el.value;
          next.awardTiebreaks = next.awardTiebreaks
            .split(',')
            .map((s) => s.trim().toUpperCase())
            .filter(Boolean);
          if (
            !next.awardTiebreaks.length ||
            next.awardTiebreaks.some(
              (c) => !['POINTS', 'MANUAL', 'BH', 'SB', 'WINS'].includes(c),
            ) ||
            Object.values(fields).some(
              (el) =>
                el.type === 'number' &&
                (!Number.isFinite(+el.value) || +el.value < 0),
            ) ||
            configs.some(
              (c) =>
                !(next.rankingVersion === 'legacy' ? TIEBREAKS : TEAM_TIEBREAKS)[c.code] ||
                (next.rankingVersion === 'legacy' && ['EMGSB','EGMSB'].includes(c.code)) ||
                [c.cutsLow ?? 0, c.cutsHigh ?? 0].some(
                  (n) => !Number.isInteger(+n) || +n < 0,
                ),
            ) ||
            new Set(configs.map((c) => c.code)).size !== configs.length
          ) {
            err.hidden = false;
            err.textContent =
              'Use supported, non-repeated tie-breaks and nonnegative whole-number cuts.';
            return false;
          }
          t.teamPolicy = next;
          t.tiebreakConfig = configs;
          t.tiebreaks = configs.map((c) => c.code);
          t.setupSources = {
            ...t.setupSources,
            tiebreaks: 'section',
            tiebreakConfig: 'section',
          };
          commit();
        },
      },
    ],
    { wide: true },
  );
}
function manualAward(t) {
  const report = teamReportTables(t, t.roundsData.length).report;
  const player = choose('', [
      ['', 'Choose player'],
      ...report.players.map((p) => [p.player.id, p.player.name]),
    ]),
    board = num(1),
    value = num(0),
    reason = h('input', { value: '' }),
    err = h('p', { role: 'alert' });
  const load = () => {
    const m = t.boardAwardManual?.[`${board.value}:${player.value}`];
    value.value = m?.value ?? 0;
    reason.value = m?.reason ?? '';
  };
  player.onchange = () => {
    board.value =
      report.players.find((p) => p.player.id === player.value)?.membership
        ?.board || 1;
    load();
  };
  board.onchange = load;
  modal(
    'Manual board-award value',
    h(
      'div',
      { class: 'setup-grid' },
      field('Player', player),
      field('Award board', board),
      field('Value', value),
      field('Reason', reason),
      err,
    ),
    [
      { label: 'Cancel' },
      {
        label: 'Save value',
        kind: 'primary',
        onClick: () => {
          if (
            !player.value ||
            !Number.isInteger(+board.value) ||
            +board.value < 1 ||
            !Number.isFinite(+value.value) ||
            !reason.value.trim()
          ) {
            err.textContent =
              'Choose a player and board, enter a numeric value and reason.';
            return false;
          }
          (t.boardAwardManual ??= {})[`${board.value}:${player.value}`] = {
            value: +value.value,
            reason: reason.value.trim(),
            at: new Date().toISOString(),
          };
          commit();
        },
      },
    ],
  );
}
export function TeamReports(t) {
  const out = h('div', { class: 'page-inner team-reports' }),
    upto = choose(
      t.roundsData.length,
      Array.from({ length: t.roundsData.length + 1 }, (_, i) => [
        i,
        `Through round ${i}`,
      ]),
    ),
    select = choose('', []),
    search = h('input', {
      type: 'search',
      placeholder: 'Search player, team, school or FIDE ID',
      'aria-label': 'Search report',
    }),
    content = h('div', {}),
    status = h('p', { class: 'muted', role: 'status' });
  let tables = [],
    sort = { col: null, asc: true };
  const draw = () => {
    const table = tables.find((x) => x.id === select.value) || tables[0];
    if (!table) return;
    let rows = table.rows.filter((row) =>
      row.join(' ').toLowerCase().includes(search.value.toLowerCase()),
    );
    if (sort.col !== null)
      rows.sort((a, b) => {
        const x = a[sort.col],
          y = b[sort.col];
        return (
          (typeof x === 'number' && typeof y === 'number'
            ? x - y
            : String(x ?? '').localeCompare(String(y ?? ''), undefined, {
                numeric: true,
              })) * (sort.asc ? 1 : -1)
        );
      });
    content.replaceChildren(
      h('h2', { class: 'sec' }, table.title),
      h(
        'div',
        { class: 'table-scroll' },
        h(
          'table',
          { class: 'db' },
          h(
            'thead',
            {},
            h(
              'tr',
              {},
              table.headers.map((label, i) =>
                h(
                  'th',
                  {
                    'aria-sort':
                      sort.col === i
                        ? sort.asc
                          ? 'ascending'
                          : 'descending'
                        : 'none',
                  },
                  h(
                    'button',
                    {
                      class: 'report-sort',
                      onclick: () => {
                        sort = {
                          col: i,
                          asc: sort.col === i ? !sort.asc : true,
                        };
                        draw();
                      },
                    },
                    label,
                  ),
                ),
              ),
            ),
          ),
          h(
            'tbody',
            {},
            rows.map((row) =>
              h(
                'tr',
                {},
                row.map((cell) => h('td', {}, String(cell ?? ''))),
              ),
            ),
          ),
        ),
      ),
    );
  };
  const refresh = () => {
    const old = select.value,
      data = teamReportTables(t, +upto.value);
    tables = data.tables;
    select.replaceChildren(
      ...tables.map((table) =>
        h(
          'option',
          { value: table.id, selected: table.id === old },
          table.title,
        ),
      ),
    );
    status.textContent = `Latest paired round: ${t.roundsData.length} · Latest completed round: ${data.report.completedRound}. Board statistics and player scores reflect the selected cutoff.${data.report.reconciliation.length ? ` ${data.report.reconciliation.length} historical matches need board reconciliation; individual totals may be incomplete.` : ''}`;
    draw();
  };
  search.oninput = draw;
  select.onchange = () => {
    sort = { col: null, asc: true };
    draw();
  };
  upto.onchange = refresh;
  out.append(
    h('h1', { class: 'page-title' }, 'Team reports'),
    h(
      'div',
      { class: 'toolbar' },
      h(
        'button',
        { class: 'btn', onclick: () => teamPolicyEditor(t) },
        'Calculation policies',
      ),
      h(
        'button',
        { class: 'btn', onclick: () => manualAward(t) },
        'Manual award value',
      ),
      h(
        'button',
        { class: 'btn', onclick: () => window.print() },
        'Print / save PDF',
      ),
    ),
    h(
      'div',
      { class: 'toolbar' },
      field('Reporting cutoff', upto),
      field('Report', select),
      search,
    ),
    status,
    content,
  );
  refresh();
  return out;
}
export function officialFields(event) {
  event.officials ??= {};
  return h(
    'div',
    {},
    h('h2', { class: 'sec' }, 'Tournament officials'),
    ...['director', 'chief', 'deputy'].map((role) => {
      const person = event.officials[role] ?? {};
      return h(
        'fieldset',
        {},
        h(
          'legend',
          {},
          {
            director: 'Tournament director',
            chief: 'Chief arbiter',
            deputy: 'Deputy arbiter',
          }[role],
        ),
        h(
          'div',
          { class: 'setup-grid' },
          ...['name', 'title', 'fideId'].map((key) =>
            field(
              { name: 'Name', title: 'Title', fideId: 'FIDE ID' }[key],
              h('input', {
                value: person[key] || '',
                onchange: (e) => {
                  (event.officials[role] ??= {})[key] = e.target.value.trim();
                  store.emit();
                },
              }),
            ),
          ),
        ),
      );
    }),
  );
}
export function attachmentFields(event) {
  const body = h('div', { class: 'team-dialog' }),
    list = h('div', {}),
    error = h('p', { role: 'alert' });
  const draw = () => {
    list.replaceChildren(
      ...(event.attachments || []).map((a, i) =>
        h(
          'div',
          { class: 'toolbar' },
          field(
            'Document label',
            h('input', {
              value: a.label || a.name,
              onchange: (e) => {
                a.label = e.target.value;
                store.emit();
              },
            }),
          ),
          h('span', { class: 'muted' }, a.name),
          h(
            'button',
            {
              class: 'btn ghost',
              onclick: () => {
                event.attachments.splice(i, 1);
                store.emit();
                draw();
              },
            },
            'Remove',
          ),
        ),
      ),
    );
  };
  body.append(
    h('h2', { class: 'sec' }, 'Published documents'),
    h(
      'p',
      { class: 'muted' },
      'Labeled PDFs appear in the report site. Maximum 2 MiB per document, 25 MiB for the full bundle. A QR code is generated when a public tournament URL is available.',
    ),
    list,
    h(
      'button',
      {
        class: 'btn',
        onclick: async () => {
          try {
            const file = await window.tl?.openBinary({ extensions: ['pdf'] });
            if (!file) return;
            const bytes = new Uint8Array(file.bytes);
            if (
              bytes.length > 2 * 1024 * 1024 ||
              new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-'
            )
              throw new Error('Choose a PDF no larger than 2 MiB.');
            let binary = '';
            for (let offset = 0; offset < bytes.length; offset += 8192)
              binary += String.fromCharCode(
                ...bytes.slice(offset, offset + 8192),
              );
            (event.attachments ??= []).push({
              name: file.name,
              label: file.name.replace(/\.pdf$/i, ''),
              contentBase64: btoa(binary),
            });
            store.emit();
            draw();
          } catch (e) {
            error.textContent = e.message;
          }
        },
      },
      'Add PDF document',
    ),
    error,
  );
  draw();
  return body;
}
