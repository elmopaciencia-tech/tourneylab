import { h, modal, toast, render } from './app.js';
import { store } from './store.js';
import { createId } from './setup/defaults.js';
import { previewTeamCSV, TEAM_CSV_HEADERS } from './engine/team-csv.js';
export async function importTeamCSV(t) {
  try {
    const file = await window.tl?.openCsv();
    if (!file) return;
    const data = previewTeamCSV(file.text ?? file.content ?? file),
      event = store.activeEvent;
    const body = h(
      'div',
      {},
      h(
        'p',
        {},
        `${data.teams} teams · ${data.rows.length} players. Existing identities match by FIDE ID or national ID; exact names without identifiers require manual assignment to prevent duplicate registrations.`,
      ),
      h('p', { class: 'muted' }, `Columns: ${TEAM_CSV_HEADERS.join(', ')}`),
    );
    const message = h(
      'p',
      { class: 'callout err', role: 'alert' },
      data.errors.join('\n'),
    );
    body.append(
      message,
      h(
        'div',
        { class: 'table-scroll' },
        h(
          'table',
          { class: 'db' },
          h(
            'tr',
            {},
            [
              'Team',
              'No',
              'Group',
              'Captain',
              'Order',
              'Reserve',
              'Player',
              'Rating',
              'FIDE ID',
            ].map((x) => h('th', {}, x)),
          ),
          ...data.rows.map((r) =>
            h(
              'tr',
              {},
              [
                r.team,
                r.teamNo,
                r.group,
                r.captain,
                r.board,
                r.reserve ? 'Yes' : '',
                r.player.name,
                r.player.rating,
                r.player.fideId,
              ].map((x) => h('td', {}, String(x ?? ''))),
            ),
          ),
        ),
      ),
    );
    modal(
      'Preview team roster import',
      body,
      [
        { label: 'Cancel' },
        {
          label: 'Import rosters',
          kind: 'primary',
          onClick: () => {
            if (data.errors.length) return false;
            const snapshot = JSON.stringify({ event, section: t });
            try {
              const assigned = new Set(
                (t.teams || [])
                  .flatMap((tm) => tm.members || [])
                  .map((m) => m.rosterId ?? m.playerId),
              );
              for (const r of data.rows) {
                let teamPlayer = t.players.find(
                  (p) => p.name.trim().toLowerCase() === r.team.toLowerCase(),
                );
                if (!teamPlayer) {
                  if (r.teamNo && t.players.some((p) => p.no === r.teamNo))
                    throw new Error(
                      `Team number ${r.teamNo} already belongs to another team.`,
                    );
                  teamPlayer = store.playerDefaults(t, {
                    id: createId('P'),
                    no:
                      r.teamNo ||
                      Math.max(0, ...t.players.map((p) => p.no)) + 1,
                    name: r.team,
                  });
                  t.players.push(teamPlayer);
                }
                let team = (t.teams ??= []).find(
                  (tm) => tm.playerId === teamPlayer.id,
                );
                if (!team) {
                  team = {
                    id: createId('TM'),
                    playerId: teamPlayer.id,
                    members: [],
                  };
                  t.teams.push(team);
                }
                const exact = event.registrations.find(
                  (p) =>
                    (r.player.fideId && p.fideId === r.player.fideId) ||
                    (r.player.ids.national &&
                      p.ids?.national === r.player.ids.national),
                );
                if (
                  !exact &&
                  event.registrations.some(
                    (p) => p.name.toLowerCase() === r.player.name.toLowerCase(),
                  )
                )
                  throw new Error(
                    `${r.player.name} is already registered. Add an identifier to the CSV or assign this player in the roster editor.`,
                  );
                const registration =
                  exact ||
                  store.registerPlayer(event.id, r.player, { emit: false });
                let player = t.rosterPlayers?.find(
                  (p) => p.registrationId === registration.id,
                );
                if (!player)
                  player = store.assignRegistration(
                    t.id,
                    registration.id,
                    {},
                    { emit: false },
                  );
                const member = team.members.find(
                  (m) => (m.rosterId ?? m.playerId) === player.id,
                );
                if (!member && assigned.has(player.id))
                  throw new Error(`${player.name} belongs to another team.`);
                if (
                  team.members.some((m) => m !== member && +m.board === r.board)
                )
                  throw new Error(
                    `${r.team} already has registered board ${r.board}.`,
                  );
                if (member)
                  Object.assign(member, { board: r.board, reserve: r.reserve });
                else
                  team.members.push({
                    rosterId: player.id,
                    board: r.board,
                    reserve: r.reserve,
                  });
                assigned.add(player.id);
                Object.assign(teamPlayer, {
                  captain: r.captain,
                  group: r.group,
                  club: r.teamClub,
                  fed: r.teamFed,
                });
                Object.assign(team, {
                  name: teamPlayer.name,
                  captain: r.captain,
                });
              }
              store.emit();
              render();
              toast(`Imported ${data.rows.length} roster members.`);
            } catch (e) {
              const old = JSON.parse(snapshot);
              for (const k of Object.keys(t)) delete t[k];
              Object.assign(t, old.section);
              for (const k of Object.keys(event)) delete event[k];
              Object.assign(event, old.event);
              message.textContent = e.message;
              return false;
            }
          },
        },
      ],
      { wide: true },
    );
  } catch (e) {
    toast(e.message);
  }
}
