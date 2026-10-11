import { importTeamCSV } from './team-csv-ui.js';
// Team operations use the same board records as calculations and published reports.
import { h, modal, toast, render, go } from './app.js';
import { store } from './store.js';
import { RESULTS, resultLabel } from './engine/state.js';
import {
  boardOneColour,
  seedBoards,
  assessMatch,
  saveMatchBoards,
  teamRoster,
  teamRating,
  normalizeTeamPolicy,
} from './engine/team.js';
const field = (label, input, help = '') => {
  if (!input.hasAttribute('aria-label'))
    input.setAttribute('aria-label', label);
  return h(
    'label',
    { class: 'team-field' },
    h('span', {}, label),
    input,
    help ? h('small', { class: 'muted' }, help) : null,
  );
};
const input = (value, type = 'text') =>
  h('input', { type, value: value ?? '' });
const select = (value, choices) =>
  h(
    'select',
    {},
    choices.map(([id, label]) =>
      h('option', { value: id, selected: String(value) === String(id) }, label),
    ),
  );
const commit = () => {
  store.emit();
  render();
};
export function openBoards(t, match) {
  const round = t.roundsData.findIndex((rd) => rd.pairings.includes(match)) + 1;
  let draft = seedBoards(t, match),
    boardOne = boardOneColour(t, match);
  const body = h('div', { class: 'team-dialog' }),
    error = h('p', { class: 'callout err', role: 'alert', hidden: true }),
    rows = h('div', {}),
    reason = input('');
  const name = (id) => t.players.find((p) => p.id === id)?.name || 'Team';
  const draw = () => {
    rows.replaceChildren();
    const status = assessMatch(t, { ...match, teamBoards: draft });
    rows.append(
      h(
        'p',
        { class: 'muted', role: 'status' },
        `${status.completed}/${status.required} board results · ${status.score.w} : ${status.score.b} ${status.complete ? '— complete' : '— provisional'}`,
      ),
    );
    const table = h(
      'table',
      { class: 'db team-board-editor' },
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          h('th', {}, 'Board'),
          h('th', {}, name(match.whiteId)),
          h('th', {}, 'Result (White – Black)'),
          h('th', {}, name(match.blackId)),
          h('th', {}, 'Rated'),
        ),
      ),
    );
    const tbody = h('tbody', {});
    table.append(tbody);
    for (const board of draft) {
      const leftIds = new Set(
        teamRoster(t, match.whiteId).map((m) => m.rosterId),
      );
      const c =
        board.homeColor || (leftIds.has(board.whiteRosterId) ? 'W' : 'B');
      board.homeColor = c;
      const playerSelect = (teamId, key, colour) => {
        const options = teamRoster(t, teamId).filter(
          (m) => !m.player.withdrawn || m.rosterId === board[key],
        );
        const sel = select(board[key], [
          ['', 'Vacant board'],
          ...options.map((m) => [
            m.rosterId,
            `${m.board}${m.reserve ? ' (reserve)' : ''}. ${m.player.name} · ${m.player.rating || 'Unrated'}`,
          ]),
        ]);
        sel.setAttribute(
          'aria-label',
          `Board ${board.board} ${colour === 'W' ? 'White' : 'Black'} player`,
        );
        sel.addEventListener('change', () => {
          board[key] = sel.value;
        });
        return h(
          'div',
          { class: 'team-colour-player' },
          h(
            'span',
            { class: 'pill', title: colour === 'W' ? 'White' : 'Black' },
            colour === 'W' ? '○ White' : '● Black',
          ),
          sel,
        );
      };
      const res = select(board.result, [
        ['', 'Pending'],
        ...Object.keys(RESULTS)
          .filter((k) => k !== 'ADJ' && !(t.fideMode && RESULTS[k].unusual))
          .map((k) => [k, resultLabel(k)]),
      ]);
      res.setAttribute('aria-label', `Board ${board.board} result`);
      res.addEventListener('change', () => {
        board.result = res.value;
        draw();
        rows.querySelector(`[data-board-result="${board.board}"]`)?.focus();
      });
      res.dataset.boardResult = board.board;
      const rated = h('input', {
        type: 'checkbox',
        checked: t.rated !== false && board.rated !== false,
        disabled: t.rated === false,
        'aria-label': `Board ${board.board} rated`,
        onchange: (e) => {
          board.rated = e.target.checked;
        },
      });
      tbody.append(
        h(
          'tr',
          {},
          h('td', {}, `${match.board}.${board.board}`),
          h(
            'td',
            {},
            playerSelect(
              match.whiteId,
              c === 'W' ? 'whiteRosterId' : 'blackRosterId',
              c,
            ),
          ),
          h('td', {}, res),
          h(
            'td',
            {},
            playerSelect(
              match.blackId,
              c === 'W' ? 'blackRosterId' : 'whiteRosterId',
              c === 'W' ? 'B' : 'W',
            ),
          ),
          h('td', {}, rated),
        ),
      );
    }
    rows.append(table);
  };
  const colour = select(boardOne, [
    ['W', 'First team White on board 1'],
    ['B', 'First team Black on board 1'],
  ]);
  colour.addEventListener('change', () => {
    boardOne = colour.value;
    draft = draft.map((b) => {
      const newC = (boardOne === 'W') === (b.board % 2 === 1) ? 'W' : 'B';
      if (newC === b.homeColor) return b;
      const reverse = {
        '1-0': '0-1',
        '0-1': '1-0',
        '1F-0F': '0F-1F',
        '0F-1F': '1F-0F',
        '1/2-0': '0-1/2',
        '0-1/2': '1/2-0',
      };
      return {
        ...b,
        homeColor: newC,
        whiteRosterId: b.blackRosterId,
        blackRosterId: b.whiteRosterId,
        result: reverse[b.result] || b.result,
      };
    });
    draw();
  });
  body.append(
    h(
      'p',
      {},
      `${name(match.whiteId)} versus ${name(match.blackId)} · Round ${round}`,
    ),
    h(
      'div',
      { class: 'toolbar' },
      field('Board-one colour', colour),
      h(
        'button',
        {
          class: 'btn',
          disabled: round < 2,
          onclick: () => {
            draft = seedBoards(
              t,
              { ...match, boardOneColor: boardOne },
              { previous: true, round },
            );
            draw();
          },
        },
        'Use previous lineup',
      ),
    ),
    match.boardDataVersion !== 1 && match.result
      ? h(
          'p',
          { class: 'callout warn' },
          'Historical totals/colours need reconciliation. Check every board before saving.',
        )
      : h('span', { hidden: true }),
    rows,
    field(
      'Correction reason',
      reason,
      'Required when changing a completed match. Later pairings will stay unchanged.',
    ),
    error,
  );
  draw();
  modal(
    'Lineup & board results',
    body,
    [
      { label: 'Cancel' },
      {
        label: 'Save boards',
        kind: 'primary',
        onClick: () => {
          try {
            const candidate = { ...match, boardOneColor: boardOne };
            saveMatchBoards(t, candidate, draft, {
              round,
              reason: reason.value,
            });
            Object.assign(match, candidate);
            commit();
            toast(
              match.result
                ? 'Match completed.'
                : 'Draft saved; complete every board before the next round.',
            );
          } catch (e) {
            error.hidden = false;
            error.textContent = e.message;
            return false;
          }
        },
      },
    ],
    { wide: true },
  );
}
export function teamScoreControl(t, match) {
  const status = assessMatch(t, match),
    legacy = match.boardDataVersion !== 1 && !!match.result;
  return h(
    'div',
    { class: 'team-score-control' },
    h(
      'span',
      {},
      legacy
        ? `${match.matchScore?.w ?? '–'} : ${match.matchScore?.b ?? '–'} (legacy)`
        : `${status.score.w} : ${status.score.b}`,
    ),
    h(
      'button',
      {
        class: 'btn ghost',
        onclick: (e) => {
          e.stopPropagation();
          openBoards(t, match);
        },
      },
      `${status.completed}/${status.required} boards`,
    ),
  );
}
export function openRoster(t, teamPlayer) {
  let team = (t.teams ??= []).find((x) => x.playerId === teamPlayer.id);
  const pending = new Map(),
    withdrawals = new Map();
  const draft = (team?.members ?? []).map((m) => ({
    ...m,
    rosterId: m.rosterId ?? m.playerId,
  }));
  const body = h('div', { class: 'team-dialog' }),
    list = h('div', {}),
    error = h('p', { class: 'callout err', hidden: true, role: 'alert' });
  const startingNo = input(teamPlayer.no, 'number'),
    withdrawn = h('input', {
      type: 'checkbox',
      checked: !!teamPlayer.withdrawn,
    });
  startingNo.min = 1;
  startingNo.disabled = t.roundsData.length > 0;
  const name = input(teamPlayer.name),
    captain = input(teamPlayer.captain || team?.captain),
    group = input(teamPlayer.group),
    club = input(teamPlayer.club),
    fed = input(teamPlayer.fed);
  const assignedOther = new Set(
    (t.teams ?? [])
      .filter((x) => x.playerId !== teamPlayer.id)
      .flatMap((x) => (x.members ?? []).map((m) => m.rosterId ?? m.playerId)),
  );
  const event = store.activeEvent;
  const draw = () => {
    list.replaceChildren();
    for (const [i, m] of draft.entries()) {
      const person =
        t.rosterPlayers?.find((p) => p.id === m.rosterId) ||
        pending.get(m.rosterId);
      const order = input(m.board, 'number');
      order.min = 1;
      order.addEventListener('change', () => (m.board = +order.value));
      const withdrawn = h('input', {
        type: 'checkbox',
        checked: withdrawals.get(m.rosterId) ?? !!person?.withdrawn,
        onchange: (e) => withdrawals.set(m.rosterId, e.target.checked),
      });
      const reserve = h('input', {
        type: 'checkbox',
        checked: m.reserve,
        onchange: (e) => (m.reserve = e.target.checked),
      });
      const used = t.roundsData.some((rd) =>
        rd.pairings.some((pr) =>
          pr.teamBoards?.some((b) =>
            [b.whiteRosterId, b.blackRosterId].includes(m.rosterId),
          ),
        ),
      );
      list.append(
        h(
          'div',
          { class: 'team-roster-row' },
          field('Order', order),
          h(
            'span',
            { class: 'grow' },
            person?.name || 'Missing player',
            h(
              'small',
              { class: 'muted' },
              ` · ${person?.title || ''} ${person?.rating || 'Unrated'} · ${person?.fed || ''} · ${person?.fideId || 'No FIDE ID'}`,
            ),
          ),
          field('Reserve', reserve),
          field('Withdrawn', withdrawn),
          h(
            'button',
            {
              class: 'btn ghost',
              disabled: used,
              title: used
                ? 'Historical membership must be retained'
                : 'Remove from this roster',
              onclick: () => {
                draft.splice(i, 1);
                draw();
              },
            },
            'Remove',
          ),
        ),
      );
    }
  };
  const choices = () => [
    ['', 'Select registered player…'],
    ...(event?.registrations ?? [])
      .filter((r) => !r.archived)
      .filter((r) => {
        const p = t.rosterPlayers?.find((p) => p.registrationId === r.id);
        return (
          !draft.some((m) => pending.get(m.rosterId)?.id === r.id) &&
          (!p ||
            (!assignedOther.has(p.id) &&
              !draft.some((m) => m.rosterId === p.id)))
        );
      })
      .map((r) => [r.id, `${r.name} · ${r.fideId || r.club || ''}`]),
  ];
  let picker = select('', choices());
  const add = h(
    'button',
    {
      class: 'btn',
      onclick: () => {
        if (!picker.value) return;
        const r = event.registrations.find((r) => r.id === picker.value);
        let p = t.rosterPlayers?.find((p) => p.registrationId === r.id);
        try {
          if (!p) {
            const temporaryId = `pending:${r.id}`;
            pending.set(temporaryId, r);
            p = { id: temporaryId };
          }
          draft.push({
            rosterId: p.id,
            board: Math.max(0, ...draft.map((m) => Number(m.board) || 0)) + 1,
            reserve: draft.length >= t.boardsPerMatch,
          });
          picker.replaceChildren(
            ...choices().map(([id, label]) =>
              h('option', { value: id }, label),
            ),
          );
          draw();
        } catch (e) {
          error.hidden = false;
          error.textContent = e.message;
        }
      },
    },
    'Add to roster',
  );
  body.append(
    h(
      'div',
      { class: 'setup-grid' },
      field('Team name', name),
      field('Starting number', startingNo),
      field('Withdrawn team', withdrawn),
      field('Captain', captain),
      field('Group / region', group),
      field('School / club', club),
      field('Federation', fed),
    ),
    h(
      'p',
      { class: 'muted' },
      'Registered order is separate from each round’s playing lineup. Reserves can replace starters without changing past results.',
    ),
    list,
    h('div', { class: 'toolbar' }, picker, add),
    error,
  );
  draw();
  modal(
    'Team details & roster',
    body,
    [
      { label: 'Close' },
      {
        label: 'Save roster',
        kind: 'primary',
        onClick: () => {
          if (
            !name.value.trim() ||
            !Number.isInteger(+startingNo.value) ||
            +startingNo.value < 1 ||
            t.players.some(
              (p) => p !== teamPlayer && p.no === +startingNo.value,
            ) ||
            draft.some((m) => !Number.isInteger(+m.board) || +m.board < 1) ||
            new Set(draft.map((m) => +m.board)).size !== draft.length
          ) {
            error.hidden = false;
            error.textContent =
              'Enter a team name, unique starting number and unique positive roster orders.';
            return false;
          }
          const snapshot = JSON.stringify({
            roster: t.rosterPlayers,
            overrides: t.eligibilityOverrides,
          });
          try {
            const ids = new Map();
            for (const m of draft)
              if (pending.has(m.rosterId))
                ids.set(
                  m.rosterId,
                  store.assignRegistration(
                    t.id,
                    pending.get(m.rosterId).id,
                    {},
                    { emit: false },
                  ).id,
                );
            for (const m of draft)
              if (ids.has(m.rosterId)) m.rosterId = ids.get(m.rosterId);
          } catch (e) {
            const old = JSON.parse(snapshot);
            t.rosterPlayers = old.roster;
            t.eligibilityOverrides = old.overrides;
            error.hidden = false;
            error.textContent = e.message;
            return false;
          }
          for (const [id, withdrawn] of withdrawals) {
            const p = t.rosterPlayers.find((p) => p.id === id);
            if (p) p.withdrawn = withdrawn;
          }
          Object.assign(teamPlayer, {
            no: +startingNo.value,
            withdrawn: withdrawn.checked,
            name: name.value.trim(),
            captain: captain.value.trim(),
            group: group.value.trim(),
            club: club.value.trim(),
            fed: fed.value.trim().toUpperCase(),
          });
          if (!t.players.includes(teamPlayer)) t.players.push(teamPlayer);
          if (!team) {
            team = {
              id: `TM-${teamPlayer.id}`,
              playerId: teamPlayer.id,
              members: [],
            };
            t.teams.push(team);
          }
          Object.assign(team, {
            name: teamPlayer.name,
            captain: teamPlayer.captain,
            members: draft.sort((a, b) => a.board - b.board),
          });
          commit();
        },
      },
    ],
    { wide: true },
  );
}
export function rosterOverview(t) {
  return h(
    'div',
    {},
    h(
      'div',
      { class: 'toolbar' },
      h('h2', { class: 'sec' }, 'Registered rosters'),
      h(
        'button',
        { class: 'btn', onclick: () => importTeamCSV(t) },
        'Import roster CSV…',
      ),
    ),
    ...(t.players ?? []).map((p) => {
      const members = teamRoster(t, p.id),
        rating = teamRating(t, p.id);
      return h(
        'div',
        { class: 'team-roster-summary' },
        h(
          'div',
          { class: 'toolbar' },
          h('b', {}, `${p.no}. ${p.name || 'Unnamed team'}`),
          h(
            'span',
            { class: 'muted' },
            `${members.length} players · average ${rating ?? '—'}${p.group ? ` · ${p.group}` : ''}`,
          ),
          h(
            'button',
            { class: 'btn', onclick: () => openRoster(t, p) },
            'Edit team & roster',
          ),
        ),
        h(
          'p',
          { class: 'muted small' },
          members
            .map((m) => `${m.board}${m.reserve ? 'R' : ''}. ${m.player.name}`)
            .join(' · ') ||
            'No players assigned. Add registered players to this roster.',
        ),
      );
    }),
  );
}

export function TeamsPage(t) {
  const body = h(
    'div',
    { class: 'page-inner' },
    h('h1', { class: 'page-title' }, 'Teams & rosters'),
    h(
      'p',
      { class: 'page-sub' },
      'Register players once, then assign them to a team. Registered order stays separate from each round’s lineup.',
    ),
    h(
      'div',
      { class: 'toolbar' },
      h(
        'button',
        {
          class: 'btn primary',
          onclick: () =>
            openRoster(
              t,
              store.playerDefaults(t, {
                name: '',
                no: Math.max(0, ...t.players.map((p) => p.no)) + 1,
              }),
            ),
        },
        'Add team',
      ),
      h(
        'button',
        { class: 'btn', onclick: () => go('registrations') },
        'Event registrations',
      ),
      h(
        'button',
        { class: 'btn', onclick: () => go('team-reports') },
        'Team reports',
      ),
    ),
    rosterOverview(t),
  );
  return body;
}
