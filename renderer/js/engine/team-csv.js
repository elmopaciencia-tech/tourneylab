// RFC 4180 quoting, including commas and newlines inside quoted names.
export function csvCells(text) {
  const rows = [];
  let row = [],
    cell = '',
    quoted = false;
  text = String(text).replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && (c === ',' || c === '\n' || c === '\r')) {
      row.push(cell.trim());
      cell = '';
      if (c !== ',') {
        if (row.some(Boolean)) rows.push(row);
        row = [];
        if (c === '\r' && text[i + 1] === '\n') i++;
      }
    } else cell += c;
  }
  if (quoted) throw new Error('Unclosed quoted CSV field.');
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}
export const TEAM_CSV_HEADERS = [
  'team',
  'teamNo',
  'group',
  'captain',
  'teamClub',
  'teamFed',
  'board',
  'reserve',
  'name',
  'title',
  'rating',
  'fed',
  'fideId',
  'nationalId',
  'birthYear',
  'club',
  'fideStandard',
  'fideRapid',
  'fideBlitz',
  'nationalRating',
];
export function previewTeamCSV(text) {
  const grid = csvCells(text);
  if (!grid.length) throw new Error('The CSV is empty.');
  const headers = grid
    .shift()
    .map((h) => h.toLowerCase().replace(/[ _-]/g, ''));
  for (const key of ['team', 'board', 'name'])
    if (!headers.includes(key))
      throw new Error(
        `Missing ${key} column. Expected: ${TEAM_CSV_HEADERS.join(', ')}.`,
      );
  const rows = [],
    errors = [],
    orders = new Set(),
    ids = new Set(),
    teamMetadata = new Map();
  grid.forEach((cells, i) => {
    const get = (k) => cells[headers.indexOf(k.toLowerCase())] || '',
      rating = (k) => {
        const v = get(k);
        if (v && (!Number.isFinite(+v) || +v < 0))
          errors.push(`Row ${i + 2}: ${k} must be nonnegative.`);
        return +v || 0;
      };
    const row = {
      line: i + 2,
      team: get('team'),
      teamNo: get('teamNo') ? +get('teamNo') : null,
      group: get('group'),
      captain: get('captain'),
      teamClub: get('teamClub'),
      teamFed: get('teamFed'),
      board: +get('board'),
      reserve: ['1', 'true', 'yes', 'r'].includes(get('reserve').toLowerCase()),
      player: {
        name: get('name'),
        title: get('title'),
        rating: rating('rating'),
        fed: get('fed').toUpperCase(),
        fideId: get('fideId'),
        ids: { national: get('nationalId') },
        byear: get('birthYear') ? +get('birthYear') : '',
        club: get('club'),
        ratings: {
          fideStandard: rating('fideStandard'),
          fideRapid: rating('fideRapid'),
          fideBlitz: rating('fideBlitz'),
          national: rating('nationalRating'),
        },
      },
    };
    if (
      !row.team ||
      !row.player.name ||
      !Number.isInteger(row.board) ||
      row.board < 1
    )
      errors.push(
        `Row ${row.line}: team, name and positive registered board are required.`,
      );
    if (
      row.teamNo !== null &&
      (!Number.isInteger(row.teamNo) || row.teamNo < 1)
    )
      errors.push(`Row ${row.line}: invalid team number.`);
    if (
      row.player.byear !== '' &&
      (!Number.isInteger(row.player.byear) ||
        row.player.byear < 1900 ||
        row.player.byear > 2200)
    )
      errors.push(`Row ${row.line}: invalid birth year.`);
    if (
      get('reserve') &&
      !['1', '0', 'true', 'false', 'yes', 'no', 'r'].includes(
        get('reserve').toLowerCase(),
      )
    )
      errors.push(`Row ${row.line}: reserve must be yes/no.`);
    const order = `${row.team.toLowerCase()}:${row.board}`;
    if (orders.has(order))
      errors.push(
        `Row ${row.line}: duplicate registered board for ${row.team}.`,
      );
    orders.add(order);
    const id = row.player.fideId
      ? `f:${row.player.fideId}`
      : row.player.ids.national
        ? `n:${row.player.ids.national}`
        : `name:${row.player.name.toLowerCase()}:${row.player.byear}`;
    if (ids.has(id))
      errors.push(`Row ${row.line}: player appears more than once.`);
    ids.add(id);
    const meta = JSON.stringify([
        row.teamNo,
        row.group,
        row.captain,
        row.teamClub,
        row.teamFed,
      ]),
      old = teamMetadata.get(row.team.toLowerCase());
    if (old && old !== meta)
      errors.push(
        `Row ${row.line}: team details must be consistent across its rows.`,
      );
    teamMetadata.set(row.team.toLowerCase(), meta);
    rows.push(row);
  });
  return { rows, errors, teams: teamMetadata.size };
}
