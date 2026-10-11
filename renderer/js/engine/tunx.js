// Swiss-Manager .TUNx binary import (clean-room, based on observed files).
//
// Supports both sparse and fully populated 30-string Swiss-Manager player
// records. Unknown/reserved data is deliberately preserved from the source.
// The original bytes are retained for byte-identical export, while known rich
// identity, rating, metadata, bye, pairing, and result fields can be rewritten.

const MARKERS = Object.freeze({
  header: [0x93, 0xff, 0x89, 0x44],
  settings: [0x95, 0xff, 0x89, 0x44],
  rounds: [0xa3, 0xff, 0x89, 0x44],
  players: [0xa5, 0xff, 0x89, 0x44],
  pairings: [0xb3, 0xff, 0x89, 0x44],
  directory: [0xd3, 0xff, 0x89, 0x44],
  end: [0xe3, 0xff, 0x89, 0x44]
});

const RESULT_CODES = Object.freeze({
  0: '',
  1: '1-0',
  2: '1/2-1/2',
  3: '0-1',
  4: '1F-0F',
  5: '0F-1F',
  6: '0F-0F',
  7: 'ADJ'
});
const NATIVE_RESULT_CODES = Object.freeze(Object.fromEntries(
  Object.entries(RESULT_CODES).map(([code, result]) => [result, Number(code)])
));

const PAIRING_RECORD_SIZE = 21;
const ROUND_RECORD_COUNT_OFFSET = 38;
const INACTIVE_OPPONENT = 0xfffe;
const BYE_OPPONENT = 0xffff;
const MAX_PLAYERS = 10000;
const MAX_ROUNDS = 1000;
const RICH_PLAYER_STRING_COUNT = 30;
const RICH_PLAYER_NUMERIC_SIZE = 110;

const METADATA_FIELDS = Object.freeze({
  name: 0,
  chiefArbiter: 3,
  organizer: 4,
  site: 5,
  shortName: 9,
  city: 10,
  sourceId: 11,
  categories: 13,
  timeControl: 14,
  federation: 20
});

const RICH_PLAYER_FIELDS = Object.freeze({
  surname: 0,
  firstName: 1,
  shortName: 3,
  title: 4,
  nationalId: 5,
  club: 9,
  federation: 10,
  group: 11,
  type: 12,
  source: 17
});

const NATIVE_TIEBREAKS = Object.freeze({
  0x0b: 'CUM',
  0x25: 'PERF',
  0x34: 'BHM',
  0x3d: 'WINS',
  0x44: 'DE',
  0x51: 'SB',
  0x54: 'BH',
  0x55: 'BHC1',
  0x58: 'AROC'
});

export class TunxError extends Error {
  constructor(code, message, offset = null) {
    super(message);
    this.name = 'TunxError';
    this.code = code;
    this.offset = offset;
  }
}

export function parseTunx(input) {
  const bytes = toBytes(input);
  const structuralWarnings = [];
  if (bytes.length < 64) fail('truncated_tunx', 'The TUNx file is too short.');
  expectMarker(bytes, 0, MARKERS.header, 'unsupported_tunx_variant', 'Missing TUNx header marker.');

  const directoryOffset = findMarker(bytes, MARKERS.directory);
  if (directoryOffset < 0 || directoryOffset + 20 > bytes.length) {
    fail('missing_tunx_directory', 'The TUNx block directory is missing or truncated.');
  }
  const endOffset = directoryOffset + 32;
  expectMarker(bytes, endOffset, MARKERS.end, 'missing_tunx_end', 'The TUNx end marker is missing.');
  if (endOffset + MARKERS.end.length !== bytes.length) {
    fail('unsupported_tunx_variant', 'Unexpected data follows the TUNx end marker.', endOffset + 4);
  }

  const roundBlockOffset = readU32(bytes, directoryOffset + 4);
  const playerBlockOffset = readU32(bytes, directoryOffset + 8);
  const pairingBlockOffset = readU32(bytes, directoryOffset + 12);
  const recordedDirectoryOffset = readU32(bytes, directoryOffset + 16);
  if (recordedDirectoryOffset !== directoryOffset) {
    structuralWarnings.push(`Legacy directory pointer ${recordedDirectoryOffset} differs from the footer marker at ${directoryOffset}.`);
  }
  validateOrderedOffsets([roundBlockOffset, playerBlockOffset, pairingBlockOffset, directoryOffset], bytes.length);
  expectMarker(bytes, roundBlockOffset, MARKERS.rounds, 'invalid_tunx_block', 'Missing round block marker.');
  expectMarker(bytes, playerBlockOffset, MARKERS.players, 'invalid_tunx_block', 'Missing player block marker.');
  expectMarker(bytes, pairingBlockOffset, MARKERS.pairings, 'invalid_tunx_block', 'Missing pairing block marker.');

  const settingsOffset = findMarker(bytes, MARKERS.settings, 4, roundBlockOffset);
  if (settingsOffset < 0) fail('invalid_tunx_block', 'Missing tournament settings block marker.');
  ensureRange(bytes, settingsOffset, 83, roundBlockOffset);
  const variant = readU32(bytes, settingsOffset + 13);
  const tournamentType = bytes[settingsOffset + 15];
  const currentRound = bytes[settingsOffset + 21];
  const playerCount = readU16(bytes, settingsOffset + 23);
  const encodedRounds = readU16(bytes, settingsOffset + 4);
  const rounds = encodedRounds || (playerCount === 0 ? 1 : 0);
  const encodedStartDate = readU32(bytes, settingsOffset + 75);
  const encodedEndDate = readU32(bytes, settingsOffset + 79);
  if (!Number.isInteger(playerCount) || playerCount < 0 || playerCount > MAX_PLAYERS) {
    fail('invalid_tunx_player_count', `Invalid TUNx player count: ${playerCount}.`, settingsOffset + 23);
  }
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > MAX_ROUNDS || currentRound > rounds) {
    fail('invalid_tunx_round_count', `Invalid TUNx round values: ${currentRound}/${rounds}.`, settingsOffset + 21);
  }

  const metadata = readStringSequence(bytes, 0x6c, settingsOffset);
  const metadataValue = field => metadata[METADATA_FIELDS[field]] ?? '';
  const name = metadataValue('name') || 'Imported Swiss-Manager tournament';
  const originalFilename = metadataValue('sourceId');
  const categoryText = metadataValue('categories').replace(/^"/, '');
  const playerData = parsePlayers(bytes, playerBlockOffset + 4, pairingBlockOffset, playerCount);
  const players = playerData.players;
  const warnings = [...structuralWarnings];
  if (!encodedRounds && !playerCount) warnings.push('The empty TUNx file did not specify a round count; TourneyLab defaulted it to one round.');
  const recordedPairingEnd = recordedDirectoryOffset >= pairingBlockOffset + 4
    && recordedDirectoryOffset <= directoryOffset
    && (recordedDirectoryOffset - pairingBlockOffset - 4) % PAIRING_RECORD_SIZE === 0
    ? recordedDirectoryOffset
    : directoryOffset;
  const pairingData = playerCount
    ? parsePairings(bytes, pairingBlockOffset + 4, recordedPairingEnd, { players, rounds, currentRound, warnings })
    : { roundsData: [] };
  if (!playerCount) warnings.push('The TUNx file contains no players.');
  const startDate = normalizeCompactDate(encodedStartDate);
  const endDate = normalizeCompactDate(encodedEndDate) || startDate;
  const categories = categoryText.split(',').map(value => value.trim()).filter(Boolean);

  if (!startDate && encodedStartDate) warnings.push(`Tournament date ${encodedStartDate} was not recognized.`);
  if (playerData.layout === 'rich') warnings.push('Imported the Swiss-Manager rich player record layout, including identity and rating fields.');
  if (categories.length) warnings.push(`Swiss-Manager category configuration preserved as labels: ${categories.join(', ')}.`);
  warnings.push('Round-specific dates, tie-break parameters, and opaque Swiss-Manager settings are not decoded yet.');

  const tournament = {
    name,
    sectionName: 'Open',
    sectionCode: 'A',
    site: metadataValue('site') || metadataValue('city'),
    federation: metadataValue('federation') || mostCommon(players.map(player => player.fed)),
    organizer: metadataValue('organizer'),
    startDate,
    endDate,
    timeControl: metadataValue('timeControl'),
    type: tournamentType === 1 ? 'roundrobin' : 'swiss',
    rounds,
    currentRound,
    scoring: { win: 1, draw: 0.5, loss: 0 },
    matchScoring: { win: 2, draw: 1, loss: 0 },
    pabValue: 'win',
    fideMode: true,
    tiebreakRules: 'legacy',
    initialColor: 'white',
    acceleration: 'none',
    byeWeakest: false,
    clubProtection: false,
    defaultFed: mostCommon(players.map(player => player.fed)),
    tiebreaks: parseNativeTiebreaks(bytes, settingsOffset),
    ageGroups: categories.map(code => ({ code, label: code })),
    players,
    teams: [],
    forbidden: [],
    roundsData: pairingData.roundsData,
    interop: {
      swissManager: {
        extension: 'TUNx',
        codecVersion: 2,
        variant,
        playerLayout: playerData.layout,
        originalFilename,
        sourceBase64: encodeBase64(bytes),
        exportMode: 'source-backed-v1'
      }
    }
  };

  return {
    tournament,
    warnings: unique(warnings),
    nativeMetadata: {
      variant,
      playerLayout: playerData.layout,
      originalFilename,
      offsets: { roundBlockOffset, playerBlockOffset, pairingBlockOffset, directoryOffset }
    }
  };
}

export function exportOriginalTunx(tournament) {
  const source = tournament?.interop?.swissManager?.sourceBase64;
  if (!source) fail('tunx_source_unavailable', 'This tournament was not imported from a preserved TUNx file.');
  return decodeBase64(source);
}

// Writes the subset of native fields whose binary representation has been
// validated. Opaque Swiss-Manager configuration is copied from the imported
// source, so this intentionally requires a source-backed tournament.
export function exportTunx(tournament) {
  const source = exportOriginalTunx(tournament);
  const parsedSource = parseTunx(source);
  const original = parsedSource.tournament;
  const playerLayout = parsedSource.nativeMetadata.playerLayout;
  if (sameWritableTournament(tournament, original)) return source;
  const competitionChanged = !sameCompetitionState(tournament, original);
  validateWritableTournament(tournament, original, { playerLayout, competitionChanged });

  const sourceDirectoryOffset = findMarker(source, MARKERS.directory);
  const roundBlockOffset = readU32(source, sourceDirectoryOffset + 4);
  const playerBlockOffset = readU32(source, sourceDirectoryOffset + 8);
  const pairingBlockOffset = readU32(source, sourceDirectoryOffset + 12);
  const recordedPairingEnd = readU32(source, sourceDirectoryOffset + 16);
  const sourcePairingEnd = recordedPairingEnd >= pairingBlockOffset + 4
    && recordedPairingEnd <= sourceDirectoryOffset
    && (recordedPairingEnd - pairingBlockOffset - 4) % PAIRING_RECORD_SIZE === 0
    ? recordedPairingEnd
    : sourceDirectoryOffset;
  const settingsOffset = findMarker(source, MARKERS.settings, 4, roundBlockOffset);
  const templates = readPlayerTemplates(source, playerBlockOffset + 4, pairingBlockOffset, original.players.length, playerLayout);

  const metadata = readStringSequence(source, 0x6c, settingsOffset);
  metadata[METADATA_FIELDS.name] = String(tournament.name || original.name);
  const metadataBytes = concatBytes(metadata.map(encodeUtf16));
  const outputSettingsOffset = 0x6c + metadataBytes.length;
  const configOffsetDelta = outputSettingsOffset - settingsOffset;
  const outputRoundBlockOffset = roundBlockOffset + configOffsetDelta;
  const outputPlayerBlockOffset = playerBlockOffset + configOffsetDelta;
  const prefix = concatBytes([
    Uint8Array.from(source.subarray(0, 0x6c)),
    metadataBytes,
    Uint8Array.from(source.subarray(settingsOffset, playerBlockOffset + 4))
  ]);
  writeU32(prefix, outputSettingsOffset + 75, compactDate(tournament.startDate || original.startDate));
  writeU32(prefix, outputSettingsOffset + 79, compactDate(tournament.endDate || tournament.startDate || original.endDate || original.startDate));
  // currentRound is a single byte. Preserve the adjacent opaque settings byte.
  prefix[outputSettingsOffset + 21] = Number(tournament.currentRound) || 0;
  writeU16(prefix, outputSettingsOffset + 23, tournament.players.length);

  const originalByNumber = new Map(original.players.map(player => [player.no, player]));
  const templateByNumber = new Map(templates.map(template => [template.number, template]));
  const playerData = concatBytes([...tournament.players]
    .sort((left, right) => left.no - right.no)
    .map(player => encodePlayerRecord(player, originalByNumber.get(player.no), templateByNumber.get(player.no), playerLayout)));
  const encodedPairings = competitionChanged
    ? encodePairingRecords(tournament)
    : null;
  const pairingData = encodedPairings
    ? encodedPairings.bytes
    : Uint8Array.from(source.subarray(pairingBlockOffset + 4, sourcePairingEnd));
  if (encodedPairings) {
    writeRoundRecordCounts(
      prefix,
      outputRoundBlockOffset,
      outputPlayerBlockOffset,
      tournament.rounds,
      encodedPairings.recordCounts
    );
  }
  const pairingBlockMarker = Uint8Array.from(source.subarray(pairingBlockOffset, pairingBlockOffset + 4));
  const directoryPreamble = Uint8Array.from(source.subarray(sourcePairingEnd, sourceDirectoryOffset));

  const newPairingBlockOffset = prefix.length + playerData.length;
  const newPairingEnd = newPairingBlockOffset + pairingBlockMarker.length + pairingData.length;
  const newDirectoryOffset = newPairingEnd + directoryPreamble.length;
  const footer = Uint8Array.from(source.subarray(sourceDirectoryOffset));
  writeU32(footer, 4, outputRoundBlockOffset);
  writeU32(footer, 8, outputPlayerBlockOffset);
  writeU32(footer, 12, newPairingBlockOffset);
  writeU32(footer, 16, newPairingEnd);

  const output = concatBytes([prefix, playerData, pairingBlockMarker, pairingData, directoryPreamble, footer]);
  // Parse our own output before returning it. This catches offset or record
  // mistakes locally instead of handing Swiss-Manager a malformed file.
  parseTunx(output);
  return output;
}

export function hasOriginalTunx(tournament) {
  return !!tournament?.interop?.swissManager?.sourceBase64;
}

function validateWritableTournament(tournament, original, { playerLayout, competitionChanged }) {
  if (tournament?.type !== 'swiss') fail('unsupported_tunx_edit', 'Native TUNx writing currently supports individual Swiss tournaments only.');
  if (Number(tournament.rounds) !== Number(original.rounds)) {
    fail('unsupported_tunx_edit', 'Changing the scheduled round count is not supported by the current TUNx writer.');
  }
  if (!Array.isArray(tournament.players) || tournament.players.length !== original.players.length) {
    fail('unsupported_tunx_edit', 'Adding or removing players is not supported by the current TUNx writer.');
  }
  const expectedNumbers = new Set(original.players.map(player => player.no));
  const actualNumbers = new Set(tournament.players.map(player => Number(player.no)));
  if (actualNumbers.size !== tournament.players.length || [...actualNumbers].some(number => !expectedNumbers.has(number))) {
    fail('unsupported_tunx_edit', 'Player starting numbers must remain the same for native TUNx export.');
  }
  for (const player of tournament.players) {
    const unsupported = [
      Number(player.rating) || 0,
      player.fideId,
      player.club,
      player.byear,
      player.sex,
      player.title
    ];
    if (playerLayout !== 'rich' && unsupported.some(Boolean)) {
      fail('unsupported_tunx_edit', `Native export cannot yet write rating or identity fields for ${player.name || `player ${player.no}`}.`);
    }
  }
  const currentRound = Number(tournament.currentRound) || 0;
  if (currentRound < 0 || currentRound > tournament.rounds || tournament.roundsData.length < currentRound) {
    fail('unsupported_tunx_edit', 'The current round is inconsistent with the tournament schedule.');
  }
  const futureRoundCount = tournament.rounds - currentRound;
  for (const player of competitionChanged ? tournament.players : []) {
    const futureExclusions = (player.excludedRounds ?? []).filter(round => round > currentRound && round <= tournament.rounds);
    if (!player.withdrawn && futureExclusions.length && futureExclusions.length !== futureRoundCount) {
      fail('unsupported_tunx_edit', `Future one-round exclusions for ${player.name} cannot be written until native round boundaries are decoded.`);
    }
  }
}

function sameWritableTournament(tournament, original) {
  const fields = value => ({
    name: value.name ?? '',
    startDate: value.startDate ?? '',
    endDate: value.endDate ?? '',
    rounds: Number(value.rounds) || 0,
    currentRound: Number(value.currentRound) || 0,
    players: [...(value.players ?? [])].sort((left, right) => left.no - right.no).map(player => ({
      no: Number(player.no),
      name: player.name ?? '',
      rating: Number(player.rating) || 0,
      nationalRating: Number(player.ratings?.national) || 0,
      fideId: String(player.fideId ?? ''),
      nationalId: String(player.ids?.national ?? ''),
      fed: player.fed ?? '',
      club: player.club ?? '',
      birthDate: player.birthDate ?? '',
      byear: Number(player.byear) || 0,
      sex: player.sex ?? '',
      title: player.title ?? '',
      group: player.group ?? '',
      type: player.type ?? ''
    })),
    competition: competitionState(value)
  });
  return JSON.stringify(fields(tournament)) === JSON.stringify(fields(original));
}

function sameCompetitionState(tournament, original) {
  return JSON.stringify(competitionState(tournament)) === JSON.stringify(competitionState(original));
}

function competitionState(tournament) {
  return {
    currentRound: Number(tournament.currentRound) || 0,
    roundsData: (tournament.roundsData ?? []).map(round => ({
      round: Number(round.round),
      pairings: (round.pairings ?? []).map(pairing => ({
        board: Number(pairing.board),
        whiteId: pairing.whiteId,
        blackId: pairing.blackId,
        result: pairing.result ?? ''
      })),
      byes: (round.byes ?? []).map(bye => ({ playerId: bye.playerId, type: bye.type }))
    })),
    players: [...(tournament.players ?? [])].sort((left, right) => left.no - right.no).map(player => ({
      no: Number(player.no),
      active: player.active !== false,
      withdrawn: !!player.withdrawn,
      excludedRounds: [...(player.excludedRounds ?? [])].map(Number).sort((left, right) => left - right),
      requestedByes: player.requestedByes ?? {}
    }))
  };
}

function readPlayerTemplates(bytes, start, end, playerCount, layout) {
  if (layout === 'rich') return readRichPlayerTemplates(bytes, start, end, playerCount);
  const templates = [];
  let offset = start;
  for (let index = 0; index < playerCount; index++) {
    const fullName = readUtf16(bytes, offset, end);
    offset = fullName.nextOffset + 4;
    const shortName = readUtf16(bytes, offset, end);
    offset = shortName.nextOffset + 12;
    const federation = readUtf16(bytes, offset, end);
    offset = federation.nextOffset;
    ensureRange(bytes, offset, 148, end);
    const tail = Uint8Array.from(bytes.subarray(offset, offset + 148));
    templates.push({
      number: readU16(tail, 60) || index + 1,
      fullName: fullName.value,
      shortName: shortName.value,
      federation: federation.value,
      tail
    });
    offset += 148;
  }
  if (offset !== end) fail('unsupported_tunx_player_layout', 'Could not recover native player templates.', offset);
  return templates;
}

function readRichPlayerTemplates(bytes, start, end, playerCount) {
  const templates = [];
  let offset = start;
  for (let index = 0; index < playerCount; index++) {
    const strings = [];
    for (let field = 0; field < RICH_PLAYER_STRING_COUNT; field++) {
      const value = readUtf16(bytes, offset, end);
      strings.push(value.value);
      offset = value.nextOffset;
    }
    ensureRange(bytes, offset, RICH_PLAYER_NUMERIC_SIZE, end);
    templates.push({
      number: index + 1,
      strings,
      numeric: Uint8Array.from(bytes.subarray(offset, offset + RICH_PLAYER_NUMERIC_SIZE))
    });
    offset += RICH_PLAYER_NUMERIC_SIZE;
  }
  if (offset !== end) fail('unsupported_tunx_player_layout', 'Could not recover rich native player templates.', offset);
  return templates;
}

function encodePlayerRecord(player, original, template, layout) {
  if (!original || !template) fail('unsupported_tunx_edit', `No native player template exists for start number ${player.no}.`);
  if (layout === 'rich') return encodeRichPlayerRecord(player, original, template);
  const name = String(player.name ?? '').trim() || original.name;
  const federation = String(player.fed ?? '').trim();
  let shortName = template.shortName;
  if (template.shortName === template.fullName) shortName = name;
  else if (template.shortName.length === 1) shortName = name.slice(0, 1);
  const tail = Uint8Array.from(template.tail);
  writeU16(tail, 60, Number(player.no));
  return concatBytes([
    encodeUtf16(name),
    new Uint8Array(4),
    encodeUtf16(shortName),
    new Uint8Array(12),
    encodeUtf16(federation),
    tail
  ]);
}

function encodeRichPlayerRecord(player, original, template) {
  const strings = [...template.strings];
  const numeric = Uint8Array.from(template.numeric);
  const name = String(player.name ?? '').trim() || original.name;
  if (name !== original.name) {
    const comma = name.indexOf(',');
    strings[RICH_PLAYER_FIELDS.surname] = comma >= 0 ? name.slice(0, comma).trim() : name;
    strings[RICH_PLAYER_FIELDS.firstName] = comma >= 0 ? name.slice(comma + 1).trim() : '';
    strings[RICH_PLAYER_FIELDS.shortName] = name;
  }
  strings[RICH_PLAYER_FIELDS.title] = String(player.title ?? '').trim().toUpperCase();
  strings[RICH_PLAYER_FIELDS.nationalId] = String(player.ids?.national ?? '').trim();
  strings[RICH_PLAYER_FIELDS.club] = String(player.club ?? '').trim();
  strings[RICH_PLAYER_FIELDS.federation] = String(player.fed ?? '').trim().toUpperCase();
  strings[RICH_PLAYER_FIELDS.group] = String(player.group ?? '').trim();
  strings[RICH_PLAYER_FIELDS.type] = String(player.type ?? '').trim();

  const originalFideRating = readU16(template.numeric, 8);
  const originalNationalRating = readU16(template.numeric, 10);
  const rating = Number(player.rating) || 0;
  if (rating !== (Number(original.rating) || 0)) {
    if (originalFideRating || !originalNationalRating) writeU16(numeric, 8, rating);
    else writeU16(numeric, 10, rating);
  }
  writeU16(numeric, 10, Number(player.ratings?.national) || 0);
  numeric[6] = String(player.sex ?? '').toLowerCase() === 'w' ? 1 : 0;
  writeU32(numeric, 14, nativeBirthDate(player));
  writeU32(numeric, 24, numericIdentifier(player.fideId, 'FIDE ID'));

  return concatBytes([...strings.map(encodeUtf16), numeric]);
}

function nativeBirthDate(player) {
  const birthDate = String(player.birthDate ?? '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return compactDate(birthDate);
  const year = Number(player.byear) || 0;
  if (!year) return 0;
  if (!Number.isInteger(year) || year < 1000 || year > 9999) {
    fail('unsupported_tunx_edit', `Invalid birth year for ${player.name || `player ${player.no}`}.`);
  }
  return year * 10000;
}

function numericIdentifier(value, label) {
  const text = String(value ?? '').trim();
  if (!text) return 0;
  if (!/^\d+$/.test(text)) fail('unsupported_tunx_edit', `${label} must contain digits only for native TUNx export.`);
  const number = Number(text);
  if (!Number.isSafeInteger(number) || number < 0 || number > 0xffffffff) {
    fail('unsupported_tunx_edit', `${label} is outside the native TUNx range.`);
  }
  return number;
}

function encodePairingRecords(tournament) {
  const players = [...tournament.players].sort((left, right) => left.no - right.no);
  const numberById = new Map(players.map(player => [player.id, player.no]));
  const currentRound = Number(tournament.currentRound) || 0;
  const records = [];
  const recordCounts = [];

  for (let round = 1; round <= currentRound; round++) {
    const recordStart = records.length;
    const roundData = tournament.roundsData[round - 1];
    const seen = new Set();
    for (const pairing of roundData.pairings ?? []) {
      const white = numberById.get(pairing.whiteId);
      const black = numberById.get(pairing.blackId);
      if (!white || !black || white === black || seen.has(white) || seen.has(black)) {
        fail('unsupported_tunx_edit', `Round ${round} contains an invalid or duplicate pairing.`);
      }
      const resultCode = NATIVE_RESULT_CODES[pairing.result ?? ''];
      if (resultCode == null) fail('unsupported_tunx_edit', `Round ${round} contains unsupported result ${pairing.result}.`);
      records.push(encodePairingRecord(white, black, resultCode));
      seen.add(white);
      seen.add(black);
    }
    for (const bye of roundData.byes ?? []) {
      const player = numberById.get(bye.playerId);
      if (!player || seen.has(player)) fail('unsupported_tunx_edit', `Round ${round} contains an invalid or duplicate bye.`);
      records.push(encodePairingRecord(player, BYE_OPPONENT, nativeByeResultCode(bye.type)));
      seen.add(player);
    }
    for (const player of players) {
      if (seen.has(player.no)) continue;
      records.push(encodePairingRecord(player.no, INACTIVE_OPPONENT, 3));
    }
    recordCounts.push(records.length - recordStart);
  }

  for (let round = currentRound + 1; round <= tournament.rounds; round++) {
    const recordStart = records.length;
    for (const player of players) {
      if (player.withdrawn || (player.excludedRounds ?? []).includes(round)) {
        records.push(encodePairingRecord(player.no, INACTIVE_OPPONENT, 0));
      }
    }
    recordCounts.push(records.length - recordStart);
  }
  return { bytes: concatBytes(records), recordCounts };
}

function writeRoundRecordCounts(bytes, roundBlockOffset, playerBlockOffset, rounds, recordCounts) {
  const roundDataLength = playerBlockOffset - roundBlockOffset - MARKERS.rounds.length;
  const roundRecordSize = roundDataLength / rounds;
  if (!Number.isInteger(roundRecordSize) || roundRecordSize <= ROUND_RECORD_COUNT_OFFSET + 1) {
    fail(
      'unsupported_tunx_round_layout',
      'Could not update the native round record directory.',
      roundBlockOffset
    );
  }
  for (let round = 0; round < rounds; round++) {
    writeU16(
      bytes,
      roundBlockOffset + MARKERS.rounds.length + round * roundRecordSize + ROUND_RECORD_COUNT_OFFSET,
      recordCounts[round] ?? 0
    );
  }
}

function nativeByeResultCode(type) {
  if (type === 'FPB') return 1;
  if (type === 'HPB') return 2;
  if (type === 'PAB') return 9;
  return 0;
}

function encodePairingRecord(player, opponent, resultCode) {
  const output = new Uint8Array(PAIRING_RECORD_SIZE);
  writeU16(output, 0, player);
  writeU16(output, 2, opponent);
  writeU16(output, 4, resultCode);
  return output;
}

function parsePlayers(bytes, start, end, playerCount) {
  const rich = tryParseRichPlayers(bytes, start, end, playerCount);
  if (rich) return { layout: 'rich', players: rich };
  return { layout: 'compact', players: parseCompactPlayers(bytes, start, end, playerCount) };
}

function tryParseRichPlayers(bytes, start, end, playerCount) {
  try {
    const records = [];
    let offset = start;
    for (let index = 0; index < playerCount; index++) {
      const strings = [];
      for (let field = 0; field < RICH_PLAYER_STRING_COUNT; field++) {
        const value = readUtf16(bytes, offset, end);
        strings.push(value.value);
        offset = value.nextOffset;
      }
      ensureRange(bytes, offset, RICH_PLAYER_NUMERIC_SIZE, end);
      const numeric = bytes.subarray(offset, offset + RICH_PLAYER_NUMERIC_SIZE);
      records.push({ strings, numeric });
      offset += RICH_PLAYER_NUMERIC_SIZE;
    }
    if (offset !== end) return null;
    return records.map((record, index) => richPlayer(record, index));
  } catch (error) {
    if (error instanceof TunxError) return null;
    throw error;
  }
}

function richPlayer({ strings, numeric }, index) {
  const field = name => strings[RICH_PLAYER_FIELDS[name]] ?? '';
  const surname = field('surname').trim();
  const firstName = field('firstName').trim();
  const number = index + 1;
  const fideRating = readU16(numeric, 8);
  const nationalRating = readU16(numeric, 10);
  const encodedBirthDate = readU32(numeric, 14);
  const birth = normalizeNativeBirthDate(encodedBirthDate);
  const fideId = readU32(numeric, 24);
  return {
    id: `SM-${number}`,
    no: number,
    name: firstName ? `${surname}, ${firstName}` : (surname || field('shortName') || `Player ${number}`),
    rating: fideRating || nationalRating || 0,
    ratings: nationalRating ? { national: nationalRating } : {},
    fideId: fideId ? String(fideId) : '',
    ids: field('nationalId') ? { national: field('nationalId') } : {},
    fed: field('federation'),
    club: field('club'),
    birthDate: birth.birthDate,
    byear: birth.byear,
    sex: numeric[6] === 1 ? 'w' : '',
    title: field('title').toUpperCase(),
    group: field('group'),
    type: field('type'),
    active: true,
    withdrawn: false,
    excludedRounds: [],
    requestedByes: {},
    rankCorrection: 0,
    addedPoints: 0,
    interop: {
      swissManager: {
        source: field('source'),
        categoryId: readU16(numeric, 18),
        registrationId: readU16(numeric, 22)
      }
    }
  };
}

function parseCompactPlayers(bytes, start, end, playerCount) {
  const players = [];
  let offset = start;
  for (let index = 0; index < playerCount; index++) {
    const fullName = readUtf16(bytes, offset, end);
    offset = fullName.nextOffset;
    ensureRange(bytes, offset, 4, end);
    offset += 4;
    const shortName = readUtf16(bytes, offset, end);
    offset = shortName.nextOffset;
    ensureRange(bytes, offset, 12, end);
    offset += 12;
    const federation = readUtf16(bytes, offset, end);
    offset = federation.nextOffset;
    ensureRange(bytes, offset, 148, end);
    const firstNumber = readU16(bytes, offset + 60);
    const secondNumber = readU16(bytes, offset + 94);
    const number = firstNumber || secondNumber || index + 1;
    players.push({
      id: `SM-${number}`,
      no: number,
      name: fullName.value || shortName.value || `Player ${number}`,
      rating: 0,
      ratings: {},
      fideId: '',
      ids: {},
      fed: federation.value,
      club: '',
      birthDate: '',
      byear: '',
      sex: '',
      title: '',
      active: true,
      withdrawn: false,
      excludedRounds: [],
      requestedByes: {},
      rankCorrection: 0,
      addedPoints: 0
    });
    offset += 148;
  }
  if (offset !== end) {
    fail('unsupported_tunx_player_layout', `Player records end ${end - offset} byte(s) away from the pairing block.`, offset);
  }
  const numbers = new Set(players.map(player => player.no));
  if (numbers.size !== players.length || [...numbers].some(number => number < 1 || number > playerCount)) {
    fail('invalid_tunx_player', 'Player start numbers are missing, duplicated, or out of range.', start);
  }
  return players;
}

function parsePairings(bytes, start, end, { players, rounds, currentRound, warnings }) {
  const length = end - start;
  if (length < 0 || length % PAIRING_RECORD_SIZE !== 0) {
    fail('unsupported_tunx_pairing_layout', 'The TUNx pairing block is not made of 21-byte records.', start);
  }
  const records = [];
  for (let offset = start; offset < end; offset += PAIRING_RECORD_SIZE) {
    const player = readU16(bytes, offset);
    const opponent = readU16(bytes, offset + 2);
    const resultCode = readU16(bytes, offset + 4);
    if (player < 1 || player > players.length) {
      fail('invalid_tunx_pairing', `Pairing references player ${player}.`, offset);
    }
    if (opponent !== INACTIVE_OPPONENT && opponent !== BYE_OPPONENT && (opponent < 1 || opponent > players.length)) {
      fail('invalid_tunx_pairing', `Pairing references opponent ${opponent}.`, offset + 2);
    }
    if (opponent !== INACTIVE_OPPONENT && opponent !== BYE_OPPONENT && !Object.hasOwn(RESULT_CODES, resultCode)) {
      warnings.push(`Unsupported native result code ${resultCode} for player ${player} was imported as unresolved.`);
    }
    records.push({ player, opponent, resultCode, offset });
  }

  const completedGroups = [];
  let cursor = 0;
  for (let round = 1; round <= currentRound; round++) {
    const seen = new Set();
    const group = [];
    while (seen.size < players.length) {
      const record = records[cursor++];
      if (!record) fail('truncated_tunx_pairings', `Round ${round} does not cover every player.`, end);
      const covered = record.opponent === INACTIVE_OPPONENT || record.opponent === BYE_OPPONENT
        ? [record.player]
        : [record.player, record.opponent];
      if (covered.some(number => seen.has(number))) {
        fail('invalid_tunx_round', `Player appears more than once in round ${round}.`, record.offset);
      }
      covered.forEach(number => seen.add(number));
      group.push(record);
    }
    completedGroups.push(group);
  }

  const futureRoundCount = rounds - currentRound;
  const futureRecords = records.slice(cursor);
  const futureGroups = [];
  if (futureRoundCount) {
    if (futureRecords.length % futureRoundCount !== 0) {
      warnings.push('Future-round exclusions could not be divided cleanly across scheduled rounds.');
    } else {
      const recordsPerRound = futureRecords.length / futureRoundCount;
      for (let index = 0; index < futureRoundCount; index++) {
        futureGroups.push(futureRecords.slice(index * recordsPerRound, (index + 1) * recordsPerRound));
      }
    }
  } else if (futureRecords.length) {
    warnings.push(`${futureRecords.length} pairing record(s) occur after the current final round and were ignored.`);
  }

  const byNumber = new Map(players.map(player => [player.no, player]));
  const roundsData = completedGroups.map((group, index) => {
    const round = index + 1;
    const pairings = [];
    const byes = [];
    for (const record of group) {
      if (record.opponent === INACTIVE_OPPONENT) {
        byNumber.get(record.player).excludedRounds.push(round);
        continue;
      }
      if (record.opponent === BYE_OPPONENT) {
        byes.push({ playerId: byNumber.get(record.player).id, type: nativeByeType(record.resultCode) });
        continue;
      }
      pairings.push({
        board: pairings.length + 1,
        whiteId: byNumber.get(record.player).id,
        blackId: byNumber.get(record.opponent).id,
        result: RESULT_CODES[record.resultCode] ?? '',
        manual: false
      });
    }
    return { round, date: '', time: '', site: '', pairings, byes };
  });

  futureGroups.forEach((group, index) => {
    const round = currentRound + index + 1;
    for (const record of group) {
      if (record.opponent !== INACTIVE_OPPONENT) {
        warnings.push(`Unexpected future pairing in round ${round} was not imported.`);
        continue;
      }
      byNumber.get(record.player).excludedRounds.push(round);
    }
  });
  for (const player of players) {
    const future = player.excludedRounds.filter(round => round > currentRound);
    player.withdrawn = futureRoundCount > 0 && future.length === futureRoundCount;
  }
  return { roundsData };
}

function nativeByeType(resultCode) {
  if (resultCode === 1) return 'FPB';
  if (resultCode === 2) return 'HPB';
  if (resultCode === 9) return 'PAB';
  return 'ZPB';
}

function readUtf16(bytes, offset, limit = bytes.length) {
  ensureRange(bytes, offset, 2, limit);
  const length = readU16(bytes, offset);
  const byteLength = length * 2;
  ensureRange(bytes, offset + 2, byteLength, limit);
  let value = '';
  for (let index = 0; index < length; index++) {
    value += String.fromCharCode(readU16(bytes, offset + 2 + index * 2));
  }
  return { value, nextOffset: offset + 2 + byteLength };
}

function readStringSequence(bytes, start, end) {
  const values = [];
  let offset = start;
  while (offset < end) {
    const value = readUtf16(bytes, offset, end);
    values.push(value.value);
    offset = value.nextOffset;
  }
  if (offset !== end) fail('unsupported_tunx_metadata', 'The TUNx metadata string block is malformed.', offset);
  return values;
}

function parseNativeTiebreaks(bytes, settingsOffset) {
  const count = bytes[settingsOffset + 31] ?? 0;
  const result = [];
  for (let index = 0; index < Math.min(count, 5); index++) {
    const encoded = readU16(bytes, settingsOffset + 32 + index * 2);
    const code = NATIVE_TIEBREAKS[(encoded >>> 8) & 0xff];
    if (code) result.push(code);
  }
  return result.length ? result : ['BH', 'BHC1', 'SB', 'WINS'];
}

function normalizeNativeBirthDate(value) {
  if (!value) return { birthDate: '', byear: '' };
  const text = String(value).padStart(8, '0');
  const year = Number(text.slice(0, 4));
  if (year < 1000 || year > 9999) return { birthDate: '', byear: '' };
  const month = Number(text.slice(4, 6));
  const day = Number(text.slice(6, 8));
  if (!month && !day) return { birthDate: '', byear: year };
  const normalized = `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  const date = new Date(`${normalized}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== normalized
    ? { birthDate: '', byear: year }
    : { birthDate: normalized, byear: year };
}

function normalizeCompactDate(value) {
  const match = String(value || '').match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!match) return '';
  const normalized = `${match[1]}-${match[2]}-${match[3]}`;
  const date = new Date(`${normalized}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== normalized ? '' : normalized;
}

function compactDate(value) {
  const normalized = String(value ?? '').replace(/-/g, '');
  if (!/^\d{8}$/.test(normalized) || !normalizeCompactDate(Number(normalized))) {
    fail('unsupported_tunx_edit', `Invalid tournament date: ${value}.`);
  }
  return Number(normalized);
}

function encodeUtf16(value) {
  const text = String(value ?? '');
  if (text.length > 0xffff) fail('unsupported_tunx_edit', 'A TUNx string is too long.');
  const output = new Uint8Array(2 + text.length * 2);
  writeU16(output, 0, text.length);
  for (let index = 0; index < text.length; index++) writeU16(output, 2 + index * 2, text.charCodeAt(index));
  return output;
}

function expectMarker(bytes, offset, marker, code, message) {
  ensureRange(bytes, offset, marker.length);
  if (!marker.every((value, index) => bytes[offset + index] === value)) fail(code, message, offset);
}

function findMarker(bytes, marker, start = 0, end = bytes.length) {
  const last = Math.min(end, bytes.length) - marker.length;
  for (let offset = Math.max(0, start); offset <= last; offset++) {
    if (marker.every((value, index) => bytes[offset + index] === value)) return offset;
  }
  return -1;
}

function validateOrderedOffsets(offsets, fileLength) {
  for (let index = 0; index < offsets.length; index++) {
    const offset = offsets[index];
    if (!Number.isInteger(offset) || offset < 0 || offset >= fileLength || (index && offset <= offsets[index - 1])) {
      fail('invalid_tunx_offset', 'The TUNx block directory contains invalid or unordered offsets.');
    }
  }
}

function readU16(bytes, offset) {
  ensureRange(bytes, offset, 2);
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readU32(bytes, offset) {
  ensureRange(bytes, offset, 4);
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function writeU16(bytes, offset, value) {
  ensureRange(bytes, offset, 2);
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
}

function writeU32(bytes, offset, value) {
  ensureRange(bytes, offset, 4);
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

function ensureRange(bytes, offset, length, limit = bytes.length) {
  if (!Number.isInteger(offset) || !Number.isInteger(length) || offset < 0 || length < 0 || offset + length > Math.min(limit, bytes.length)) {
    fail('truncated_tunx', 'A TUNx record extends beyond its containing block.', offset);
  }
}

function toBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  if (Array.isArray(input)) return Uint8Array.from(input);
  fail('invalid_tunx_input', 'TUNx input must be binary data.');
}

function encodeBase64(bytes) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let output = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index];
    const hasB = index + 1 < bytes.length;
    const hasC = index + 2 < bytes.length;
    const b = hasB ? bytes[index + 1] : 0;
    const c = hasC ? bytes[index + 2] : 0;
    output += alphabet[a >> 2];
    output += alphabet[((a & 3) << 4) | (b >> 4)];
    output += hasB ? alphabet[((b & 15) << 2) | (c >> 6)] : '=';
    output += hasC ? alphabet[c & 63] : '=';
  }
  return output;
}

function decodeBase64(value) {
  const clean = String(value ?? '').replace(/\s+/g, '');
  if (!clean || clean.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(clean)) {
    fail('invalid_tunx_source', 'Preserved TUNx source data is invalid.');
  }
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const output = [];
  for (let index = 0; index < clean.length; index += 4) {
    const values = clean.slice(index, index + 4).split('').map(char => char === '=' ? 0 : alphabet.indexOf(char));
    output.push((values[0] << 2) | (values[1] >> 4));
    if (clean[index + 2] !== '=') output.push(((values[1] & 15) << 4) | (values[2] >> 2));
    if (clean[index + 3] !== '=') output.push(((values[2] & 3) << 6) | values[3]);
  }
  return Uint8Array.from(output);
}

function concatBytes(parts) {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function mostCommon(values) {
  const counts = new Map();
  for (const value of values.filter(Boolean)) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].sort((left, right) => right[1] - left[1])[0]?.[0] ?? '';
}

function unique(values) {
  return [...new Set(values)];
}

function fail(code, message, offset = null) {
  throw new TunxError(code, message, offset);
}
