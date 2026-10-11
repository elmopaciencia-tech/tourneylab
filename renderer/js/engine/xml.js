// TourneyLab XML interop (MIT).
//
// Mirrors the public Swiss-Manager XML import/export schema (the closest thing
// Swiss-Manager has to a machine-readable API): players, teams, team
// compositions, and player results. Entities may be referenced by unique id,
// ident number, or starting-rank number. Result codes include the standard and
// forfeit forms, with a separate ResRtg field for rating calculation.
//
// This is a self-contained, browser-safe implementation (no DOMParser
// dependency for import so it also runs under Node for tests): export builds a
// string; import uses a small tolerant tag scanner sufficient for the schema we
// emit and for typical Swiss-Manager exchange files.

import { RESULTS } from './state.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

// Map an internal result code (white/black) to Swiss-Manager XML result codes,
// from White's perspective: '1-0', '1/2', '0-1', '1-0F', '0-1F', '0-0F'.
function xmlResult(code) {
  switch (code) {
    case '1-0': return '1-0';
    case '0-1': return '0-1';
    case '1/2-1/2': return '1/2';
    case '1F-0F': return '1-0F';
    case '0F-1F': return '0-1F';
    case '0F-0F': return '0-0F';
    case 'ADJ': return '1/2';
    default: return '';
  }
}
function fromXmlResult(x) {
  switch ((x || '').trim()) {
    case '1-0': return '1-0';
    case '0-1': return '0-1';
    case '1/2': case '0.5': case '½': return '1/2-1/2';
    case '1-0F': return '1F-0F';
    case '0-1F': return '0F-1F';
    case '0-0F': return '0F-0F';
    default: return '';
  }
}

export function exportXML(t) {
  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(`<SwissManagerTournament name="${esc(t.name)}" type="${esc(t.type)}" rounds="${t.rounds}">`);

  // Players
  lines.push('  <Players>');
  for (const p of t.players) {
    lines.push(
      `    <Player PlayerUniqueId="${esc(p.id)}" SNo="${p.no}"` +
      ` Surname="${esc(surname(p.name))}" FirstName="${esc(firstName(p.name))}"` +
      ` Rtg="${p.rating ?? ''}" FideId="${esc(p.fideId ?? '')}"` +
      ` Fed="${esc(p.fed ?? '')}" CNo="${esc(p.club ?? '')}"` +
      ` BirthYear="${esc(p.byear ?? '')}" Sex="${esc(p.sex ?? '')}" Title="${esc(p.title ?? '')}"/>`
    );
  }
  lines.push('  </Players>');

  // Teams + compositions, when present
  const teams = t.teams ?? [];
  if (teams.length) {
    lines.push('  <Teams>');
    for (const tm of teams) {
      lines.push(`    <Team TeamUniqueId="${esc(tm.id)}" PlayerUniqueId="${esc(tm.playerId ?? '')}" Name="${esc(tm.name)}" Captain="${esc(tm.captain ?? '')}">`);
      for (const m of tm.members ?? []) {
        lines.push(`      <TeamMember PlayerUniqueId="${esc(m.rosterId ?? m.playerId)}" Board="${m.board}" Reserve="${m.reserve ? 1 : 0}"/>`);
      }
      lines.push('    </Team>');
    }
    lines.push('  </Teams>');
  }

  // Results: one <Round> per round, each pairing carries Res and ResRtg.
  lines.push('  <Results>');
  t.roundsData.forEach((rd, ri) => {
    lines.push(`    <Round No="${ri + 1}" Date="${esc(rd.date ?? '')}">`);
    for (const pr of rd.pairings) {
      const res = xmlResult(pr.result);
      const spec = RESULTS[pr.result];
      // ResRtg: only games explicitly rated and actually played over the board.
      const resRtg = spec && spec.played && pr.rated !== false ? res : '';
      lines.push(
        `      <Pairing Board="${pr.board}" White="${esc(pr.whiteId)}" Black="${esc(pr.blackId)}"` +
        ` Res="${esc(res)}" ResRtg="${esc(resRtg)}"${pr.manual ? ' Manual="1"' : ''}/>`
      );
    }
    for (const b of rd.byes ?? []) {
      lines.push(`      <Bye Player="${esc(b.playerId)}" Type="${esc(b.type)}"/>`);
    }
    lines.push('    </Round>');
  });
  lines.push('  </Results>');
  if (['team-swiss','team-rr'].includes(t.type)) {
    const fields=['type','players','rosterPlayers','teams','roundsData','currentRound','boardsPerMatch','teamBoardOrderCheck','teamByeMatchScore','teamPolicy','boardAwardManual','tiebreaks','tiebreakConfig','scoring','matchScoring'];
    lines.push(`  <TourneyLabTeamData>${esc(JSON.stringify(Object.fromEntries(fields.map(key=>[key,t[key]]))))}</TourneyLabTeamData>`);
  }
  lines.push('</SwissManagerTournament>');
  return lines.join('\n') + '\n';
}

// ---- tolerant import ------------------------------------------------------

function attrs(tag) {
  const out = {};
  const re = /([A-Za-z_][\w]*)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(tag))) out[m[1]] = decodeEntities(m[2]);
  return out;
}
function decodeEntities(s) {
  return String(s).replace(/&(amp|lt|gt|quot|apos);/g, (_, e) =>
    ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e]));
}

// Returns a partial tournament object: { name, type, rounds, players[], teams[],
// roundsData[] }. The caller merges these into a store tournament. Players are
// matched by PlayerUniqueId, then ID/SNo as a fallback.
export function importXML(xml) {
  const result = { players: [], teams: [], roundsData: [] };
  const root = /<SwissManagerTournament\b([^>]*)>/i.exec(xml);
  if (root) {
    const a = attrs(root[1]);
    if (a.name) result.name = a.name;
    if (a.type) result.type = a.type;
    if (a.rounds) result.rounds = +a.rounds;
  }

  // players
  const pRe = /<Player\b([^>]*)\/?>/gi; let m;
  while ((m = pRe.exec(xml))) {
    const a = attrs(m[1]);
    const name = [a.FirstName, a.Surname].filter(Boolean).join(' ').trim() || a.Name || '';
    result.players.push({
      id: a.PlayerUniqueId || a.ID || ('sno-' + a.SNo),
      no: a.SNo ? +a.SNo : undefined,
      name,
      rating: a.Rtg ? +a.Rtg : (a.Rating ? +a.Rating : null),
      fideId: a.FideId || a['FIDE-No'] || '',
      fed: a.Fed || '',
      club: a.CNo || a.Club || '',
      byear: a.BirthYear || '',
      sex: a.Sex || '',
      title: a.Title || ''
    });
  }

  // teams
  const tRe = /<Team\b([^>]*)>([\s\S]*?)<\/Team>/gi;
  while ((m = tRe.exec(xml))) {
    const a = attrs(m[1]);
    const members = [];
    const mRe = /<TeamMember\b([^>]*)\/?>/gi; let mm;
    while ((mm = mRe.exec(m[2]))) {
      const ma = attrs(mm[1]);
      members.push({ rosterId: ma.PlayerUniqueId || ma.ID, playerId: ma.PlayerUniqueId || ma.ID, board: +ma.Board || 0, reserve: ma.Reserve === '1' });
    }
    result.teams.push({ id: a.TeamUniqueId || a.ID, playerId: a.PlayerUniqueId || a.TeamUniqueId || a.ID, name: a.Name || '', captain: a.Captain || '', members });
  }

  // rounds + pairings + byes
  const rRe = /<Round\b([^>]*)>([\s\S]*?)<\/Round>/gi;
  while ((m = rRe.exec(xml))) {
    const a = attrs(m[1]);
    const round = { round: +a.No || result.roundsData.length + 1, date: a.Date || '', pairings: [], byes: [] };
    const prRe = /<Pairing\b([^>]*)\/?>/gi; let pp;
    while ((pp = prRe.exec(m[2]))) {
      const pa = attrs(pp[1]);
      const hasResRtg = Object.hasOwn(pa, 'ResRtg');
      round.pairings.push({
        board: +pa.Board || round.pairings.length + 1,
        whiteId: pa.White, blackId: pa.Black,
        result: fromXmlResult(pa.Res),
        manual: pa.Manual === '1',
        rated: hasResRtg ? !!fromXmlResult(pa.ResRtg) : undefined
      });
    }
    const bRe = /<Bye\b([^>]*)\/?>/gi; let bb;
    while ((bb = bRe.exec(m[2]))) {
      const ba = attrs(bb[1]);
      round.byes.push({ playerId: ba.Player, type: ba.Type || 'PAB' });
    }
    result.roundsData.push(round);
  }
  const extension=xml.match(/<TourneyLabTeamData>([\s\S]*?)<\/TourneyLabTeamData>/);
  if(extension){const data=JSON.parse(decodeEntities(extension[1]));for(const key of ['type','players','rosterPlayers','teams','roundsData','currentRound','boardsPerMatch','teamBoardOrderCheck','teamByeMatchScore','teamPolicy','boardAwardManual','tiebreaks','tiebreakConfig','scoring','matchScoring'])if(Object.hasOwn(data,key))result[key]=data[key];}
  return result;
}

function surname(full) {
  const parts = String(full || '').trim().split(/\s+/);
  return parts.length > 1 ? parts[parts.length - 1] : full;
}
function firstName(full) {
  const parts = String(full || '').trim().split(/\s+/);
  return parts.length > 1 ? parts.slice(0, -1).join(' ') : '';
}
