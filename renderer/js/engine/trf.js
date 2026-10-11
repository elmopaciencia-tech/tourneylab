// TourneyLab TRF/TRF(x) import (MIT).
//
// Supports the common FIDE TRF16/26 text records used for tournament exchange.
// The parser is intentionally tolerant: official fixed-column records are read
// first, then whitespace-style records from tools such as JaVaFo/Lichess and
// TourneyLab's own TRF-like export are accepted as fallbacks.

import { RESULTS } from './state.js';

const RECORD_CODES = [
  '001', '012', '022', '032', '042', '052', '062', '072', '082', '092',
  '102', '112', '122', '132', '142', '152', '162', '172', '182', '192',
  '202', '212', '222', '240', '250', '260', '299', '300', '310', '320', '330', '352', '362',
  '013', '801', '802', 'DAT', 'XXR', 'XXS', 'XXC'
];

const TITLE_CODES = new Set(['GM', 'IM', 'WGM', 'FM', 'WIM', 'CM', 'WFM', 'WCM']);

export function importTRF(text) {
  const warnings = [];
  const records = splitRecords(text);
  const meta = {};
  const roundDateLine = [];
  const players = [];
  const datGroups = new Map();
  const oldTeams = [];
  const newTeams = [];
  const lineups = {};
  const forfeits = [];
  const team801 = [];
  const team802 = [];
  const scoring = { win: 1, draw: 0.5, loss: 0 };
  const matchScoring = { win: 2, draw: 1, loss: 0 };
  let pabValue = 'win';
  let explicitRounds = null;

  for (const line of records) {
    if (!line || line.startsWith('###')) continue;
    const code = line.slice(0, 3).toUpperCase();
    if (code === '001') players.push(parsePlayer(line, warnings));
    else if (code === '013') oldTeams.push(parse013(line));
    else if (code === '310') {
      const parsed = parse310(line);
      if (parsed) newTeams.push(parsed);
      else warnings.push('Skipped an invalid TRF26 310 team record.');
    }
    else if (code === '300') {
      const parsed = parse300(line);
      if (parsed) {
        lineups[parsed.round] = lineups[parsed.round] ?? {};
        lineups[parsed.round][teamId(parsed.teamNo)] = parsed.rosterNos.map(playerId);
      }
    } else if (code === '330') {
      const parsed = parse330(line);
      if (parsed) forfeits.push(parsed);
    } else if (code === '801') {
      const parsed = parse801(line);
      if (parsed) team801.push(parsed);
    } else if (code === '802') {
      const parsed = parse802(line);
      if (parsed) team802.push(parsed);
    } else if (line.startsWith('DAT ')) {
      const parsed = parseDAT(line);
      if (parsed?.type === 'GROUP') datGroups.set(parsed.playerNo, parsed.value);
    } else if (line.startsWith('XXR ')) {
      explicitRounds = parseInt(line.slice(4).trim(), 10) || explicitRounds;
    } else if (line.startsWith('XXS ')) {
      const parsed = parseXXS(line);
      if (parsed.W != null) scoring.win = parsed.W;
      if (parsed.D != null) scoring.draw = parsed.D;
      if (parsed.L != null) scoring.loss = parsed.L;
      if (parsed.PAB != null) {
        if (parsed.PAB === scoring.draw) pabValue = 'draw';
        else pabValue = 'win';
      }
    } else if (code === '132') {
      roundDateLine.push(...parse132(line));
    } else if (/^\d{3}/.test(code)) {
      const value = line.slice(4).trim();
      if (code === '012') meta.name = value;
      else if (code === '022') meta.site = value;
      else if (code === '032') meta.federation = value;
      else if (code === '042') meta.startDate = normalizeDate(value);
      else if (code === '052') meta.endDate = normalizeDate(value);
      else if (code === '062') meta.playerCount = parseInt(value, 10) || 0;
      else if (code === '072') meta.ratedCount = parseInt(value, 10) || 0;
      else if (code === '082') meta.teamCount = parseInt(value, 10) || 0;
      else if (code === '092') meta.typeText = value;
      else if (code === '142') explicitRounds = parseInt(value, 10) || explicitRounds;
      else if (code === '152') meta.initialColor = /^B/i.test(value) ? 'black' : 'white';
      else if (code === '162') apply162(value, scoring);
      else if (code === '362') apply362(value, matchScoring);
    }
  }

  const teamEvent = isTeamEvent(meta, oldTeams, newTeams, datGroups);
  const importedPlayers = players.map(p => toRosterPlayer(p));
  const rounds = explicitRounds || Math.max(
    ...players.map(p => p.cells.length),
    roundDateLine.length,
    0
  ) || 1;

  const tournament = baseTournament(meta, {
    type: teamEvent ? (isRoundRobin(meta.typeText) ? 'team-rr' : 'team-swiss') : (isRoundRobin(meta.typeText) ? 'roundrobin' : 'swiss'),
    rounds,
    scoring,
    pabValue
  });
  tournament.initialColor = meta.initialColor || 'white';
  tournament.matchScoring = matchScoring;

  if (teamEvent) {
    tournament.rosterPlayers = importedPlayers;
    applyTeamData(tournament, players, oldTeams, newTeams, datGroups, lineups, team801, team802, forfeits, roundDateLine, warnings);
  } else {
    tournament.players = importedPlayers;
    tournament.roundsData = buildIndividualRounds(players, rounds, roundDateLine, warnings);
  }

  tournament.currentRound = lastImportedRound(tournament.roundsData);
  if (tournament.roundsData.length > tournament.rounds) tournament.rounds = tournament.roundsData.length;

  return { tournament, warnings: unique(warnings) };
}

function baseTournament(meta, { type, rounds, scoring, pabValue }) {
  return {
    name: meta.name || 'Imported TRF tournament',
    site: meta.site || '',
    federation: meta.federation || '',
    organizer: '',
    startDate: meta.startDate || '',
    endDate: meta.endDate || '',
    type,
    rounds,
    doubleRR: false,
    rrMode: 'berger',
    koReplays: 1,
    koAdvancement: 'blackInLastGame',
    scoring,
    matchScoring: { win: 2, draw: 1, loss: 0 },
    pabValue,
    fideMode: true,
    tiebreakRules: 'fide2026',
    initialColor: 'white',
    acceleration: 'none',
    byeWeakest: false,
    clubProtection: false,
    defaultFed: meta.federation || '',
    tiebreaks: type.startsWith('team') ? ['MP', 'GP', 'EMMSB', 'EGGSB'] : ['BH', 'BHC1', 'SB', 'WINS'],
    ageGroups: [],
    players: [],
    rosterPlayers: [],
    teams: [],
    teamLineups: {},
    boardsPerMatch: 4,
    forbidden: [],
    roundsData: [],
    currentRound: 0,
    icon: type.startsWith('team') ? '👥' : '♟️'
  };
}

function splitRecords(text) {
  const codePattern = RECORD_CODES.join('|');
  const re = new RegExp(`(^|\\s)(${codePattern})(?=\\s)`, 'g');
  const out = [];
  for (const raw of String(text ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    if (line.trimStart().startsWith('###')) continue;
    const startCode = line.trimStart().slice(0, 3).toUpperCase();
    if (['001', '013', '300', '310', '330', '801', '802', 'DAT', 'XXR', 'XXS', 'XXC'].includes(startCode) || line.trimStart().startsWith('DAT ')) {
      out.push(line.trimStart());
      continue;
    }
    const starts = [];
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(line))) starts.push(m.index + (m[1] ? 1 : 0));
    if (starts.length <= 1) {
      out.push(line.trimStart());
      continue;
    }
    for (let i = 0; i < starts.length; i++) {
      const part = line.slice(starts[i], starts[i + 1]).trimEnd();
      if (part.trim()) out.push(part.trimStart());
    }
  }
  return out;
}

function parsePlayer(line, warnings) {
  const fixed = parseFixedPlayer(line);
  if (fixed) return fixed;
  return parseLoosePlayer(line, warnings);
}

function parseFixedPlayer(line) {
  const noField = line.slice(4, 8);
  if (!/^\s*\d{1,4}\s*$/.test(noField) || line.length < 84) return null;
  if (!/^\s*(?:[A-Z]{3})?\s*$/.test(line.slice(53, 56))) return null;
  const p = {
    no: parseInt(noField, 10),
    sex: line.slice(9, 10).trim(),
    title: line.slice(10, 13).trim(),
    name: line.slice(14, 47).trim(),
    rating: parseInt(line.slice(48, 52).trim(), 10) || 0,
    fed: line.slice(53, 56).trim(),
    fideId: stripLeadingZeros(line.slice(57, 68).trim()),
    birth: line.slice(69, 79).trim(),
    points: parseFloat(line.slice(80, 84).trim()) || 0,
    rank: parseInt(line.slice(85, 89).trim(), 10) || null,
    cells: []
  };
  for (let base = 91, round = 1; base < line.length; base += 10, round++) {
    const oppRaw = line.slice(base, base + 4);
    const colorRaw = line.slice(base + 5, base + 6);
    const resultRaw = line.slice(base + 7, base + 8);
    if (!(oppRaw + colorRaw + resultRaw).trim()) continue;
    p.cells.push({
      round,
      oppNo: parseInt(oppRaw.trim(), 10) || 0,
      color: normalizeColor(colorRaw),
      result: resultRaw.trim()
    });
  }
  return p;
}

function parseLoosePlayer(line) {
  const tokens = line.trim().split(/\s+/);
  const no = parseInt(tokens[1], 10);
  let i = 2;
  let sex = '';
  let title = '';
  if (/^[mw]$/i.test(tokens[i] ?? '')) sex = tokens[i++].toLowerCase();
  if (TITLE_CODES.has((tokens[i] ?? '').toUpperCase())) title = tokens[i++].toUpperCase();

  let ratingIdx = -1;
  for (let j = i; j < tokens.length - 1; j++) {
    if (/^\d{1,4}$/.test(tokens[j]) && /^[A-Z]{3}$/i.test(tokens[j + 1])) {
      ratingIdx = j;
      break;
    }
  }
  if (ratingIdx < 0) ratingIdx = Math.min(tokens.length, i + 1);

  const p = {
    no,
    sex,
    title,
    name: tokens.slice(i, ratingIdx).join(' ').trim() || `Player ${no}`,
    rating: parseInt(tokens[ratingIdx], 10) || 0,
    fed: tokens[ratingIdx + 1] || '',
    fideId: stripLeadingZeros(tokens[ratingIdx + 2] || ''),
    birth: tokens[ratingIdx + 3] || '',
    points: parseFloat(tokens[ratingIdx + 4]) || 0,
    rank: parseInt(tokens[ratingIdx + 5], 10) || null,
    cells: []
  };
  for (let j = ratingIdx + 6, round = 1; j < tokens.length; j += 3, round++) {
    const oppNo = parseInt(tokens[j], 10) || 0;
    const color = normalizeColor(tokens[j + 1]);
    const result = tokens[j + 2] || '';
    if (!tokens[j] && !tokens[j + 1] && !tokens[j + 2]) continue;
    p.cells.push({ round, oppNo, color, result });
  }
  return p;
}

function toRosterPlayer(p) {
  return {
    id: playerId(p.no),
    no: p.no,
    name: p.name || `Player ${p.no}`,
    rating: p.rating || 0,
    fideId: p.fideId || '',
    fed: p.fed || '',
    club: '',
    birthDate: normalizeDate(p.birth),
    byear: yearFromBirth(p.birth),
    sex: p.sex || '',
    title: p.title || '',
    group: '',
    type: '',
    active: true,
    withdrawn: false,
    excludedRounds: [],
    requestedByes: {},
    rankCorrection: 0,
    addedPoints: 0
  };
}

function buildIndividualRounds(players, rounds, roundDates, warnings) {
  const byNo = new Map(players.map(p => [p.no, p]));
  const roundsData = [];
  const seenPairs = new Set();
  const seenByes = new Set();

  for (let round = 1; round <= rounds; round++) {
    const rd = { round, date: roundDates[round - 1] || '', time: '', site: '', pairings: [], byes: [] };
    for (const p of players) {
      const cell = p.cells.find(c => c.round === round);
      if (!cell) continue;
      if (!cell.oppNo) {
        const type = byeType(cell.result);
        const key = `${round}:${p.no}`;
        if (type && !seenByes.has(key)) {
          rd.byes.push({ playerId: playerId(p.no), type });
          seenByes.add(key);
        }
        continue;
      }
      const opp = byNo.get(cell.oppNo);
      if (!opp) continue;
      const key = pairKey(round, p.no, opp.no);
      if (seenPairs.has(key)) continue;
      const whiteIsP = cell.color === 'w';
      const result = resultFromPerspective(cell.result, whiteIsP, warnings);
      rd.pairings.push({
        board: rd.pairings.length + 1,
        whiteId: playerId(whiteIsP ? p.no : opp.no),
        blackId: playerId(whiteIsP ? opp.no : p.no),
        result,
        manual: false
      });
      seenPairs.add(key);
    }
    if (rd.pairings.length || rd.byes.length || rd.date) roundsData.push(rd);
  }
  return roundsData;
}

function applyTeamData(t, players, oldTeams, newTeams, datGroups, lineups, team801, team802, forfeits, roundDates, warnings) {
  const rosterByNo = new Map(players.map(p => [p.no, toRosterPlayer(p)]));
  t.rosterPlayers = [...rosterByNo.values()];

  let teamDefs = [];
  if (newTeams.length) teamDefs = newTeams.map(tm => ({ no: tm.no, name: tm.name, memberNos: tm.memberNos }));
  else if (oldTeams.length) teamDefs = oldTeams.map((tm, i) => ({ no: i + 1, name: tm.name, memberNos: tm.memberNos }));
  else {
    const groups = new Map();
    for (const [pNo, group] of datGroups) {
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push(pNo);
    }
    teamDefs = [...groups].map(([name, memberNos], i) => ({ no: i + 1, name, memberNos }));
  }

  const rosterToTeam = new Map();
  t.players = teamDefs.map((tm, i) => ({
    id: teamId(tm.no || i + 1),
    no: tm.no || i + 1,
    name: tm.name || `Team ${tm.no || i + 1}`,
    rating: teamAverageRating(tm.memberNos, rosterByNo),
    fed: teamFederation(tm.memberNos, rosterByNo),
    captain: '',
    active: true,
    withdrawn: false,
    excludedRounds: [],
    requestedByes: {},
    rankCorrection: 0,
    addedPoints: 0
  }));
  t.teams = teamDefs.map((tm, i) => {
    const tid = teamId(tm.no || i + 1);
    const members = tm.memberNos.map((no, idx) => {
      rosterToTeam.set(no, tid);
      return { rosterId: playerId(no), board: idx + 1, reserve: false };
    });
    return { id: `team-${tm.no || i + 1}`, playerId: tid, name: tm.name || `Team ${tm.no || i + 1}`, members };
  });
  t.boardsPerMatch = Math.max(1, ...t.teams.map(tm => tm.members.length));
  t.teamLineups = lineups;

  // A 001 result matrix carries the authoritative board pairings. Some real
  // TRF26 writers also include compact 801 summaries whose variable-length
  // board groups are ambiguous without the surrounding implementation. Use
  // 801 only when there are no board pairings in 001 at all.
  const hasPlayerBoardCells = players.some(player => player.cells.some(cell => cell.oppNo));
  const from801 = hasPlayerBoardCells ? [] : buildRoundsFrom801(t, team801, roundDates, warnings);
  const from802 = buildRoundsFrom802(t, team802, forfeits, roundDates, warnings);
  const fromBoards = buildTeamRoundsFromPlayerCells(t, players, rosterToTeam, roundDates, warnings);
  t.roundsData = mergeTeamRounds(from802, mergeTeamRounds(from801, fromBoards, t.rounds), t.rounds);
  for (const f of forfeits) applyTeamForfeit(t, f);
}

function buildTeamRoundsFromPlayerCells(t, players, rosterToTeam, roundDates, warnings) {
  const byNo = new Map(players.map(p => [p.no, p]));
  const roundsData = [];
  const seenGames = new Set();

  for (let round = 1; round <= t.rounds; round++) {
    const groups = new Map();
    for (const p of players) {
      const cell = p.cells.find(c => c.round === round);
      if (!cell?.oppNo) continue;
      const opp = byNo.get(cell.oppNo);
      if (!opp) continue;
      const gameKey = pairKey(round, p.no, opp.no);
      if (seenGames.has(gameKey)) continue;
      seenGames.add(gameKey);
      const pTeam = rosterToTeam.get(p.no);
      const oppTeam = rosterToTeam.get(opp.no);
      if (!pTeam || !oppTeam || pTeam === oppTeam) continue;
      const whiteRosterNo = cell.color === 'w' ? p.no : opp.no;
      const blackRosterNo = cell.color === 'w' ? opp.no : p.no;
      const whiteTeam = rosterToTeam.get(whiteRosterNo);
      const blackTeam = rosterToTeam.get(blackRosterNo);
      const key = [pTeam, oppTeam].sort().join('|');
      if (!groups.has(key)) groups.set(key, {
        whiteId: whiteTeam,
        blackId: whiteTeam === pTeam ? oppTeam : pTeam,
        boards: []
      });
      const group = groups.get(key);
      group.boards.push({
        board: group.boards.length + 1,
        whiteRosterId: playerId(whiteRosterNo),
        blackRosterId: playerId(blackRosterNo),
        result: resultFromPerspective(cell.result, cell.color === 'w', warnings),
        rated: !/[WDL]/.test(cell.result)
      });
    }
    const rd = { round, date: roundDates[round - 1] || '', time: '', site: '', pairings: [], byes: [] };
    for (const group of groups.values()) {
      const pr = {
        board: rd.pairings.length + 1,
        whiteId: group.whiteId,
        blackId: group.blackId,
        result: '',
        manual: false,
        teamBoards: group.boards
      };
      recomputeImportedTeamMatch(t, pr);
      rd.pairings.push(pr);
    }
    if (rd.pairings.length || rd.date) roundsData.push(rd);
  }
  return roundsData;
}

function buildRoundsFrom802(t, team802, forfeits, roundDates, warnings) {
  const byRound = new Map();
  const partials = new Map();
  for (const line of team802) {
    warnings.push('Imported TRF26 802 match totals; board-by-board rows are preserved only when present elsewhere.');
    line.rounds.forEach((r, i) => {
      if (!r.oppNo) return;
      const round = i + 1;
      const whiteTeam = r.color === 'b' ? teamId(r.oppNo) : teamId(line.teamNo);
      const blackTeam = r.color === 'b' ? teamId(line.teamNo) : teamId(r.oppNo);
      const key = `${round}:${[line.teamNo, r.oppNo].sort((a, b) => a - b).join('|')}`;
      const p = partials.get(key) || { round, whiteId: whiteTeam, blackId: blackTeam, scores: new Map() };
      p.whiteId = whiteTeam;
      p.blackId = blackTeam;
      p.scores.set(teamId(line.teamNo), r.gamePoints);
      partials.set(key, p);
    });
  }
  for (const part of partials.values()) {
    const rd = ensureRoundMap(byRound, part.round, roundDates);
    const w = part.scores.get(part.whiteId) ?? 0;
    const b = part.scores.get(part.blackId) ?? 0;
    rd.pairings.push({
      board: rd.pairings.length + 1,
      whiteId: part.whiteId,
      blackId: part.blackId,
      result: w > b ? '1-0' : w < b ? '0-1' : '1/2-1/2',
      manual: false,
      matchScore: { w, b },
      teamBoards: []
    });
  }
  for (const f of forfeits) ensureRoundMap(byRound, f.round, roundDates);
  return [...byRound.values()].sort((a, b) => a.round - b.round);
}

function buildRoundsFrom801(t, team801, roundDates, warnings) {
  const partials = new Map();
  for (const line of team801) {
    warnings.push('Imported TRF26 801 board records.');
    for (let i = 0, round = 1; i < line.rounds.length; i++, round++) {
      const r = line.rounds[i];
      if (!r.oppNo) continue;
      const key = `${round}:${[line.teamNo, r.oppNo].sort((a, b) => a - b).join('|')}`;
      const part = partials.get(key) || { round, teams: [line.teamNo, r.oppNo], sides: new Map() };
      part.sides.set(teamId(line.teamNo), r);
      partials.set(key, part);
    }
  }

  const byRound = new Map();
  for (const part of partials.values()) {
    const teamA = teamId(part.teams[0]);
    const teamB = teamId(part.teams[1]);
    const sideA = part.sides.get(teamA);
    const sideB = part.sides.get(teamB);
    const whiteId = sideA?.color === 'w' ? teamA : sideB?.color === 'w' ? teamB : teamA;
    const blackId = whiteId === teamA ? teamB : teamA;
    const whiteSide = part.sides.get(whiteId);
    const blackSide = part.sides.get(blackId);
    const boards = [];
    const n = Math.max(whiteSide?.rosterNos.length ?? 0, blackSide?.rosterNos.length ?? 0, whiteSide?.results.length ?? 0, blackSide?.results.length ?? 0);
    for (let i = 0; i < n; i++) {
      const raw = whiteSide?.results[i] ?? blackSide?.results[i] ?? '';
      boards.push({
        board: i + 1,
        whiteRosterId: playerId(whiteSide?.rosterNos[i] || 0),
        blackRosterId: playerId(blackSide?.rosterNos[i] || 0),
        result: whiteSide ? resultFromPerspective(raw, true, warnings) : resultFromPerspective(raw, false, warnings),
        rated: true
      });
    }
    const rd = ensureRoundMap(byRound, part.round, roundDates);
    const pr = { board: rd.pairings.length + 1, whiteId, blackId, result: '', manual: false, teamBoards: boards };
    recomputeImportedTeamMatch(t, pr);
    rd.pairings.push(pr);
  }
  return [...byRound.values()].sort((a, b) => a.round - b.round);
}

function mergeTeamRounds(primary, fallback, rounds) {
  const byRound = new Map();
  for (const rd of fallback) byRound.set(rd.round, cloneRound(rd));
  for (const rd of primary) {
    const existing = byRound.get(rd.round) || { round: rd.round, date: rd.date || '', time: '', site: '', pairings: [], byes: [] };
    for (const pr of rd.pairings) {
      const key = [pr.whiteId, pr.blackId].sort().join('|');
      const old = existing.pairings.find(x => [x.whiteId, x.blackId].sort().join('|') === key);
      if (old) Object.assign(old, pr, { teamBoards: old.teamBoards?.length ? old.teamBoards : pr.teamBoards });
      else existing.pairings.push(pr);
    }
    byRound.set(rd.round, existing);
  }
  return [...byRound.values()]
    .filter(rd => rd.round <= rounds && (rd.pairings.length || rd.byes.length || rd.date))
    .sort((a, b) => a.round - b.round);
}

function applyTeamForfeit(t, f) {
  let rd = t.roundsData.find(x => x.round === f.round);
  if (!rd) {
    rd = { round: f.round, date: '', time: '', site: '', pairings: [], byes: [] };
    t.roundsData.push(rd);
    t.roundsData.sort((a, b) => a.round - b.round);
  }
  const result = f.type === '+-' ? '1F-0F' : f.type === '-+' ? '0F-1F' : '0F-0F';
  const existing = rd.pairings.find(pr => pr.whiteId === teamId(f.whiteNo) && pr.blackId === teamId(f.blackNo));
  if (existing) existing.result = result;
  else rd.pairings.push({ board: rd.pairings.length + 1, whiteId: teamId(f.whiteNo), blackId: teamId(f.blackNo), result, manual: false, teamBoards: [] });
}

function recomputeImportedTeamMatch(t, pr) {
  const rosterTeam = new Map();
  for (const tm of t.teams ?? []) for (const m of tm.members ?? []) rosterTeam.set(m.rosterId, tm.playerId);
  let w = 0, b = 0;
  for (const board of pr.teamBoards ?? []) {
    const spec = RESULTS[board.result];
    if (!spec) continue;
    const whiteSide = rosterTeam.get(board.whiteRosterId);
    const blackSide = rosterTeam.get(board.blackRosterId);
    const wp = pointsFor(spec.w, t.scoring);
    const bp = pointsFor(spec.b, t.scoring);
    if (whiteSide === pr.whiteId) w += wp; else b += wp;
    if (blackSide === pr.whiteId) w += bp; else b += bp;
  }
  pr.matchScore = { w, b };
  pr.result = w > b ? '1-0' : w < b ? '0-1' : '1/2-1/2';
}

function parse013(line) {
  const fixedName = line.slice(4, 36).trim();
  const fixedIds = [];
  for (let i = 36; i < line.length; i += 5) {
    const n = parseInt(line.slice(i, i + 4).trim(), 10);
    if (n) fixedIds.push(n);
  }
  if (fixedName && fixedIds.length) return { name: fixedName, memberNos: fixedIds };
  const tokens = line.trim().split(/\s+/);
  const ids = tokens.filter(t => /^\d{1,4}$/.test(t)).slice(1).map(n => parseInt(n, 10));
  return { name: tokens.slice(1, tokens.length - ids.length).join(' '), memberNos: ids };
}

function parse310(line) {
  // TRF26 310 is fixed-width. Ratings/strength factors are six columns wide,
  // not necessarily six digits, so token-searching for /^\d{6}$/ rejects the
  // normal values emitted by Sharly, chesspairing, and @echecs/trf.
  const no = parseInt(line.slice(4, 7).trim(), 10);
  if (!no) return null;
  const memberNos = [];
  for (let i = 72; i < line.length; i += 5) {
    const memberNo = parseInt(line.slice(i, i + 5).trim(), 10);
    if (memberNo) memberNos.push(memberNo);
  }
  return {
    no,
    name: line.slice(8, 40).trim() || `Team ${no}`,
    nickname: line.slice(41, 46).trim(),
    strength: parseInt(line.slice(47, 53).trim(), 10) || 0,
    matchPoints: parseFloat(line.slice(54, 60).trim()) || 0,
    gamePoints: parseFloat(line.slice(61, 67).trim()) || 0,
    rank: parseInt(line.slice(68, 71).trim(), 10) || null,
    memberNos
  };
}

function parse300(line) {
  const t = line.trim().split(/\s+/);
  if (t.length < 5) return null;
  return {
    round: parseInt(t[1], 10),
    teamNo: parseInt(t[2], 10),
    oppNo: parseInt(t[3], 10),
    rosterNos: t.slice(4).map(x => parseInt(x, 10)).filter(Boolean)
  };
}

function parse330(line) {
  const t = line.trim().split(/\s+/);
  if (t.length < 5) return null;
  return { type: t[1], round: parseInt(t[2], 10), whiteNo: parseInt(t[3], 10), blackNo: parseInt(t[4], 10) };
}

function parse802(line) {
  const t = line.trim().split(/\s+/);
  if (t.length < 8) return null;
  const rounds = [];
  for (let i = 5; i < t.length;) {
    // Normal rounds are "opponent colour game-points"; bye rounds are
    // "PAB|FPB|HPB|ZPB game-points" and therefore consume only two tokens.
    // Treating every round as three tokens shifts every later round in real
    // team files after their first bye.
    if (/^[PFHZ]PB$/i.test(t[i])) {
      rounds.push({ oppNo: 0, color: '', gamePoints: parseFloat(t[i + 1]) || 0, bye: t[i].toUpperCase() });
      i += 2;
    } else {
      rounds.push({ oppNo: parseInt(t[i], 10) || 0, color: normalizeColor(t[i + 1]), gamePoints: parseFloat(t[i + 2]) || 0 });
      i += 3;
    }
  }
  return { teamNo: parseInt(t[1], 10), nickname: t[2], matchPoints: parseFloat(t[3]) || 0, gamePoints: parseFloat(t[4]) || 0, rounds };
}

function parse801(line) {
  const t = line.trim().split(/\s+/);
  if (t.length < 8) return null;
  const boardCount = Math.max(1, Math.floor((t.length - 8) || 1));
  const rounds = [];
  for (let i = 5; i < t.length;) {
    const oppNo = parseInt(t[i], 10) || 0;
    const color = normalizeColor(t[i + 1]);
    const results = parseBoardResults(t[i + 2]);
    const count = results.length || boardCount;
    const rosterNos = t.slice(i + 3, i + 3 + count).map(x => parseInt(x, 10)).filter(Boolean);
    rounds.push({ oppNo, color, results, rosterNos });
    i += 3 + count;
  }
  return { teamNo: parseInt(t[1], 10), nickname: t[2], matchPoints: parseFloat(t[3]) || 0, gamePoints: parseFloat(t[4]) || 0, rounds };
}

function parseBoardResults(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return [];
  if (s.includes(',')) return s.split(',').map(x => x.trim()).filter(Boolean);
  return [...s].filter(c => c.trim());
}

function parseDAT(line) {
  const m = /^DAT\s+(\d+)\s+(\S+)\s+(.+)$/i.exec(line.trim());
  if (!m) return null;
  return { playerNo: parseInt(m[1], 10), type: m[2].toUpperCase(), value: m[3].trim() };
}

function parseXXS(line) {
  const out = {};
  const re = /([A-Z]+)=(-?\d+(?:\.\d+)?|\.\d+)/gi;
  let m;
  while ((m = re.exec(line))) out[m[1].toUpperCase()] = parseFloat(m[2]);
  return out;
}

function parse132(line) {
  const dates = [];
  for (let base = 91; base < line.length; base += 10) {
    const raw = line.slice(base, base + 8).trim();
    if (raw) dates.push(normalizeDate(raw));
  }
  if (dates.length) return dates;
  return line.slice(4).trim().split(/\s+/).map(normalizeDate).filter(Boolean);
}

function apply162(value, scoring) {
  const parsed = parsePointSystem(value);
  if (parsed.W != null) scoring.win = parsed.W;
  if (parsed.D != null) scoring.draw = parsed.D;
  if (parsed.L != null) scoring.loss = parsed.L;
}

function apply362(value, scoring) {
  const parsed = parsePointSystem(value);
  if (parsed.TW != null) scoring.win = parsed.TW;
  if (parsed.TD != null) scoring.draw = parsed.TD;
  if (parsed.TL != null) scoring.loss = parsed.TL;
}

function parsePointSystem(value) {
  const out = parseXXS(String(value));
  const re = /\b(T?[WDL])\s+(-?\d+(?:\.\d+)?|\.\d+)/gi;
  let match;
  while ((match = re.exec(String(value)))) out[match[1].toUpperCase()] = parseFloat(match[2]);
  return out;
}

function resultFromPerspective(raw, playerIsWhite, warnings) {
  const c = String(raw ?? '').trim();
  if (/[WDL]/.test(c)) warnings.push('Unrated TRF result codes W/D/L were imported as normal game scores; unrated status is not displayed.');
  switch (c) {
    case '1': case 'W': case 'w': case '+':
      return c === '+' ? (playerIsWhite ? '1F-0F' : '0F-1F') : (playerIsWhite ? '1-0' : '0-1');
    case '=': case 'D': case 'd':
      return '1/2-1/2';
    case '0': case 'L': case 'l': case '-':
      return c === '-' ? (playerIsWhite ? '0F-1F' : '1F-0F') : (playerIsWhite ? '0-1' : '1-0');
    default:
      return '';
  }
}

function byeType(raw) {
  switch (String(raw ?? '').trim().toUpperCase()) {
    case 'H': return 'HPB';
    case 'F': return 'FPB';
    case 'U': return 'PAB';
    case 'Z': case '': return 'ZPB';
    default: return null;
  }
}

function normalizeDate(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  const m = /^(\d{2,4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(s);
  if (!m) return s;
  const y = m[1].length === 2 ? 2000 + parseInt(m[1], 10) : parseInt(m[1], 10);
  return `${String(y).padStart(4, '0')}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
}

function isTeamEvent(meta, oldTeams, newTeams, datGroups) {
  return (meta.teamCount ?? 0) > 0 ||
    /team/i.test(meta.typeText || '') ||
    oldTeams.length > 0 ||
    newTeams.length > 0 ||
    ((meta.teamCount ?? 0) > 0 && datGroups.size > 0);
}

function isRoundRobin(typeText = '') {
  return /round.?robin/i.test(typeText);
}

function lastImportedRound(roundsData) {
  let last = 0;
  for (let i = 0; i < roundsData.length; i++) {
    const rd = roundsData[i];
    if (rd?.pairings?.length || rd?.byes?.length) last = Math.max(last, rd.round ?? i + 1);
  }
  return last;
}

function ensureRoundMap(map, round, roundDates) {
  if (!map.has(round)) map.set(round, { round, date: roundDates[round - 1] || '', time: '', site: '', pairings: [], byes: [] });
  return map.get(round);
}

function cloneRound(rd) {
  return {
    ...rd,
    pairings: rd.pairings.map(pr => ({ ...pr, matchScore: pr.matchScore ? { ...pr.matchScore } : pr.matchScore, teamBoards: (pr.teamBoards ?? []).map(b => ({ ...b })) })),
    byes: (rd.byes ?? []).map(b => ({ ...b }))
  };
}

function teamAverageRating(ids, rosterByNo) {
  const ratings = ids.map(id => rosterByNo.get(id)?.rating || 0).filter(Boolean);
  return ratings.length ? Math.round(ratings.reduce((a, b) => a + b, 0) / ratings.length) : 0;
}

function teamFederation(ids, rosterByNo) {
  return rosterByNo.get(ids[0])?.fed || '';
}

function pointsFor(outcome, scoring) {
  return outcome === 'win' ? scoring.win : outcome === 'draw' ? scoring.draw : scoring.loss;
}

function pairKey(round, a, b) {
  return `${round}:${Math.min(a, b)}:${Math.max(a, b)}`;
}

function playerId(no) {
  return `P${parseInt(no, 10)}`;
}

function teamId(no) {
  return `T${parseInt(no, 10)}`;
}

function normalizeColor(c) {
  c = String(c ?? '').trim().toLowerCase();
  return c === 'w' || c === 'b' ? c : '-';
}

function stripLeadingZeros(s) {
  return String(s ?? '').trim().replace(/^0+(?=\d)/, '');
}

function yearFromBirth(birth) {
  const m = /^(\d{4})/.exec(String(birth ?? ''));
  return m ? m[1] : '';
}

function unique(values) {
  return [...new Set(values)];
}
