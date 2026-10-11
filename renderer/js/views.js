import { TeamReports, teamPolicyEditor, officialFields, attachmentFields } from './team-report-ui.js';
import { isTeamEvent, seedBoards, teamRating } from './engine/team.js';
import { openBoards, teamScoreControl, rosterOverview, openRoster, TeamsPage } from './team-ui.js';
// TourneyLab views (MIT)
import { store } from './store.js';
import { h, icon, iconLabel, toast, modal, confirmModal, go, render } from './app.js';
import { checkManualPair, suggestPairColours } from './engine/dutch.js';
import { pairSection, pairSectionRemainder } from './engine/pairing.js';
import { bergerSchedule, simultaneousSchedule, rutschSchedule, scheveningenSchedule } from './engine/roundrobin.js';
import { computeStandings, TIEBREAKS } from './engine/tiebreaks.js';
import {
  computeStates, pairingChecklist, roundReadiness, pairablePlayers,
  RESULTS, RESULT_KEYS, resultLabel, byeLabel, byePoints
} from './engine/state.js';
import { calculateRatingProjectionAfterRound } from './engine/ratingProjection.js';
import { pairingListHTML, pairingCardsHTML, teamMatchCardsHTML, standingsHTML, standingsCSV, tournamentReportHTML, eventReportBundle, publicationFingerprint, tournamentPGN, ratingAdminTRF } from './export.js';
import { exportXML, importXML } from './engine/xml.js';
import { importTRF } from './engine/trf.js';
import { exportOriginalTunx, exportTunx, hasOriginalTunx, parseTunx } from './engine/tunx.js';
import { koFirstRound, koPairRound, koMiniMatchWinner, koRounds } from './engine/knockout.js';
import {
  createId, normalizeAgeScheme, normalizeRatingProjection, normalizeRoundSchedule, normalizeTiebreakConfig,
  normalizeOrganizerProfile, profileForSection, registrationSectionLabels, sectionDisplayName,
  tournamentReadinessSummary, TOURNAMENT_SETUP_FIELDS
} from './setup/defaults.js';
import { applyRatingPolicy } from './setup/ratingPolicy.js';
import { canEditSetupField, setupStatus } from './setup/validation.js';
import { EVENT_TYPES, RATING_SOURCES, RATING_TYPES, TIEBREAK_PRESETS, presetForType } from './setup/presets.js';
import { eventWorkflowSummary, sectionWorkflowSummary, setupWarningAction } from './setup/workflow.js';

export const EVENT_VIEWS = [
  { id: 'event-overview', icon: '📄', label: 'Overview' },
  { id: 'registrations', icon: '👥', label: 'Registrations' },
  { id: 'event-sections', icon: '🗂️', label: 'Sections' },
  { id: 'event-setup', icon: '⚙️', label: 'Setup' },
  { id: 'event-export', icon: '📤', label: 'Export & publish' }
];

export const VIEWS = [
  { id: 'overview',  icon: '📄', label: 'Overview' },
  { id: 'players',   icon: '👥', label: 'Players' },
  { id: 'rounds',    icon: '🔀', label: 'Rounds & results' },
  { id: 'team-reports', icon: '📋', label: 'Team reports', teamOnly: true },
  { id: 'standings', icon: '🏆', label: 'Standings' },
  { id: 'setup',     icon: '⚙️', label: 'Setup' },
  { id: 'export',    icon: '📤', label: 'Reports & export' }
];

export function renderView(view) {
  const t = store.active;
  const event = store.activeEvent;
  switch (view) {
    case 'home': return Home();
    case 'archives': return ArchivedTournaments();
    case 'settings': return WorkspaceSettings();
    case 'event-dashboard':
    case 'event-overview': return EventOverview(event);
    case 'registrations': return Registrations(event);
    case 'event-sections': return EventSections(event);
    case 'event-setup': return EventSetup(event);
    case 'event-export': return EventExport(event);
  }
  if (!t) return event ? EventOverview(event) : Home();
  switch (view) {
    case 'setup-wizard': return SetupWizard(t);
    case 'overview': return Overview(t);
    case 'players': return Players(t);
    case 'rounds': return Rounds(t);
    case 'team-reports': return isTeam(t) ? TeamReports(t) : Standings(t);
    case 'standings': return isTeam(t) ? TeamReports(t) : Standings(t);
    case 'settings':
    case 'setup': return Setup(t);
    case 'export': return SectionExportPage(t);
    default: return Home();
  }
}

const page = (...kids) => h('div', { class: 'page-inner' }, ...kids);
const isTeam = t => t.type === 'team-swiss' || t.type === 'team-rr';
const unit = t => isTeam(t) ? 'team' : 'player';
const playerName = (t, id) => t.players.find(p => p.id === id)?.name || '—';
const fmt = n => Number.isInteger(n) ? String(n) : String(+n.toFixed(1)).replace('.5', '½').replace('0½', '½');
let workspaceProfileId = '';

function commit() { const t=store.active; if(isTeamEvent(t)) for(const rd of t.roundsData) for(const m of rd.pairings) if(!m.result && !m.teamBoards?.length) Object.assign(m,{teamBoards:seedBoards(t,m),boardDataVersion:1,boardStatus:'draft',boardOneColor:'W',matchScore:{w:0,b:0}}); store.emit(); render(); }

// =================================================================== HOME
function Home() {
  const activeEvents = (store.data.events ?? []).filter(event => !event.archived);
  return page(
    h('div', { class: 'page-icon home-brand-logo' },
      h('img', { src: '../icons/tourneylab-logo.svg', alt: '' })),
    h('h1', { class: 'page-title home-brand-wordmark', 'aria-label': 'TourneyLab' },
      h('img', { src: '../icons/tourneylab-wordmark.svg', alt: '' })),
    h('p', { class: 'page-sub' }, 'Run Swiss and round-robin chess tournaments with FIDE Dutch pairings.'),
    h('div', { class: 'toolbar' },
      h('button', { class: 'btn primary', onclick: () => { store.newEvent(); setupWizardStep = 0; go('setup-wizard'); } }, iconLabel('＋', 'New tournament')),
      h('button', { class: 'btn', onclick: openTournamentFile }, iconLabel('📂', 'Open .tlab file…')),
      h('button', { class: 'btn', onclick: importTRFFile }, iconLabel('📥', 'Import TRF…')),
      h('button', { class: 'btn', onclick: importTunxFile }, iconLabel('📥', 'Import Swiss-Manager .TUNx…'))
    ),
    activeEvents.length
      ? h('table', { class: 'db' },
          h('tr', {}, h('th', {}, 'Tournament'), h('th', {}, 'Sections'), h('th', {}, 'Progress'), h('th', {}, 'Registrations')),
          activeEvents.map(event => {
            const sections = store.childrenForEvent(event.id);
            const paired = sections.filter(section => section.currentRound > 0).length;
            return h('tr', { style: 'cursor:pointer', role: 'link', tabindex: '0', onclick: () => {
              store.data.activeEventId = event.id;
              store.data.activeId = sections[0]?.id ?? null;
              go('event-overview');
            }, onkeydown: e => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              e.preventDefault();
              store.data.activeEventId = event.id;
              store.data.activeId = sections[0]?.id ?? null;
              go('event-overview');
            } },
              h('td', {}, iconLabel(event.icon ?? '♟️', event.name || 'Untitled tournament')),
              h('td', { class: 'num' }, String(sections.length)),
              h('td', {}, paired ? `${paired} of ${sections.length} started` : 'Not started'),
              h('td', { class: 'num' }, String(event.registrations?.filter(registration => !registration.archived).length ?? 0)));
          }))
      : h('div', { class: 'empty' }, store.data.events?.some(event => event.archived)
          ? 'No active tournaments. Restore one from Archived tournaments or create a new tournament.'
          : 'No tournaments yet. Create one to get started.'),
    h('h2', { class: 'sec' }, 'Typical workflow'),
    h('ol', { class: 'muted' },
      h('li', {}, 'Create a tournament and configure its first section.'),
      h('li', {}, 'Enter tournament and section data: dates, rounds, tie-breaks and scoring.'),
      h('li', {}, 'Import or enter players, then check pairing numbers.'),
      h('li', {}, 'Pair round 1, adjust manually if needed, publish pairings.'),
      h('li', {}, 'Enter results (keys 1–7), pair the next round, repeat.'),
      h('li', {}, 'Export final standings, rating files and PGN.'))
  );
}

function ArchivedTournaments() {
  const archivedEvents = (store.data.events ?? []).filter(event => event.archived);
  const openTournament = event => {
    const sections = store.childrenForEvent(event.id);
    store.data.activeEventId = event.id;
    store.data.activeId = sections[0]?.id ?? null;
    go('event-overview');
  };

  return page(h('div', { class: 'archived-tournaments-page' },
    h('div', { class: 'page-icon' }, icon('archive')),
    h('h1', { class: 'page-title' }, 'Archived tournaments'),
    h('p', { class: 'page-sub' }, 'Archived tournaments stay intact and can be opened, restored, or permanently deleted.'),
    archivedEvents.length
      ? h('table', { class: 'db archived-tournaments-table' },
          h('tr', {},
            h('th', {}, 'Tournament'),
            h('th', {}, 'Sections'),
            h('th', {}, 'Progress'),
            h('th', {}, 'Registrations'),
            h('th', { class: 'archive-actions-cell' }, 'Actions')),
          archivedEvents.map(event => {
            const sections = store.childrenForEvent(event.id);
            const paired = sections.filter(section => section.currentRound > 0).length;
            return h('tr', {
              style: 'cursor:pointer',
              role: 'link',
              tabindex: '0',
              onclick: () => openTournament(event),
              onkeydown: e => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                e.preventDefault();
                openTournament(event);
              }
            },
            h('td', {}, iconLabel(event.icon ?? '♟️', event.name || 'Untitled tournament')),
            h('td', { class: 'num' }, String(sections.length)),
            h('td', {}, paired ? `${paired} of ${sections.length} started` : 'Not started'),
            h('td', { class: 'num' }, String(event.registrations?.filter(registration => !registration.archived).length ?? 0)),
            h('td', { class: 'archive-actions-cell' }, h('div', { class: 'archive-actions' },
              h('button', {
                class: 'btn',
                'aria-label': `Restore ${event.name || 'Untitled tournament'}`,
                onclick: e => { e.stopPropagation(); store.restoreEvent(event.id); render(); }
              }, iconLabel('🔁', 'Restore')),
              h('button', {
                class: 'btn danger',
                'aria-label': `Delete ${event.name || 'Untitled tournament'} permanently`,
                onclick: e => {
                  e.stopPropagation();
                  confirmModal(
                    'Delete tournament',
                    `Delete “${event.name}” and all of its sections permanently? Saved .tlab files are not affected.`,
                    () => { store.deleteEvent(event.id); render(); },
                    'Delete permanently'
                  );
                }
              }, iconLabel('✕', 'Delete permanently'))
            )));
          }))
      : h('div', { class: 'empty' }, 'No archived tournaments.')
  ));
}

function WorkspaceSettings() {
  const settings = store.data.settings ??= {};
  settings.organizerProfiles ??= [];
  if (!settings.organizerProfiles.some(profile => profile.id === workspaceProfileId)) {
    workspaceProfileId = settings.activeOrganizerProfileId || settings.organizerProfiles[0]?.id || '';
  }
  const profile = settings.organizerProfiles.find(item => item.id === workspaceProfileId) ?? null;
  const createProfile = () => {
    const created = normalizeOrganizerProfile({
      id: createId('OP'),
      name: `Organizer profile ${settings.organizerProfiles.length + 1}`,
      federation: settings.defaultFederation ?? '',
      defaultFed: settings.defaultFederation ?? '',
      defaultRatingType: settings.defaultRatingType ?? 'standard',
      defaultRatingSource: settings.defaultRatingSource ?? 'rating'
    });
    settings.organizerProfiles.push(created);
    settings.activeOrganizerProfileId ||= created.id;
    workspaceProfileId = created.id;
    store.emit();
    render();
  };

  return page(h('div', { class: 'workspace-settings-page' },
    h('div', { class: 'page-icon' }, icon('⚙️')),
    h('h1', { class: 'page-title' }, 'Settings'),
    h('p', { class: 'page-sub' }, 'Local organizer profiles and workspace preferences. Profiles will be ready to move into account settings when sign-in is added.'),
    h('div', { class: 'settings-profile-layout' },
      h('aside', { class: 'settings-profile-list', 'aria-label': 'Organizer profiles' },
        h('b', { class: 'settings-profile-list-label' }, 'Organizer profiles'),
        settings.organizerProfiles.length
          ? h('div', { class: 'settings-profile-tabs' }, settings.organizerProfiles.map(item => h('button', {
            class: `settings-profile-row${item.id === workspaceProfileId ? ' active' : ''}`,
            'aria-current': item.id === workspaceProfileId ? 'true' : null,
            onclick: () => { workspaceProfileId = item.id; render(); }
          }, h('span', {}, item.name), item.id === settings.activeOrganizerProfileId ? h('span', { class: 'pill blue' }, 'Default') : null)))
          : h('div', { class: 'empty settings-profile-empty' }, 'Create a profile to reuse organizer details in new tournaments.'),
        h('button', { class: 'btn ghost settings-profile-new', onclick: createProfile }, '＋ New')),
      profile ? organizerProfileEditor(settings, profile) : h('section', { class: 'settings-profile-editor empty' },
        h('p', {}, 'No organizer profile yet.'),
        h('button', { class: 'btn primary', onclick: createProfile }, 'Create organizer profile'))),
    h('section', { class: 'setup-section settings-safety-section' },
      setupHeading('Data safety', 'Workspace-wide persistence options.'),
      h('div', { class: 'setup-grid' },
        setupField('Backup generations', h('input', {
          type: 'number', min: 0, max: 9, value: settings.backupGenerations ?? 3,
          onchange: changeEvent => { settings.backupGenerations = Math.max(0, Math.min(9, Number(changeEvent.target.value) || 0)); store.emit(); }
        }), 'Used when saving .tlab files.')))
  ));
}

function organizerProfileEditor(settings, profile) {
  const name = h('input', { type: 'text', value: profile.name });
  const organizer = h('input', { type: 'text', value: profile.organizer });
  const federation = h('input', { type: 'text', value: profile.federation, maxlength: 3, placeholder: 'e.g. SGP' });
  const defaultFed = h('input', { type: 'text', value: profile.defaultFed, maxlength: 3, placeholder: 'Applied to new registrations' });
  const site = h('input', { type: 'text', value: profile.site, placeholder: 'City or regular venue' });
  const chiefArbiter = h('input', { type: 'text', value: profile.chiefArbiter });
  const deputyArbiters = h('input', { type: 'text', value: profile.deputyArbiters });
  const arbiterEmail = h('input', { type: 'email', value: profile.arbiterEmail });
  const ratingType = setupSelect(profile.defaultRatingType, RATING_TYPES, () => {});
  const ratingSource = setupSelect(profile.defaultRatingSource, RATING_SOURCES, () => {});
  const reportOption = (key, label) => h('label', { class: 'settings-report-option' },
    h('input', { type: 'checkbox', checked: profile.listOptions?.[key] !== false, dataset: { option: key } }),
    h('span', {}, label));
  return h('section', { class: 'settings-profile-editor' },
    h('div', { class: 'settings-profile-editor-head' },
      h('div', {}, h('h2', {}, profile.name), h('p', { class: 'muted small' }, 'Applied automatically when a new tournament is created.')),
      h('button', {
        class: 'btn danger',
        onclick: () => confirmModal('Delete organizer profile', `Delete “${profile.name}”? Existing tournaments are unaffected.`, () => {
          settings.organizerProfiles = settings.organizerProfiles.filter(item => item.id !== profile.id);
          if (settings.activeOrganizerProfileId === profile.id) settings.activeOrganizerProfileId = settings.organizerProfiles[0]?.id ?? '';
          workspaceProfileId = settings.activeOrganizerProfileId;
          store.emit();
          render();
        })
      }, 'Delete')),
    h('div', { class: 'setup-section' },
      setupHeading('Identity', 'Stable organizer and arbiter details.'),
      h('div', { class: 'setup-grid' },
        setupField('Profile name', name), setupField('Organizer', organizer),
        setupField('Tournament federation', federation), setupField('Default player federation', defaultFed),
        setupField('Default city / venue', site), setupField('Chief arbiter', chiefArbiter),
        setupField('Deputy arbiters', deputyArbiters), setupField('Arbiter email', arbiterEmail))),
    h('div', { class: 'setup-section' },
      setupHeading('Tournament preferences', 'Defaults only; every tournament remains editable.'),
      h('div', { class: 'setup-grid' },
        setupField('Rating type', ratingType), setupField('Primary rating source', ratingSource))),
    h('div', { class: 'setup-section settings-report-columns' },
      setupHeading('Report columns', 'Select the player details to include in reports.'),
      h('div', { class: 'settings-report-options' },
        reportOption('showFideId', 'FIDE ID'), reportOption('showFederation', 'Federation'),
        reportOption('showClub', 'Club'), reportOption('showBirthYear', 'Birth year'), reportOption('showTitles', 'Titles'))),
    h('div', { class: 'setup-footer settings-profile-actions' },
      h('button', {
        class: 'btn', disabled: settings.activeOrganizerProfileId === profile.id,
        onclick: () => { settings.activeOrganizerProfileId = profile.id; store.emit(); render(); }
      }, settings.activeOrganizerProfileId === profile.id ? 'Default profile' : 'Make default'),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn primary', onclick: () => {
        const updated = normalizeOrganizerProfile({
          ...profile,
          name: name.value.trim() || 'Organizer profile', organizer: organizer.value.trim(),
          federation: federation.value, defaultFed: defaultFed.value, site: site.value.trim(),
          chiefArbiter: chiefArbiter.value.trim(), deputyArbiters: deputyArbiters.value.trim(), arbiterEmail: arbiterEmail.value.trim(),
          defaultRatingType: ratingType.value, defaultRatingSource: ratingSource.value,
          listOptions: Object.fromEntries([...document.querySelectorAll('.settings-report-options input[data-option]')].map(input => [input.dataset.option, input.checked]))
        });
        Object.assign(profile, updated);
        store.emit();
        toast('Organizer profile saved.');
        render();
      } }, 'Save profile'))
  );
}

async function openTournamentFile() {
  const res = await window.tl.openTournament();
  if (!res) return;
  try {
    store.importDocument(JSON.parse(res.json));
    go('event-overview');
  } catch { toast('Could not read that file as a TourneyLab tournament.'); }
}

async function importTRFFile() {
  const text = await window.tl.openText({ title: 'Import TRF', extensions: ['trf', 'trfx', 'txt'] });
  if (!text) return;
  try {
    const { tournament, warnings } = importTRF(text);
    const t = store.newTournament(tournament);
    go('event-overview');
    if (warnings.length) {
      modal('TRF imported with notes', h('div', {},
        h('p', { class: 'muted' }, `${t.name} was imported. Review these notes before pairing or publishing:`),
        h('ul', {}, warnings.map(w => h('li', {}, w)))
      ), [{ label: 'OK', kind: 'primary' }]);
    } else {
      toast(`Imported ${t.name}.`);
    }
  } catch (e) {
    console.error(e);
    toast('Could not read that file as a TRF tournament.');
  }
}

async function importTunxFile() {
  try {
    if (typeof window.tl?.openBinary !== 'function') {
      modal('Restart TourneyLab to import .TUNx', h('div', {},
        h('p', {}, 'The Swiss-Manager importer was added after this TourneyLab window started.'),
        h('p', { class: 'muted' }, 'Quit TourneyLab completely, then relaunch it. Reloading this window is not enough because Electron must reload its main process.')
      ), [{ label: 'OK', kind: 'primary' }]);
      return;
    }
    const opened = await window.tl.openBinary({ title: 'Import Swiss-Manager .TUNx', extensions: ['tunx'] });
    if (!opened) return;
    const bytes = opened.bytes?.data ? Uint8Array.from(opened.bytes.data) : new Uint8Array(opened.bytes);
    const { tournament, warnings } = parseTunx(bytes);
    tournament.interop.swissManager.originalFilename = opened.name || tournament.interop.swissManager.originalFilename;
    const imported = store.newTournament(tournament);
    go('event-overview');
    if (warnings.length) {
      modal('Swiss-Manager tournament imported', h('div', {},
        h('p', { class: 'muted' }, `${imported.name} was imported. Review these notes before pairing or publishing:`),
        h('ul', {}, warnings.map(warning => h('li', {}, warning))),
        h('p', { class: 'muted small' }, 'TourneyLab preserves the original binary file for byte-identical re-export. Native edits are not written back yet.')
      ), [{ label: 'OK', kind: 'primary' }]);
    } else {
      toast(`Imported ${imported.name}.`);
    }
  } catch (error) {
    console.error(error);
    toast(`Could not import TUNx: ${error.message || 'unsupported or damaged file'}.`);
  }
}

function typeLabel(type) {
  return { swiss: 'Swiss', roundrobin: 'Round robin', 'team-swiss': 'Team Swiss', 'team-rr': 'Team round robin', ko: 'Knockout (KO)' }[type] ?? type;
}

function ratingTypeLabel(type) {
  return RATING_TYPES.find(choice => choice.id === type)?.label ?? type;
}

let showArchivedRegistrations = false;
let registrationBoardSearch = '';
let registrationBoardSelection = new Set();
let registrationBoardDragIds = [];
let registrationBoardUndo = null;
let registrationBoardEventId = null;

function openChild(section, view = 'overview') {
  store.data.activeId = section.id;
  store.data.activeEventId = section.eventId;
  go(view);
}

function tournamentPageIdentity(event, iconOwner = event, subtitle = '') {
  const titleOwner = event ?? iconOwner;
  return [
    h('h1', { class: 'visually-hidden' }, titleOwner?.name || 'Untitled tournament'),
    h('div', {
      class: 'page-icon',
      title: 'Click to change icon',
      role: 'button',
      tabindex: '0',
      'aria-label': 'Change tournament icon',
      style: 'cursor:pointer',
      onclick: () => cycleIcon(iconOwner ?? titleOwner),
      onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cycleIcon(iconOwner ?? titleOwner); } }
    }, icon(iconOwner?.icon ?? titleOwner?.icon ?? '♟️')),
    h('input', {
      class: 'page-title',
      type: 'text',
      value: titleOwner?.name ?? '',
      placeholder: 'Untitled tournament',
      'aria-label': 'Tournament name',
      title: 'Click to edit tournament name',
      onchange: e => {
        if (event) updateEvent(event, 'name', e.target.value);
        else {
          titleOwner.name = e.target.value;
          commit();
        }
      }
    }),
    subtitle ? h('p', { class: 'page-sub' }, subtitle) : null
  ];
}

function sectionWorkspaceName(event, section) {
  const sections = store.childrenForEvent(event.id);
  const labels = registrationSectionLabels(event, sections);
  return labels[sections.findIndex(item => item.id === section.id)] ?? section.sectionName ?? 'Section';
}

function sectionTitleName(event, section) {
  const name = String(section?.sectionName || section?.name || '').trim().replace(/\s+/g, ' ');
  if (!name || name.toLocaleLowerCase() === String(event?.name ?? '').trim().toLocaleLowerCase()) return 'Main Section';
  return /\bsection$/i.test(name) ? name : `${name} Section`;
}

function sectionPageIdentity(event, section, subtitle = '') {
  const title = sectionTitleName(event, section);
  const context = subtitle || [event.name, section.sectionCode ? `Code ${section.sectionCode}` : ''].filter(Boolean).join(' · ');
  return [
    h('h1', { class: 'visually-hidden' }, title),
    h('div', {
      class: 'page-icon',
      title: 'Click to change section icon',
      role: 'button',
      tabindex: '0',
      'aria-label': 'Change section icon',
      style: 'cursor:pointer',
      onclick: () => cycleIcon(section),
      onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cycleIcon(section); } }
    }, icon(section.icon ?? event.icon ?? '♟️')),
    h('input', {
      class: 'page-title',
      type: 'text',
      value: title,
      placeholder: 'Section name',
      'aria-label': 'Section name',
      title: 'Click to edit section name',
      onchange: e => { section.sectionName = e.target.value.trim() || 'Section'; commit(); }
    }),
    context ? h('p', { class: 'page-sub' }, context) : null
  ];
}

function eventWorkspaceHeader(event, title, subtitle, mark = '♟️') {
  return h('header', { class: 'setup-header event-workspace-header' },
    h('div', { class: 'page-icon setup-icon' }, icon(mark)),
    h('div', { class: 'grow' },
      h('div', { class: 'setup-kicker' }, 'Tournament'),
      h('h1', { class: 'workspace-title' }, title),
      h('p', { class: 'page-sub' }, `${event.name}${subtitle ? ` · ${subtitle}` : ''}`)));
}

function overviewProp(mark, label, control) {
  return h('div', { class: 'prop' }, h('div', { class: 'k' }, icon(mark), label), h('div', { class: 'v' }, control));
}

function overviewText(value, fallback = 'Not set') {
  return h('span', { class: value ? '' : 'muted', style: 'padding:4px 8px' }, value || fallback);
}

function eventOverviewInput(event, key, { type = 'text', placeholder = '', transform = value => value } = {}) {
  const labels = {
    site: 'Tournament venue or city', federation: 'Tournament federation', organizer: 'Tournament organizer',
    startDate: 'Tournament start date', endDate: 'Tournament end date'
  };
  return h('input', {
    type,
    value: event[key] ?? '',
    placeholder,
    'aria-label': labels[key] ?? key,
    onchange: e => updateEvent(event, key, transform(e.target.value))
  });
}

function sectionBoardRange(section) {
  const people = section.type === 'team-swiss' || section.type === 'team-rr'
    ? (section.rosterPlayers ?? [])
    : (section.players ?? []);
  const count = Math.max(2, people.length);
  const first = Number(section.startingBoard) || 1;
  const last = first + Math.max(1, Math.ceil(count / 2)) - 1;
  return first === last ? String(first) : `${first}-${last}`;
}

function EventOverview(event) {
  const children = store.childrenForEvent(event.id);
  const registrations = (event.registrations ?? []).filter(registration => !registration.archived);
  const eventDates = [event.startDate, event.endDate].filter(Boolean).join(' to ');
  const summary = eventWorkflowSummary(event, children);

  return page(h('div', { class: 'event-overview' },
    tournamentPageIdentity(event, event,
      [event.site, eventDates, `${registrations.length} registrations`].filter(Boolean).join(' · ')),
    h('div', { class: 'event-command-bar' },
      h('button', { class: 'btn primary', onclick: () => go(summary.nextAction.view) }, summary.nextAction.label),
      h('button', { class: 'btn', onclick: () => go('event-sections') }, iconLabel('🗂️', 'Sections')),
      h('button', { class: 'btn', onclick: () => go('event-setup') }, iconLabel('⚙️', 'Tournament setup')),
      h('button', { class: 'btn', onclick: () => go('event-export') }, iconLabel('📤', 'Export & publish'))),
    h('div', { class: 'props event-overview-properties' },
      overviewProp('📍', 'Venue / city', eventOverviewInput(event, 'site', { placeholder: 'City, venue' })),
      overviewProp('🏳️', 'Federation', eventOverviewInput(event, 'federation', { placeholder: 'e.g. SGP', transform: value => value.toUpperCase() })),
      overviewProp('🧑‍⚖️', 'Organizer', eventOverviewInput(event, 'organizer', { placeholder: 'Organizer' })),
      overviewProp('📅', 'Start date', eventOverviewInput(event, 'startDate', { type: 'date' })),
      overviewProp('📅', 'End date', eventOverviewInput(event, 'endDate', { type: 'date' }))),
    h('h2', { class: 'sec', id: 'tournament-status-heading' }, 'Tournament status'),
    h('div', { class: 'props', 'aria-labelledby': 'tournament-status-heading' },
      overviewProp('👥', 'Registrations', overviewText(`${summary.assignedRegistrations} assigned of ${summary.registrations}`)),
      overviewProp('🗂️', 'Sections', overviewText(`${summary.sections} total · ${summary.startedSections} started`)),
      overviewProp('📈', 'Progress', overviewText(summary.completedSections ? `${summary.completedSections} completed` : summary.startedSections ? 'In progress' : 'Not started')),
      overviewProp('⚠️', 'Setup attention', overviewText(summary.setupAttention ? `${summary.setupAttention} section${summary.setupAttention === 1 ? '' : 's'}` : 'No blockers'))),
    h('div', { class: 'section-heading-row' },
      h('h2', { class: 'sec' }, 'Sections at a glance'),
      h('button', { class: 'btn ghost', onclick: () => go('event-sections') }, 'Manage sections')),
    children.length
      ? h('div', { class: 'section-glance-list' }, children.map(child => {
          const status = setupStatus(event, child);
          const progress = child.currentRound ? `Round ${child.currentRound} of ${child.rounds}` : 'Not started';
          return h('button', {
            class: 'section-glance-row',
            'aria-label': `Open ${sectionWorkspaceName(event, child)}`,
            onclick: () => openChild(child)
          },
          h('span', { class: 'section-glance-name' }, sectionWorkspaceName(event, child)),
          h('span', { class: 'muted' }, `${typeLabel(child.type)} · ${child.players?.length ?? 0} players`),
          h('span', { class: 'muted' }, progress),
          status.errors.length
            ? h('span', { class: 'pill red' }, `${status.errors.length} blocker${status.errors.length === 1 ? '' : 's'}`)
            : h('span', { class: 'pill green' }, 'Ready'));
        }))
      : h('div', { class: 'empty' }, 'No sections yet. Add the first section to continue.')
  ));
}

function EventSections(event) {
  const children = store.childrenForEvent(event.id);

  return page(h('div', { class: 'event-sections' },
    eventWorkspaceHeader(event, 'Sections', 'Create, configure, and monitor each competition.', '🗂️'),
    h('div', { class: 'event-command-bar' },
      h('button', { class: 'btn primary', onclick: () => openChildTournamentDialog(event) }, iconLabel('＋', 'Add section')),
      h('button', { class: 'btn', onclick: () => openDivisionBuilder(event) }, iconLabel('🗂️', 'Build sections')),
      h('button', {
        class: 'btn',
        onclick: () => go('registrations')
      }, iconLabel('👥', 'Registrations')),
      h('button', { class: 'btn', onclick: () => openChildDefaultsDialog(event) }, iconLabel('⚙️', 'Section defaults')),
      h('button', { class: 'btn', onclick: () => openBoardAllocationDialog(event) }, iconLabel('↕', 'Allocate boards'))),
    h('div', { class: 'event-summary-strip' },
      h('span', {}, h('b', {}, String(children.length)), ` section${children.length === 1 ? '' : 's'}`),
      h('span', {}, h('b', {}, String(children.filter(child => child.currentRound > 0).length)), ' started'),
      h('span', {}, h('b', {}, String(children.filter(child => setupStatus(event, child).errors.length).length)), ' need setup attention')),
    h('h2', { class: 'sec' }, 'Sections'),
    children.length
      ? h('div', { class: 'table-scroll' }, h('table', { class: 'db child-tournaments-table' },
          h('tr', {},
            h('th', {}, 'Section'), h('th', {}, 'Format'), h('th', { class: 'num' }, 'Rounds'),
            h('th', { class: 'num' }, 'Participants'), h('th', {}, 'Progress'),
            h('th', {}, 'Boards'), h('th', {}, 'Setup'), h('th', {}, '')),
          children.map(child => {
            const status = setupStatus(event, child);
            const progress = child.currentRound ? `Round ${child.currentRound} of ${child.rounds}` : 'Not started';
            return h('tr', {
              class: 'child-row', role: 'link', tabindex: '0',
              onclick: () => openChild(child),
              onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openChild(child); } }
            },
              h('td', {}, h('b', {}, sectionWorkspaceName(event, child)), child.sectionCode ? h('span', { class: 'muted child-code' }, child.sectionCode) : null),
              h('td', {}, typeLabel(child.type)),
              h('td', { class: 'num' }, String(child.rounds)),
              h('td', { class: 'num' }, String(child.players?.length ?? 0)),
              h('td', {}, progress),
              h('td', {}, sectionBoardRange(child)),
              h('td', {}, status.errors.length
                ? h('span', { class: 'pill red' }, `${status.errors.length} blocker${status.errors.length === 1 ? '' : 's'}`)
                : status.warnings.length
                  ? h('span', { class: 'pill yellow' }, `${status.warnings.length} warning${status.warnings.length === 1 ? '' : 's'}`)
                  : h('span', { class: 'pill green' }, 'Ready')),
              h('td', {}, h('button', {
                class: 'btn ghost', title: 'Section actions',
                onclick: e => { e.stopPropagation(); childDashboardMenu(event, child); }
              }, '...')));
          })))
      : h('div', { class: 'empty' }, 'No sections yet. Add one section or build several sections together.')
  ));
}

function openBoardAllocationDialog(event) {
  const sections = store.childrenForEvent(event.id);
  const available = sections.filter(section => !section.roundsData?.length);
  if (!available.length) {
    modal('Allocate boards', h('p', { class: 'muted' }, 'All sections have started. Existing board ranges were left unchanged.'), [{ label: 'Done', kind: 'primary' }]);
    return;
  }

  const selected = new Set(available.map(section => section.id));
  const startBoard = h('input', { type: 'number', min: 1, value: 1 });
  const padding = h('input', { type: 'number', min: 0, value: 2 });
  const preview = h('div', { class: 'table-scroll board-allocation-preview' });
  let proposals = [];
  const refresh = () => {
    proposals = store.proposeSectionBoardAllocation(event.id, {
      sectionIds: [...selected],
      startBoard: Number(startBoard.value) || 1,
      padding: Math.max(0, Number(padding.value) || 0)
    });
    preview.replaceChildren(proposals.length
      ? h('table', { class: 'db' },
          h('tr', {}, h('th', {}, 'Section'), h('th', { class: 'num' }, 'Current'), h('th', { class: 'num' }, 'Proposed'), h('th', { class: 'num' }, 'Boards')),
          proposals.map(item => h('tr', {},
            h('td', {}, item.sectionName),
            h('td', { class: 'num' }, String(item.currentBoard)),
            h('td', { class: 'num' }, item.startingBoard === item.endingBoard ? String(item.startingBoard) : `${item.startingBoard}-${item.endingBoard}`),
            h('td', { class: 'num' }, String(item.boardCount)))))
      : h('div', { class: 'empty' }, 'Select at least one unstarted section.'));
  };
  startBoard.addEventListener('change', refresh);
  padding.addEventListener('change', refresh);
  const selector = h('div', { class: 'board-allocation-list' }, sections.map(section => {
    const started = !!section.roundsData?.length;
    return h('label', { class: `child-filter${started ? ' muted' : ''}` },
      h('input', {
        type: 'checkbox', checked: !started, disabled: started,
        onchange: e => { if (e.target.checked) selected.add(section.id); else selected.delete(section.id); refresh(); }
      }),
      h('span', {}, sectionDisplayName(section)),
      started ? h('span', { class: 'pill' }, 'Started') : null);
  }));
  refresh();

  modal('Allocate boards', h('div', {},
    h('div', { class: 'callout' }, h('span', { class: 'ic' }, icon('ℹ️')), h('div', {}, 'Board ranges are stored per section. This tool coordinates them across the tournament and skips started sections.')),
    h('div', { class: 'setup-grid compact' }, setupField('First board', startBoard), setupField('Empty boards between sections', padding)),
    selector,
    preview
  ), [
    { label: 'Cancel' },
    { label: 'Apply board ranges', kind: 'primary', onClick: () => {
      if (!proposals.length) return false;
      store.applySectionBoardAllocation(event.id, proposals);
      toast(`Updated ${proposals.length} section board range${proposals.length === 1 ? '' : 's'}.`);
    }}
  ], { wide: true });
}

function childDashboardMenu(event, child) {
  modal(child.sectionName || 'Section', h('p', { class: 'muted small' }, 'Choose an action for this section.'), [
    { label: 'Done' },
    { label: 'Save as section defaults', onClick: () => { store.saveChildDefaultsFromChild(child.id); toast('Tournament section defaults updated.'); } },
    { label: 'Use as template', onClick: () => openChildTournamentDialog(event, child) },
    { label: 'Open', kind: 'primary', onClick: () => openChild(child) }
  ]);
}

function sectionAgeBand(event, section) {
  return event?.ageScheme?.bands?.find(band => band.id === section?.eligibilityBandId) ?? null;
}

function sectionMaximumAge(event, section) {
  const band = sectionAgeBand(event, section);
  return band && !band.open && Number(band.maxAge) > 0 ? Number(band.maxAge) : '';
}

function setSectionMaximumAge(event, section, value, { renderAfter = true } = {}) {
  event.ageScheme = normalizeAgeScheme(event.ageScheme, event.startDate ? `${event.startDate.slice(0, 4)}-01-01` : '');
  const age = value === '' ? '' : Math.max(1, Number(value) || 1);
  if (age === '') {
    section.eligibilityBandId = '';
  } else {
    const current = sectionAgeBand(event, section);
    const matching = event.ageScheme.bands.find(band => !band.open && Number(band.maxAge) === age);
    if (matching) {
      section.eligibilityBandId = matching.id;
    } else if (current && !current.open && store.childrenForEvent(event.id).filter(item => item.eligibilityBandId === current.id).length <= 1) {
      current.code = `U${age}`;
      current.label = `Under ${age}`;
      current.maxAge = age;
    } else {
      const band = { id: createId('B'), code: `U${age}`, label: `Under ${age}`, maxAge: age, open: false };
      event.ageScheme.bands.push(band);
      section.eligibilityBandId = band.id;
    }
  }
  if (renderAfter) commit();
  else store.emit();
}

function sectionAgeLimitControl(event, section) {
  const age = sectionMaximumAge(event, section);
  return h('div', { class: 'section-age-limit' },
    h('input', {
      type: 'number', min: 1, max: 120, value: age,
      placeholder: 'No limit',
      'aria-label': `${sectionDisplayName(section)} maximum age`,
      onchange: e => setSectionMaximumAge(event, section, e.target.value)
    }),
    age === '' ? h('span', { class: 'muted small' }, 'Open') : h('span', { class: 'muted small' }, 'on cutoff date'));
}

function openChildTournamentDialog(event, template = null) {
  const children = store.childrenForEvent(event.id);
  const defaults = template ?? profileForSection(event, 'swiss');
  const source = h('select', {},
    h('option', { value: 'defaults', selected: !template }, 'Tournament format profile'),
    children.map(child => h('option', { value: child.id, selected: template?.id === child.id }, child.sectionName || child.sectionCode)));
  const name = h('input', { type: 'text', value: template ? `${template.sectionName} copy` : '', placeholder: 'e.g. Under 12' });
  const code = h('input', { type: 'text', value: store.nextChildCode(event.id), maxlength: 8 });
  const type = setupSelect(defaults.type ?? 'swiss', EVENT_TYPES, value => { rounds.value = profileForSection(event, value).rounds; });
  const rounds = h('input', { type: 'number', min: 1, max: 150, value: defaults.rounds ?? 7, disabled: true });
  const startingBoard = h('input', { type: 'number', min: 1, value: suggestedStartingBoard(event) });
  const expectedPlayers = h('input', { type: 'number', min: 0, value: template?.expectedPlayers ?? 30 });
  const maximumAge = h('input', {
    type: 'number', min: 1, max: 120, value: template ? sectionMaximumAge(event, template) : '',
    placeholder: 'No limit'
  });
  const ratingMin = h('input', { type: 'number', min: 0, value: defaults.eligibility?.ratingMin ?? defaults.ratingMin ?? '' });
  const ratingMax = h('input', { type: 'number', min: 0, value: defaults.eligibility?.ratingMax ?? defaults.ratingMax ?? '' });
  const birthYearMin = h('input', { type: 'number', min: 1900, max: 2200, value: defaults.eligibility?.birthYearMin ?? '' });
  const birthYearMax = h('input', { type: 'number', min: 1900, max: 2200, value: defaults.eligibility?.birthYearMax ?? '' });
  const sideGame = h('input', { type: 'checkbox', checked: !!defaults.sideGame });
  const message = h('div', { class: 'dialog-message' });

  const applySource = () => {
    const selected = source.value === 'defaults'
      ? profileForSection(event, type.value)
      : children.find(child => child.id === source.value);
    if (!selected) return;
    type.value = selected.type ?? 'swiss';
    rounds.value = selected.rounds ?? 7;
    ratingMin.value = selected.eligibility?.ratingMin ?? selected.ratingMin ?? '';
    ratingMax.value = selected.eligibility?.ratingMax ?? selected.ratingMax ?? '';
    maximumAge.value = selected.id ? sectionMaximumAge(event, selected) : '';
    birthYearMin.value = selected.eligibility?.birthYearMin ?? '';
    birthYearMax.value = selected.eligibility?.birthYearMax ?? '';
    sideGame.checked = !!selected.sideGame;
  };
  source.addEventListener('change', applySource);

  modal(template ? 'Create section from template' : 'Add section', h('div', {},
    h('div', { class: 'callout' }, h('span', { class: 'ic' }, icon('ℹ️')), h('div', {},
      h('b', {}, 'Inherited tournament rules'),
      h('div', { class: 'muted small' }, [event.site || 'No venue', profileForSection(event, type.value).timeControl || 'No time control', `${profileForSection(event, type.value).rounds} rounds`, profileForSection(event, type.value).rated === false ? 'Unrated' : 'Rated'].filter(Boolean).join(' · ')))),
    h('div', { class: 'setup-grid child-dialog-grid' },
      setupField('Section name', name),
      setupField('Code', code),
      setupField('Setup source', source, 'Tournament profiles remain live until overridden or pairing starts.'),
      setupField('Format', type),
      setupField('Inherited rounds', rounds, 'Change rounds from parent Competition rules, or override later in Section Setup.'),
      setupField('Age limit', maximumAge, 'Leave blank for no age limit. Age is measured on the tournament cutoff date.'),
      setupField('Target players', expectedPlayers),
      setupField('Starting board', startingBoard),
      setupField('Minimum rating', ratingMin),
      setupField('Maximum rating', ratingMax),
      setupField('Minimum birth year', birthYearMin),
      setupField('Maximum birth year', birthYearMax),
      setupField('Side event', sideGame)),
    message
  ), [
    { label: 'Cancel' },
    { label: 'Create section', kind: 'primary', onClick: () => {
      try {
        const section = store.createChildTournament(event.id, {
          sectionName: name.value.trim(),
          sectionCode: code.value.trim().toUpperCase(),
          sourceSectionId: source.value === 'defaults' ? undefined : source.value,
          type: type.value,
          startingBoard: Number(startingBoard.value) || 1,
          expectedPlayers: Number(expectedPlayers.value) || 0,
          eligibility: eligibilityFromInputs(ratingMin, ratingMax, birthYearMin, birthYearMax),
          sideGame: sideGame.checked
        });
        setSectionMaximumAge(event, section, maximumAge.value, { renderAfter: false });
        go('registrations');
      } catch (error) {
        message.className = 'dialog-message error';
        message.textContent = error.message;
        return false;
      }
    }}
  ], { wide: true });
  name.focus();
}

function eligibilityFromInputs(ratingMin, ratingMax, birthYearMin, birthYearMax) {
  const value = input => input.value === '' ? '' : Number(input.value);
  return {
    ratingMin: value(ratingMin), ratingMax: value(ratingMax),
    birthYearMin: value(birthYearMin), birthYearMax: value(birthYearMax)
  };
}

function suggestedStartingBoard(event) {
  return store.childrenForEvent(event.id).reduce((next, child) => {
    const people = Math.max(child.players?.length ?? 0, Number(child.expectedPlayers) || 0);
    const boards = Math.max(1, Math.ceil(Math.max(2, people) / 2));
    return Math.max(next, (Number(child.startingBoard) || 1) + boards);
  }, 1);
}

function openChildDefaultsDialog(event) {
  const children = store.childrenForEvent(event.id);
  let draft = JSON.parse(JSON.stringify(event.childDefaults ?? {}));
  const source = h('select', {},
    h('option', { value: '' }, 'Current section defaults'),
    children.map(child => h('option', { value: child.id }, child.sectionName || child.sectionCode)));
  const type = setupSelect(draft.type ?? 'swiss', EVENT_TYPES, () => {});
  const rounds = h('input', { type: 'number', min: 1, max: 150, value: draft.rounds ?? 7 });
  const startingBoard = h('input', { type: 'number', min: 1, value: draft.startingBoard ?? 1 });
  const ratingMin = h('input', { type: 'number', min: 0, value: draft.eligibility?.ratingMin ?? '' });
  const ratingMax = h('input', { type: 'number', min: 0, value: draft.eligibility?.ratingMax ?? '' });
  const birthYearMin = h('input', { type: 'number', min: 1900, max: 2200, value: draft.eligibility?.birthYearMin ?? '' });
  const birthYearMax = h('input', { type: 'number', min: 1900, max: 2200, value: draft.eligibility?.birthYearMax ?? '' });
  const sideGame = h('input', { type: 'checkbox', checked: !!draft.sideGame });
  const load = () => {
    const child = children.find(item => item.id === source.value);
    if (!child) return;
    draft = store.childSetupSnapshot(child);
    type.value = draft.type;
    rounds.value = draft.rounds;
    startingBoard.value = draft.startingBoard;
    ratingMin.value = draft.eligibility?.ratingMin ?? '';
    ratingMax.value = draft.eligibility?.ratingMax ?? '';
    birthYearMin.value = draft.eligibility?.birthYearMin ?? '';
    birthYearMax.value = draft.eligibility?.birthYearMax ?? '';
    sideGame.checked = !!draft.sideGame;
  };

  modal('Section defaults', h('div', {},
    h('div', { class: 'callout' }, h('span', { class: 'ic' }, icon('ℹ️')), h('div', {}, 'These values apply only to future sections. Existing sections do not change.')),
    h('div', { class: 'toolbar' }, source, h('button', { class: 'btn', onclick: load }, 'Use selected section')),
    h('div', { class: 'setup-grid' },
      setupField('Format', type), setupField('Rounds', rounds), setupField('Starting board', startingBoard),
      setupField('Minimum rating', ratingMin), setupField('Maximum rating', ratingMax),
      setupField('Minimum birth year', birthYearMin), setupField('Maximum birth year', birthYearMax),
      setupField('Side event', sideGame))
  ), [
    { label: 'Cancel' },
    { label: 'Save defaults', kind: 'primary', onClick: () => {
      event.childDefaults = {
        ...draft,
        type: type.value,
        pairingSystem: pairingSystemForView(type.value),
        rounds: Number(rounds.value) || 1,
        finalRound: Number(rounds.value) || 1,
        startingBoard: Number(startingBoard.value) || 1,
        eligibility: eligibilityFromInputs(ratingMin, ratingMax, birthYearMin, birthYearMax),
        sideGame: sideGame.checked
      };
      event.childDefaults.ratingMin = event.childDefaults.eligibility.ratingMin;
      event.childDefaults.ratingMax = event.childDefaults.eligibility.ratingMax;
      store.emit();
      toast('Section defaults saved for future sections.');
    }}
  ], { wide: true });
}

function pairingSystemForView(type) {
  if (type === 'team-swiss') return 'fide-c04.6';
  if (type === 'swiss') return 'fide-dutch';
  return type === 'ko' ? 'knockout' : 'round-robin';
}

function pairingSystemChoices(type) {
  if (type === 'swiss') return [
    { id: 'fide-dutch', label: 'FIDE Dutch' },
    { id: 'fide-double-swiss', label: 'Double Swiss' }
  ];
  if (type === 'team-swiss') return [
    { id: 'fide-dutch', label: 'FIDE Dutch' },
    { id: 'fide-c04.6', label: 'FIDE C.04.6' },
    { id: 'olympiad', label: 'Olympiad / ECU' }
  ];
  if (type === 'ko') return [{ id: 'knockout', label: 'Knockout bracket' }];
  return [{ id: 'round-robin', label: 'Round robin tables' }];
}

function openDivisionBuilder(event) {
  const rows = [];
  const table = h('table', { class: 'db division-builder-table' });
  const message = h('div', { class: 'dialog-message' });
  const usedCodes = () => new Set([...store.childrenForEvent(event.id).map(child => child.sectionCode), ...rows.map(row => row.sectionCode)].filter(Boolean));
  const nextCode = () => {
    const used = usedCodes();
    for (let i = 0; i < 26; i++) {
      const code = String.fromCharCode(65 + i);
      if (!used.has(code)) return code;
    }
    return `S${used.size + 1}`;
  };
  const estimate = row => (event.registrations ?? []).filter(registration => !registration.archived && store.registrationEligibility({
    eligibility: row.eligibility,
    ratingPolicy: event.childDefaults?.ratingPolicy ?? { primary: 'rating', fallback: 'rating', unratedValue: 0 }
  }, registration).eligible).length;
  const addRow = (partial = {}) => {
    const last = rows.at(-1);
    const startingBoard = last
      ? last.startingBoard + Math.max(1, Math.ceil((last.estimatedParticipants || 2) / 2))
      : suggestedStartingBoard(event);
    rows.push({
      sectionName: partial.sectionName ?? `Section ${rows.length + 1}`,
      sectionCode: partial.sectionCode ?? nextCode(),
      type: partial.type ?? event.childDefaults?.type ?? 'swiss',
      rounds: partial.rounds ?? event.childDefaults?.rounds ?? 7,
      startingBoard: partial.startingBoard ?? startingBoard,
      eligibility: partial.eligibility ?? { ratingMin: '', ratingMax: '', birthYearMin: '', birthYearMax: '' },
      sideGame: !!partial.sideGame,
      estimatedParticipants: 0
    });
    rows.at(-1).estimatedParticipants = estimate(rows.at(-1));
    renderRows();
  };
  const field = (row, key, options = {}) => h('input', {
    type: options.type ?? 'text', min: options.min, value: row[key] ?? '',
    onchange: e => { row[key] = options.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value; row.estimatedParticipants = estimate(row); }
  });
  const eligibleField = (row, key, min = 0) => h('input', {
    type: 'number', min, value: row.eligibility[key] ?? '',
    onchange: e => { row.eligibility[key] = e.target.value === '' ? '' : Number(e.target.value); row.estimatedParticipants = estimate(row); }
  });
  const renderRows = () => {
    const head = h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Code'), h('th', {}, 'Format'), h('th', { class: 'num' }, 'Rounds'), h('th', { class: 'num' }, 'Board'), h('th', { class: 'num' }, 'Rtg min'), h('th', { class: 'num' }, 'Rtg max'), h('th', { class: 'num' }, 'Born min'), h('th', { class: 'num' }, 'Born max'), h('th', { class: 'num' }, 'Est.'), h('th', {}, ''));
    const bodyRows = rows.map((row, index) => h('tr', {},
        h('td', {}, field(row, 'sectionName')), h('td', {}, field(row, 'sectionCode')),
        h('td', {}, setupSelect(row.type, EVENT_TYPES, value => { row.type = value; })),
        h('td', {}, field(row, 'rounds', { type: 'number', min: 1 })),
        h('td', {}, field(row, 'startingBoard', { type: 'number', min: 1 })),
        h('td', {}, eligibleField(row, 'ratingMin')), h('td', {}, eligibleField(row, 'ratingMax')),
        h('td', {}, eligibleField(row, 'birthYearMin', 1900)), h('td', {}, eligibleField(row, 'birthYearMax', 1900)),
        h('td', { class: 'num' }, String(row.estimatedParticipants)),
        h('td', {}, h('button', { class: 'btn ghost', title: 'Remove row', disabled: rows.length === 1, onclick: () => { rows.splice(index, 1); renderRows(); } }, icon('✕')))));
    table.replaceChildren(head, ...bodyRows);
  };
  const suggest = () => {
    let board = suggestedStartingBoard(event);
    const existingCodes = new Set(store.childrenForEvent(event.id).map(child => child.sectionCode));
    rows.forEach((row, index) => {
      let codeIndex = index;
      let code;
      do { code = codeIndex < 26 ? String.fromCharCode(65 + codeIndex) : `S${codeIndex + 1}`; codeIndex++; } while (existingCodes.has(code));
      row.sectionCode = code;
      existingCodes.add(code);
      row.estimatedParticipants = estimate(row);
      row.startingBoard = board;
      board += Math.max(1, Math.ceil((row.estimatedParticipants || 2) / 2));
    });
    renderRows();
  };
  addRow({ sectionName: 'Section 1' });
  addRow({ sectionName: 'Section 2' });

  modal('Build sections', h('div', { class: 'division-builder' },
    h('div', { class: 'toolbar' },
      h('button', { class: 'btn', onclick: () => addRow() }, iconLabel('＋', 'Add row')),
      h('button', { class: 'btn', onclick: suggest }, iconLabel('↕', 'Suggest codes & boards'))),
    h('div', { class: 'table-scroll' }, table),
    h('p', { class: 'muted small' }, `New sections inherit ${[event.site || 'the tournament venue', event.timeControl || 'the tournament time control', event.ratingType].filter(Boolean).join(', ')}. Override them later from the section Setup page.`),
    h('p', { class: 'muted small' }, 'Eligibility limits are inclusive. Overlap is shown as a warning because a registration may qualify for more than one section, but can be assigned to only one.'),
    message
  ), [
    { label: 'Cancel' },
    { label: 'Create all', kind: 'primary', onClick: () => {
      const validation = store.validateChildRows(event.id, rows);
      if (validation.errors.length) {
        message.className = 'dialog-message error';
        message.replaceChildren(h('b', {}, 'Fix before creating:'), h('ul', {}, validation.errors.map(error => h('li', {}, error))));
        return false;
      }
      if (validation.warnings.length && !message.dataset.reviewed) {
        message.className = 'dialog-message warning';
        message.dataset.reviewed = 'true';
        message.replaceChildren(h('b', {}, 'Review warnings, then choose Create all again:'), h('ul', {}, validation.warnings.map(warning => h('li', {}, warning))));
        return false;
      }
      store.createChildTournaments(event.id, validation.rows);
      go('registrations');
    }}
  ], { wide: true });
}

function Registrations(event) {
  if (registrationBoardEventId !== event.id) {
    registrationBoardSelection.clear();
    registrationBoardDragIds = [];
    registrationBoardUndo = null;
    registrationBoardEventId = event.id;
  }
  const children = store.childrenForEvent(event.id);
  const labels = registrationSectionLabels(event, children);
  const labelByChildId = new Map(children.map((child, index) => [child.id, labels[index]]));
  const sectionLabel = child => labelByChildId.get(child.id) ?? 'Section';
  const registrations = (event.registrations ?? []).filter(registration => showArchivedRegistrations || !registration.archived);
  const duplicateCount = event.registrationDuplicateCandidates?.length ?? 0;
  const movable = new Set(registrations.filter(registration => !registrationBoardLocked(children, registration)).map(registration => registration.id));
  for (const id of registrationBoardSelection) if (!movable.has(id)) registrationBoardSelection.delete(id);
  const destination = h('select', { 'aria-label': 'Move selected registrations to' },
    h('option', { value: '__choose__' }, 'Move to…'),
    h('option', { value: '' }, 'Unassigned'),
    children.map(child => h('option', { value: child.id }, sectionLabel(child))));
  const moveButton = h('button', { class: 'btn primary registration-move', disabled: true,
    onclick: () => moveRegistrationBoardSelection(event, children, destination.value, [...registrationBoardSelection])
  }, 'Move');
  destination.addEventListener('change', () => { moveButton.disabled = !registrationBoardSelection.size || destination.value === '__choose__'; });
  const workspace = h('div', { class: 'registrations-workspace' },
    h('header', { class: 'setup-header registrations-header' },
      h('div', { class: 'page-icon setup-icon' }, icon('👥')),
      h('div', { class: 'grow' },
        h('div', { class: 'setup-kicker' }, 'Tournament'),
        h('h1', { class: 'page-title' }, 'Registrations'),
        h('p', { class: 'page-sub' }, `${event.name} · Assign each registration to one section.`)),
      h('button', { class: 'btn ghost', onclick: () => go('event-overview') }, 'Tournament overview')),
    h('div', { class: 'event-command-bar registration-command-bar' },
      h('button', { class: 'btn primary', onclick: () => openRegistrationDialog(event) }, iconLabel('＋', 'New registration')),
      h('button', { class: 'btn', onclick: () => quickAddRegistrations(event) }, iconLabel('＋', 'Quick add registrations')),
      h('button', { class: 'btn', onclick: () => importRegistrationCSV(event) }, iconLabel('📥', 'Import registration CSV')),
      h('button', { class: 'btn', disabled: !children.length || !registrations.length, onclick: () => reviewSuggestedAssignments(event, children) }, iconLabel('🎯', 'Suggest assignments')),
      h('span', { class: 'spacer' }),
      h('input', {
        class: 'registration-board-search', type: 'search', value: registrationBoardSearch,
        placeholder: 'Search players', 'aria-label': 'Search registrations',
        oninput: e => {
          registrationBoardSearch = e.target.value;
          const query = registrationBoardSearch.trim().toLowerCase();
          workspace.querySelectorAll('.registration-board-card').forEach(card => { card.hidden = !!query && !card.dataset.searchText.includes(query); });
          updateRegistrationBoardSelection(workspace);
        }
      }),
      h('label', { class: 'inline-toggle' }, h('input', {
        type: 'checkbox', checked: showArchivedRegistrations,
        onchange: e => { showArchivedRegistrations = e.target.checked; render(); }
      }), 'Show archived')),
    duplicateCount ? h('div', { class: 'callout warn' },
      h('span', { class: 'ic' }, icon('⚠')),
      h('div', { class: 'grow' }, `${duplicateCount} possible name-only duplicate${duplicateCount === 1 ? '' : 's'} need review. Exact federation IDs were already merged.`),
      h('button', { class: 'btn', onclick: () => reviewRegistrationDuplicates(event) }, 'Review possible duplicates')) : null,
    h('div', { class: 'registration-selection-status' },
      h('span', { class: 'registration-selection-summary', role: 'status', 'aria-live': 'polite' }),
      h('div', { class: 'registration-selection-actions' }, destination, moveButton,
        h('button', { class: 'btn ghost', onclick: () => { registrationBoardSelection.clear(); updateRegistrationBoardSelection(workspace); } }, 'Clear'))),
    registrationBoardUndo ? h('div', { class: 'registration-undo-bar', role: 'status' },
      h('span', {}, `${registrationBoardUndo.ids.length} player${registrationBoardUndo.ids.length === 1 ? '' : 's'} moved.`),
      h('button', { class: 'btn ghost', onclick: () => undoRegistrationBoardMove(event) }, 'Undo')) : null,
    registrations.length
      ? registrationBoard(event, children, registrations, sectionLabel)
      : h('div', { class: 'empty' }, 'No registrations yet. Add people manually, paste names, or import a CSV rating list.'),
    h('p', { class: 'muted small registration-footnote' }, 'Select players with checkboxes or drag a selection box. Shift-click to select a range. Assignments with paired-round history are locked.')
  );
  updateRegistrationBoardSelection(workspace);
  return page(workspace);
}

function registrationBoardLocked(children, registration) {
  return registration.archived || registrationAssignments(children, registration.id)
    .some(item => item.child.roundsData?.length || item.child.currentRound);
}

// Update selection in place: replacing the board interrupts pointer gestures,
// loses keyboard focus, and resets independently scrolled lanes.
function updateRegistrationBoardSelection(root) {
  root.querySelectorAll('.registration-board-card').forEach(card => {
    const selected = registrationBoardSelection.has(card.dataset.registrationId);
    card.classList.toggle('selected', selected);
    card.querySelector('.registration-card-checkbox').checked = selected;
  });
  root.querySelectorAll('.registration-board-lane').forEach(lane => {
    const visible = [...lane.querySelectorAll('.registration-board-card:not([hidden])')];
    const movable = visible.filter(card => !card.classList.contains('locked'));
    const selected = movable.filter(card => registrationBoardSelection.has(card.dataset.registrationId)).length;
    lane.querySelector('.count').textContent = visible.length;
    const checkbox = lane.querySelector('.registration-lane-checkbox');
    checkbox.checked = !!movable.length && selected === movable.length;
    checkbox.indeterminate = selected > 0 && selected < movable.length;
    checkbox.disabled = !movable.length;
    const empty = lane.querySelector('.registration-board-empty');
    empty.hidden = !!visible.length;
    empty.textContent = registrationBoardSearch.trim() ? 'No matching players' : 'Drop players here';
  });
  const workspace = root.closest('.registrations-workspace') ?? root;
  const summary = workspace.querySelector('.registration-selection-summary');
  if (!summary) return;
  const count = registrationBoardSelection.size;
  const hidden = [...workspace.querySelectorAll('.registration-board-card[hidden]')]
    .filter(card => registrationBoardSelection.has(card.dataset.registrationId)).length;
  summary.textContent = count
    ? `${count} selected${hidden ? ` · ${hidden} hidden by search` : ''} · Drag to a section or use Move to.`
    : 'Select players to move them together.';
  workspace.querySelector('.registration-selection-status').classList.toggle('has-selection', count > 0);
  workspace.querySelector('.registration-selection-actions select').disabled = !count;
  workspace.querySelector('.registration-selection-actions .ghost').disabled = !count;
  workspace.querySelector('.registration-move').disabled = !count || workspace.querySelector('.registration-selection-actions select').value === '__choose__';
}

function registrationBoard(event, children, registrations, sectionLabel) {
  const query = registrationBoardSearch.trim().toLowerCase();
  const laneFor = registration => registrationBoardLocation(children, registration.id);
  const lanes = [{ id: '', label: 'Unassigned', note: 'Needs a tournament section' }, ...children.map(child => ({
    id: child.id,
    label: sectionLabel(child),
    note: child.roundsData?.length || child.currentRound ? `Round ${child.currentRound || child.roundsData.length} in progress` : 'Ready for assignments'
  }))];
  const board = h('div', { class: 'registration-board', 'aria-label': 'Registration assignment board' }, lanes.map(lane => {
    const cards = registrations.filter(registration => laneFor(registration) === lane.id);
    const cardList = h('div', { class: 'registration-board-cards', dataset: { sectionId: lane.id } },
      cards.map(registration => {
        const card = registrationBoardCard(children, registration);
        card.hidden = !!query && !card.dataset.searchText.includes(query);
        return card;
      }), h('p', { class: 'registration-board-empty' }, 'Drop players here'));
    const laneElement = h('section', { class: 'registration-board-lane', 'aria-label': lane.label,
      ondragover: dragEvent => {
        if (!registrationBoardDragIds.length) return;
        dragEvent.preventDefault();
        dragEvent.dataTransfer.dropEffect = 'move';
        laneElement.classList.add('dragover');
      },
      ondragleave: dragEvent => {
        if (!laneElement.contains(dragEvent.relatedTarget)) laneElement.classList.remove('dragover');
      },
      ondrop: dropEvent => {
        if (!registrationBoardDragIds.length) return;
        dropEvent.preventDefault();
        laneElement.classList.remove('dragover');
        moveRegistrationBoardSelection(event, children, lane.id);
      }
    },
      h('header', { class: 'registration-board-lane-header' },
        h('div', { class: 'registration-board-lane-title' }, h('b', {}, lane.label), h('span', { class: 'count' }, cards.length)),
        h('div', { class: 'muted small' }, lane.note),
        h('label', { class: 'registration-lane-select' }, h('input', {
          class: 'registration-lane-checkbox', type: 'checkbox', 'aria-label': `Select all visible players in ${lane.label}`,
          onchange: changeEvent => {
            cardList.querySelectorAll('.registration-board-card:not(.locked):not([hidden])').forEach(card => {
              if (changeEvent.target.checked) registrationBoardSelection.add(card.dataset.registrationId);
              else registrationBoardSelection.delete(card.dataset.registrationId);
            });
            updateRegistrationBoardSelection(board);
          }
        }), 'Select all')),
      cardList,
      h('button', { class: 'registration-board-add', onclick: () => openRegistrationDialog(event, { assignSection: children.find(child => child.id === lane.id) }) }, '＋ Add registration'));
    return laneElement;
  }));
  board.addEventListener('keydown', keyEvent => {
    if (keyEvent.target.closest('input, button, select') || registrationBoardDragIds.length) return;
    if ((keyEvent.metaKey || keyEvent.ctrlKey) && keyEvent.key.toLowerCase() === 'a') {
      keyEvent.preventDefault();
      board.querySelectorAll('.registration-board-card:not(.locked):not([hidden])').forEach(card => registrationBoardSelection.add(card.dataset.registrationId));
      updateRegistrationBoardSelection(board);
    } else if (keyEvent.key === 'Escape') {
      registrationBoardSelection.clear();
      updateRegistrationBoardSelection(board);
    }
  });
  let marquee = null;
  const rect = h('div', { class: 'registration-marquee', 'aria-hidden': 'true' });
  board.addEventListener('pointerdown', pointerEvent => {
    if (pointerEvent.button !== 0 || pointerEvent.pointerType === 'touch' || pointerEvent.target.closest('.registration-board-card, button, input, label, .registration-board-lane-header')) return;
    pointerEvent.preventDefault();
    board.setPointerCapture(pointerEvent.pointerId);
    marquee = { x: pointerEvent.clientX, y: pointerEvent.clientY, pointerId: pointerEvent.pointerId,
      original: new Set(registrationBoardSelection), additive: pointerEvent.shiftKey || pointerEvent.metaKey || pointerEvent.ctrlKey, active: false };
  });
  board.addEventListener('pointermove', pointerEvent => {
    if (!marquee || marquee.pointerId !== pointerEvent.pointerId) return;
    if (!marquee.active && Math.hypot(pointerEvent.clientX - marquee.x, pointerEvent.clientY - marquee.y) < 5) return;
    marquee.active = true;
    const left = Math.min(marquee.x, pointerEvent.clientX), top = Math.min(marquee.y, pointerEvent.clientY);
    const right = Math.max(marquee.x, pointerEvent.clientX), bottom = Math.max(marquee.y, pointerEvent.clientY);
    Object.assign(rect.style, { left: `${left}px`, top: `${top}px`, width: `${right - left}px`, height: `${bottom - top}px` });
    rect.classList.add('show');
    if (!rect.isConnected) document.body.append(rect);
    registrationBoardSelection.clear();
    if (marquee.additive) for (const id of marquee.original) registrationBoardSelection.add(id);
    board.querySelectorAll('.registration-board-card:not(.locked):not([hidden])').forEach(card => {
      const bounds = card.getBoundingClientRect();
      const clip = card.parentElement.getBoundingClientRect();
      const visibleTop = Math.max(bounds.top, clip.top), visibleBottom = Math.min(bounds.bottom, clip.bottom);
      if (visibleBottom > visibleTop && bounds.left < right && bounds.right > left && visibleTop < bottom && visibleBottom > top) registrationBoardSelection.add(card.dataset.registrationId);
    });
    updateRegistrationBoardSelection(board);
  });
  const finish = pointerEvent => {
    if (!marquee || marquee.pointerId !== pointerEvent.pointerId) return;
    if (pointerEvent.type === 'pointercancel') {
      registrationBoardSelection.clear();
      for (const id of marquee.original) registrationBoardSelection.add(id);
    }
    const pointerId = marquee.pointerId;
    marquee = null;
    if (board.hasPointerCapture(pointerId)) board.releasePointerCapture(pointerId);
    rect.remove();
    updateRegistrationBoardSelection(board);
  };
  board.addEventListener('pointerup', finish);
  board.addEventListener('pointercancel', finish);
  board.addEventListener('lostpointercapture', finish);
  return board;
}

function registrationBoardCard(children, registration) {
  const locked = registrationBoardLocked(children, registration);
  let suppressClickUntil = 0;
  let dragPreview;
  const select = (inputEvent, checked) => {
    if (locked) return;
    const board = card.closest('.registration-board');
    const cards = [...board.querySelectorAll('.registration-board-card:not(.locked):not([hidden])')];
    const anchor = cards.findIndex(item => item.dataset.registrationId === board.dataset.selectionAnchor);
    const index = cards.indexOf(card);
    if (inputEvent.shiftKey && anchor >= 0 && index >= 0) {
      for (const item of cards.slice(Math.min(anchor, index), Math.max(anchor, index) + 1)) registrationBoardSelection.add(item.dataset.registrationId);
    } else if (checked) registrationBoardSelection.add(registration.id);
    else registrationBoardSelection.delete(registration.id);
    board.dataset.selectionAnchor = registration.id;
    updateRegistrationBoardSelection(board);
  };
  const card = h('article', {
    class: `registration-board-card${locked ? ' locked' : ''}`,
    dataset: {
      registrationId: registration.id,
      searchText: [registration.name, registration.fideId, registration.fed, registration.club].map(value => String(value ?? '').toLowerCase()).join(' ')
    }, draggable: locked ? null : 'true', tabindex: '0',
    'aria-label': registration.name || 'Unnamed registration',
    title: locked ? (registration.archived ? 'Archived registration' : 'Section assignment is locked because pairing history exists.') : 'Select or drag to a section. Double-click to edit.',
    onclick: clickEvent => {
      if (performance.now() < suppressClickUntil || clickEvent.detail > 1) return;
      select(clickEvent, !registrationBoardSelection.has(registration.id));
    },
    ondblclick: () => registrationMenu(store.activeEvent, registration),
    onkeydown: keyEvent => {
      if (keyEvent.target !== card) return;
      if (keyEvent.key === ' ') {
        keyEvent.preventDefault();
        select(keyEvent, !registrationBoardSelection.has(registration.id));
      } else if (keyEvent.key === 'Enter') {
        keyEvent.preventDefault();
        registrationMenu(store.activeEvent, registration);
      }
    },
    ondragstart: dragEvent => {
      if (locked) { dragEvent.preventDefault(); return; }
      // Read live membership, never the state captured when this card rendered.
      if (!registrationBoardSelection.has(registration.id)) {
        registrationBoardSelection.clear();
        registrationBoardSelection.add(registration.id);
      }
      registrationBoardDragIds = [...registrationBoardSelection];
      const board = card.closest('.registration-board');
      updateRegistrationBoardSelection(board);
      dragEvent.dataTransfer.effectAllowed = 'move';
      dragEvent.dataTransfer.setData('text/plain', JSON.stringify(registrationBoardDragIds));
      dragPreview = h('div', { class: 'registration-drag-preview' },
        h('b', {}, `${registrationBoardDragIds.length} player${registrationBoardDragIds.length === 1 ? '' : 's'}`),
        h('span', {}, 'Move to a section'));
      document.body.append(dragPreview);
      dragEvent.dataTransfer.setDragImage(dragPreview, 24, 24);
      board.querySelectorAll('.registration-board-card.selected').forEach(item => item.classList.add('dragging'));
    },
    ondragend: () => {
      suppressClickUntil = performance.now() + 150;
      dragPreview?.remove();
      registrationBoardDragIds = [];
      document.querySelectorAll('.registration-board .dragging, .registration-board .dragover').forEach(item => item.classList.remove('dragging', 'dragover'));
      // Cancelled and rejected drops keep the group selected for another attempt.
    }
  },
    h('input', { class: 'registration-card-checkbox', type: 'checkbox', disabled: locked,
      'aria-label': `Select ${registration.name || 'unnamed registration'}`,
      onclick: clickEvent => { clickEvent.stopPropagation(); select(clickEvent, clickEvent.target.checked); },
      ondblclick: clickEvent => clickEvent.stopPropagation()
    }),
    h('div', { class: 'registration-card-content' },
      h('b', { class: 'registration-board-card-title' }, registration.name || 'Unnamed registration'),
      h('div', { class: 'registration-board-card-meta' },
        h('span', {}, registration.fed || 'No federation'),
        h('span', { class: 'registration-card-rating' }, Number(registration.rating) ? String(registration.rating) : 'Unrated'))),
    locked ? h('span', { class: 'registration-board-lock', title: registration.archived ? 'Archived' : 'Assignment locked' }, icon('🔒'))
      : h('span', { class: 'registration-card-grip', 'aria-hidden': 'true' }, '⠿'));
  return card;
}

function registrationBoardLocation(children, registrationId) {
  return registrationAssignments(children, registrationId)[0]?.child.id ?? '';
}

function moveRegistrationBoardSelection(event, children, sectionId, selectedIds = registrationBoardDragIds) {
  const ids = selectedIds.filter(id => registrationBoardLocation(children, id) !== sectionId);
  if (!ids.length) return;
  const previous = ids.map(id => ({ id, sectionId: registrationBoardLocation(children, id) }));
  try {
    store.moveRegistrations(event.id, ids.map(id => ({ id, sectionId })));
    registrationBoardUndo = { ids, previous };
    registrationBoardSelection.clear();
    toast(`Moved ${ids.length} player${ids.length === 1 ? '' : 's'}.`);
  } catch (error) {
    toast(`${error.message} No players were moved. Your selection is kept.`, 5000);
  }
  registrationBoardDragIds = [];
  render();
}

function undoRegistrationBoardMove(event) {
  if (!registrationBoardUndo) return;
  try {
    store.moveRegistrations(event.id, registrationBoardUndo.previous, { allowOverCapacity: true });
    registrationBoardUndo = null;
    toast('Registration move undone.');
  } catch (error) {
    toast(error.message);
  }
  render();
}

function registrationCell(event, registration, key, type = 'text') {
  return h('input', {
    type,
    value: registration[key] ?? '',
    disabled: registration.archived,
    onchange: e => store.updateRegistration(event.id, registration.id, {
      [key]: type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value
    })
  });
}

function assignedPerson(child, registrationId) {
  const pool = isTeam(child) ? (child.rosterPlayers ?? []) : (child.players ?? []);
  return pool.find(person => person.registrationId === registrationId) ?? null;
}

function registrationAssignments(children, registrationId) {
  return children.map(child => ({ child, person: assignedPerson(child, registrationId) }))
    .filter(item => item.person);
}

function registrationSectionSelect(event, children, registration, sectionLabel) {
  const assignments = registrationAssignments(children, registration.id);
  const locked = assignments.some(item => item.child.roundsData?.length || item.child.currentRound);
  const selectedValue = assignments.length === 1 ? assignments[0].child.id : assignments.length ? '__multiple__' : '';
  const withdrawnAssignment = assignments.find(item => item.person.withdrawn);
  const select = h('select', {
    class: 'registration-section-picker',
    disabled: registration.archived || locked,
    title: locked ? 'Section assignment is locked because pairing history exists.' : 'Choose tournament section',
    'aria-label': `Section for ${registration.name || 'registration'}`,
    onchange: e => {
      if (e.target.value === '__multiple__') return;
      const targetId = e.target.value;
      const target = children.find(child => child.id === targetId);
      const apply = options => {
        try {
          store.setRegistrationSection(event.id, registration.id, targetId, options);
          render();
        } catch (error) {
          toast(error.message);
          render();
        }
      };
      if (target) {
        const evaluation = store.registrationEligibility(target, registration);
        if (!evaluation.eligible && target.eligibilityBandId) {
          const reason = h('input', { type: 'text', placeholder: 'Reason for manual assignment' });
          const message = h('div', { class: 'dialog-message' });
          modal('Eligibility override', h('div', {},
            h('p', {}, `${registration.name || 'This registration'} needs review for ${sectionLabel(target)}.`),
            h('p', { class: 'muted small' }, evaluation.reasons.join(' · ')),
            setupField('Override reason', reason), message
          ), [
            { label: 'Cancel', onClick: () => render() },
            { label: 'Assign with override', kind: 'primary', onClick: () => {
              if (!reason.value.trim()) { message.className = 'dialog-message error'; message.textContent = 'A reason is required.'; return false; }
              apply({ eligibilityOverrideReason: reason.value.trim(), allowOverCapacity: true });
            }}
          ]);
          return;
        }
        const pool = isTeam(target) ? (target.rosterPlayers ?? []) : (target.players ?? []);
        if (target.expectedPlayers > 0 && pool.length >= target.expectedPlayers) {
          confirmModal('Exceed section target?', `${sectionLabel(target)} already has its target of ${target.expectedPlayers}. Assign ${registration.name || 'this registration'} anyway?`, () => apply({ allowOverCapacity: true }), 'Assign anyway');
          return;
        }
      }
      try {
        store.setRegistrationSection(event.id, registration.id, targetId);
        render();
      } catch (error) {
        toast(error.message);
        render();
      }
    }
  },
  h('option', { value: '', selected: selectedValue === '' }, 'Not assigned'),
  assignments.length > 1 ? h('option', { value: '__multiple__', selected: selectedValue === '__multiple__' }, 'Multiple sections') : null,
  children.map(child => h('option', {
    value: child.id,
    selected: selectedValue === child.id
  }, sectionLabel(child))));
  return h('div', { class: 'registration-section-cell' },
    select,
    withdrawnAssignment ? h('span', { class: 'pill red' }, 'Withdrawn') : null,
    withdrawnAssignment ? h('button', {
      class: 'btn ghost registration-reinstate',
      title: `Return to ${sectionLabel(withdrawnAssignment.child)}`,
      'aria-label': `Reinstate ${registration.name || 'registration'} in ${sectionLabel(withdrawnAssignment.child)}`,
      onclick: () => {
        try {
          store.reinstateRegistration(withdrawnAssignment.child.id, registration.id);
          render();
        } catch (error) {
          toast(error.message);
        }
      }
    }, 'Reinstate') : null);
}

function openRegistrationDialog(event, { registration = null, assignSection = null } = {}) {
  const current = registration ?? {};
  const name = h('input', { type: 'text', value: current.name ?? '', placeholder: 'Full name' });
  const fideId = h('input', { type: 'text', value: current.fideId ?? '' });
  const nationalId = h('input', { type: 'text', value: current.ids?.national ?? '' });
  const fed = h('input', { type: 'text', value: current.fed ?? event.defaultFed ?? event.federation ?? '', maxlength: 3 });
  const rating = h('input', { type: 'number', min: 0, value: current.rating ?? '' });
  const internationalRatings = Object.fromEntries(['fideStandard','fideRapid','fideBlitz'].map(key=>[key,h('input',{type:'number',min:0,value:current.ratings?.[key]||0})]));
  const nationalRating = h('input', { type: 'number', min: 0, value: current.ratings?.national ?? '' });
  const club = h('input', { type: 'text', value: current.club ?? '' });
  const birthDate = h('input', { type: 'date', value: current.birthDate ?? '' });
  const byear = h('input', { type: 'number', min: 1900, max: 2200, value: current.byear ?? '' });
  const title = h('input', { type: 'text', value: current.title ?? '' });
  const sex = h('select', {}, [
    { id: '', label: 'Not specified' },
    { id: 'm', label: 'Male' },
    { id: 'w', label: 'Female' }
  ].map(choice => h('option', { value: choice.id, selected: (current.sex ?? '') === choice.id }, choice.label)));
  const group = h('input', { type: 'text', value: current.group ?? '' });
  const playerType = h('input', { type: 'text', value: current.type ?? '', placeholder: 'U14, S50, Open…' });
  const message = h('div', { class: 'dialog-message' });

  modal(registration ? 'Edit registration' : 'New registration', h('div', {},
    h('div', { class: 'setup-grid' },
      setupField('Name', name), setupField('Federation', fed),
      setupField('FIDE ID', fideId), setupField('National ID', nationalId),
      setupField('Rating', rating), setupField('National rating', nationalRating),
      ...Object.entries(internationalRatings).map(([key,node])=>setupField(({fideStandard:'FIDE standard',fideRapid:'FIDE rapid',fideBlitz:'FIDE blitz'})[key],node)),
      setupField('Club / school', club), setupField('Date of birth', birthDate, 'Used for exact tournament age-band checks.'),
      setupField('Birth year', byear, 'Legacy fallback. A cutoff-boundary year is marked Needs DOB review.'),
      setupField('Title', title), setupField('Sex', sex),
      setupField('Group', group), setupField('Player category / type', playerType)),
    message
  ), [
    { label: 'Cancel' },
    { label: registration ? 'Save' : 'Add registration', kind: 'primary', onClick: () => {
      if (!name.value.trim()) {
        message.className = 'dialog-message error';
        message.textContent = 'Name is required.';
        return false;
      }
      const values = {
        name: name.value.trim(), fideId: fideId.value.trim(), fed: fed.value.trim().toUpperCase(),
        rating: Number(rating.value) || 0, club: club.value.trim(), birthDate: birthDate.value,
        byear: birthDate.value ? Number(birthDate.value.slice(0, 4)) : Number(byear.value) || '',
        title: title.value.trim(), sex: sex.value, group: group.value.trim(), type: playerType.value.trim(),
        ids: { ...(current.ids ?? {}), national: nationalId.value.trim() },
        ratings: { ...(current.ratings ?? {}), ...Object.fromEntries(Object.entries(internationalRatings).map(([key,node])=>[key,+node.value||0])), national: Number(nationalRating.value) || 0 }
      };
      try {
        const saved = registration
          ? store.updateRegistration(event.id, registration.id, values)
          : store.registerPlayer(event.id, values);
        if (assignSection && !assignedPerson(assignSection, saved.id)) {
          if (isTeam(assignSection)) openTeamRegistrationAssignment(assignSection, saved);
          else store.assignRegistration(assignSection.id, saved.id);
        }
        render();
      } catch (error) {
        message.className = 'dialog-message error';
        message.textContent = error.message;
        return false;
      }
    }}
  ], { wide: true });
  name.focus();
}

function quickAddRegistrations(event) {
  const input = h('textarea', { class: 'quick-add-input', rows: 6, placeholder: 'Alice Smith, Bob Tan, Carol Lee' });
  modal('Quick add registrations', h('div', {},
    input,
    h('p', { class: 'muted small' }, 'Separate names with commas. Name-only duplicates remain separate and are flagged for review.')
  ), [
    { label: 'Cancel' },
    { label: 'Add registrations', kind: 'primary', onClick: () => {
      const names = store.parseQuickAddNames(input.value);
      if (!names.length) { toast('Enter at least one name.'); return false; }
      for (const name of names) store.registerPlayer(event.id, { name }, { emit: false });
      store.refreshRegistrationDuplicateCandidates(event);
      store.emit();
      render();
    }}
  ]);
  input.focus();
}

async function importRegistrationCSV(event) {
  const text = await window.tl.openCsv();
  if (!text) return;
  const rows = parseRegistrationCSV(text, event);
  for (const row of rows) store.registerPlayer(event.id, row, { emit: false });
  store.refreshRegistrationDuplicateCandidates(event);
  store.emit();
  toast(`Imported ${rows.length} registration${rows.length === 1 ? '' : 's'}.`);
  render();
}

function parseRegistrationCSV(text, event) {
  const lines = String(text).split(/\r?\n/).filter(line => line.trim());
  if (!lines.length) return [];
  const headers = lines[0].toLowerCase().split(/[,;\t]/).map(cell => cell.trim());
  const hasHeader = headers.some(header => ['name', 'rating', 'fed', 'club'].includes(header));
  const index = name => headers.indexOf(name);
  const dateHeaders = ['birthdate', 'dob', 'dateofbirth'];
  return lines.slice(hasHeader ? 1 : 0).map(line => {
    const cells = line.split(/[,;\t]/).map(cell => cell.trim().replace(/^"|"$/g, ''));
    const get = (name, fallback) => hasHeader && index(name) >= 0 ? cells[index(name)] : cells[fallback];
    const getAny = names => names.map(name => get(name, -1)).find(Boolean) ?? '';
    const name = get('name', 0);
    if (!name) return null;
    return {
      name, rating: Number(get('rating', 1)) || 0,
      fed: get('fed', 2) || event.defaultFed || event.federation || '',
      club: get('club', 3) || '', birthDate: getAny(dateHeaders), byear: Number(get('byear', 4)) || '',
      fideId: get('fideid', 5) || '',
      ratings: { national: Number(get('nationalrating', -1)) || 0 },
      ids: { national: get('nationalid', -1) || '' }
    };
  }).filter(Boolean);
}

function openTeamRegistrationAssignment(child, registration) {
  const teams = [...(child.players ?? [])].sort((a, b) => (a.no ?? 0) - (b.no ?? 0));
  const team = h('select', {},
    h('option', { value: '' }, 'Unassigned roster pool'),
    teams.map(item => h('option', { value: item.id }, item.name || `Team ${item.no}`)));
  const board = h('input', { type: 'number', min: 1, value: 1 });
  const reserve = h('input', { type: 'checkbox' });
  modal(`Assign ${registration.name}`, h('div', { class: 'setup-grid' },
    setupField('Team', team), setupField('Board order', board), setupField('Reserve', reserve)
  ), [
    { label: 'Cancel' },
    { label: 'Assign registration', kind: 'primary', onClick: () => {
      try {
        store.assignRegistration(child.id, registration.id, {
          teamPlayerId: team.value || undefined,
          board: Number(board.value) || 1,
          reserve: reserve.checked
        });
        render();
      } catch (error) {
        toast(error.message);
        return false;
      }
    }}
  ]);
}

function reviewSuggestedAssignments(event, children) {
  const preview = store.suggestAssignments(event.id, children.map(child => child.id));
  const labels = registrationSectionLabels(event, children);
  const labelByChildId = new Map(children.map((child, index) => [child.id, labels[index]]));
  const sectionLabel = child => labelByChildId.get(child.id) ?? 'Section';
  const choices = [];
  const table = h('table', { class: 'db suggestion-matrix' },
    h('tr', {}, h('th', {}, 'Registration'), h('th', {}, 'Suggested section')),
    preview.suggestions.map(suggestion => {
      const registration = event.registrations.find(item => item.id === suggestion.registrationId);
      const assignments = registrationAssignments(children, suggestion.registrationId);
      const assignedIds = new Set(assignments.map(item => item.child.id));
      const locked = assignments.some(item => item.child.roundsData?.length || item.child.currentRound);
      const currentValue = assignments.length === 1 ? assignments[0].child.id : assignments.length ? '__multiple__' : '';
      const selectedValue = currentValue || suggestion.childIds[0] || '';
      const select = h('select', {
        class: 'suggestion-section-picker',
        disabled: locked,
        'aria-label': `Suggested section for ${registration?.name || 'registration'}`
      },
      h('option', { value: '', selected: selectedValue === '' }, 'Not assigned'),
      assignments.length > 1 ? h('option', { value: '__multiple__', selected: selectedValue === '__multiple__' }, 'Multiple sections') : null,
      children.map(child => {
        const eligible = suggestion.childIds.includes(child.id);
        const reasons = suggestion.evaluations[child.id]?.reasons ?? [];
        return h('option', {
          value: child.id,
          selected: selectedValue === child.id,
          disabled: !eligible && !assignedIds.has(child.id),
          title: reasons.join(', ')
        }, sectionLabel(child));
      }));
      choices.push({ select, registration, initialValue: currentValue });
      return h('tr', {},
        h('td', {}, registration?.name || ''),
        h('td', {}, h('div', { class: 'registration-section-cell' },
          select,
          locked ? h('span', { class: 'pill' }, 'Locked') : null)));
    }));
  modal('Review suggested assignments', h('div', {},
    h('p', { class: 'muted small' }, 'Choose one suggested section per registration. Ineligible sections are unavailable, and assignments with pairing history stay locked.'),
    h('div', { class: 'table-scroll' }, table)
  ), [
    { label: 'Cancel' },
    { label: 'Apply selected', kind: 'primary', onClick: () => {
      let applied = 0;
      for (const choice of choices) {
        if (choice.select.disabled || choice.select.value === '__multiple__' || choice.select.value === choice.initialValue) continue;
        store.setRegistrationSection(event.id, choice.registration.id, choice.select.value, { emit: false });
        applied++;
      }
      if (applied) store.emit();
      toast(`Applied ${applied} assignment${applied === 1 ? '' : 's'}.`);
      render();
    }}
  ], { wide: true });
}

function reviewRegistrationDuplicates(event) {
  const registration = id => event.registrations.find(item => item.id === id);
  modal('Possible duplicate registrations', h('div', {},
    h('p', { class: 'muted small' }, 'These records share a name but did not have an exact FIDE or national ID match, so TourneyLab kept them separate.'),
    h('div', { class: 'duplicate-list' }, (event.registrationDuplicateCandidates ?? []).map(([leftId, rightId]) => {
      const left = registration(leftId), right = registration(rightId);
      if (!left || !right) return null;
      return h('div', { class: 'duplicate-row' },
        h('span', { class: 'grow' }, `${left.name} · ${left.fideId || left.ids?.national || 'No federation ID'} / ${right.fideId || right.ids?.national || 'No federation ID'}`),
        h('button', { class: 'btn', onclick: () => {
          try { store.mergeRegistrations(event.id, left.id, right.id); render(); }
          catch (error) { toast(error.message); }
        } }, 'Merge'));
    }))
  ), [{ label: 'Done' }], { wide: true });
}

function registrationMenu(event, registration) {
  modal(registration.name || 'Registration', h('p', { class: 'muted small' }, 'Registration changes update every assigned section; pairing numbers and existing results stay unchanged.'), [
    { label: 'Done' },
    registration.archived
      ? { label: 'Restore', onClick: () => { store.updateRegistration(event.id, registration.id, { archived: false }); render(); } }
      : { label: 'Archive', kind: 'danger', onClick: () => { store.archiveRegistration(event.id, registration.id); render(); } },
    { label: 'Edit registration', kind: 'primary', onClick: () => openRegistrationDialog(event, { registration }) }
  ]);
}

// =================================================================== OVERVIEW
function sectionInheritedValue(event, section, field, value, fallback = 'Not set') {
  const source = store.sectionSetupSource(section, field);
  const label = source === 'tournament' ? 'Inherited from tournament' : source === 'locked' ? 'Locked for this section' : 'Section override';
  const pillClass = source === 'tournament' ? 'blue' : source === 'section' ? 'yellow' : '';
  return h('span', { class: 'overview-source-value' },
    overviewText(value, fallback),
    h('span', { class: `pill ${pillClass}`.trim() }, label));
}

function Overview(t) {
  const event = store.activeEvent;
  const resolved = store.resolvedSectionSetup(event, t);
  const workflow = sectionWorkflowSummary(event, t);
  const started = !!t.roundsData.length;
  const ageLimit = sectionMaximumAge(event, t);
  const eligibility = [
    ageLimit !== '' ? `under ${ageLimit} on ${event.ageScheme?.cutoffDate || 'cutoff date'}` : '',
    t.eligibility?.ratingMin !== '' && t.eligibility?.ratingMin != null ? `rating ${t.eligibility.ratingMin}+` : '',
    t.eligibility?.ratingMax !== '' && t.eligibility?.ratingMax != null ? `rating up to ${t.eligibility.ratingMax}` : '',
    t.eligibility?.birthYearMin !== '' && t.eligibility?.birthYearMin != null ? `born ${t.eligibility.birthYearMin}+` : '',
    t.eligibility?.birthYearMax !== '' && t.eligibility?.birthYearMax != null ? `born through ${t.eligibility.birthYearMax}` : ''
  ].filter(Boolean).join(' · ') || 'Open eligibility';
  const pairing = t.type.includes('rr') || t.type === 'roundrobin'
    ? 'Berger round-robin tables'
    : t.type === 'ko' ? 'Knockout bracket' : `${pairingSystemChoices(t.type).find(choice => choice.id === t.pairingSystem)?.label ?? 'FIDE Dutch'}${t.fideMode ? ' · FIDE mode' : ''}`;
  const dates = [resolved.startDate, resolved.endDate].filter(Boolean).join(' to ');

  return page(h('div', { class: 'section-overview' },
    sectionPageIdentity(event, t),
    h('div', { class: 'event-command-bar' },
      h('button', { class: 'btn primary', onclick: () => go(workflow.nextAction.view) }, workflow.nextAction.label),
      h('button', { class: 'btn', onclick: () => go('setup') }, iconLabel('⚙️', 'Section setup')),
      h('button', { class: 'btn ghost', onclick: () => go('event-overview') }, 'Tournament overview')),
    h('div', { class: 'props' },
      overviewProp('🗂️', 'Format', overviewText(typeLabel(t.type))),
      overviewProp('🔁', 'Rounds', overviewText(String(t.rounds))),
      overviewProp('👥', isTeam(t) ? 'Teams' : 'Players', overviewText(String(workflow.participants))),
      overviewProp('📈', 'Progress', overviewText(started ? `Round ${t.currentRound} of ${t.rounds}` : 'Not started')),
      overviewProp('↕', 'Boards', overviewText(sectionBoardRange(t))),
      overviewProp('🎯', 'Pairing', overviewText(pairing)),
      overviewProp('👥', 'Eligibility', overviewText(eligibility))),
    h('h2', { class: 'sec' }, 'Tournament details used by this section'),
    h('p', { class: 'muted small section-context-note' }, 'Change inherited values from Tournament Setup, or create an override from Section Setup.'),
    h('div', { class: 'props section-inherited-overview' },
      overviewProp('📍', 'Venue / city', sectionInheritedValue(event, t, 'site', resolved.site)),
      overviewProp('📅', 'Dates', sectionInheritedValue(event, t, 'startDate', dates)),
      overviewProp('🕓', 'Time control', sectionInheritedValue(event, t, 'timeControl', resolved.timeControl)),
      overviewProp('🏳️', 'Rating type', sectionInheritedValue(event, t, 'ratingType', ratingTypeLabel(resolved.ratingType))),
      overviewProp('📊', 'Rating status', sectionInheritedValue(event, t, 'rated', resolved.rated === false ? 'Unrated' : 'Rated'))),
    workflow.status.errors.length
      ? h('div', { class: 'callout err', role: 'alert' }, h('span', { class: 'ic' }, icon('⛔')),
          h('div', {}, h('b', {}, 'Setup needs attention'), h('ul', {}, workflow.status.errors.map(message => h('li', {}, message)))))
      : workflow.status.warnings.length
        ? h('details', { class: 'callout warn setup-warnings' },
            h('summary', {},
              h('span', { class: 'ic' }, icon('⚠️')),
              h('span', { class: 'setup-warnings-title' }, `${workflow.status.warnings.length} setup warning${workflow.status.warnings.length === 1 ? '' : 's'} to review before pairing.`),
              h('span', { class: 'setup-warning-toggle' }, 'Review details'),
              h('span', { class: 'setup-warning-chevron', 'aria-hidden': 'true' }, '›')),
            h('div', { class: 'setup-warning-details' },
              h('p', { class: 'muted small' }, 'Review each issue below. Use its action to open the workspace where it is managed.'),
              h('ul', { class: 'setup-warning-list' }, workflow.status.warnings.map(message => {
                const action = setupWarningAction(message, t);
                return h('li', { class: 'setup-warning-item' },
                  h('div', { class: 'setup-warning-copy' },
                    h('b', {}, message),
                    h('p', { class: 'setup-warning-guidance' }, action.guidance)),
                  h('div', { class: 'setup-warning-actions' },
                    h('button', { class: 'btn setup-warning-action', onclick: () => go(action.view) }, action.label),
                    action.secondaryView
                      ? h('button', { class: 'btn ghost', onclick: () => go(action.secondaryView) }, action.secondaryLabel)
                      : null));
              }))))
        : null,
    workflow.status.notices?.length
      ? h('details', { class: 'callout setup-notices' },
          h('summary', {},
            h('span', { class: 'ic' }, icon('ℹ️')),
            h('span', { class: 'setup-warnings-title' }, 'Section-specific settings'),
            h('span', { class: 'setup-warning-toggle' }, 'Show details'),
            h('span', { class: 'setup-warning-chevron', 'aria-hidden': 'true' }, '›')),
          h('div', { class: 'setup-warning-details' },
            h('p', { class: 'muted small' }, 'These are intentional differences from the tournament defaults, not pairing problems.'),
            h('ul', { class: 'setup-warning-list' }, workflow.status.notices.map(message => {
              const action = setupWarningAction(message, t);
              return h('li', { class: 'setup-warning-item' },
                h('div', { class: 'setup-warning-copy' },
                  h('b', {}, message),
                  h('p', { class: 'setup-warning-guidance' }, action.guidance)),
                h('div', { class: 'setup-warning-actions' },
                  h('button', { class: 'btn setup-warning-action', onclick: () => go(action.view) }, action.label),
                  action.secondaryView
                    ? h('button', { class: 'btn ghost', onclick: () => go(action.secondaryView) }, action.secondaryLabel)
                    : null));
            }))))
      : null
  ));
}

function cycleIcon(t) {
  const icons = ['♟️', '♞', '♜', '♛', '♚', '🏆', '⚔️', '🎯'];
  t.icon = icons[(icons.indexOf(t.icon ?? '♟️') + 1) % icons.length];
  commit();
}

// =================================================================== PLAYERS
const PLAYER_WIDTHS_KEY = 'tourneylab.playerColumnWidths';
const PLAYER_COLUMNS = [
  { key: 'number', label: 'No.', class: 'num', width: 58, min: 44 },
  { key: 'name', label: 'Name', teamLabel: 'Team', width: 260, min: 140 },
  { key: 'rating', label: 'Rating', class: 'num', width: 82, min: 62 },
  { key: 'fed', label: 'Fed', width: 68, min: 50 },
  { key: 'club', label: 'Club', teamLabel: 'Captain', width: 150, min: 90 },
  { key: 'born', label: 'Born', class: 'num', width: 76, min: 58, individualOnly: true },
  { key: 'type', label: 'Type', width: 70, min: 52, individualOnly: true },
  { key: 'points', label: 'Pts', class: 'num', width: 60, min: 46 },
  { key: 'status', label: 'Status', width: 108, min: 76 },
  { key: 'actions', label: '', width: 52, min: 40 }
];

function Players(t) {
  if(isTeam(t))return TeamsPage(t);
  const started = t.roundsData.length > 0;
  const states = computeStates(t, t.currentRound);
  const u = unit(t);
  const columns = PLAYER_COLUMNS.filter(col => !col.individualOnly || !isTeam(t));

  const head = h('tr', {}, columns.map(col => playerHeaderCell(t, col)));

  const rows = [...t.players].sort((a, b) => a.no - b.no).map(p => {
    const s = states.get(p.id);
    const cell = (key, cls = '', type = 'text') => h('input', {
      class: cls, type, value: p[key] ?? '',
      onchange: e => {
        const value = type === 'number' ? +e.target.value || 0 : e.target.value;
        if (p.registrationId && !isTeam(t)) {
          store.updateRegistration(t.eventId, p.registrationId, { [key]: value });
          render();
        } else {
          p[key] = value;
          if (key === 'byear') store.applyAgeGroups(t);
          store.emit();
        }
      }
    });
    return h('tr', {},
      h('td', { class: 'num' }, h('input', { class: 'w-s num', type: 'number', value: p.no, disabled: started, onchange: e => { p.no = +e.target.value || p.no; store.emit(); } })),
      h('td', {}, cell('name')),
      h('td', { class: 'num' }, cell('rating', 'w-s num', 'number')),
      h('td', {}, cell('fed', 'w-s')),
      h('td', {}, isTeam(t) ? cell('captain') : cell('club')),
      isTeam(t) ? null : h('td', { class: 'num' }, cell('byear', 'w-s num', 'number')),
      isTeam(t) ? null : h('td', {}, h('span', { class: 'pill' }, p.type || '—')),
      h('td', { class: 'num' }, fmt(s?.score ?? 0)),
      h('td', {}, statusPill(t, p)),
      h('td', {},
        h('button', { class: 'btn ghost', title: 'Player actions', onclick: () => playerMenu(t, p) }, '⋯'))
    );
  });

  return page(
    h('div', { class: 'page-icon' }, icon('👥')),
    h('h1', { class: 'page-title', style: 'pointer-events:none' }, isTeam(t) ? 'Teams & rosters' : 'Players'),
    h('p', { class: 'page-sub' }, isTeam(t)
      ? 'Teams are paired as units by match points; enter board scores per match in Rounds & results.'
      : 'Pairing numbers — not ratings — drive FIDE-mode pairings. Renumber by rating before round 1.'),
    h('div', { class: 'toolbar' },
      isTeam(t)
        ? h('button', { class: 'btn primary', onclick: () => { store.addPlayer(t); render(); } }, iconLabel('＋', 'New team'))
        : h('button', { class: 'btn primary', onclick: () => openRegistrationDialog(store.activeEvent, { assignSection: t }) }, iconLabel('＋', 'New registration')),
      h('button', {
        class: 'btn', onclick: () => go('registrations')
      }, iconLabel('👥', 'Assign from registrations')),
      h('button', { class: 'btn', onclick: () => quickAddPlayers(t) }, iconLabel('＋', 'Quick Add')),
      h('button', { class: 'btn', disabled: started, onclick: () => { store.renumberByRating(t); render(); } }, iconLabel('↕', 'Renumber by rating')),
      h('button', { class: 'btn', onclick: () => importCSV(t) }, iconLabel('📥', 'Import CSV (rating list)')),
      h('button', { class: 'btn', onclick: () => forbiddenEditor(t) }, iconLabel('🚫', `Forbidden pairings (${t.forbidden.length})`)),
      h('span', { class: 'spacer' }),
      started && t.players.length && !store.pairingNumbersFollowRatings(t)
        ? h('span', { class: 'pill yellow', title: 'FIDE mode pairs by pairing number; Swiss-Manager-style warning' }, iconLabel('⚠', 'Pairing numbers do not follow ratings'))
        : null
    ),
    t.players.length
      ? h('table', { class: 'db players-table' }, playerColGroup(columns), head, rows)
      : h('div', { class: 'empty' }, `No ${u}s yet. Add ${u}s or import a CSV rating list (columns: name, rating, fed, club, byear, fideid).`),
    isTeam(t) ? rosterOverview(t) : null,
    h('div', { class: 'addrow', onclick: () => { store.addPlayer(t); render(); } }, iconLabel('＋', `New ${u}`)),
    started ? h('div', { class: 'callout' }, h('span', { class: 'ic' }, icon('🕓')),
      h('div', {}, h('b', {}, 'Late entry: '), `add the ${u} here. In Rounds & results, use Pair with the bye ${u} to play the current bye, or Pair the rest to fold them into the unpaired field.`)) : null
  );
}

function playerColGroup(columns) {
  const widths = loadPlayerWidths();
  return h('colgroup', {}, columns.map(col => h('col', {
    dataset: { colKey: col.key },
    style: `width:${Math.max(col.min, Number(widths[col.key]) || col.width)}px`
  })));
}

function playerHeaderCell(t, col) {
  const label = isTeam(t) && col.teamLabel ? col.teamLabel : col.label;
  return h('th', {
    class: `${col.class ?? ''} resizable`.trim(),
    title: col.key === 'number' ? 'Pairing number' : undefined
  },
  h('span', { class: 'header-label' }, label || '\u00a0'),
  h('span', {
    class: 'col-resizer',
    title: 'Drag to resize column',
    role: 'separator',
    'aria-label': `Resize ${label || 'actions'} column`,
    onpointerdown: e => resizePlayerColumn(e, col)
  }));
}

function resizePlayerColumn(e, col) {
  const table = e.currentTarget.closest('table');
  const targetCol = table?.querySelector(`col[data-col-key="${col.key}"]`);
  if (!table || !targetCol) return;
  e.preventDefault();
  e.stopPropagation();
  const startX = e.clientX;
  const startWidth = targetCol.getBoundingClientRect().width || Number.parseFloat(targetCol.style.width) || col.width;
  let currentWidth = startWidth;
  table.classList.add('resizing');
  document.body.classList.add('col-resize-active');
  const move = ev => {
    currentWidth = Math.max(col.min, startWidth + ev.clientX - startX);
    targetCol.style.width = `${currentWidth}px`;
  };
  const finish = () => {
    savePlayerWidth(col.key, currentWidth);
    table.classList.remove('resizing');
    document.body.classList.remove('col-resize-active');
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', finish);
    document.removeEventListener('pointercancel', finish);
  };
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', finish);
  document.addEventListener('pointercancel', finish);
}

function loadPlayerWidths() {
  try { return JSON.parse(window.localStorage?.getItem(PLAYER_WIDTHS_KEY) || '{}') ?? {}; }
  catch { return {}; }
}

function savePlayerWidth(key, width) {
  try {
    window.localStorage?.setItem(PLAYER_WIDTHS_KEY, JSON.stringify({ ...loadPlayerWidths(), [key]: Math.round(width) }));
  } catch {}
}

function statusPill(t, p) {
  if (p.withdrawn) return h('span', { class: 'pill red' }, 'Withdrawn');
  if (p.active === false) return h('span', { class: 'pill yellow' }, 'Excluded');
  const next = t.currentRound + 1;
  const rb = (p.requestedByes ?? {})[next];
  if (rb) return h('span', { class: 'pill blue' }, `R${next}: ${byeLabel(rb)}`);
  if ((p.excludedRounds ?? []).includes(next)) return h('span', { class: 'pill yellow' }, `R${next}: not paired`);
  return h('span', { class: 'pill green' }, 'Active');
}

function playerMenu(t, p) {
  const next = Math.min(t.currentRound + 1, t.rounds);
  const byeSel = h('select', {},
    h('option', { value: '' }, '— no requested bye —'),
    ['HPB', 'FPB', 'ZPB'].map(v => h('option', { value: v, selected: (p.requestedByes ?? {})[next] === v }, `${byeLabel(v)} (${byePoints(v, t)} pt)`)));
  const skip = h('input', { type: 'checkbox', checked: (p.excludedRounds ?? []).includes(next) });
  const excl = h('input', { type: 'checkbox', checked: p.active === false });
  const wd = h('input', { type: 'checkbox', checked: !!p.withdrawn });
  p.ratings ??= {};
  p.ids ??= {};
  const ratingInputs = Object.fromEntries([
    ['fideStandard', 'FIDE standard'], ['fideRapid', 'FIDE rapid'],
    ['fideBlitz', 'FIDE blitz'], ['national', 'National rating'], ['local', 'Local / club rating']
  ].map(([key, label]) => [key, { label, input: h('input', { type: 'number', value: p.ratings[key] ?? '' }) }]));
  const nationalId = h('input', { type: 'text', value: p.ids.national ?? '' });

  modal(`${p.name || 'Unnamed'} — round ${next} & status`, h('div', {},
    h('div', { class: 'props' },
      h('div', { class: 'prop' }, h('div', { class: 'k' }, `Requested bye, round ${next}`), h('div', { class: 'v' }, byeSel)),
      h('div', { class: 'prop' }, h('div', { class: 'k' }, `Do not pair in round ${next}`), h('div', { class: 'v' }, skip)),
      h('div', { class: 'prop' }, h('div', { class: 'k' }, 'Exclude for remaining rounds'), h('div', { class: 'v' }, excl)),
      h('div', { class: 'prop' }, h('div', { class: 'k' }, 'Withdraw from tournament'), h('div', { class: 'v' }, wd)),
      Object.values(ratingInputs).map(item => h('div', { class: 'prop' }, h('div', { class: 'k' }, item.label), h('div', { class: 'v' }, item.input))),
      h('div', { class: 'prop' }, h('div', { class: 'k' }, 'National ID'), h('div', { class: 'v' }, nationalId))),
    h('p', { class: 'muted small' }, 'Excluded players stay in the file but are not paired, and can be reactivated later. Requested byes (½, 1, 0) are administrative results — they record no opponent and no colour.')
  ), [
    { label: p.registrationId ? 'Unassign' : 'Remove from file', kind: 'danger', onClick: () => confirmModal(p.registrationId ? 'Unassign' : 'Remove', p.registrationId ? `Remove ${p.name} from this section? After pairing begins this records a withdrawal.` : `Remove ${p.name}? Only possible before round 1.`, () => {
      if (p.registrationId) { store.unassignRegistration(t.id, p.registrationId); render(); return; }
      if (t.roundsData.length) { toast('Cannot remove after pairing started; withdraw instead.'); return; }
      t.players = t.players.filter(x => x.id !== p.id); commit();
    }) },
    { label: 'Cancel' },
    {
      label: 'Save', kind: 'primary', onClick: () => {
        p.requestedByes = p.requestedByes ?? {};
        if (byeSel.value) p.requestedByes[next] = byeSel.value; else delete p.requestedByes[next];
        p.excludedRounds = p.excludedRounds ?? [];
        if (skip.checked && !p.excludedRounds.includes(next)) p.excludedRounds.push(next);
        if (!skip.checked) p.excludedRounds = p.excludedRounds.filter(r => r !== next);
        p.active = !excl.checked;
        p.withdrawn = wd.checked;
        const nextRatings = Object.fromEntries(Object.entries(ratingInputs).map(([key, item]) => [key, Number(item.input.value) || 0]));
        const nextIds = { ...(p.ids ?? {}), national: nationalId.value };
        if (p.registrationId) {
          store.updateRegistration(t.eventId, p.registrationId, { ratings: nextRatings, ids: nextIds }, { emit: false });
        } else {
          p.ratings = nextRatings;
          p.ids = nextIds;
          applyRatingPolicy(t);
        }
        commit();
      }
    }
  ]);
}

function quickAddPlayers(t) {
  const u = unit(t);
  const input = h('textarea', {
    class: 'quick-add-input',
    placeholder: isTeam(t) ? 'Team Alpha, Team Beta, Team Gamma' : 'Alice Smith, Bob Tan, Carol Lee',
    rows: 6
  });

  const addNames = names => {
    const added = store.addPlayers(t, names.map(name => ({ name })));
    toast(`Added ${added.length} ${u}${added.length === 1 ? '' : 's'}.`);
    render();
  };

  const submit = () => {
    const names = store.parseQuickAddNames(input.value);
    if (!names.length) {
      toast(`Enter at least one ${u} name.`);
      return false;
    }

    const duplicates = store.findDuplicatePlayerNames(t, names);
    if (duplicates.length) {
      confirmModal('Duplicate names detected',
        `${duplicates.length} duplicate ${u} name${duplicates.length === 1 ? '' : 's'} detected. Add all anyway?`,
        () => addNames(names),
        'Add anyway');
      return true;
    }

    addNames(names);
    return true;
  };

  modal(`Quick Add ${u}s`, h('div', {},
    input,
    h('p', { class: 'muted small' }, `Separate ${u} names with commas. Other fields can be filled in later.`)
  ), [
    { label: 'Cancel' },
    { label: 'Add', kind: 'primary', onClick: submit }
  ]);
  input.focus();
}

async function importCSV(t) {
  const text = await window.tl.openCsv();
  if (!text) return;
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  const headerCells = lines[0].toLowerCase().split(/[,;\t]/).map(s => s.trim());
  const hasHeader = headerCells.some(c => ['name', 'rating', 'fed', 'club'].includes(c));
  const col = n => headerCells.indexOf(n);
  let added = 0;
  for (const line of lines.slice(hasHeader ? 1 : 0)) {
    const cells = line.split(/[,;\t]/).map(s => s.trim().replace(/^"|"$/g, ''));
    const get = (n, fallbackIdx) => hasHeader && col(n) >= 0 ? cells[col(n)] : cells[fallbackIdx];
    const name = get('name', 0);
    if (!name) continue;
    const ratings = {
      fideStandard: +get('fidestandard', -1) || 0,
      fideRapid: +get('fiderapid', -1) || 0,
      fideBlitz: +get('fideblitz', -1) || 0,
      national: +get('nationalrating', -1) || 0,
      local: +get('localrating', -1) || 0
    };
    store.addPlayer(t, {
      name,
      rating: +get('rating', 1) || 0,
      fed: get('fed', 2) || t.defaultFed || '',
      club: get('club', 3) || '',
      byear: +get('byear', 4) || '',
      fideId: get('fideid', 5) || '',
      ratings,
      ids: { national: get('nationalid', -1) || '' }
    });
    added++;
  }
  applyRatingPolicy(t);
  toast(`Imported ${added} ${unit(t)}s.`);
  render();
}

function forbiddenEditor(t) {
  const selA = playerSelect(t), selB = playerSelect(t);
  const list = h('div', {}, t.forbidden.map(([a, b], i) =>
    h('div', { class: 'flex', style: 'padding:3px 0' },
      h('span', { class: 'grow' }, `${playerName(t, a)} — ${playerName(t, b)}`),
      h('button', { class: 'btn ghost', onclick: e => { t.forbidden.splice(i, 1); store.emit(); e.target.closest('.flex').remove(); } }, icon('✕')))));
  modal('Forbidden pairings', h('div', {},
    h('p', { class: 'muted small' }, 'These pairs will never be paired together (max 500). Club protection in Settings extends this to whole clubs.'),
    list,
    h('div', { class: 'flex', style: 'margin-top:10px' }, selA, selB,
      h('button', {
        class: 'btn', onclick: () => {
          if (selA.value && selB.value && selA.value !== selB.value) {
            if (t.forbidden.length >= 500) { toast('Maximum of 500 forbidden pairings reached.'); return; }
            t.forbidden.push([selA.value, selB.value]); store.emit(); render(); toast('Added.');
          }
        }
      }, 'Add'))
  ), [{ label: 'Done', kind: 'primary' }]);
}

function playerSelect(t, filterIds = null, placeholder = 'Select…') {
  return h('select', {},
    h('option', { value: '' }, placeholder),
    [...t.players].sort((a, b) => a.no - b.no)
      .filter(p => !filterIds || filterIds.includes(p.id))
      .map(p => h('option', { value: p.id }, `${p.no}. ${p.name || 'Unnamed'}`)));
}

// =================================================================== ROUNDS
let viewRound = null;
let pairedRoundMotionSectionId = null;
let roundPairingUndo = null;

const ROUND_PAIRING_WIDTHS_KEY = 'tourneylab.roundPairingColumnWidths';
const ROUND_PAIRING_COLUMNS = [
  { key: 'board', label: 'Bd.', class: 'num', width: 48, min: 40 },
  { key: 'whitePts', label: 'Pts', class: 'num', width: 52, min: 44 },
  { key: 'whitePRating', label: 'Rtg', class: 'num', width: 70, min: 58, rating: true },
  { key: 'white', label: 'White', width: 180, min: 96 },
  { key: 'result', label: 'Result', class: 'center', width: 132, min: 96 },
  { key: 'black', label: 'Black', width: 180, min: 96 },
  { key: 'blackPRating', label: 'Rtg', class: 'num', width: 70, min: 58, rating: true },
  { key: 'blackPts', label: 'Pts', class: 'num', width: 52, min: 44 }
];
const ROUND_ACTION_COLUMN_WIDTH = 44;
const ROUND_PAIRING_TABLE_WIDTH = 860;

const STANDINGS_WIDTHS_KEY = 'tourneylab.standingsColumnWidths';
const STANDINGS_RATING_MODE_KEY = 'tourneylab.standingsRatingMode';

function Rounds(t) {
  const rr = t.type === 'roundrobin' || t.type === 'team-rr';
  const ko = t.type === 'ko';
  if (viewRound == null || viewRound > t.roundsData.length) viewRound = t.roundsData.length || null;

  const nextRound = t.currentRound + 1;
  const ready = roundReadiness(t, nextRound);
  const pairingRoundLimit = Math.min(t.rounds, t.finalRound || t.rounds);
  const canPairMore = t.currentRound < pairingRoundLimit && t.players.filter(p => p.active !== false && !p.withdrawn).length >= 2;
  const pairingBlocked = !ready.ok && canPairMore;
  const ratingMode = standingsRatingMode();

  const kids = [
    h('div', { class: 'page-icon' }, icon('🔀')),
    h('h1', { class: 'page-title', style: 'pointer-events:none' }, 'Rounds & results'),
    h('p', { class: 'page-sub' }, ko
      ? 'Single-elimination KO. The first round seeds 1-vs-last with free tickets to the strongest players; each round pairs the winners. Mini-matches may use several replay games.'
      : rr
        ? 'Round-robin schedule. Enter results with keys 1–7 on a selected row.'
        : `${pairingSystemChoices(t.type).find(choice => choice.id === t.pairingSystem)?.label ?? 'FIDE Dutch'} pairings. ${t.pairingSystem === 'fide-double-swiss' ? 'Each board is two games. ' : ''}All results of a round are required before the next round can be paired; adjourned games count as draws for one round only.`)
  ];

  // pairing controls
  const controls = h('div', { class: 'toolbar' });
  if (ko) {
    const seeded = t.roundsData.length > 0;
    const lastRoundComplete = seeded && t.roundsData[t.roundsData.length - 1].pairings.every(pr => pr.result);
    const champion = koChampion(t);
    controls.append(h('button', {
      class: 'btn primary',
      disabled: champion != null || (seeded && !lastRoundComplete),
      title: champion != null ? 'Tournament complete' : (seeded && !lastRoundComplete ? 'Enter all results of the current round first' : ''),
      onclick: () => confirmPairingSetup(t, () => doPairKO(t), seeded ? 'Pair next KO round' : 'Seed round 1')
    }, iconLabel('⚙', seeded ? 'Pair next KO round' : 'Seed round 1')));
    if (champion) controls.append(h('span', { class: 'pill', style: 'background:#e7f5e9;color:#1a7f37' }, iconLabel('🏆', t.players.find(p => p.id === champion)?.name ?? 'Winner')));
  } else if (rr && t.roundsData.length === 0) {
    const modeSel = h('select', { class: 'btn', onchange: e => { t.rrMode = e.target.value; store.emit(); } },
      h('option', { value: 'berger', selected: (t.rrMode ?? 'berger') === 'berger' }, 'Berger round robin'),
      h('option', { value: 'rutsch', selected: t.rrMode === 'rutsch' }, 'Rutsch (sliding)'),
      t.type === 'roundrobin' ? h('option', { value: 'simultaneous', selected: t.rrMode === 'simultaneous' }, 'Simultaneous (rank 1 vs all)') : null,
      isTeam(t) ? h('option', { value: 'scheveningen', selected: t.rrMode === 'scheveningen' }, 'Scheveningen (2 teams)') : null
    );
    controls.append(
      modeSel,
      h('button', { class: 'btn primary', disabled: t.players.length < 2, onclick: () => confirmPairingSetup(t, () => generateRR(t), 'Generate full schedule') }, iconLabel('⚙', 'Generate full schedule')),
      h('label', { class: 'flex muted small' }, h('input', { type: 'checkbox', checked: t.doubleRR, disabled: t.rrMode === 'simultaneous' || t.rrMode === 'scheveningen', onchange: e => { t.doubleRR = e.target.checked; store.emit(); } }), ' double round robin')
    );
  } else if (!rr) {
    const tooltipId = `pair-round-blocker-${t.id}`;
    controls.append(h('span', {
      class: `pair-round-control${pairingBlocked ? ' blocked' : ''}`,
      tabindex: pairingBlocked ? '0' : undefined,
      'aria-describedby': pairingBlocked ? tooltipId : undefined
    },
    h('button', {
      class: 'btn primary',
      disabled: !canPairMore || !ready.ok,
      onclick: () => confirmPairingSetup(t, () => doPairRound(t), `Pair round ${nextRound}`)
    }, iconLabel('⚙', `Pair round ${nextRound}`)),
    pairingBlocked
      ? h('span', { id: tooltipId, class: 'pair-round-tooltip', role: 'tooltip' }, ready.summary)
      : null));
    if (t.roundsData.length === 0) {
      controls.append(h('button', {
        class: 'btn',
        disabled: t.players.filter(p => p.active !== false && !p.withdrawn).length < 2,
        onclick: () => confirmPairingSetup(t, () => startRoundManually(t), 'Start round manually')
      }, iconLabel('✎', 'Start round manually')));
    }
  }
  if (t.roundsData.length) {
    controls.append(h('span', { class: 'spacer' }));
    controls.append(h('button', {
      class: 'btn danger',
      onclick: () => {
        const round = viewRound;
        const laterRounds = t.roundsData.length > round;
        confirmModal(`Delete round ${round}`, laterRounds
          ? `Delete round ${round} and all later rounds, including their pairings, byes and results? Earlier rounds will be kept.`
          : `Delete round ${round}, including its pairings, byes and results? You can pair this round again.`, () => {
          roundPairingUndo = null;
          focusedBoard = null;
          viewRound = round > 1 ? round - 1 : null;
          store.deleteFromRound(t, round);
          render();
        });
      }
    }, `Delete round ${viewRound}`));
    if (roundPairingUndoAvailable(t, viewRound)) controls.append(h('button', {
      class: 'btn round-undo',
      title: `Undo ${roundPairingUndo.label}`,
      onclick: () => undoRoundPairingAction(t)
    }, iconLabel('↶', 'Undo')));
    controls.append(h('button', { class: 'btn', onclick: () => exportFile(pairingListHTML(t, viewRound, { event: store.activeEvent, ratingMode }), `${t.name}-R${viewRound}-pairings.html`, 'HTML', 'html', { openAfterExport: true }) }, iconLabel('🖨', 'Pairing list (HTML)')));
    controls.append(h('button', { class: 'btn', onclick: () => exportFile(isTeam(t) ? teamMatchCardsHTML(t, viewRound, { event: store.activeEvent }) : pairingCardsHTML(t, viewRound, { event: store.activeEvent }), `${t.name}-R${viewRound}-cards.html`, 'HTML', 'html', { openAfterExport: true }) }, iconLabel('🖨', isTeam(t) ? 'Match cards' : 'Pairing cards')));
  }
  kids.push(controls);

  if (ready.warnings.length && !rr) {
    kids.push(h('div', { class: 'callout warn' }, h('span', { class: 'ic' }, icon('⚠️')),
      h('div', {}, h('ul', { style: 'margin:0' }, ready.warnings.map(b => h('li', {}, b))))));
  }

  if (!t.roundsData.length) {
    kids.push(h('div', { class: 'empty' }, rr ? 'Generate the schedule to begin.' : 'Pair round 1 to begin.'));
    return page(kids);
  }

  // round tabs
  kids.push(h('div', { class: 'tabs' }, t.roundsData.map((rd, i) =>
    h('div', { class: `tab${viewRound === i + 1 ? ' active' : ''}`, onclick: () => { viewRound = i + 1; render(); } }, `Round ${i + 1}`))));

  const rd = t.roundsData[viewRound - 1];
  kids.push(RoundPanel(t, rd, viewRound, ratingMode));
  return page(kids);
}

function confirmPairingSetup(t, action, actionLabel) {
  if (t.roundsData.length) {
    action();
    return;
  }
  const status = setupStatus(store.activeEvent, t);
  if (!status.ok) {
    modal('Setup incomplete', h('div', {},
      h('div', { class: 'callout err' }, h('span', { class: 'ic' }, icon('⛔')),
        h('ul', {}, status.errors.map(message => h('li', {}, message))))
    ), [
      { label: 'Close' },
      { label: 'Open Setup', kind: 'primary', onClick: () => go('setup') }
    ]);
    return;
  }
  const summary = [
    `${typeLabel(t.type)} · ${t.rounds} rounds`,
    `${t.scoring.win}/${t.scoring.draw}/${t.scoring.loss} scoring`,
    `Tie-breaks: ${t.tiebreaks.join(', ') || 'none'}`,
    `Pairing rating: ${t.ratingPolicy?.primary ?? 'rating'}`
  ];
  modal('Confirm pairing setup', h('div', {},
    h('ul', { class: 'setup-confirm-list' }, summary.map(message => h('li', {}, message))),
    status.warnings.length
      ? h('div', { class: 'callout warn' }, h('span', { class: 'ic' }, icon('⚠️')),
          h('ul', {}, status.warnings.map(message => h('li', {}, message))))
      : h('div', { class: 'callout ok' }, h('span', { class: 'ic' }, icon('ℹ️')), 'Setup checks passed.')
  ), [
    { label: 'Cancel' },
    { label: 'Review Setup', onClick: () => go('setup') },
    { label: actionLabel, kind: 'primary', onClick: action }
  ]);
}

function doPairRound(t) {
  const round = t.currentRound + 1;
  const res = pairSection(t, round);
  if (!res.ok) {
    modal('Pairing not possible', h('div', {},
      h('ul', {}, res.warnings.map(w => h('li', {}, w))),
      h('p', { class: 'muted small' }, 'Per FIDE rules, if a valid round pairing is impossible the Chief Arbiter decides — use manual pairing tools after creating an empty round, or adjust byes/exclusions.')),
      [{ label: 'OK', kind: 'primary' }]);
    return;
  }
  const byes = res.bye ? [res.bye] : [];
  // requested byes & excluded players recorded as administrative byes
  for (const p of t.players) {
    const rb = (p.requestedByes ?? {})[round];
    if (rb && p.active !== false && !p.withdrawn) byes.push({ playerId: p.id, type: rb });
  }
  const scheduled = t.roundSchedule?.[round - 1] ?? {};
  if (!t.roundsData.length) store.freezeInheritedSectionSetup(t.id, { emit: false });
  t.roundsData.push({
    pairings: res.pairings.map((pr, i) => ({ board: (Number(t.startingBoard) || 1) + i, result: '', ...pr, manual: false, rated: true })),
    byes, date: scheduled.date ?? '', time: scheduled.time ?? '', site: scheduled.site ?? '',
    pairingLog: res.log,
    pairingWarnings: res.warnings
  });
  t.currentRound = round;
  viewRound = round;
  pairedRoundMotionSectionId = t.id;
  if (res.log.length || res.warnings.length) {
    modal(`Round ${round} paired`, h('div', {},
      res.warnings.length ? h('div', { class: 'callout warn' }, h('span', { class: 'ic' }, icon('⚠️')), h('ul', { style: 'margin:0' }, res.warnings.map(w => h('li', {}, w)))) : null,
      h('ul', { class: 'muted small' }, res.log.map(l => h('li', {}, l)))),
      [{ label: 'OK', kind: 'primary' }]);
  } else toast(`Round ${round} paired.`);
  commit();
  pairedRoundMotionSectionId = null;
}

function startRoundManually(t) {
  const round = t.currentRound + 1;
  const byes = [];
  for (const p of t.players) {
    const rb = (p.requestedByes ?? {})[round];
    if (rb && p.active !== false && !p.withdrawn) byes.push({ playerId: p.id, type: rb });
  }
  const scheduled = t.roundSchedule?.[round - 1] ?? {};
  if (!t.roundsData.length) store.freezeInheritedSectionSetup(t.id, { emit: false });
  t.roundsData.push({
    pairings: [],
    byes,
    date: scheduled.date ?? '',
    time: scheduled.time ?? '',
    site: scheduled.site ?? ''
  });
  t.currentRound = round;
  viewRound = round;
  toast(`Round ${round} started. Set any fixed pairs, then pair the rest.`);
  commit();
}

function confirmPairRemainder(t, rd, round) {
  if (round !== t.currentRound) return;
  const kept = rd.pairings.length;
  modal('Pair the rest', h('p', {}, kept
    ? `Keep ${kept} board${kept === 1 ? '' : 's'} already set, and pair everyone else.`
    : 'No boards are set yet. Pair the whole round.'), [
    { label: 'Cancel' },
    { label: 'Pair the rest', kind: 'primary', onClick: () => applyPairRemainder(t, rd, round) }
  ]);
}

function applyPairRemainder(t, rd, round) {
  const res = pairSectionRemainder(t, round, rd);
  if (!res.ok) {
    modal('Pairing not possible', h('div', {},
      h('ul', {}, res.warnings.map(w => h('li', {}, w))),
      h('p', { class: 'muted small' }, 'Per FIDE rules, if a valid round pairing is impossible the Chief Arbiter decides — use the manual pairing tools, or adjust byes and exclusions.')),
      [{ label: 'OK', kind: 'primary' }]);
    return;
  }
  captureRoundPairingUndo(t, rd, 'pair the rest');
  rd.pairings = [
    ...res.kept,
    ...res.pairings.map(pr => ({ result: '', ...pr, manual: false, rated: true }))
  ];
  renumber(t, rd);
  rd.byes = [...res.keptByes];
  if (res.bye) rd.byes.push(res.bye);
  rd.pairingLog = res.log;
  rd.pairingWarnings = res.warnings;
  if (res.log.length || res.warnings.length) {
    modal(`Round ${round} paired`, h('div', {},
      res.warnings.length ? h('div', { class: 'callout warn' }, h('span', { class: 'ic' }, icon('⚠️')), h('ul', { style: 'margin:0' }, res.warnings.map(w => h('li', {}, w)))) : null,
      h('ul', { class: 'muted small' }, res.log.map(l => h('li', {}, l)))),
      [{ label: 'OK', kind: 'primary' }]);
  } else toast(`Paired the rest of round ${round}.`);
  commit();
}

function pairWithByePlayer(t, rd, round, playerId) {
  const pab = (rd.byes ?? []).find(bye => bye.type === 'PAB');
  if (!pab || round !== t.currentRound) return;
  const colours = suggestPairColours(t, round, playerId, pab.playerId);
  if (!colours) return;
  const colourLabel = orientation => `${playerName(t, orientation.whiteId)} has White`;
  const apply = orientation => {
    captureRoundPairingUndo(t, rd, 'pair with the bye player');
    rd.byes = (rd.byes ?? []).filter(bye => bye !== pab);
    rd.pairings.push({
      board: (Number(t.startingBoard) || 1) + rd.pairings.length,
      whiteId: orientation.whiteId,
      blackId: orientation.blackId,
      result: '',
      manual: true,
      rated: true
    });
    renumber(t, rd);
    commit();
  };
  modal(`Pair with the bye ${unit(t)}`, h('div', {},
    h('p', {}, `${playerName(t, playerId)} plays ${playerName(t, pab.playerId)}.`),
    h('p', { class: 'muted small' }, 'The first colour is the one the pairing rules would assign. This pairing is marked as manual.')
  ), [
    { label: 'Cancel' },
    { label: colourLabel(colours.preferred), kind: 'primary', onClick: () => apply(colours.preferred) },
    { label: colourLabel(colours.alternative), onClick: () => apply(colours.alternative) }
  ]);
}

function generateRR(t, _legacySimul) {
  const ps = [...t.players].sort((a, b) => a.no - b.no);
  const mode = _legacySimul ? 'simultaneous' : (t.rrMode ?? 'berger');
  store.freezeInheritedSectionSetup(t.id, { emit: false });

  // Scheveningen: split the field into two teams (by stored team membership if
  // available, else first half vs second half) and cross-pair them.
  if (mode === 'scheveningen') {
    let teamA, teamB;
    if ((t.teams ?? []).length >= 2) {
      teamA = (t.teams[0].members ?? []).map(m => ps.findIndex(p => p.id === m.playerId) + 1).filter(x => x > 0);
      teamB = (t.teams[1].members ?? []).map(m => ps.findIndex(p => p.id === m.playerId) + 1).filter(x => x > 0);
    } else {
      const half = Math.floor(ps.length / 2);
      teamA = ps.slice(0, half).map((_, i) => i + 1);
      teamB = ps.slice(half).map((_, i) => half + i + 1);
    }
    const sched = scheveningenSchedule(teamA, teamB);
    buildRoundsFromSchedule(t, ps, sched, 1);
    finishSchedule(t);
    return;
  }

  const sched = mode === 'simultaneous' ? simultaneousSchedule(ps.length)
    : mode === 'rutsch' ? rutschSchedule(ps.length)
    : bergerSchedule(ps.length);
  const cycles = t.doubleRR && mode === 'berger' ? 2 : 1;
  buildRoundsFromSchedule(t, ps, sched, cycles);
  finishSchedule(t);
}

function buildRoundsFromSchedule(t, ps, sched, cycles) {
  t.roundsData = [];
  for (let c = 0; c < cycles; c++) {
    for (const games of sched) {
      const pairings = [], byes = [];
      games.forEach(g => {
        if (g.bye != null) { byes.push({ playerId: ps[g.bye - 1].id, type: 'ZPB' }); return; }
        const w = c === 1 ? g.black : g.white, b = c === 1 ? g.white : g.black;
        pairings.push({ board: (Number(t.startingBoard) || 1) + pairings.length, whiteId: ps[w - 1].id, blackId: ps[b - 1].id, result: '', manual: false, rated: true });
      });
      const scheduled = t.roundSchedule?.[t.roundsData.length] ?? {};
      t.roundsData.push({ pairings, byes, date: scheduled.date ?? '', time: scheduled.time ?? '', site: scheduled.site ?? '' });
    }
  }
}

function finishSchedule(t) {
  t.rounds = t.roundsData.length;
  t.currentRound = t.rounds;
  viewRound = 1;
  toast(`Schedule generated: ${t.rounds} rounds.`);
  commit();
}

// --------------------------------------------------------------------- KO flow

// Winners of a completed KO round, in bracket order, including byes that carried
// into round 1. Returns array of player ids.
function koWinnersOf(t, roundIndex) {
  const rd = t.roundsData[roundIndex];
  if (!rd) return [];
  const winners = [];
  // byes recorded on round 1 advance directly (kept at the front, strongest)
  for (const b of rd.byes ?? []) winners.push(b.playerId);
  for (const pr of rd.pairings) {
    const games = (pr.koGames ?? [{ whiteId: pr.whiteId, blackId: pr.blackId, result: pr.result }]);
    const w = koMiniMatchWinner(pr.whiteId, pr.blackId, games, t.scoring, {
      advancementRule: t.koAdvancement ?? 'blackInLastGame',
      seedOf: id => t.players.find(p => p.id === id)?.no ?? 999
    });
    winners.push(w.winnerId ?? pr.whiteId);
  }
  return winners;
}

function koChampion(t) {
  if (t.type !== 'ko' || t.roundsData.length === 0) return null;
  const totalRounds = koRounds(t.players.filter(p => p.active !== false && !p.withdrawn).length || t.players.length);
  const last = t.roundsData[t.roundsData.length - 1];
  if (t.roundsData.length < totalRounds) return null;
  if (!last.pairings.every(pr => pr.result)) return null;
  const w = koWinnersOf(t, t.roundsData.length - 1);
  return w.length === 1 ? w[0] : null;
}

function doPairKO(t) {
  if (t.roundsData.length === 0) {
    // seed round 1
    const seeds = [...t.players].filter(p => p.active !== false && !p.withdrawn)
      .sort((a, b) => (b.rating || 0) - (a.rating || 0) || a.no - b.no);
    if (seeds.length < 2) { toast('Need at least two players.'); return; }
    store.freezeInheritedSectionSetup(t.id, { emit: false });
    const r1 = koFirstRound(seeds);
    const pairings = r1.pairings.map((p, i) => ({
      board: (Number(t.startingBoard) || 1) + i, whiteId: p.aId, blackId: p.bId, result: '', manual: false, rated: true
    }));
    // free tickets recorded as full-point byes so they show in the round
    const byes = r1.byes.map(id => ({ playerId: id, type: 'FPB' }));
    const scheduled = t.roundSchedule?.[0] ?? {};
    t.roundsData = [{ pairings, byes, date: scheduled.date ?? '', time: scheduled.time ?? '', site: scheduled.site ?? '' }];
    t.rounds = koRounds(seeds.length);
    t.currentRound = 1;
    viewRound = 1;
    toast(`KO seeded: ${seeds.length} players, ${t.rounds} rounds, ${byes.length} free ticket(s).`);
    commit();
    return;
  }
  // pair next round from the winners of the last
  const lastIdx = t.roundsData.length - 1;
  const last = t.roundsData[lastIdx];
  if (!last.pairings.every(pr => pr.result)) { toast('Enter all results of the current round first.'); return; }
  const winners = koWinnersOf(t, lastIdx);
  if (winners.length <= 1) { toast('Tournament complete.'); return; }
  const pairs = koPairRound(winners);
  const pairings = pairs.map((p, i) => ({ board: (Number(t.startingBoard) || 1) + i, whiteId: p.aId, blackId: p.bId, result: '', manual: false, rated: true }));
  const scheduled = t.roundSchedule?.[t.roundsData.length] ?? {};
  t.roundsData.push({ pairings, byes: [], date: scheduled.date ?? '', time: scheduled.time ?? '', site: scheduled.site ?? '' });
  t.currentRound = t.roundsData.length;
  viewRound = t.currentRound;
  toast(`Round ${t.currentRound} paired (${pairings.length} match${pairings.length > 1 ? 'es' : ''}).`);
  commit();
}

let focusedBoard = null;

function checklistOpponentText(row) {
  return row.opponents.map((no, index) => {
    const marked = row.noPab && index === row.opponents.length - 1;
    return marked ? `${no} [X]` : String(no);
  }).join(', ');
}

function PairingChecklist(t, rd, round) {
  if (t.type !== 'swiss' && t.type !== 'team-swiss') return null;
  const rows = pairingChecklist(t, round);
  const log = rd.pairingLog ?? [];
  const warnings = rd.pairingWarnings ?? [];
  const headers = ['No', 'Name', 'Pts', 'Colours', 'Pref', '-1R', '-2R', 'Opponents', 'PAB'];
  return h('section', { 'aria-label': 'Pairing checklist' },
    h('h2', { class: 'sec' }, 'Pairing checklist'),
    h('p', { class: 'muted small' }, 'This is the state before this round.'),
    warnings.length
      ? h('div', { class: 'callout warn' }, h('span', { class: 'ic' }, icon('⚠️')),
          h('ul', { style: 'margin:0' }, warnings.map(warning => h('li', {}, warning))))
      : null,
    log.length
      ? h('ul', { class: 'muted small' }, log.map(line => h('li', {}, line)))
      : null,
    h('div', { class: 'standings-scroll', tabindex: 0, role: 'region', 'aria-label': 'Pairing checklist table' },
      h('table', { class: 'db' },
        h('tr', {}, headers.map(label => h('th', {}, label))),
        rows.map(row => h('tr', {},
          h('td', { class: 'num' }, row.no ?? ''),
          h('td', {}, row.name),
          h('td', { class: 'num' }, fmt(row.score)),
          h('td', { class: 'muted' }, row.colors),
          h('td', {}, row.preference),
          h('td', {}, row.float1),
          h('td', {}, row.float2),
          h('td', {}, checklistOpponentText(row)),
          h('td', {}, row.noPab ? 'no PAB' : ''))))));
}

function RoundPanel(t, rd, round, ratingMode) {
  const animateNewPairing = pairedRoundMotionSectionId === t.id && round === t.currentRound;
  const states = computeStates(t, round - 1);
  const projections = calculateRatingProjectionAfterRound(t, round);
  const players = new Map(t.players.map(player => [player.id, player]));
  const team = isTeam(t);
  const allowedResults = Object.keys(RESULTS).filter(c => !(t.fideMode && RESULTS[c].unusual));

  const meta = h('div', { class: 'toolbar' },
    h('span', { class: 'muted small' }, 'Date'),
    h('input', { type: 'date', class: 'btn', value: rd.date ?? '', onchange: e => { rd.date = e.target.value; copyTimes(t, rd); store.emit(); } }),
    h('span', { class: 'muted small' }, 'Time'),
    h('input', { type: 'time', class: 'btn', value: rd.time ?? '', onchange: e => { rd.time = e.target.value; copyTimes(t, rd); store.emit(); } }),
    h('span', { class: 'muted small' }, 'Site'),
    h('input', { type: 'text', class: 'btn', placeholder: t.site || 'Site', value: rd.site ?? '', onchange: e => { rd.site = e.target.value; store.emit(); } }),
    h('span', { class: 'spacer' }),
    h('span', { class: 'muted small' }, 'Result keys: '), h('kbd', {}, '1'), '–', h('kbd', {}, '7')
  );

  const rows = rd.pairings.map((pr, rowIndex) => {
    const sw = states.get(pr.whiteId), sb = states.get(pr.blackId);
    const whiteName = playerName(t, pr.whiteId);
    const blackName = playerName(t, pr.blackId);
    const resultSelect = (label, value, onChange) => h('select', {
      'aria-label': label,
      onchange: e => onChange(e.target.value)
    },
      h('option', { value: '' }, '(no result)'),
      allowedResults.map(c => h('option', { value: c, selected: value === c }, resultLabel(c))));
    const doubleSwiss = t.pairingSystem === 'fide-double-swiss';
    if (doubleSwiss) pr.games ??= ['', ''];
    const sel = doubleSwiss
      ? h('div', {},
          resultSelect(`Game 1 result for board ${pr.board}: ${whiteName} versus ${blackName}`, pr.games[0], value => { pr.games[0] = value; commit(); }),
          resultSelect(`Game 2 result for board ${pr.board}: ${blackName} versus ${whiteName}`, pr.games[1], value => { pr.games[1] = value; commit(); }))
      : resultSelect(`Result for board ${pr.board}: ${whiteName} versus ${blackName}`, pr.result, value => { pr.result = value; commit(); });

    const teamCells = team ? matchScoreCells(t, pr) : null;

    const row = h('tr', {
      tabindex: 0,
      class: `${focusedBoard === pr.board ? 'focused' : ''}${animateNewPairing ? ' pairing-row-arrive' : ''}`.trim(),
      style: animateNewPairing ? `animation-delay:${Math.min(rowIndex * 40, 240)}ms` : undefined,
      onclick: () => { focusedBoard = pr.board; highlight(row); },
      onfocus: () => { focusedBoard = pr.board; highlight(row); },
      onkeydown: e => {
        if (e.target !== e.currentTarget || e.ctrlKey || e.metaKey || e.altKey || team) return;
        const code = RESULT_KEYS[e.key];
        if (t.pairingSystem === 'fide-double-swiss') {
          pr.games ??= ['', ''];
          if (code && !(t.fideMode && RESULTS[code]?.unusual)) { pr.games[0] = code; commit(); e.preventDefault(); }
          if (e.key === '0' || e.key === 'Backspace') { pr.games[0] = ''; commit(); e.preventDefault(); }
          return;
        }
        if (code && !(t.fideMode && RESULTS[code]?.unusual)) { pr.result = code; commit(); e.preventDefault(); }
        if (e.key === '0' || e.key === 'Backspace') { pr.result = ''; commit(); e.preventDefault(); }
      }
    },
      h('td', { class: 'num' }, String(pr.board)),
      h('td', { class: 'num muted' }, fmt(sw?.score ?? 0)),
      team ? h('td', {class:'num'}, String(teamRating(t,pr.whiteId) ?? '—')) : pairingRatingCell(players.get(pr.whiteId), projections.get(pr.whiteId), ratingMode),
      h('td', { title: whiteName }, whiteName, pr.manual ? h('span', { class: 'muted', title: 'Manually modified pairing' }, ' *') : ''),
      h('td', { class: 'round-result' }, team ? teamCells : sel),
      h('td', { title: blackName }, blackName, pr.manual ? h('span', { class: 'muted', title: 'Manually modified pairing' }, ' *') : ''),
      team ? h('td', {class:'num'}, String(teamRating(t,pr.blackId) ?? '—')) : pairingRatingCell(players.get(pr.blackId), projections.get(pr.blackId), ratingMode),
      h('td', { class: 'num muted' }, fmt(sb?.score ?? 0)),
      h('td', { class: 'round-actions' }, pairingActionsMenu(t, rd, pr))
    );
    return row;
  });

  function highlight(row) {
    row.closest('table').querySelectorAll('tr').forEach(r => r.classList.remove('focused'));
    row.classList.add('focused');
  }

  const byeRows = (rd.byes ?? []).map(b => {
    const name = playerName(t, b.playerId);
    return h('tr', {},
    h('td', {}, ''), h('td', {}, ''),
    pairingRatingCell(players.get(b.playerId), projections.get(b.playerId), ratingMode),
    h('td', { title: name }, name),
    h('td', { style: 'text-align:center' }, h('span', {
      class: 'pill blue bye-badge',
      title: `${byeLabel(b.type)} · ${byePoints(b.type, t)} pt`,
      'aria-label': `${byeLabel(b.type)} · ${byePoints(b.type, t)} points`
    }, `Bye · ${fmt(byePoints(b.type, t))}`)),
    h('td', { class: 'muted' }, b.type === 'PAB' ? 'Pairing-allocated (no opponent, no colour)' : 'Administrative bye'),
    h('td', {}, ''),
    h('td', {}, ''),
    h('td', {}, b.type === 'PAB' && t.fideMode
      ? h('span', { class: 'muted small', title: 'Under strict FIDE settings the PAB value is fixed by tournament parameters' }, icon('🔒'))
      : iconBtn('✕', 'Remove bye', () => { rd.byes = rd.byes.filter(x => x !== b); commit(); })));
  });

  // unpaired players in this round
  const inRound = new Set([...rd.pairings.flatMap(p => [p.whiteId, p.blackId]), ...(rd.byes ?? []).map(b => b.playerId)]);
  const unpaired = pairablePlayers(t, round).filter(p => !inRound.has(p.id));

  const manualTools = unpaired.length || round === t.currentRound ? ManualTools(t, rd, round, unpaired) : null;

  return h('div', {},
    meta,
    h('table', { class: 'db round-pairings' },
      pairingColGroup(),
      h('tr', {},
        ROUND_PAIRING_COLUMNS.map(col => pairingHeaderCell(t, col, ratingMode)),
        h('th', { class: 'round-actions' }, '')),
      rows, byeRows),
    manualTools,
    PairingChecklist(t, rd, round)
  );
}

function pairingActionsMenu(t, rd, pr) {
  const index = rd.pairings.indexOf(pr);
  const action = (symbol, label, onclick, attrs = {}) => h('button', {
    type: 'button',
    class: `pairing-action-item${attrs.danger ? ' danger' : ''}`,
    disabled: attrs.disabled,
    role: 'menuitem',
    onclick: event => { event.stopPropagation(); onclick(); }
  }, h('span', { 'aria-hidden': 'true' }, symbol), h('span', {}, label));

  const confirmAction = (title, message, label, onConfirm, kind = 'primary') =>
    confirmModal(title, message, onConfirm, label, kind);

  return h('details', {
    class: 'pairing-actions-menu',
    onclick: event => event.stopPropagation(),
    onkeydown: event => event.stopPropagation()
  },
  h('summary', {
    class: 'btn ghost pairing-actions-trigger',
    title: `Actions for board ${pr.board}`,
    'aria-label': `Actions for board ${pr.board}`
  }, icon('⋯')),
  h('div', { class: 'pairing-actions-menu-panel', role: 'menu' },
    isTeam(t) ? action('⇄', 'Lineup & board colours', () => openBoards(t, pr)) : action('⇄', 'Swap colours', () => confirmAction(
      `Swap colours on board ${pr.board}?`,
      `${playerName(t, pr.whiteId)} and ${playerName(t, pr.blackId)} will exchange colours.`,
      'Swap colours',
      () => {
        captureRoundPairingUndo(t, rd, 'colour swap');
        [pr.whiteId, pr.blackId] = [pr.blackId, pr.whiteId];
        pr.manual = true;
        commit();
      }
    )),
    action('↑', 'Move up', () => confirmAction(
      `Move board ${pr.board} up?`,
      'This changes the board order and renumbers the round.',
      'Move up',
      () => {
        captureRoundPairingUndo(t, rd, 'move up');
        movePair(t, rd, pr, -1);
      }
    ), { disabled: index === 0 }),
    action('↓', 'Move down', () => confirmAction(
      `Move board ${pr.board} down?`,
      'This changes the board order and renumbers the round.',
      'Move down',
      () => {
        captureRoundPairingUndo(t, rd, 'move down');
        movePair(t, rd, pr, 1);
      }
    ), { disabled: index === rd.pairings.length - 1 }),
    action('✕', 'Remove pairing', () => confirmAction(
      `Remove board ${pr.board}?`,
      `${playerName(t, pr.whiteId)} and ${playerName(t, pr.blackId)} will become unpaired. You can pair them manually again.`,
      'Remove pairing',
      () => {
        captureRoundPairingUndo(t, rd, 'pairing removal');
        rd.pairings = rd.pairings.filter(pairing => pairing !== pr);
        renumber(t, rd);
        commit();
      },
      'danger'
    ), { danger: true })));
}

function captureRoundPairingUndo(t, rd, label) {
  const round = t.roundsData.indexOf(rd) + 1;
  const snapshot = rd.pairings.map(pairing => ({
    pairing,
    board: pairing.board,
    whiteId: pairing.whiteId,
    blackId: pairing.blackId,
    manual: pairing.manual
  }));
  const byes = (rd.byes ?? []).map(bye => ({ ...bye }));
  const hadLog = Object.prototype.hasOwnProperty.call(rd, 'pairingLog');
  const hadWarnings = Object.prototype.hasOwnProperty.call(rd, 'pairingWarnings');
  const pairingLog = hadLog ? rd.pairingLog.slice() : null;
  const pairingWarnings = hadWarnings ? rd.pairingWarnings.slice() : null;
  roundPairingUndo = {
    tournamentId: t.id,
    round,
    label,
    restore: () => {
      rd.pairings = snapshot.map(item => {
        Object.assign(item.pairing, {
          board: item.board,
          whiteId: item.whiteId,
          blackId: item.blackId,
          manual: item.manual
        });
        return item.pairing;
      });
      rd.byes = byes.map(bye => ({ ...bye }));
      if (hadLog) rd.pairingLog = pairingLog.slice();
      else delete rd.pairingLog;
      if (hadWarnings) rd.pairingWarnings = pairingWarnings.slice();
      else delete rd.pairingWarnings;
    }
  };
}

function roundPairingUndoAvailable(t, round) {
  return roundPairingUndo?.tournamentId === t.id
    && roundPairingUndo.round === round
    && !!t.roundsData[round - 1];
}

function undoRoundPairingAction(t) {
  if (!roundPairingUndoAvailable(t, viewRound)) return;
  const undo = roundPairingUndo;
  roundPairingUndo = null;
  undo.restore();
  toast(`Undid ${undo.label}.`);
  commit();
}

function pairingColGroup() {
  const widths = fittedRoundPairingWidths(loadRoundPairingWidths());
  return h('colgroup', {},
    ROUND_PAIRING_COLUMNS.map(col => h('col', {
      dataset: { colKey: col.key },
      style: `width:${widths[col.key] / ROUND_PAIRING_TABLE_WIDTH * 100}%`
    })),
    h('col', { style: `width:${ROUND_ACTION_COLUMN_WIDTH / ROUND_PAIRING_TABLE_WIDTH * 100}%` })
  );
}

function fittedRoundPairingWidths(saved = {}) {
  const available = ROUND_PAIRING_TABLE_WIDTH - ROUND_ACTION_COLUMN_WIDTH;
  const widths = Object.fromEntries(ROUND_PAIRING_COLUMNS.map(col => [
    col.key,
    Math.max(col.min, Number.isFinite(Number(saved[col.key])) ? Number(saved[col.key]) || col.width : col.width)
  ]));
  let excess = Object.values(widths).reduce((sum, width) => sum + width, 0) - available;

  while (excess > 0.5) {
    const flexible = ROUND_PAIRING_COLUMNS.filter(col => widths[col.key] > col.min);
    if (!flexible.length) break;
    const share = excess / flexible.length;
    let removed = 0;
    for (const col of flexible) {
      const reduction = Math.min(share, widths[col.key] - col.min);
      widths[col.key] -= reduction;
      removed += reduction;
    }
    if (removed < 0.5) break;
    excess -= removed;
  }
  const spare = available - Object.values(widths).reduce((sum, width) => sum + width, 0);
  widths.white += spare / 2;
  widths.black += spare / 2;
  return widths;
}

function pairingHeaderCell(t, col, ratingMode) {
  const label = col.rating && isTeam(t) ? 'Avg Rtg' : col.rating && ratingMode === 'projected' ? 'pRating'
    : col.key === 'white' ? (isTeam(t) ? 'First team' : 'White')
    : col.key === 'black' ? (isTeam(t) ? 'Second team' : 'Black')
    : col.label;
  const title = col.rating ? 'Click to switch Rtg / pRating. pRating is provisional and does not affect pairings.' : label;
  const labelNode = col.rating && !isTeam(t)
    ? h('button', {
        class: 'rating-switch',
        title,
        onclick: e => { e.stopPropagation(); toggleStandingsRatingMode(); }
      },
      h('span', { class: 'rating-label-full' }, label),
      h('span', { class: 'rating-label-compact', 'aria-hidden': 'true' }, ratingMode === 'projected' ? 'pRtg' : 'Rtg'))
    : h('span', { class: 'header-label' }, label);
  return h('th', { class: `${col.class ?? ''} resizable`.trim(), title },
    labelNode,
    h('span', {
      class: 'col-resizer',
      title: 'Drag or use arrow keys to resize. Double-click or press Home to reset columns.',
      role: 'separator',
      tabindex: 0,
      'aria-orientation': 'vertical',
      'aria-label': `Resize ${col.key.startsWith('white') && col.key !== 'white' ? 'White ' : col.key.startsWith('black') && col.key !== 'black' ? 'Black ' : ''}${col.label} column`,
      'aria-valuemin': col.min,
      'aria-valuemax': ROUND_PAIRING_TABLE_WIDTH - ROUND_ACTION_COLUMN_WIDTH - ROUND_PAIRING_COLUMNS.filter(item => item.key !== col.key).reduce((sum, item) => sum + item.min, 0),
      'aria-valuenow': Math.round(fittedRoundPairingWidths(loadRoundPairingWidths())[col.key]),
      ondblclick: e => resetPairingColumns(e.currentTarget.closest('table')),
      onkeydown: e => {
        if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(e.key)) return;
        e.preventDefault();
        e.stopPropagation();
        const table = e.currentTarget.closest('table');
        if (e.key === 'Home') return resetPairingColumns(table);
        const widths = readPairingWidths(table);
        applyPairingWidths(table, redistributePairingWidths(widths, col, (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 24 : 8)), true);
      },
      onpointerdown: e => resizePairingColumn(e, col)
    })
  );
}

function pairingRatingCell(player, projection, ratingMode) {
  if (ratingMode === 'projected') return h('td', projectionAttrs(projection), projectionLabel(projection));
  return h('td', { class: 'num muted' }, player?.rating ?? '');
}

function projectionLabel(summary) {
  return summary?.status === 'rated' && summary.projectedRatingRounded != null
    ? String(summary.projectedRatingRounded)
    : '';
}

function projectionAttrs(summary) {
  const title = projectionTitle(summary);
  return {
    class: 'num muted p-rating',
    title
  };
}

function projectionTitle(summary) {
  if (!summary) return 'Projected rating unavailable';
  if (summary.status !== 'rated') return 'Projected rating unavailable for unrated players';
  const rounded = summary.projectedChangeRounded ?? 0;
  const raw = summary.projectedChangeRaw ?? 0;
  const sign = rounded > 0 ? '+' : '';
  const rawSign = raw > 0 ? '+' : '';
  return `Projected rating (provisional): ${summary.projectedRatingRounded} (${sign}${rounded}, raw ${rawSign}${raw}, K ${summary.kFactor ?? '—'})`;
}

function readPairingWidths(table) {
  return Object.fromEntries(ROUND_PAIRING_COLUMNS.map(col => [col.key,
    Number.parseFloat(table.querySelector(`col[data-col-key="${col.key}"]`).style.width) * ROUND_PAIRING_TABLE_WIDTH / 100
  ]));
}

// Keep the table within its container by borrowing space from other columns.
function redistributePairingWidths(widths, col, delta) {
  const next = { ...widths };
  const others = ROUND_PAIRING_COLUMNS.filter(item => item.key !== col.key);
  const capacity = others.reduce((sum, item) => sum + Math.max(0, widths[item.key] - item.min), 0);
  const change = Math.max(col.min - widths[col.key], Math.min(delta, capacity));
  next[col.key] += change;
  if (change > 0 && capacity > 0) {
    for (const item of others) next[item.key] -= change * Math.max(0, widths[item.key] - item.min) / capacity;
  } else if (change < 0) {
    const recipients = others.filter(item => item.key === 'white' || item.key === 'black');
    for (const item of recipients) next[item.key] -= change / recipients.length;
  }
  return next;
}

function applyPairingWidths(table, widths, persist = false) {
  for (const col of ROUND_PAIRING_COLUMNS) {
    table.querySelector(`col[data-col-key="${col.key}"]`).style.width = `${widths[col.key] / ROUND_PAIRING_TABLE_WIDTH * 100}%`;
    const grip = table.querySelectorAll('.col-resizer')[ROUND_PAIRING_COLUMNS.indexOf(col)];
    grip.setAttribute('aria-valuenow', Math.round(widths[col.key]));
  }
  if (persist) {
    try { window.localStorage?.setItem(ROUND_PAIRING_WIDTHS_KEY, JSON.stringify(widths)); } catch { /* Session resizing still works without storage. */ }
  }
}

function resetPairingColumns(table) {
  applyPairingWidths(table, fittedRoundPairingWidths(), true);
  toast('Column widths reset.');
}

function resizePairingColumn(e, col) {
  if (e.button !== 0) return;
  const table = e.currentTarget.closest('table');
  if (!table) return;
  e.preventDefault();
  e.stopPropagation();
  const startX = e.clientX;
  const widths = readPairingWidths(table);
  const scale = ROUND_PAIRING_TABLE_WIDTH / table.getBoundingClientRect().width;
  let current = widths;
  table.classList.add('resizing');
  document.body.classList.add('col-resize-active');
  const move = ev => {
    current = redistributePairingWidths(widths, col, (ev.clientX - startX) * scale);
    applyPairingWidths(table, current);
  };
  const finish = ev => {
    applyPairingWidths(table, ev.type === 'pointercancel' || ev.type === 'blur' ? widths : current, true);
    table.classList.remove('resizing');
    document.body.classList.remove('col-resize-active');
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', finish);
    document.removeEventListener('pointercancel', finish);
    window.removeEventListener('blur', finish);
  };
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', finish);
  document.addEventListener('pointercancel', finish);
  window.addEventListener('blur', finish);
}

function loadRoundPairingWidths() {
  try {
    return JSON.parse(window.localStorage?.getItem(ROUND_PAIRING_WIDTHS_KEY) || '{}') ?? {};
  } catch {
    return {};
  }
}

function matchScoreCells(t, pr) { return teamScoreControl(t, pr); }
function teamBoardsEditor(t, pr) { openBoards(t, pr); }

function copyTimes(t, rd) {
  // entering the first round's time copies it to later rounds without one
  if (t.roundsData[0] === rd && rd.time) {
    for (const other of t.roundsData) if (!other.time) other.time = rd.time;
  }
}

function iconBtn(label, title, onclick) {
  return h('button', { class: 'btn ghost', title, style: 'padding:1px 6px', onclick: e => { e.stopPropagation(); onclick(); } }, icon(label));
}

function movePair(t, rd, pr, dir) {
  const i = rd.pairings.indexOf(pr), j = i + dir;
  if (j < 0 || j >= rd.pairings.length) return;
  [rd.pairings[i], rd.pairings[j]] = [rd.pairings[j], rd.pairings[i]];
  renumber(t, rd); commit();
}
function renumber(t, rd) { rd.pairings.forEach((p, i) => { p.board = (Number(t.startingBoard) || 1) + i; }); }

function ManualTools(t, rd, round, unpaired) {
  const selA = playerSelect(t, unpaired.map(p => p.id), 'White…');
  const selB = playerSelect(t, unpaired.map(p => p.id), 'Black…');
  const selBye = playerSelect(t, unpaired.map(p => p.id), `${unit(t)} for bye…`);
  const byeType = h('select', {}, ['HPB', 'FPB', 'ZPB', 'PAB'].map(v => h('option', { value: v }, byeLabel(v))));
  const current = round === t.currentRound;
  const pab = (rd.byes ?? []).find(bye => bye.type === 'PAB');
  const lone = unpaired.length === 1 ? unpaired[0] : null;
  return h('div', {},
    h('h2', { class: 'sec' }, 'Manual pairing'),
    unpaired.length ? h('p', { class: 'muted small' }, `Unpaired this round: ${unpaired.map(p => p.name || '?').join(', ')}`) : h('p', { class: 'muted small' }, 'Everyone is paired. Remove a pairing above to re-pair manually.'),
    h('div', { class: 'toolbar' },
      selA, selB,
      h('button', {
        class: 'btn', disabled: unpaired.length < 2, onclick: () => {
          if (!selA.value || !selB.value || selA.value === selB.value) return;
          const issues = checkManualPair(t, round, selA.value, selB.value);
          const add = () => { rd.pairings.push({ board: (Number(t.startingBoard) || 1) + rd.pairings.length, whiteId: selA.value, blackId: selB.value, result: '', manual: true, rated: true }); commit(); };
          if (issues.length) {
            modal('Constraint warning', h('div', {},
              h('ul', {}, issues.map(i => h('li', {}, i))),
              h('p', { class: 'muted small' }, 'Manual pairings can be necessary, but bypassing engine constraints can invalidate FIDE reproducibility. The pairing will be marked with *.')),
              [{ label: 'Cancel' }, { label: 'Pair anyway', kind: 'danger', onClick: add }]);
          } else add();
        }
      }, '＋ Set pairing'),
      h('button', {
        class: 'btn',
        disabled: !current || unpaired.length < 1,
        title: current ? 'Keep the boards already set and pair everyone else' : 'Only the current round can be paired',
        onclick: () => confirmPairRemainder(t, rd, round)
      }, 'Pair the rest'),
      current && lone && pab
        ? h('button', {
            class: 'btn',
            onclick: () => pairWithByePlayer(t, rd, round, lone.id)
          }, `Pair with the bye ${unit(t)}`)
        : null,
      h('span', { class: 'spacer' }),
      selBye, byeType,
      h('button', {
        class: 'btn', disabled: !unpaired.length, onclick: () => {
          if (!selBye.value) return;
          const s = computeStates(t, round - 1).get(selBye.value);
          if (byeType.value === 'PAB' && (s?.hadPAB || s?.fullPointUnplayed)) {
            toast('Warning: this player already has a PAB or an unplayed full-point win.');
          }
          rd.byes = rd.byes ?? [];
          rd.byes.push({ playerId: selBye.value, type: byeType.value });
          commit();
        }
      }, 'Set bye'))
  );
}

// =================================================================== STANDINGS
function standingsColumns(t) {
  const base = [
    { key: 'rank', label: 'Rk.', class: 'num', width: 48, min: 38 },
    { key: 'number', label: 'No.', class: 'num', width: 52, min: 40 },
    { key: 'name', label: 'Name', width: 220, min: 110 },
    { key: 'fed', label: 'Fed', width: 64, min: 48 },
    { key: 'rating', label: 'Rtg', class: 'num', width: 74, min: 60 },
    { key: 'points', label: 'Pts', class: 'num', width: 62, min: 48 }
  ];
  return [
    ...base,
    ...t.tiebreaks.map(c => ({ key: `tb-${c}`, label: c, class: 'num', width: 70, min: 52, title: TIEBREAKS[c], tiebreak: c }))
  ];
}

function Standings(t) {
  const upto = t.currentRound || 0;
  if (!upto) {
    return page(h('div', { class: 'page-icon' }, icon('🏆')),
      h('h1', { class: 'page-title', style: 'pointer-events:none' }, 'Standings'),
      h('div', { class: 'empty' }, 'Standings appear once round 1 is paired.'));
  }
  const st = computeStandings(t, upto);
  const projections = calculateRatingProjectionAfterRound(t, upto);
  const columns = standingsColumns(t);
  const ratingMode = standingsRatingMode();
  return page(
    h('div', { class: 'page-icon' }, icon('🏆')),
    h('h1', { class: 'page-title', style: 'pointer-events:none' }, 'Standings'),
    h('p', { class: 'page-sub' }, `After round ${upto}. Tie-breaks: ${t.tiebreaks.map(c => TIEBREAKS[c]).join(' → ')}.`),
    h('div', { class: 'toolbar' },
      h('span', { class: 'muted small' }, 'Tie-break order:'),
      ...t.tiebreaks.map((c, i) => h('span', { class: 'pill', style: 'cursor:pointer', title: 'Click to remove', onclick: () => { t.tiebreaks.splice(i, 1); commit(); } }, `${i + 1}. ${c} `, icon('✕'))),
      h('select', {
        onchange: e => { if (e.target.value) { t.tiebreaks.push(e.target.value); commit(); } }
      }, h('option', { value: '' }, '＋ add tie-break'),
        Object.entries(TIEBREAKS).filter(([c]) => !t.tiebreaks.includes(c)).map(([c, n]) => h('option', { value: c }, n)))),
    h('div', { class: 'standings-scroll', tabindex: 0, role: 'region', 'aria-label': 'Standings table; scroll horizontally to see all columns' },
    h('table', { class: 'db standings-table' },
      standingsColGroup(columns),
      h('tr', {}, columns.map(col => standingsHeaderCell(col, ratingMode))),
      st.map(r => h('tr', {}, columns.map(col => standingsCell(r, col, projections, ratingMode))))))
  );
}

function standingsCell(row, col, projections, ratingMode) {
  switch (col.key) {
    case 'rank':
      return h('td', { class: 'num' }, String(row.rankLabel ?? row.rank));
    case 'number':
      return h('td', { class: 'num muted' }, String(row.player.no));
    case 'name':
      return h('td', {}, row.player.name || '—', row.player.withdrawn ? h('span', { class: 'pill red', style: 'margin-left:6px' }, 'wd') : '');
    case 'fed':
      return h('td', { class: 'muted' }, row.player.fed ?? '');
    case 'rating':
      if (ratingMode === 'projected') {
        const summary = projections.get(row.player.id);
        return h('td', projectionAttrs(summary), projectionLabel(summary));
      }
      return h('td', { class: 'num muted' }, row.player.rating || '');
    case 'points':
      return h('td', { class: 'num' }, h('b', {}, fmt(row.score)));
    default: {
      const value = row.tbs[col.tiebreak];
      return h('td', { class: 'num muted' }, String(typeof value === 'number' ? +value.toFixed(2) : value));
    }
  }
}

function standingsColGroup(columns) {
  const widths = loadStandingsWidths();
  return h('colgroup', {}, columns.map(col => h('col', {
    dataset: { colKey: col.key },
    style: `width:${Math.max(col.min, Number(widths[col.key]) || col.width)}px`
  })));
}

function standingsHeaderCell(col, ratingMode) {
  const isRating = col.key === 'rating';
  const label = isRating && ratingMode === 'projected' ? 'pRating' : col.label;
  const title = isRating
    ? 'Click to switch Rtg / pRating. pRating is provisional and does not affect pairings.'
    : (col.title ?? '');
  const labelNode = isRating
    ? h('button', {
        class: 'rating-switch',
        title,
        onclick: e => { e.stopPropagation(); toggleStandingsRatingMode(); }
      }, label)
    : h('span', { class: 'header-label' }, label);
  return h('th', { class: `${col.class ?? ''} resizable`.trim(), title },
    labelNode,
    h('span', {
      class: 'col-resizer',
      title: 'Drag to resize column',
      role: 'separator',
      'aria-hidden': 'true',
      onpointerdown: e => resizeStandingsColumn(e, col)
    })
  );
}

function standingsRatingMode() {
  try {
    const mode = window.localStorage?.getItem(STANDINGS_RATING_MODE_KEY);
    return mode === 'projected' ? 'projected' : 'rating';
  } catch {
    return 'rating';
  }
}

function toggleStandingsRatingMode() {
  const next = standingsRatingMode() === 'projected' ? 'rating' : 'projected';
  try {
    window.localStorage?.setItem(STANDINGS_RATING_MODE_KEY, next);
  } catch {}
  render();
}

function resizeStandingsColumn(e, col) {
  const table = e.currentTarget.closest('table');
  const targetCol = table?.querySelector(`col[data-col-key="${col.key}"]`);
  if (!table || !targetCol) return;

  e.preventDefault();
  e.stopPropagation();

  const startX = e.clientX;
  const startWidth = targetCol.getBoundingClientRect().width || Number.parseFloat(targetCol.style.width) || col.width;
  let currentWidth = startWidth;
  table.classList.add('resizing');
  document.body.classList.add('col-resize-active');

  const move = ev => {
    currentWidth = Math.max(col.min, startWidth + ev.clientX - startX);
    targetCol.style.width = `${currentWidth}px`;
  };
  const finish = () => {
    saveStandingsWidth(col.key, currentWidth);
    table.classList.remove('resizing');
    document.body.classList.remove('col-resize-active');
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', finish);
    document.removeEventListener('pointercancel', finish);
  };

  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', finish);
  document.addEventListener('pointercancel', finish);
}

function loadStandingsWidths() {
  try {
    return JSON.parse(window.localStorage?.getItem(STANDINGS_WIDTHS_KEY) || '{}') ?? {};
  } catch {
    return {};
  }
}

function saveStandingsWidth(key, width) {
  try {
    const widths = loadStandingsWidths();
    widths[key] = Math.round(width);
    window.localStorage?.setItem(STANDINGS_WIDTHS_KEY, JSON.stringify(widths));
  } catch {}
}

// =================================================================== SETUP
const SETUP_WIZARD_STEPS = [
  { id: 'event', label: 'Tournament details' },
  { id: 'schedule', label: 'Schedule & venue' },
  { id: 'rules', label: 'Competition rules' },
  { id: 'section', label: 'First section' },
  { id: 'eligibility', label: 'Eligibility & capacity' },
  { id: 'review', label: 'Review' }
];

const SETUP_WIZARD_DESCRIPTIONS = {
  event: 'Name the event and record the core organizer details.',
  schedule: 'Set the tournament dates, venue, and round timetable.',
  rules: 'Set the pairing format, rating policy, scoring, and entry rules inherited by new sections.',
  section: 'Configure the first competition section and its defaults.',
  eligibility: 'Define section eligibility, capacity, and registration behavior.',
  review: 'Resolve warnings and confirm the tournament is ready for registrations.'
};

const SECTION_SETUP_TABS = [
  { id: 'general', label: 'General' },
  { id: 'pairing', label: 'Pairing' },
  { id: 'scoring', label: 'Scoring' },
  { id: 'tiebreaks', label: 'Tie-breaks' },
  { id: 'schedule', label: 'Schedule' },
  { id: 'administration', label: 'Administration' }
];

const EVENT_SETUP_TABS = [
  { id: 'details', label: 'Details' },
  { id: 'schedule', label: 'Schedule & venue' },
  { id: 'rules', label: 'Competition rules' },
  { id: 'eligibility', label: 'Sections & eligibility' },
  { id: 'publishing', label: 'Publishing & reports' }
];

let setupWizardStep = 0;
let setupTab = 'general';
let eventSetupTab = 'details';
let eventProfileType = 'swiss';

function wizardProfileControls(event, t) {
  const profiles = store.data.settings.tournamentSetupProfiles ?? [];
  const select = setupSelect('', [{ id: '', label: 'Choose saved setup…' }, ...profiles.map(p => ({ id: p.id, label: p.name }))], () => {});
  select.setAttribute('aria-label', 'Saved setup profile');
  return h('div', { class: 'wizard-profile-bar' },
    h('span', {}, 'Setup profile'), select,
    h('button', { class: 'btn', disabled: !profiles.length, onclick: () => {
      if (!select.value) { toast('Choose a setup profile first.'); return; }
      confirmModal('Apply setup profile', 'Replace organizer, venue, competition rules and section settings? Tournament name, dates and players are kept.', () => {
        const profile = store.applyTournamentSetupProfile(event, t, select.value);
        render(); toast(`Applied ${profile.name}. Review the name and dates before finishing.`);
      });
    } }, 'Apply profile'),
    store.data.settings.defaultTournamentSetupProfileId ? h('button', { class: 'btn ghost', onclick: () => {
      store.data.settings.defaultTournamentSetupProfileId = '';
      store.emit(); render(); toast('New tournaments will use organizer defaults.');
    } }, 'Stop using default profile') : null,
    h('span', { class: 'muted small' }, profiles.length ? 'Reusable settings; fresh names, dates and players.' : 'Configure once, then save a profile in Review.'));
}

function wizardSaveProfile(event, t) {
  const name = h('input', { type: 'text', placeholder: 'e.g. Saturday rapid', 'aria-label': 'Setup profile name' });
  const defaultToggle = h('input', { type: 'checkbox' });
  return h('section', { class: 'setup-section' },
    setupHeading('Reuse this setup', 'Save organizer, venue, rules and first-section settings. Names, dates and players start fresh.'),
    h('div', { class: 'wizard-profile-bar' }, name,
      h('label', { class: 'flex' }, defaultToggle, 'Use by default for new tournaments'),
      h('button', { class: 'btn', onclick: () => {
        if (!name.value.trim()) { name.focus(); toast('Enter a profile name.'); return; }
        const profile = store.saveTournamentSetupProfile(event, t, name.value, defaultToggle.checked);
        render(); toast(`Saved ${profile.name}.`);
      } }, 'Save setup profile')));
}

function showWizardStep(index) {
  setupWizardStep = index;
  render();
  document.getElementById('page')?.scrollTo({ top: 0 });
  const button = document.querySelector('.setup-step.active');
  button?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  button?.focus({ preventScroll: true });
}

function SetupWizard(t) {
  const event = store.activeEvent;
  const step = SETUP_WIZARD_STEPS[setupWizardStep] ?? SETUP_WIZARD_STEPS[0];
  const status = setupStatus(event, t);
  const contents = {
    event: () => eventIdentityFields(event),
    schedule: () => eventScheduleFields(event),
    rules: () => competitionProfileFields(event),
    section: () => sectionSetupFields(event, t),
    eligibility: () => sectionsEligibilityFields(event),
    review: () => h('div', {}, setupReview(event, t, status), wizardSaveProfile(event, t))
  };

  return page(h('div', { class: 'setup-shell setup-wizard' },
    h('div', { class: 'setup-wizard-layout' },
      h('header', { class: 'setup-wizard-rail' },
        h('div', { class: 'setup-wizard-identity' }, tournamentPageIdentity(event, event, sectionDisplayName(t))),
        wizardProfileControls(event, t),
        h('nav', { class: 'setup-steps', 'aria-label': 'Tournament setup progress' },
          SETUP_WIZARD_STEPS.map((item, index) => h('button', {
            class: `setup-step${index === setupWizardStep ? ' active' : ''}`,
            'aria-current': index === setupWizardStep ? 'step' : undefined,
            'data-setup-step': item.id,
            onclick: () => showWizardStep(index)
          }, h('span', { class: 'setup-step-no' }, String(index + 1)), h('span', {}, item.label))))
      ),
      h('div', { class: 'setup-wizard-content' },
        h('header', { class: 'setup-wizard-heading' },
          h('h2', {}, step.label),
          h('p', {}, SETUP_WIZARD_DESCRIPTIONS[step.id])
        ),
        h('section', { class: 'setup-panel', 'data-step': step.id }, contents[step.id]()),
        h('footer', { class: 'setup-footer' },
          h('button', { class: 'btn ghost', onclick: () => go('home') }, 'Back to home'),
          h('span', { class: 'spacer' }),
          h('button', {
            class: 'btn', disabled: setupWizardStep === 0,
            onclick: () => showWizardStep(Math.max(0, setupWizardStep - 1))
          }, 'Back'),
          setupWizardStep < SETUP_WIZARD_STEPS.length - 1
            ? h('button', { class: 'btn primary', onclick: () => showWizardStep(setupWizardStep + 1) }, 'Continue')
            : h('button', { class: 'btn primary', disabled: !status.ok, onclick: () => finishSetup(t) }, iconLabel('✓', 'Finish setup & add registrations'))
        )
      )
    )
  ));
}

function EventSetup(event) {
  const sections = store.childrenForEvent(event.id);
  const registrations = (event.registrations ?? []).filter(registration => !registration.archived);
  const eventDates = [event.startDate, event.endDate].filter(Boolean).join(' to ');
  const summary = eventWorkflowSummary(event, sections);
  const readiness = tournamentReadinessSummary(event, sections);
  const tabs = {
    details: () => eventIdentityFields(event),
    schedule: () => eventScheduleFields(event),
    rules: () => competitionProfileFields(event),
    eligibility: () => sectionsEligibilityFields(event),
    publishing: () => h('div', {}, publishingSetupFields(event), reportOptionsFields(event))
  };

  return page(h('div', { class: 'setup-shell event-setup-workspace' },
    tournamentPageIdentity(event, event,
      [event.site, eventDates, `${registrations.length} registrations`].filter(Boolean).join(' · ')),
    h('div', { class: 'event-command-bar' },
      h('button', { class: 'btn', onclick: () => go(summary.nextAction.view) }, summary.nextAction.label),
      h('button', { class: 'btn', onclick: () => go('event-sections') }, iconLabel('🗂️', 'Sections')),
      h('button', { class: 'btn primary', 'aria-current': 'page' }, iconLabel('⚙️', 'Tournament setup')),
      h('button', { class: 'btn', onclick: () => go('event-export') }, iconLabel('📤', 'Export & publish'))),
    h('h2', { class: 'sec', id: 'setup-status-heading' }, 'Setup status'),
    h('div', { class: 'props event-setup-properties', 'aria-labelledby': 'setup-status-heading' },
      overviewProp('👥', 'Planned players', overviewText(String(readiness.plannedPlayers))),
      overviewProp('🗂️', 'Sections', overviewText(`${summary.sections} total`)),
      overviewProp('🎲', 'Rounds', overviewText(String(readiness.rounds))),
      overviewProp('⚠️', 'Setup attention', overviewText(summary.setupAttention
        ? `${summary.setupAttention} section${summary.setupAttention === 1 ? '' : 's'} need attention`
        : 'No blockers'))),
    h('div', { class: 'section-heading-row setup-details-heading' },
      h('h2', { class: 'sec' }, 'Tournament setup'),
      h('button', { class: 'btn ghost', onclick: () => go('event-sections') }, 'View sections')),
    h('nav', { class: 'setup-tabs', 'aria-label': 'Tournament setup sections', role: 'tablist' }, EVENT_SETUP_TABS.map(tab => h('button', {
      class: `setup-tab${eventSetupTab === tab.id ? ' active' : ''}`,
      role: 'tab',
      'aria-selected': String(eventSetupTab === tab.id),
      onclick: () => { eventSetupTab = tab.id; render(); }
    }, tab.label))),
    h('section', { class: 'setup-panel', role: 'tabpanel' }, tabs[eventSetupTab]?.() ?? tabs.details())
  ));
}

function Setup(t) {
  const event = store.activeEvent;
  const status = setupStatus(event, t);
  const workflow = sectionWorkflowSummary(event, t);
  const progress = workflow.currentRound
    ? `Round ${workflow.currentRound} of ${t.rounds}`
    : 'Not started';
  const setupAttention = status.errors.length
    ? `${status.errors.length} blocker${status.errors.length === 1 ? '' : 's'}`
    : status.warnings.length
      ? `${status.warnings.length} warning${status.warnings.length === 1 ? '' : 's'}`
      : 'No blockers';
  const context = [
    event.name,
    typeLabel(t.type),
    `${workflow.participants} ${isTeam(t) ? 'teams' : 'players'}`
  ].filter(Boolean).join(' · ');
  const tabs = {
    general: () => sectionSetupFields(event, t),
    pairing: () => pairingSetupFields(event, t),
    scoring: () => scoringSetupFields(event, t),
    tiebreaks: () => tieBreakSetupFields(event, t),
    schedule: () => scheduleSetupFields(event, t),
    administration: () => administrationSetupFields(event, t)
  };

  return page(h('div', { class: 'setup-shell section-setup-workspace' },
    sectionPageIdentity(event, t, context),
    sectionSwitcher(event, t),
    h('h2', { class: 'sec', id: 'section-setup-status-heading' }, 'Setup status'),
    h('div', { class: 'props section-setup-properties', 'aria-labelledby': 'section-setup-status-heading' },
      overviewProp('👥', isTeam(t) ? 'Teams' : 'Players', overviewText(String(workflow.participants))),
      overviewProp('🗂️', 'Format', overviewText(typeLabel(t.type))),
      overviewProp('📈', 'Progress', overviewText(progress)),
      overviewProp('⚠️', 'Setup attention', overviewText(setupAttention))),
    h('div', { class: 'section-heading-row setup-details-heading' },
      h('h2', { class: 'sec' }, 'Section setup'),
      h('button', { class: 'btn ghost', onclick: () => { setupTab = 'administration'; render(); } }, 'View checklist')),
    h('nav', { class: 'setup-tabs', 'aria-label': 'Section setup sections', role: 'tablist' }, SECTION_SETUP_TABS.map(tab => h('button', {
      class: `setup-tab${setupTab === tab.id ? ' active' : ''}`,
      role: 'tab',
      'aria-selected': String(setupTab === tab.id),
      onclick: () => { setupTab = tab.id; render(); }
    }, tab.label))),
    h('section', { class: 'setup-panel', role: 'tabpanel' }, tabs[setupTab]?.() ?? tabs.general())
  ));
}

function sectionSwitcher(event, t) {
  const sections = store.childrenForEvent(event.id);
  return h('div', { class: 'section-switcher' },
    h('label', {}, 'Section', h('select', {
      onchange: e => { store.setActive(e.target.value); render(); }
    }, sections.map(section => h('option', { value: section.id, selected: section.id === t.id }, sectionWorkspaceName(event, section))))),
    h('span', { class: 'spacer' }),
    h('button', { class: 'btn', onclick: () => openChildTournamentDialog(event) }, iconLabel('＋', 'Add section')),
    h('button', { class: 'btn', onclick: () => { store.duplicateSection(t.id); setupTab = 'general'; render(); } }, iconLabel('📄', 'Duplicate section')),
    h('button', {
      class: 'btn danger', disabled: sections.length <= 1,
      onclick: () => confirmModal('Delete section', `Delete ${sectionDisplayName(t)}?`, () => { store.deleteSection(t.id); render(); })
    }, iconLabel('🗑', 'Delete'))
  );
}

function setupHeading(title, subtitle = '') {
  return h('div', { class: 'setup-section-heading' }, h('h2', {}, title), subtitle ? h('p', {}, subtitle) : null);
}

function setupField(label, control, note = '') {
  return h('label', { class: 'setup-field' },
    h('span', { class: 'setup-label' }, label),
    control,
    note ? h('span', { class: 'setup-note' }, note) : null);
}

function setupInput(obj, key, options = {}) {
  const type = options.type ?? 'text';
  return h('input', {
    type,
    value: obj?.[key] ?? '',
    placeholder: options.placeholder ?? '',
    min: options.min,
    max: options.max,
    step: options.step,
    disabled: options.disabled,
    onchange: e => {
      const value = type === 'number'
        ? (e.target.value === '' ? '' : Number(e.target.value))
        : e.target.value;
      if (options.onChange) options.onChange(value);
      else { obj[key] = value; commit(); }
    }
  });
}

function setupSelect(value, choices, onChange, disabled = false) {
  return h('select', { disabled, onchange: e => onChange(e.target.value) },
    choices.map(choice => {
      const item = typeof choice === 'string' ? { id: choice, label: choice } : choice;
      return h('option', { value: item.id, selected: item.id === value }, item.label);
    }));
}

function setupToggle(checked, onChange, disabled = false) {
  return h('input', { type: 'checkbox', checked, disabled, onchange: e => onChange(e.target.checked) });
}

function updateEvent(event, key, value) {
  const previous = event[key];
  const previousYear = String(previous ?? '').match(/^(\d{4})/)?.[1] ?? '';
  const cutoffWasAutomatic = !event.ageScheme?.cutoffDate || event.ageScheme.cutoffDate === (previousYear ? `${previousYear}-01-01` : '');
  if (TOURNAMENT_SETUP_FIELDS.includes(key)) store.setTournamentSetupDefault(event.id, key, value, { emit: false });
  else if (['name', 'federation', 'organizer', 'defaultFed'].includes(key)) store.setTournamentSharedValue(event.id, key, value, { emit: false });
  else event[key] = value;
  if (key === 'startDate') {
    const year = String(value ?? '').match(/^(\d{4})/)?.[1] ?? '';
    if (cutoffWasAutomatic && year) event.ageScheme.cutoffDate = `${year}-01-01`;
    if (event.masterSchedule?.[0] && (!event.masterSchedule[0].date || event.masterSchedule[0].date === previous)) {
      event.masterSchedule[0].date = value;
      store.setMasterSchedule(event.id, event.masterSchedule, { emit: false });
    }
  }
  commit();
}

function eventIdentityFields(event) {
  event.arbiters ??= { chief: '', deputies: '', email: '' };
  return h('div', { class: 'setup-section' },
    setupHeading('Tournament identity', 'Shared live across every section and tournament report.'),
    h('div', { class: 'setup-grid' },
      setupField('Tournament name', setupInput(event, 'name', { placeholder: 'Tournament name', onChange: value => updateEvent(event, 'name', value) })),
      setupField('Federation', setupInput(event, 'federation', { placeholder: 'e.g. SGP', onChange: value => updateEvent(event, 'federation', value.toUpperCase()) })),
      setupField('Organizer', setupInput(event, 'organizer', { onChange: value => updateEvent(event, 'organizer', value) })),
      setupField('Chief arbiter', setupInput(event.arbiters, 'chief', { onChange: value => { event.arbiters.chief = value; commit(); } })),
      setupField('Deputy arbiters', setupInput(event.arbiters, 'deputies', { onChange: value => { event.arbiters.deputies = value; commit(); } })),
      setupField('Arbiter email', setupInput(event.arbiters, 'email', { type: 'email', onChange: value => { event.arbiters.email = value; commit(); } })),
      setupField('Default federation', setupInput(event, 'defaultFed', { placeholder: 'Applied to new registrations', onChange: value => updateEvent(event, 'defaultFed', value.toUpperCase()) })),
      setupField('Published notices', setupInput(event, 'remarks', {onChange: value => {event.remarks=value;store.emit();}}))
    ), officialFields(event), attachmentFields(event));
}

function eventSharedDefaultsFields(event) {
  return h('div', { class: 'setup-section' },
    setupHeading('Shared defaults', 'Unstarted sections follow these values until they are overridden in Section Setup.'),
    h('div', { class: 'setup-grid' },
      setupField('Default venue / city', setupInput(event, 'site', { onChange: value => updateEvent(event, 'site', value) })),
      setupField('Default start date', setupInput(event, 'startDate', { type: 'date', onChange: value => updateEvent(event, 'startDate', value) })),
      setupField('Default end date', setupInput(event, 'endDate', { type: 'date', onChange: value => updateEvent(event, 'endDate', value) })),
      setupField('Default time control', setupInput(event, 'timeControl', { placeholder: 'e.g. 60+30', onChange: value => updateEvent(event, 'timeControl', value) })),
      setupField('Default rating type', setupSelect(event.ratingType, RATING_TYPES, value => updateEvent(event, 'ratingType', value))),
      setupField('Default FIDE event code', setupInput(event, 'fideEventCode', { onChange: value => updateEvent(event, 'fideEventCode', value) })),
      setupField('Default FIDE report code', setupInput(event, 'fideReportCode', { onChange: value => updateEvent(event, 'fideReportCode', value) })),
      setupField('Rated by default', setupToggle(event.rated !== false, value => updateEvent(event, 'rated', value)))
    ));
}

function eventSetupFields(event) {
  return h('div', {}, eventIdentityFields(event), eventSharedDefaultsFields(event));
}

function eventScheduleFields(event) {
  const maxRounds = Math.max(1, ...Object.values(event.competitionProfiles ?? {}).map(profile => Number(profile.rounds) || 0));
  event.masterSchedule = normalizeRoundSchedule(event.masterSchedule, maxRounds, event);
  const updateRound = (index, key, value) => {
    const schedule = event.masterSchedule.map(round => ({ ...round }));
    schedule[index][key] = value;
    store.setMasterSchedule(event.id, schedule, { emit: false });
    commit();
  };
  return h('div', {},
    h('div', { class: 'setup-section' },
      setupHeading('Master venue and dates', 'Shared live by every inheriting, unstarted section.'),
      h('div', { class: 'setup-grid' },
        setupField('Venue / city', setupInput(event, 'site', { onChange: value => updateEvent(event, 'site', value) })),
        setupField('Start date', setupInput(event, 'startDate', { type: 'date', onChange: value => updateEvent(event, 'startDate', value) })),
        setupField('End date', setupInput(event, 'endDate', { type: 'date', onChange: value => updateEvent(event, 'endDate', value) })))),
    h('div', { class: 'setup-section' },
      setupHeading('Master round schedule', 'Sections inherit the first N rows for their configured round count.'),
      h('div', { class: 'schedule-table' },
        h('div', { class: 'schedule-head' }, h('span', {}, 'Round'), h('span', {}, 'Date'), h('span', {}, 'Time'), h('span', {}, 'Site')),
        event.masterSchedule.map((round, index) => h('div', { class: 'schedule-row' },
          h('span', { class: 'num' }, String(index + 1)),
          setupInput(round, 'date', { type: 'date', onChange: value => updateRound(index, 'date', value) }),
          setupInput(round, 'time', { type: 'time', onChange: value => updateRound(index, 'time', value) }),
          setupInput(round, 'site', { placeholder: event.site || 'Venue', onChange: value => updateRound(index, 'site', value) }))))));
}

function competitionProfileFields(event) {
  const profile = profileForSection(event, eventProfileType);
  const update = (field, value) => {
    store.setTournamentProfileValue(event.id, eventProfileType, field, value, { emit: false });
    commit();
  };
  profile.byePolicy ??= {};
  profile.ratingPolicy ??= {};
  const setNested = (field, key, value) => update(field, { ...(profile[field] ?? {}), [key]: value });
  const typeChoices = EVENT_TYPES.map(item => ({ ...item, label: item.id === 'team-rr' ? 'Team · Round robin' : item.label }));
  return h('div', {},
    h('div', { class: 'callout' }, h('span', { class: 'ic' }, icon('ℹ️')), h('div', {}, 'Changes autosave and update inheriting, unstarted sections immediately. Overrides and started sections are unchanged.')),
    h('div', { class: 'setup-section' },
      setupHeading('Competition profile', 'Maintain one reusable rule set for each supported format.'),
      h('div', { class: 'setup-grid' },
        setupField('Profile', setupSelect(eventProfileType, typeChoices, value => { eventProfileType = value; render(); })),
        setupField('Rounds', setupInput(profile, 'rounds', { type: 'number', min: 1, max: 150, onChange: value => update('rounds', Math.max(1, Number(value) || 1)) })),
        setupField('Time control', setupInput(profile, 'timeControl', { placeholder: 'e.g. 60+30', onChange: value => update('timeControl', value) })),
        setupField('Rating type', setupSelect(profile.ratingType, RATING_TYPES, value => update('ratingType', value))),
        setupField('Rated', setupToggle(profile.rated !== false, value => update('rated', value))),
        setupField('FIDE mode', setupToggle(!!profile.fideMode, value => {
          if (value) {
            store.setTournamentProfileValue(event.id, eventProfileType, 'byeWeakest', false, { emit: false });
            store.setTournamentProfileValue(event.id, eventProfileType, 'ignoreColour', false, { emit: false });
            store.setTournamentProfileValue(event.id, eventProfileType, 'pairByTiebreak', false, { emit: false });
          }
          update('fideMode', value);
        })),
        setupField('Initial color for No. 1', setupSelect(profile.initialColor, [
          { id: 'white', label: 'White' }, { id: 'black', label: 'Black' }
        ], value => update('initialColor', value))),
        setupField('Acceleration', setupSelect(profile.acceleration, [
          { id: 'none', label: 'None' }, { id: 'baku', label: 'Baku' }
        ], value => update('acceleration', value))),
        setupField('Bye to weakest', setupToggle(!!profile.byeWeakest, value => update('byeWeakest', value), !!profile.fideMode)),
        setupField('Ignore colour', setupToggle(!!profile.ignoreColour, value => update('ignoreColour', value), !!profile.fideMode)),
        setupField('Pair by tie-break', setupToggle(!!profile.pairByTiebreak, value => update('pairByTiebreak', value), !!profile.fideMode)),
        setupField('Initial ranking', setupSelect(profile.initialRanking, [
          { id: 'rating', label: 'Resolved rating' }, { id: 'name', label: 'Name' },
          { id: 'fideId', label: 'FIDE ID' }, { id: 'national', label: 'National rating' },
          { id: 'manual', label: 'Manual pairing numbers' }
        ], value => update('initialRanking', value))),
        setupField('Primary rating', setupSelect(profile.ratingPolicy.primary, RATING_SOURCES, value => setNested('ratingPolicy', 'primary', value))),
        setupField('Fallback rating', setupSelect(profile.ratingPolicy.fallback, RATING_SOURCES, value => setNested('ratingPolicy', 'fallback', value))))),
    h('div', { class: 'setup-section' },
      setupHeading('Scoring, tie-breaks and entry policy'),
      h('div', { class: 'setup-grid' },
        setupField('Win points', setupInput(profile.scoring, 'win', { type: 'number', step: 0.5, onChange: value => setNested('scoring', 'win', value) })),
        setupField('Draw points', setupInput(profile.scoring, 'draw', { type: 'number', step: 0.5, onChange: value => setNested('scoring', 'draw', value) })),
        setupField('Loss points', setupInput(profile.scoring, 'loss', { type: 'number', step: 0.5, onChange: value => setNested('scoring', 'loss', value) })),
        setupField('Tie-break preset', setupSelect('', [{ id: '', label: 'Choose preset…' }, ...TIEBREAK_PRESETS], value => {
          const preset = TIEBREAK_PRESETS.find(item => item.id === value);
          if (!preset) return;
          const config = normalizeTiebreakConfig(preset.codes);
          store.setTournamentProfileValue(event.id, eventProfileType, 'tiebreakConfig', config, { emit: false });
          store.setTournamentProfileValue(event.id, eventProfileType, 'tiebreaks', config.map(item => item.code), { emit: false });
          commit();
        })),
        setupField('Restriction strength', setupSelect(profile.restrictionPolicy, [{ id: 'hard', label: 'Hard' }, { id: 'soft', label: 'Soft' }], value => update('restrictionPolicy', value))),
        setupField('Late entry policy', setupSelect(profile.lateEntryPolicy, [
          { id: 'manual', label: 'Manual approval' }, { id: 'nextRound', label: 'Pair from next round' },
          { id: 'zeroThenPair', label: 'Zero for missed rounds' }
        ], value => update('lateEntryPolicy', value))),
        setupField('Club protection', setupToggle(!!profile.clubProtection, value => update('clubProtection', value))),
        setupField('Accept excluded results', setupToggle(!!profile.allowExcludedResults, value => update('allowExcludedResults', value))),
        setupField('Unplayed-round rules', setupSelect(profile.tiebreakRules, [{ id: 'fide2026', label: 'FIDE 2026' }, { id: 'legacy', label: 'Legacy virtual opponent' }], value => update('tiebreakRules', value))),
        setupField('Allow half-point byes', setupToggle(profile.byePolicy.allowHalfPoint !== false, value => setNested('byePolicy', 'allowHalfPoint', value))),
        setupField('Maximum half-point byes', setupInput(profile.byePolicy, 'maxHalfPointByes', { type: 'number', min: 0, onChange: value => setNested('byePolicy', 'maxHalfPointByes', value) })))));
}

function sectionsEligibilityFields(event) {
  event.ageScheme = normalizeAgeScheme(event.ageScheme, event.startDate ? `${event.startDate.slice(0, 4)}-01-01` : '');
  const sections = store.childrenForEvent(event.id);
  const readiness = tournamentReadinessSummary(event, sections);
  const cutoff = value => { event.ageScheme.cutoffDate = value; commit(); };
  return h('div', {},
    h('div', { class: 'setup-status-strip' },
      h('span', {}, `${readiness.plannedPlayers} planned players · ${readiness.sections} sections · ${readiness.rounds} rounds`),
      h('span', { class: 'muted' }, sections.some(section => sectionMaximumAge(event, section) !== '') ? 'Age rules active' : 'All sections open')),
    h('div', { class: 'setup-section' },
      setupHeading('Section eligibility', 'Set age eligibility directly on each section. Leave Under age blank for an open section.'),
      h('div', { class: 'props section-cutoff-property' },
        overviewProp('📅', 'Age cutoff date', h('input', { type: 'date', value: event.ageScheme.cutoffDate, 'aria-label': 'Age cutoff date', onchange: e => cutoff(e.target.value) }))),
      h('div', { class: 'schedule-table section-eligibility-table' },
        h('div', { class: 'schedule-head' }, h('span', {}, 'Section'), h('span', {}, 'Under age'), h('span', {}, 'Target players'), h('span', {}, 'Starting board')),
        sections.map(section => h('div', { class: 'schedule-row' },
          h('span', {}, sectionDisplayName(section)),
          sectionAgeLimitControl(event, section),
          setupInput(section, 'expectedPlayers', { type: 'number', min: 0 }),
          setupInput(section, 'startingBoard', { type: 'number', min: 1 })))),
      h('div', { class: 'toolbar' },
        h('button', { class: 'btn', onclick: () => openChildTournamentDialog(event) }, iconLabel('＋', 'Add section')),
        h('button', { class: 'btn', disabled: !sections.length, onclick: () => {
          const proposals = store.proposeSectionBoardAllocation(event.id);
          store.applySectionBoardAllocation(event.id, proposals);
          render();
        } }, 'Allocate starting boards'))));
}

function reportOptionsFields(event) {
  event.listOptions ??= {};
  const option = (key, label, defaultValue = false) => setupField(label, setupToggle(event.listOptions[key] ?? defaultValue, value => {
    event.listOptions[key] = value;
    for (const section of store.sectionsForEvent(event.id)) section.listOptions = { ...event.listOptions };
    commit();
  }));
  return h('div', { class: 'setup-section' },
    setupHeading('Tournament lists and reports', 'Presentation-only options remain live for all sections.'),
    h('div', { class: 'setup-grid' },
      option('showFideId', 'Show FIDE ID', true), option('showFederation', 'Show federation', true),
      option('showClub', 'Show club', true), option('showBirthYear', 'Show birth year'), option('showNationalId', 'Show national ID'),
      option('showTitles', 'Show titles', true)));
}

function futureSectionDefaultsFields(event) {
  const defaults = event.childDefaults ??= store.childSetupSnapshot(store.childrenForEvent(event.id)[0] ?? {});
  defaults.eligibility ??= { ratingMin: '', ratingMax: '', birthYearMin: '', birthYearMax: '' };
  const sections = store.childrenForEvent(event.id);
  const source = h('select', { 'aria-label': 'Copy defaults from section' },
    h('option', { value: '' }, 'Choose a section…'),
    sections.map(section => h('option', { value: section.id }, sectionWorkspaceName(event, section))));
  const update = (key, value) => { defaults[key] = value; commit(); };
  const updateEligibility = (key, value) => { defaults.eligibility[key] = value; defaults[key] = value; commit(); };

  return h('div', {},
    h('div', { class: 'callout' }, h('span', { class: 'ic' }, icon('ℹ️')),
      h('div', {}, 'These settings apply only to sections created later. Existing sections keep their current competition settings.')),
    h('div', { class: 'toolbar future-default-source' },
      source,
      h('button', {
        class: 'btn', disabled: !sections.length,
        onclick: () => {
          if (!source.value) return;
          store.saveChildDefaultsFromChild(source.value);
          toast('Future section defaults copied from the selected section.');
          render();
        }
      }, 'Use selected section')),
    h('div', { class: 'setup-section' },
      setupHeading('Future section defaults', 'A starting template for new competitions.'),
      h('div', { class: 'setup-grid' },
        setupField('Format', setupSelect(defaults.type, EVENT_TYPES, value => {
          defaults.type = value;
          defaults.pairingSystem = pairingSystemForView(value);
          commit();
        })),
        setupField('Rounds', setupInput(defaults, 'rounds', { type: 'number', min: 1, max: 150, onChange: value => {
          defaults.rounds = Math.max(1, Number(value) || 1);
          defaults.finalRound = defaults.rounds;
          commit();
        } })),
        setupField('Starting board', setupInput(defaults, 'startingBoard', { type: 'number', min: 1, onChange: value => update('startingBoard', Math.max(1, Number(value) || 1)) })),
        setupField('Minimum rating', setupInput(defaults.eligibility, 'ratingMin', { type: 'number', min: 0, onChange: value => updateEligibility('ratingMin', value) })),
        setupField('Maximum rating', setupInput(defaults.eligibility, 'ratingMax', { type: 'number', min: 0, onChange: value => updateEligibility('ratingMax', value) })),
        setupField('Minimum birth year', setupInput(defaults.eligibility, 'birthYearMin', { type: 'number', min: 1900, max: 2200, onChange: value => updateEligibility('birthYearMin', value) })),
        setupField('Maximum birth year', setupInput(defaults.eligibility, 'birthYearMax', { type: 'number', min: 1900, max: 2200, onChange: value => updateEligibility('birthYearMax', value) })),
        setupField('Side event', setupToggle(!!defaults.sideGame, value => update('sideGame', value)))
      )));
}

function inheritedSetupField(event, t, field, label, controlFactory, note = '') {
  const source = store.sectionSetupSource(t, field);
  const inherited = source === 'tournament';
  const locked = source === 'locked';
  const status = inherited ? 'Inherited' : 'Overridden';
  const statusClass = inherited ? 'blue' : 'yellow';
  const changeValue = value => {
    try {
      store.setSectionSetupValue(t.id, field, value, { emit: false });
      commit();
    } catch (error) { toast(error.message); }
  };
  const changeSource = useDefault => {
    try {
      if (useDefault) store.useTournamentSetupDefault(t.id, field, { emit: false });
      else store.setSectionSetupValue(t.id, field, t[field], { emit: false });
      commit();
    } catch (error) { toast(error.message); }
  };
  return h('div', { class: `setup-field setup-inherited-field ${inherited ? 'is-inherited' : ''}` },
    h('span', { class: `setup-label setup-source-label${locked ? ' is-locked' : ''}` },
      h('span', {}, label),
      locked
        ? h('span', {
            class: 'setup-lock-icon', role: 'img',
            'aria-label': 'Locked after pairing began', title: 'Locked after pairing began'
          })
        : h('span', { class: `pill ${statusClass}`.trim() }, status)),
    controlFactory({ disabled: inherited || locked, onChange: changeValue }),
    locked ? h('span', { class: 'setup-note' }, 'Locked after pairing began.') : h('button', {
      type: 'button', class: 'btn ghost setup-inherit-action',
      onclick: () => changeSource(!inherited)
    }, inherited ? 'Override tournament rule' : 'Use tournament rule'),
    note ? h('span', { class: 'setup-note' }, note) : null);
}

function changeSectionType(t, type) {
  const result = store.changeSectionFormat(t.id, type, { emit: false });
  if (result.changed) return commit();
  confirmModal('Change section format', `Changing format will reset these incompatible overrides: ${result.incompatible.join(', ')}.`, () => {
    store.changeSectionFormat(t.id, type, { confirmReset: true, emit: false });
    commit();
  });
}

function sectionSetupFields(event, t) {
  const locked = field => !canEditSetupField(t, field);
  const indexItem = (id, label, active = false) => h('button', {
    type: 'button',
    class: `section-general-index-item${active ? ' active' : ''}`,
    ...(active ? { 'aria-current': 'location' } : {}),
    onclick: e => {
      document.querySelectorAll('.section-general-index-item').forEach(item => {
        item.classList.remove('active');
        item.removeAttribute('aria-current');
      });
      e.currentTarget.classList.add('active');
      e.currentTarget.setAttribute('aria-current', 'location');
      document.getElementById(id)?.scrollIntoView({ block: 'start' });
    }
  }, label);
  return h('div', { class: 'section-general-indexed' },
    h('nav', { class: 'section-general-index', 'aria-label': 'General setup sections' },
      indexItem('section-identity-eligibility', 'Identity & eligibility', true),
      indexItem('section-shared-details', 'Shared details')
    ),
    h('div', { class: 'section-general-content' },
    h('div', { class: 'setup-section', id: 'section-identity-eligibility' },
      setupHeading('Section identity & eligibility', 'Name this section and set its entry rules and operational details.'),
      h('div', { class: 'setup-grid' },
      setupField('Section name', h('input', {
        type: 'text', value: sectionTitleName(event, t), placeholder: 'Open Section',
        onchange: e => { t.sectionName = e.target.value.trim() || 'Section'; commit(); }
      })),
      setupField('Section code', setupInput(t, 'sectionCode', { placeholder: 'A' })),
      setupField('Section format', setupSelect(t.type, EVENT_TYPES, value => changeSectionType(t, value), locked('type'))),
      setupField('Pairing system', setupSelect(t.pairingSystem, pairingSystemChoices(t.type), value => {
        if (t.roundsData.length && value !== t.pairingSystem) {
          toast('FIDE does not allow the pairing system to change after a round has been paired.');
        }
        if (!t.roundsData.length) store.setSectionSetupValue(t.id, 'pairingSystem', value, { emit: false });
        else {
          t.pairingSystem = value;
          t.setupSources = { ...(t.setupSources ?? {}), pairingSystem: 'section' };
        }
        commit();
      }, t.type !== 'swiss' && t.type !== 'team-swiss')),
      inheritedSetupField(event, t, 'rounds', 'Rounds', ({ disabled, onChange }) => setupInput(t, 'rounds', { type: 'number', min: 1, max: 150, disabled, onChange })),
      setupField('Final round', setupInput(t, 'finalRound', { type: 'number', min: 1, max: t.rounds })),
      setupField('Starting board', setupInput(t, 'startingBoard', { type: 'number', min: 1 })),
      setupField('Target players', setupInput(t, 'expectedPlayers', { type: 'number', min: 0 }), 'Assignments beyond this target require confirmation.'),
      setupField('Age limit', sectionAgeLimitControl(event, t), 'Leave blank for no age limit. Age is measured on the tournament cutoff date.'),
      setupField('Minimum rating', setupInput(t.eligibility, 'ratingMin', { type: 'number', min: 0, onChange: value => { t.eligibility.ratingMin = value; t.ratingMin = value; commit(); } })),
      setupField('Maximum rating', setupInput(t.eligibility, 'ratingMax', { type: 'number', min: 0, onChange: value => { t.eligibility.ratingMax = value; t.ratingMax = value; commit(); } })),
      inheritedSetupField(event, t, 'doubleRR', 'Double round robin', ({ disabled, onChange }) => setupToggle(!!t.doubleRR, onChange, disabled)),
      setupField('Side event', setupToggle(!!t.sideGame, value => { t.sideGame = value; commit(); })),
      setupField('Exclude from rating report', setupToggle(!!t.excludeFromRatingReport, value => { t.excludeFromRatingReport = value; commit(); })),
      setupField('Section arbiters', setupInput(t, 'sectionArbiters', { placeholder: 'Assigned arbiters for this section' })),
      inheritedSetupField(event, t, 'fideEventCode', 'FIDE event code', ({ disabled, onChange }) => setupInput(t, 'fideEventCode', { disabled, onChange })),
      inheritedSetupField(event, t, 'fideReportCode', 'FIDE report code', ({ disabled, onChange }) => setupInput(t, 'fideReportCode', { disabled, onChange }))
      )),
    h('div', { class: 'setup-section', id: 'section-shared-details' },
      setupHeading('Shared tournament details', 'Administrative details stay editable after pairing and follow the parent until overridden.'),
      h('div', { class: 'setup-grid' },
        inheritedSetupField(event, t, 'site', 'Venue / city', ({ disabled, onChange }) => setupInput(t, 'site', { disabled, onChange })),
        inheritedSetupField(event, t, 'startDate', 'Start date', ({ disabled, onChange }) => setupInput(t, 'startDate', { type: 'date', disabled, onChange })),
        inheritedSetupField(event, t, 'endDate', 'End date', ({ disabled, onChange }) => setupInput(t, 'endDate', { type: 'date', disabled, onChange })),
        inheritedSetupField(event, t, 'timeControl', 'Time control', ({ disabled, onChange }) => setupInput(t, 'timeControl', { disabled, placeholder: 'e.g. 60+30', onChange }), 'Inherited from the parent competition profile; you can override it at any time.'),
        inheritedSetupField(event, t, 'ratingType', 'Rating type', ({ disabled, onChange }) => setupSelect(t.ratingType, RATING_TYPES, onChange, disabled), 'Editable after pairing; affects rating and report output, not existing pairings.'),
        inheritedSetupField(event, t, 'rated', 'Rated section', ({ disabled, onChange }) => setupToggle(t.rated !== false, onChange, disabled), 'Editable after pairing; affects rating and report output, not existing pairings.')
      )))
  );
}

function pairingSetupFields(event, t) {
  t.byePolicy ??= {};
  return h('div', { class: 'setup-section' },
    setupHeading('Pairing', t.roundsData.length ? 'Pairing-critical fields are locked after round 1.' : 'Rules applied when pairings are generated.'),
    h('div', { class: 'setup-grid' },
      inheritedSetupField(event, t, 'fideMode', 'FIDE mode', ({ disabled, onChange }) => setupToggle(!!t.fideMode, value => {
        onChange(value);
        if (value) { t.byeWeakest = false; t.ignoreColour = false; t.pairByTiebreak = false; }
      }, disabled)),
      inheritedSetupField(event, t, 'initialColor', 'Initial color for No. 1', ({ disabled, onChange }) => setupSelect(t.initialColor, [{ id: 'white', label: 'White' }, { id: 'black', label: 'Black' }], onChange, disabled)),
      inheritedSetupField(event, t, 'acceleration', 'Acceleration', ({ disabled, onChange }) => setupSelect(t.acceleration, [{ id: 'none', label: 'None' }, { id: 'baku', label: 'Baku' }], onChange, disabled)),
      inheritedSetupField(event, t, 'pabValue', 'Pairing-allocated bye', ({ disabled, onChange }) => setupSelect(t.pabValue, [{ id: 'win', label: 'Win value' }, { id: 'draw', label: 'Draw value' }], onChange, disabled)),
      inheritedSetupField(event, t, 'restrictionPolicy', 'Restriction strength', ({ disabled, onChange }) => setupSelect(t.restrictionPolicy, [{ id: 'hard', label: 'Hard' }, { id: 'soft', label: 'Soft' }], onChange, disabled)),
      inheritedSetupField(event, t, 'lateEntryPolicy', 'Late entry policy', ({ disabled, onChange }) => setupSelect(t.lateEntryPolicy, [
        { id: 'manual', label: 'Manual approval' },
        { id: 'nextRound', label: 'Pair from next round' },
        { id: 'zeroThenPair', label: 'Zero for missed rounds' }
      ], onChange, disabled)),
      inheritedSetupField(event, t, 'clubProtection', 'Club protection', ({ disabled, onChange }) => setupToggle(!!t.clubProtection, onChange, disabled)),
      inheritedSetupField(event, t, 'byeWeakest', 'Bye to weakest', ({ disabled, onChange }) => setupToggle(!!t.byeWeakest, onChange, disabled || !!t.fideMode)),
      inheritedSetupField(event, t, 'ignoreColour', 'Ignore colour', ({ disabled, onChange }) => setupToggle(!!t.ignoreColour, onChange, disabled || !!t.fideMode)),
      inheritedSetupField(event, t, 'pairByTiebreak', 'Pair by tie-break', ({ disabled, onChange }) => setupToggle(!!t.pairByTiebreak, onChange, disabled || !!t.fideMode)),
      inheritedSetupField(event, t, 'byePolicy', 'Bye policy', ({ disabled, onChange }) => h('div', { class: 'setup-grid compact' },
        setupField('Half-point byes', setupToggle(t.byePolicy.allowHalfPoint !== false, value => onChange({ ...t.byePolicy, allowHalfPoint: value }), disabled)),
        setupField('Maximum', setupInput(t.byePolicy, 'maxHalfPointByes', { type: 'number', min: 0, disabled, onChange: value => onChange({ ...t.byePolicy, maxHalfPointByes: value }) })),
        setupField('Full-point byes', setupToggle(t.byePolicy.allowFullPoint !== false, value => onChange({ ...t.byePolicy, allowFullPoint: value }), disabled)),
        setupField('Final-round byes', setupToggle(!!t.byePolicy.lastRoundByes, value => onChange({ ...t.byePolicy, lastRoundByes: value }), disabled))))
    ),
    isTeam(t) ? h('div', {},
      setupHeading('Team pairing'),
      h('div', { class: 'setup-grid' },
        inheritedSetupField(event, t, 'teamColourPreference', 'Board 1 colour', ({ disabled, onChange }) => setupSelect(t.teamColourPreference ?? 'A', [
          { id: 'A', label: 'C.04.6 Type A' },
          { id: 'B', label: 'C.04.6 Type B' },
          { id: 'none', label: 'No colour preference' }
        ], onChange, disabled)),
        inheritedSetupField(event, t, 'teamPairBy', 'Pair teams by', ({ disabled, onChange }) => setupSelect(t.teamPairBy, [{ id: 'matchPoints', label: 'Match points' }, { id: 'gamePoints', label: 'Game points' }], onChange, disabled)),
        inheritedSetupField(event, t, 'boardsPerMatch', 'Boards per match', ({ disabled, onChange }) => setupInput(t, 'boardsPerMatch', { type: 'number', min: 1, disabled, onChange })),
        inheritedSetupField(event, t, 'teamBoardOrderCheck', 'Check board order', ({ disabled, onChange }) => setupToggle(t.teamBoardOrderCheck !== false, onChange, disabled)),
        inheritedSetupField(event, t, 'teamByeMatchScore', 'Team bye score', ({ disabled, onChange }) => h('div', { class: 'setup-grid compact' },
          setupField('Match points', setupInput(t.teamByeMatchScore, 'match', { type: 'number', min: 0, disabled, onChange: value => onChange({ ...t.teamByeMatchScore, match: value }) })),
          setupField('Game points', setupInput(t.teamByeMatchScore, 'game', { type: 'number', min: 0, disabled, onChange: value => onChange({ ...t.teamByeMatchScore, game: value }) }))))
      )) : null,
    t.type === 'ko' ? h('div', {},
      setupHeading('Knockout'),
      h('div', { class: 'setup-grid' },
        inheritedSetupField(event, t, 'koReplays', 'Games per mini-match', ({ disabled, onChange }) => setupInput(t, 'koReplays', { type: 'number', min: 1, max: 9, disabled, onChange })),
        inheritedSetupField(event, t, 'koAdvancement', 'Tied mini-match', ({ disabled, onChange }) => setupSelect(t.koAdvancement, [
          { id: 'blackInLastGame', label: 'Black in last game advances' },
          { id: 'betterSeed', label: 'Better seed advances' },
          { id: 'manual', label: 'Arbiter decision' }
        ], onChange, disabled))
      )) : null
  );
}

function scoringSetupFields(event, t) {
  const projection = t.ratingProjection = normalizeRatingProjection(t.ratingProjection);
  const updateProjection = next => {
    t.ratingProjection = normalizeRatingProjection({ ...projection, ...next });
    commit();
  };
  return h('div', { class: 'setup-section' },
    setupHeading('Scoring'),
    h('div', { class: 'setup-grid compact' },
      inheritedSetupField(event, t, 'scoring', 'Game scoring', ({ disabled, onChange }) => h('div', { class: 'setup-grid compact' },
        setupField('Win', setupInput(t.scoring, 'win', { type: 'number', step: 0.5, disabled, onChange: value => onChange({ ...t.scoring, win: value }) })),
        setupField('Draw', setupInput(t.scoring, 'draw', { type: 'number', step: 0.5, disabled, onChange: value => onChange({ ...t.scoring, draw: value }) })),
        setupField('Loss', setupInput(t.scoring, 'loss', { type: 'number', step: 0.5, disabled, onChange: value => onChange({ ...t.scoring, loss: value }) })))),
      isTeam(t) ? inheritedSetupField(event, t, 'matchScoring', 'Match scoring', ({ disabled, onChange }) => h('div', { class: 'setup-grid compact' },
        setupField('Win', setupInput(t.matchScoring, 'win', { type: 'number', step: 0.5, disabled, onChange: value => onChange({ ...t.matchScoring, win: value }) })),
        setupField('Draw', setupInput(t.matchScoring, 'draw', { type: 'number', step: 0.5, disabled, onChange: value => onChange({ ...t.matchScoring, draw: value }) })),
        setupField('Loss', setupInput(t.matchScoring, 'loss', { type: 'number', step: 0.5, disabled, onChange: value => onChange({ ...t.matchScoring, loss: value }) })))) : null,
      setupField('Projected rating K-factor', h('div', { class: 'projection-k-control' },
        setupSelect(projection.kFactorMode, [
          { id: 'auto', label: 'Automatic · FIDE rules' },
          { id: '10', label: 'K = 10 · slower movement' },
          { id: '20', label: 'K = 20 · standard movement' },
          { id: '40', label: 'K = 40 · faster movement' },
          { id: 'custom', label: 'Custom…' }
        ], kFactorMode => updateProjection({ kFactorMode })),
        projection.kFactorMode === 'custom'
          ? setupField('Custom K-factor', setupInput(projection, 'customKFactor', {
              type: 'number',
              min: 1,
              max: 100,
              step: 1,
              onChange: customKFactor => updateProjection({ customKFactor })
            }))
          : null
      ), 'Display-only; projected ratings never affect pairings.')
    )
  );
}

function syncTieBreaks(t) {
  t.tiebreakConfig = normalizeTiebreakConfig(t.tiebreakConfig);
  t.tiebreaks = t.tiebreakConfig.map(item => item.code);
  commit();
}

function tieBreakSetupFields(event, t) {
  const source = store.sectionSetupSource(t, 'tiebreakConfig');
  if (source === 'tournament') return h('div', { class: 'setup-section' },
    setupHeading('Tie-breaks', 'Inherited in decisive order from the tournament format profile.'),
    h('div', { class: 'tiebreak-list' }, normalizeTiebreakConfig(t.tiebreakConfig).map((item, index) => h('div', { class: 'tiebreak-row' },
      h('span', { class: 'tiebreak-order' }, String(index + 1)), h('span', { class: 'pill' }, item.code), h('span', { class: 'grow' }, TIEBREAKS[item.code] ?? item.code)))),
    h('button', { class: 'btn ghost', onclick: () => { store.setSectionSetupValue(t.id, 'tiebreakConfig', t.tiebreakConfig, { emit: false }); store.setSectionSetupValue(t.id, 'tiebreaks', t.tiebreaks, { emit: false }); commit(); } }, 'Override tournament rule'));
  t.tiebreakConfig = normalizeTiebreakConfig(t.tiebreakConfig ?? t.tiebreaks);
  const available = Object.entries(TIEBREAKS).filter(([code]) => !t.tiebreaks.includes(code));
  const addSelect = setupSelect(available[0]?.[0] ?? '', available.map(([id, label]) => ({ id, label: `${id} · ${label}` })), () => {});
  const rows = t.tiebreakConfig.map((item, index) => h('div', { class: 'tiebreak-row' },
    h('span', { class: 'tiebreak-order' }, String(index + 1)),
    h('span', { class: 'pill' }, item.code),
    h('span', { class: 'grow' }, TIEBREAKS[item.code] ?? item.code),
    item.code.startsWith('BH') || item.code === 'MMED' || item.code === 'SOLK'
      ? h('label', { class: 'inline-number' }, 'Low', h('input', { type: 'number', min: 0, max: 9, value: item.cutsLow ?? 0, onchange: e => { item.cutsLow = Number(e.target.value) || 0; syncTieBreaks(t); } }))
      : null,
    item.code.startsWith('BH') || item.code === 'MMED' || item.code === 'SOLK'
      ? h('label', { class: 'inline-number' }, 'High', h('input', { type: 'number', min: 0, max: 9, value: item.cutsHigh ?? 0, onchange: e => { item.cutsHigh = Number(e.target.value) || 0; syncTieBreaks(t); } }))
      : null,
    h('button', { class: 'btn ghost', title: 'Move up', disabled: index === 0, onclick: () => { [t.tiebreakConfig[index - 1], t.tiebreakConfig[index]] = [t.tiebreakConfig[index], t.tiebreakConfig[index - 1]]; syncTieBreaks(t); } }, icon('↑')),
    h('button', { class: 'btn ghost', title: 'Move down', disabled: index === t.tiebreakConfig.length - 1, onclick: () => { [t.tiebreakConfig[index + 1], t.tiebreakConfig[index]] = [t.tiebreakConfig[index], t.tiebreakConfig[index + 1]]; syncTieBreaks(t); } }, icon('↓')),
    h('button', { class: 'btn ghost danger', title: 'Remove tie-break', onclick: () => { t.tiebreakConfig.splice(index, 1); syncTieBreaks(t); } }, icon('✕'))
  ));
  return h('div', { class: 'setup-section' },
    setupHeading('Tie-breaks', 'Order is decisive from top to bottom.'),
    h('button', { class: 'btn ghost', onclick: () => { store.useTournamentSetupDefault(t.id, 'tiebreakConfig', { emit: false }); store.useTournamentSetupDefault(t.id, 'tiebreaks', { emit: false }); commit(); } }, 'Use tournament rule'),
    h('div', { class: 'setup-grid' },
      setupField('Preset', setupSelect('', [{ id: '', label: 'Choose preset…' }, ...TIEBREAK_PRESETS], value => {
        const preset = TIEBREAK_PRESETS.find(item => item.id === value);
        if (!preset) return;
        t.tiebreakConfig = normalizeTiebreakConfig(preset.codes);
        syncTieBreaks(t);
      })),
      setupField('Unplayed-round rules', setupSelect(t.tiebreakRules, [
        { id: 'fide2026', label: 'FIDE 2026' },
        { id: 'legacy', label: 'Legacy virtual opponent' }
      ], value => { t.tiebreakRules = value; commit(); }))
    ),
    h('div', { class: 'tiebreak-list' }, rows),
    h('div', { class: 'toolbar' }, addSelect, h('button', {
      class: 'btn', disabled: !available.length,
      onclick: () => { if (!addSelect.value) return; t.tiebreakConfig.push({ code: addSelect.value, cutsLow: 0, cutsHigh: 0 }); syncTieBreaks(t); }
    }, iconLabel('＋', 'Add tie-break')))
  );
}

function scheduleSetupFields(event, t) {
  t.roundSchedule = normalizeRoundSchedule(t.roundSchedule, t.rounds, { ...event, ...t });
  const source = store.sectionSetupSource(t, 'roundSchedule');
  const inherited = source === 'tournament';
  const updateRound = (index, key, value) => {
    const schedule = t.roundSchedule.map(round => ({ ...round }));
    schedule[index][key] = value;
    store.setSectionSetupValue(t.id, 'roundSchedule', schedule, { emit: false });
    commit();
  };
  return h('div', { class: 'setup-section' },
    setupHeading('Schedule', inherited ? 'Inherited from the tournament master schedule and editable after pairing.' : 'This section overrides the tournament master schedule and remains editable after pairing.'),
    h('div', { class: 'schedule-table' },
      h('div', { class: 'schedule-head' }, h('span', {}, 'Round'), h('span', {}, 'Date'), h('span', {}, 'Time'), h('span', {}, 'Site')),
      t.roundSchedule.map((round, index) => h('div', { class: 'schedule-row' },
        h('span', { class: 'num' }, String(index + 1)),
        setupInput(round, 'date', { type: 'date', disabled: inherited, onChange: value => updateRound(index, 'date', value) }),
        setupInput(round, 'time', { type: 'time', disabled: inherited, onChange: value => updateRound(index, 'time', value) }),
        setupInput(round, 'site', { disabled: inherited, placeholder: t.site || event.site || 'Venue', onChange: value => updateRound(index, 'site', value) })
      ))
    ),
    h('button', { class: 'btn ghost', onclick: () => {
      if (inherited) store.setSectionSetupValue(t.id, 'roundSchedule', t.roundSchedule, { emit: false });
      else store.useTournamentSetupDefault(t.id, 'roundSchedule', { emit: false });
      commit();
    } }, inherited ? 'Override tournament rule' : 'Use tournament rule')
  );
}

function publishingSetupFields(event) {
  event.publish ??= {};
  const updatePublish = (key, value) => {
    event.publish[key] = value;
    for (const section of store.sectionsForEvent(event.id)) section.publish = { ...event.publish };
    commit();
  };
  return h('div', { class: 'setup-section' },
    setupHeading('Publishing'),
    h('div', { class: 'setup-grid' },
      setupField('Creator / last upload', setupInput(event.publish, 'creator', { onChange: value => updatePublish('creator', value) })),
      setupField('Last update override', setupInput(event.publish, 'lastUpdate', { onChange: value => updatePublish('lastUpdate', value) })),
      setupField('Homepage URL', setupInput(event.publish, 'homepageUrl', { type: 'url', onChange: value => updatePublish('homepageUrl', value) })),
      setupField('Registration URL', setupInput(event.publish, 'registrationUrl', { type: 'url', onChange: value => updatePublish('registrationUrl', value) })),
      setupField('Calendar URL', setupInput(event.publish, 'calendarUrl', { type: 'url', onChange: value => updatePublish('calendarUrl', value) })),
      setupField('QR URL', setupInput(event.publish, 'qrUrl', { type: 'url', onChange: value => updatePublish('qrUrl', value) }))
    )
  );
}

function administrationSetupFields(event, t) {
  const status = setupStatus(event, t);
  const policy = t.ratingPolicy ??= {};
  t.listOptions ??= {};
  t.titleNorm ??= {};
  return h('div', {},
    setupReview(event, t, status),
    h('div', { class: 'setup-section' },
      setupHeading('Pairing rating policy'),
      h('div', { class: 'setup-grid' },
        inheritedSetupField(event, t, 'ratingPolicy', 'Rating policy', ({ disabled, onChange }) => h('div', { class: 'setup-grid compact' },
          setupField('Primary rating', setupSelect(policy.primary, RATING_SOURCES, value => onChange({ ...policy, primary: value }), disabled)),
          setupField('Fallback rating', setupSelect(policy.fallback, RATING_SOURCES, value => onChange({ ...policy, fallback: value }), disabled)),
          setupField('Unrated value', setupInput(policy, 'unratedValue', { type: 'number', min: 0, disabled, onChange: value => onChange({ ...policy, unratedValue: value }) })),
          setupField('Renumber from resolved rating', setupToggle(policy.renumberByResolvedRating !== false, value => onChange({ ...policy, renumberByResolvedRating: value }), disabled))))
      )),
    h('div', { class: 'setup-section' },
      setupHeading('FIDE title and norm metadata'),
      h('div', { class: 'setup-grid' },
        setupField('Norm-eligible section', setupToggle(!!t.titleNorm.enabled, value => { t.titleNorm.enabled = value; commit(); })),
        setupField('Norm category', setupInput(t.titleNorm, 'category', { placeholder: 'GM / IM / WGM / WIM' })),
        setupField('Title report code', setupInput(t.titleNorm, 'reportCode'))
      )),
    h('div', { class: 'setup-section' }, setupHeading('Award groups', 'Optional section-local award categories; eligibility is configured on the parent tournament.'), AgeGroups(t)),
    h('div', { class: 'setup-section danger-zone' },
      setupHeading('Round administration'),
      h('button', {
        class: 'btn danger', disabled: !t.roundsData.length,
        onclick: () => confirmModal('Delete all paired rounds', 'Delete all pairings and results from this section?', () => { store.deleteFromRound(t, 1); render(); })
      }, iconLabel('🗑', 'Delete all pairings and results')))
  );
}

function setupReview(event, t, status = setupStatus(event, t)) {
  const group = (title, items, kind, emptyText) => h('div', { class: `setup-check-group ${kind}` },
    h('h3', {}, title),
    items.length ? h('ul', {}, items.map(item => h('li', {}, item))) : h('p', { class: 'muted' }, emptyText));
  return h('div', { class: 'setup-section setup-status' },
    setupHeading('Pre-pairing checklist'),
    h('div', { class: 'setup-check-grid' },
      group('Complete', status.checklist, 'complete', 'No completed checks yet.'),
      group('Warnings', status.warnings, 'warning', 'No warnings.'),
      group('Blockers', status.errors, 'blocker', 'No blockers.'))
  );
}

function finishSetup(t) {
  applyRatingPolicy(t);
  if (t.initialRanking !== 'manual' && !t.roundsData.length) {
    const compare = {
      rating: (a, b) => (b.rating - a.rating) || (a.name ?? '').localeCompare(b.name ?? ''),
      name: (a, b) => (a.name ?? '').localeCompare(b.name ?? ''),
      fideId: (a, b) => String(a.fideId ?? '').localeCompare(String(b.fideId ?? '')) || (a.name ?? '').localeCompare(b.name ?? ''),
      national: (a, b) => ((b.ratings?.national ?? 0) - (a.ratings?.national ?? 0)) || (a.name ?? '').localeCompare(b.name ?? '')
    }[t.initialRanking] ?? ((a, b) => (b.rating - a.rating));
    [...t.players].sort(compare).forEach((player, index) => { player.no = index + 1; });
  }
  t.setupCompletedAt = new Date().toISOString();
  store.emit();
  go('registrations');
}

function AgeGroups(t) {
  const list = h('div', {}, (t.ageGroups ?? []).map((g, i) =>
    h('div', { class: 'flex', style: 'padding:2px 0' },
      h('span', { class: 'pill' }, g.code),
      h('span', { class: 'muted small grow' }, g.code.startsWith('U') ? `born ${g.maxBirthYear} or later` : `born ${g.maxBirthYear} or earlier`),
      h('button', { class: 'btn ghost', onclick: () => { t.ageGroups.splice(i, 1); store.applyAgeGroups(t); commit(); } }, icon('✕')))));
  const code = h('input', { type: 'text', class: 'btn', placeholder: 'U14 / S60', style: 'width:90px' });
  const year = h('input', { type: 'number', class: 'btn', placeholder: 'cutoff birth year', style: 'width:150px' });
  return h('div', {},
    h('p', { class: 'muted small' }, 'Define groups like U14 or S60 with a birth-year cutoff; player “type” fields fill automatically from birth years.'),
    list,
    h('div', { class: 'toolbar' }, code, year, h('button', {
      class: 'btn', onclick: () => {
        if (!code.value || !year.value) return;
        t.ageGroups = t.ageGroups ?? [];
        t.ageGroups.push({ code: code.value.toUpperCase(), maxBirthYear: +year.value });
        store.applyAgeGroups(t); commit();
      }
    }, '＋ Add group')));
}

// =================================================================== EXPORT
function exportWorkspaceRow(mark, label, desc, buttons) {
  return h('div', { class: 'prop', style: 'min-height:44px' },
    h('div', { class: 'k', style: 'width:260px' }, icon(mark), h('span', {}, h('div', {}, label), h('div', { class: 'muted small' }, desc))),
    h('div', { class: 'v flex' }, buttons));
}

async function saveTournamentDocument(event) {
  const path = await window.tl.saveTournament({
    suggestedName: `${safe(event.name)}.tlab`,
    json: JSON.stringify(store.eventDocument(event.id), null, 1),
    backupGenerations: store.data.settings.backupGenerations
  });
  if (path) toast(`Saved to ${path}`);
}

const managedPublishing = {
  connection: null,
  connectionLoading: false,
  connectAttempt: null,
  status: new Map(),
  statusLoading: new Set(),
  busy: '',
  error: '',
  ownershipConflict: false
};

function ensurePublisherConnection() {
  if (managedPublishing.connection != null || managedPublishing.connectionLoading || !window.tl?.publisher) return;
  managedPublishing.connectionLoading = true;
  window.tl.publisher.connection()
    .then(connection => { managedPublishing.connection = connection; })
    .catch(error => { managedPublishing.error = error.message; managedPublishing.connection = { connected: false }; })
    .finally(() => { managedPublishing.connectionLoading = false; render(); });
}

function ensurePublisherStatus(event) {
  const reportId = event.publish?.reportId;
  if (!reportId || managedPublishing.status.has(reportId) || managedPublishing.statusLoading.has(reportId) || !managedPublishing.connection?.connected) return;
  managedPublishing.statusLoading.add(reportId);
  window.tl.publisher.report(reportId)
    .then(status => { managedPublishing.status.set(reportId, status); managedPublishing.ownershipConflict = false; syncPublishedStatus(event, status, false); })
    .catch(error => {
      managedPublishing.error = error.message;
      if ([403, 404].includes(error.status)) managedPublishing.ownershipConflict = true;
      if (error.status === 401) managedPublishing.connection = { connected: false };
    })
    .finally(() => { managedPublishing.statusLoading.delete(reportId); render(); });
}

function syncPublishedStatus(event, status, persist = true, fingerprint = '') {
  event.publish = event.publish ?? {};
  Object.assign(event.publish, {
    provider: 'tourneylab',
    reportId: status.reportId,
    publicUrl: status.publicUrl,
    visibility: status.visibility,
    lastRevision: status.revision,
    lastPublishedAt: status.lastPublishedAt ?? event.publish.lastPublishedAt ?? ''
  });
  if (fingerprint) event.publish.lastPublishedFingerprint = fingerprint;
  if (persist) store.emit();
}

async function connectManagedPublisher() {
  managedPublishing.error = '';
  managedPublishing.busy = 'Connecting…'; render();
  try {
    const attempt = await window.tl.publisher.connectStart(`TourneyLab on ${navigator.platform || 'desktop'}`);
    managedPublishing.connectAttempt = attempt;
    managedPublishing.busy = '';
    render();
    pollManagedPublisher(attempt);
  } catch (error) {
    managedPublishing.error = error.message;
    managedPublishing.busy = '';
    render();
  }
}

function pollManagedPublisher(attempt) {
  if (managedPublishing.connectAttempt?.deviceCode !== attempt.deviceCode) return;
  window.tl.publisher.connectPoll(attempt.deviceCode).then(result => {
    managedPublishing.connection = { connected: true, persistent: result.persistent, account: result.account };
    managedPublishing.connectAttempt = null;
    managedPublishing.error = result.persistent ? '' : 'This device cannot encrypt credentials, so you will need to reconnect after restarting.';
    render();
  }).catch(error => {
    if (error.status === 428 && managedPublishing.connectAttempt) {
      setTimeout(() => pollManagedPublisher(attempt), Math.max(2, attempt.interval ?? 3) * 1000);
      return;
    }
    managedPublishing.connectAttempt = null;
    managedPublishing.error = error.message;
    render();
  });
}

async function disconnectManagedPublisher() {
  await window.tl.publisher.disconnect();
  managedPublishing.connection = { connected: false };
  managedPublishing.status.clear();
  managedPublishing.error = '';
  render();
}

async function createManagedReport(event) {
  managedPublishing.busy = 'Setting up online results…'; managedPublishing.error = ''; render();
  try {
    const status = await window.tl.publisher.createReport(event.name, event.publish?.visibility ?? 'listed');
    managedPublishing.status.set(status.reportId, status);
    managedPublishing.ownershipConflict = false;
    syncPublishedStatus(event, status);
  } catch (error) { managedPublishing.error = error.message; }
  managedPublishing.busy = ''; render();
}

async function publishManagedReport(event, sections, ratingMode) {
  const reportId = event.publish?.reportId;
  if (!reportId) return createManagedReport(event);
  const status = managedPublishing.status.get(reportId);
  const fingerprint = publicationFingerprint(event, sections);
  managedPublishing.busy = status?.revision ? 'Updating published results…' : 'Publishing results…';
  managedPublishing.error = ''; render();
  try {
    let bundle = eventReportBundle(event, sections, { generatedAt: new Date(), ratingMode });
    if (window.tl?.prepareReportBundle) bundle = await window.tl.prepareReportBundle(bundle);
    const next = await window.tl.publisher.publishBundle(reportId, bundle, status?.revision ?? event.publish.lastRevision ?? 0);
    managedPublishing.status.set(reportId, next);
    syncPublishedStatus(event, next, true, fingerprint);
    toast(next.revision === 1 ? 'Results published' : 'Published results updated');
  } catch (error) {
    managedPublishing.error = error.message;
    if (error.status === 409) managedPublishing.status.delete(reportId);
    if ([403, 404].includes(error.status)) managedPublishing.ownershipConflict = true;
  }
  managedPublishing.busy = ''; render();
}

async function purchasePublishing(kind, event) {
  managedPublishing.busy = 'Opening secure checkout…'; managedPublishing.error = ''; render();
  try {
    if (kind === 'event') await window.tl.publisher.checkout(event.publish.reportId);
    else await window.tl.publisher.proCheckout();
    managedPublishing.busy = 'Payment pending confirmation';
    pollManagedStatus(event, 100);
  } catch (error) { managedPublishing.busy = ''; managedPublishing.error = error.message; render(); }
}

function pollManagedStatus(event, attempts) {
  if (!attempts || !event.publish?.reportId) { managedPublishing.busy = ''; render(); return; }
  setTimeout(async () => {
    try {
      const status = await window.tl.publisher.report(event.publish.reportId);
      managedPublishing.status.set(status.reportId, status);
      syncPublishedStatus(event, status, false);
      if (status.entitlement?.canPublish) { managedPublishing.busy = ''; store.emit(); render(); return; }
    } catch (error) { managedPublishing.error = error.message; }
    pollManagedStatus(event, attempts - 1);
  }, 3000);
}

async function updateManagedVisibility(event, visibility) {
  try {
    const status = await window.tl.publisher.updateReport(event.publish.reportId, { visibility });
    managedPublishing.status.set(status.reportId, status);
    syncPublishedStatus(event, status);
  } catch (error) { managedPublishing.error = error.message; render(); }
}

async function managedAction(event, action, body) {
  try {
    const status = await window.tl.publisher.action(event.publish.reportId, action, body);
    managedPublishing.status.set(event.publish.reportId, status);
    if (action === 'delete') resetManagedReport(event);
    else syncPublishedStatus(event, status);
  } catch (error) { managedPublishing.error = error.message; render(); }
}

function resetManagedReport(event) {
  if (event.publish?.reportId) managedPublishing.status.delete(event.publish.reportId);
  Object.assign(event.publish, {
    provider: '', reportId: '', publicUrl: '', lastRevision: 0,
    lastPublishedAt: '', lastPublishedFingerprint: ''
  });
  managedPublishing.ownershipConflict = false;
  managedPublishing.error = '';
  store.emit(); render();
}

function rollbackManagedReport(event, currentRevision) {
  const revision = h('input', { type: 'number', min: 1, max: Math.max(1, currentRevision - 1), value: Math.max(1, currentRevision - 1), class: 'btn' });
  modal('Rollback published results', h('div', {}, h('p', { class: 'muted' }, 'Choose a previous published revision.'), revision), [
    { label: 'Cancel' },
    { label: 'Rollback', kind: 'primary', onClick: () => managedAction(event, 'rollback', { revision: Number(revision.value) }) }
  ]);
}

function managedPublishingPanel(event, sections, ratingMode) {
  ensurePublisherConnection();
  ensurePublisherStatus(event);
  const connection = managedPublishing.connection;
  const reportId = event.publish?.reportId;
  const status = reportId ? managedPublishing.status.get(reportId) : null;
  const fingerprint = publicationFingerprint(event, sections);
  const dirty = !!status?.revision && event.publish?.lastPublishedFingerprint !== fingerprint;
  const buttons = [];
  let description = 'Publish to a permanent TourneyLab Results link. Managed publishing is optional; HTML export remains free.';

  if (!connection?.connected) {
    buttons.push(h('button', { class: 'btn primary', disabled: managedPublishing.connectionLoading || !!managedPublishing.busy, onclick: connectManagedPublisher }, 'Connect with Google'));
  } else if (managedPublishing.ownershipConflict) {
    description = 'This saved report ID belongs to another publishing account. Connect its owner or create a separate public report.';
    buttons.push(h('button', { class: 'btn primary', onclick: () => resetManagedReport(event) }, 'Publish as a new report'));
    buttons.push(h('button', { class: 'btn', onclick: disconnectManagedPublisher }, 'Change account'));
  } else if (!reportId) {
    buttons.push(h('button', { class: 'btn primary', disabled: !sections.length || !!managedPublishing.busy, onclick: () => createManagedReport(event) }, 'Set up online results'));
    buttons.push(h('button', { class: 'btn', onclick: disconnectManagedPublisher }, connection.account?.email ?? 'Disconnect'));
  } else if (!status) {
    description = 'Checking the hosted report…';
  } else {
    const entitlement = status.entitlement ?? {};
    description = status.revision
      ? `${dirty ? 'Unpublished changes' : 'Published'} · Revision ${status.revision} · ${status.visibility === 'unlisted' ? 'Unlisted' : 'Listed publicly'}`
      : 'Online report created. Choose an Event Pass or Organizer Pro to publish it.';
    if (entitlement.canPublish) {
      buttons.push(h('button', { class: 'btn primary', disabled: !!managedPublishing.busy || !sections.length, onclick: () => publishManagedReport(event, sections, ratingMode) }, status.revision ? dirty ? 'Update published results' : 'Publish again' : 'Publish results'));
    } else {
      buttons.push(h('button', { class: 'btn primary', disabled: !!managedPublishing.busy, onclick: () => purchasePublishing('event', event) }, 'Event Pass · US$6'));
      buttons.push(h('button', { class: 'btn', disabled: !!managedPublishing.busy, onclick: () => purchasePublishing('pro', event) }, 'Organizer Pro · US$59/year'));
    }
    if (status.publicUrl && status.revision) {
      buttons.push(h('button', { class: 'btn', onclick: () => window.tl.publisher.openExternal(status.publicUrl) }, 'Open results'));
      buttons.push(h('button', { class: 'btn', onclick: async () => { await window.tl.publisher.copyText(status.publicUrl); toast('Results link copied'); } }, 'Copy link'));
      buttons.push(h('button', { class: 'btn', onclick: () => updateManagedVisibility(event, status.visibility === 'listed' ? 'unlisted' : 'listed') }, status.visibility === 'listed' ? 'Make unlisted' : 'List publicly'));
      if (status.revision > 1 && entitlement.canPublish) buttons.push(h('button', { class: 'btn', onclick: () => rollbackManagedReport(event, status.revision) }, 'Rollback…'));
      buttons.push(h('button', { class: 'btn', onclick: () => confirmModal('Unpublish online results?', 'The permanent link will stop displaying this report until you publish it again.', () => managedAction(event, 'unpublish'), 'Unpublish') }, 'Unpublish'));
      buttons.push(h('button', { class: 'btn danger', onclick: () => confirmModal('Delete hosted results?', 'This permanently removes every hosted revision. Your local tournament and exported files are unaffected.', () => managedAction(event, 'delete'), 'Delete hosted results') }, 'Delete hosted results'));
    }
  }

  return h('section', { class: 'managed-publishing', 'aria-labelledby': 'managed-publishing-title' },
    h('div', { class: 'managed-publishing-head' },
      h('div', {}, h('h2', { id: 'managed-publishing-title' }, 'Publish with TourneyLab'), h('p', { class: 'muted' }, description)),
      connection?.connected ? h('span', { class: 'pill' }, connection.account?.email ?? 'Connected') : null),
    managedPublishing.connectAttempt ? h('div', { class: 'publisher-device-code', role: 'status' },
      h('span', {}, 'Approve this code in your browser'), h('strong', {}, managedPublishing.connectAttempt.userCode)) : null,
    managedPublishing.busy ? h('p', { class: 'publisher-progress', role: 'status', 'aria-live': 'polite' }, managedPublishing.busy) : null,
    managedPublishing.error ? h('p', { class: 'publisher-error', role: 'alert' }, managedPublishing.error) : null,
    h('div', { class: 'toolbar managed-publishing-actions' }, buttons));
}

function EventExport(event) {
  const sections = store.sectionsForEvent(event.id);
  const ratingMode = standingsRatingMode();
  const publishedLinks = [event.publish?.homepageUrl, event.publish?.registrationUrl, event.publish?.calendarUrl].filter(Boolean).length;

  return page(h('div', { class: 'event-export-workspace' },
    eventWorkspaceHeader(event, 'Export & publish', 'Full-tournament output and shared publishing details.', '📤'),
    h('div', { class: 'props export-workspace-list' },
      exportWorkspaceRow('📄', 'Tournament report site', `${sections.length} section${sections.length === 1 ? '' : 's'} with separate section, round, player, and team pages`, [
        h('button', {
          class: 'btn primary', disabled: !sections.length,
          onclick: () => exportReportSite(event, sections, ratingMode)
        }, 'Export report site…')
      ]),
      exportWorkspaceRow('💾', 'Tournament file', 'Save or share the tournament, registrations, and every section', [
        h('button', { class: 'btn primary', onclick: () => saveTournamentDocument(event) }, 'Save .tlab as…')
      ]),
      exportWorkspaceRow('📤', 'Publishing details', publishedLinks ? `${publishedLinks} shared link${publishedLinks === 1 ? '' : 's'} configured` : 'No shared links configured', [
        h('button', { class: 'btn', onclick: () => { eventSetupTab = 'publishing'; go('event-setup'); } }, 'Configure publishing')
      ])),
    managedPublishingPanel(event, sections, ratingMode),
    h('div', { class: 'callout' }, h('span', { class: 'ic' }, icon('ℹ️')),
      h('div', {}, 'The exported report folder opens offline and can be uploaded to any static host without a TourneyLab account. Section pairing lists, standings, PGN, TRF, and XML remain local exports.'))
  ));
}

function SectionExportPage(t) {
  const upto = t.currentRound || 0;
  const ratingMode = standingsRatingMode();
  const event = store.activeEvent;
  return page(
    h('div', { class: 'page-icon' }, icon('📤')),
    h('h1', { class: 'page-title', style: 'pointer-events:none' }, 'Reports & export'),
        h('p', { class: 'page-sub' }, `${sectionWorkspaceName(event, t)} · Section reports and interchange files generated locally.`),
        h('div', { class: 'props' },
          exportWorkspaceRow('📄', 'Section report', 'Players, schedule, pairings, standings, and administration details', [
            h('button', { class: 'btn primary', onclick: () => exportFile(tournamentReportHTML(t, { event, uptoRound: upto || t.roundsData.length, generatedAt: new Date(), ratingMode }), `${safe(event.name)}-${safe(t.sectionName)}-report.html`, 'HTML', 'html') }, 'Export HTML')]),
      exportWorkspaceRow('🖨', 'Pairing list', `Round ${upto || 1}, HTML`, [
        h('button', { class: 'btn', disabled: !upto, onclick: () => exportFile(pairingListHTML(t, viewRoundOr(t), { event, ratingMode }), `${safe(t.name)}-R${viewRoundOr(t)}-pairings.html`, 'HTML', 'html', { openAfterExport: true }) }, 'Export HTML'),
        h('button', { class: 'btn', disabled: !upto, onclick: () => exportFile(isTeam(t) ? teamMatchCardsHTML(t, viewRoundOr(t), { event }) : pairingCardsHTML(t, viewRoundOr(t), { event }), `${safe(t.name)}-R${viewRoundOr(t)}-cards.html`, 'HTML', 'html', { openAfterExport: true }) }, isTeam(t) ? 'Match cards' : 'Pairing cards')]),
      exportWorkspaceRow('🏆', 'Standings', `After round ${upto}, with tie-breaks`, [
        h('button', { class: 'btn', disabled: !upto, onclick: () => exportFile(standingsHTML(t, upto, { ratingMode, event }), `${safe(t.name)}-standings.html`, 'HTML', 'html') }, 'HTML'),
        h('button', { class: 'btn', disabled: !upto, onclick: () => exportFile(standingsCSV(t, upto, { ratingMode }), `${safe(t.name)}-standings.csv`, 'CSV', 'csv') }, 'CSV / Excel')]),
      exportWorkspaceRow('♟', 'PGN', 'Game skeletons with tournament metadata', [
        h('button', { class: 'btn', disabled: !upto, onclick: () => exportFile(tournamentPGN(t, { empty: true, event }), `${safe(t.name)}-empty.pgn`, 'PGN', 'pgn') }, 'Empty PGN'),
        h('button', { class: 'btn', disabled: !upto, onclick: () => exportFile(tournamentPGN(t, { event }), `${safe(t.name)}.pgn`, 'PGN', 'pgn') }, 'With results')]),
      exportWorkspaceRow('📊', 'Rating administration', 'TRF-style file for rating reports', [
        h('button', { class: 'btn', disabled: !upto, onclick: () => exportFile(ratingAdminTRF(t, upto, { event }), `${safe(t.name)}.trf`, 'TRF', 'trf') }, 'Export TRF')]),
      exportWorkspaceRow('🔁', 'XML interchange', 'Swiss-Manager-style XML (players, teams, results)', [
        h('button', { class: 'btn', onclick: () => exportFile(exportXML(t), `${safe(t.name)}.xml`, 'XML', 'xml') }, 'Export XML'),
        h('button', { class: 'btn', onclick: () => importXMLInto(t) }, 'Import XML…')]),
      exportWorkspaceRow('📦', 'Swiss-Manager .TUNx', hasOriginalTunx(t)
        ? 'Export supported TourneyLab edits to .TUNx, or recover the byte-identical imported file'
        : 'Available after importing a native Swiss-Manager .TUNx file', [
        h('button', { class: 'btn primary', disabled: !hasOriginalTunx(t), onclick: () => exportTunxFile(t) }, 'Export .TUNx'),
        h('button', { class: 'btn', disabled: !hasOriginalTunx(t), onclick: () => exportOriginalTunxFile(t) }, 'Export original .TUNx')])),
    h('div', { class: 'callout' }, h('span', { class: 'ic' }, icon('ℹ️')),
      h('div', {}, 'Use the tournament Export & publish page for the complete report and .tlab file.'))
  );
}

function viewRoundOr(t) { return viewRound ?? t.currentRound ?? 1; }
const safe = s => (s || 'tournament').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-');

async function exportFile(content, suggestedName, filterName, ext, opts = {}) {
  const p = await window.tl.exportFile({ suggestedName, content, filterName, ext, ...opts });
  if (p) toast(opts.openAfterExport ? `Exported and opened ${p}` : `Exported to ${p}`);
}

async function exportReportSite(event, sections, ratingMode) {
  try {
    let bundle = eventReportBundle(event, sections, { generatedAt: new Date(), ratingMode });
    if (window.tl?.prepareReportBundle) bundle = await window.tl.prepareReportBundle(bundle);
    const written = await window.tl.exportReportBundle({
      suggestedName: `${safe(event.name)}-report`,
      bundle
    });
    if (written?.directory) toast(`Exported report site to ${written.directory}`);
  } catch (error) {
    toast(error?.message || 'Could not export the report site.');
  }
}

async function exportOriginalTunxFile(t) {
  try {
    const bytes = exportOriginalTunx(t);
    const originalName = t.interop?.swissManager?.originalFilename;
    const suggestedName = /\.tunx$/i.test(originalName || '') ? originalName : `${safe(t.name)}.TUNx`;
    const exportedPath = await window.tl.exportBinary({
      suggestedName,
      bytes,
      filterName: 'Swiss-Manager tournament',
      ext: 'TUNx'
    });
    if (exportedPath) toast(`Exported original Swiss-Manager file to ${exportedPath}`);
  } catch (error) {
    console.error(error);
    toast(`Could not export original TUNx: ${error.message || 'source unavailable'}.`);
  }
}

async function exportTunxFile(t) {
  try {
    const bytes = exportTunx(t);
    const originalName = t.interop?.swissManager?.originalFilename;
    const suggestedName = /\.tunx$/i.test(originalName || '') ? originalName : `${safe(t.name)}.TUNx`;
    const exportedPath = await window.tl.exportBinary({
      suggestedName,
      bytes,
      filterName: 'Swiss-Manager tournament',
      ext: 'TUNx'
    });
    if (exportedPath) toast(`Exported Swiss-Manager file to ${exportedPath}`);
  } catch (error) {
    console.error(error);
    modal('Cannot export this change to TUNx yet', h('p', {}, error.message || 'The tournament contains an unsupported native edit.'), [
      { label: 'OK', kind: 'primary' }
    ]);
  }
}

async function importXMLInto(t) {
  const text = await window.tl.openText({ title: 'Import XML', extensions: ['xml'] });
  if (!text) return;
  let data;
  try { data = importXML(text); }
  catch (e) { toast('Could not parse XML.'); return; }

  // Merge players by id (or by start number) without clobbering existing ones.
  const byId = new Map(t.players.map(p => [p.id, p]));
  const byNo = new Map(t.players.map(p => [p.no, p]));
  let added = 0, updated = 0;
  for (const ip of data.players) {
      const existing = byId.get(ip.id) || (ip.no != null && byNo.get(ip.no));
      if (existing) {
        const values = {
          name: ip.name || existing.name,
          rating: ip.rating ?? existing.rating,
          fed: ip.fed || existing.fed, club: ip.club || existing.club,
          fideId: ip.fideId || existing.fideId, byear: ip.byear || existing.byear,
          sex: ip.sex || existing.sex, title: ip.title || existing.title
        };
        if (existing.registrationId && !isTeam(t)) store.updateRegistration(t.eventId, existing.registrationId, values, { emit: false });
        else Object.assign(existing, values);
        updated++;
      } else {
        const player = {
          id: ip.id || ('P' + Math.random().toString(36).slice(2, 9)),
          no: ip.no ?? t.players.length + 1, name: ip.name || 'Unnamed',
          rating: ip.rating ?? null, fed: ip.fed || '', club: ip.club || '',
          fideId: ip.fideId || '', byear: ip.byear || '', sex: ip.sex || '',
          title: ip.title || '', rankCorrection: 0, addedPoints: 0
        };
        if (isTeam(t)) t.players.push(player);
        else store.addPlayer(t, player);
        added++;
      }
  }

  // Optionally import rounds/results when present (FIDE XML "results import
  // requires pairings already to exist" — here we accept full rounds too).
  const applyPlayersToast = () => toast(`XML imported: ${added} added, ${updated} updated.`);
  if (data.roundsData.length) {
    confirmModal('Import rounds & results?',
      `The file contains ${data.roundsData.length} round(s). Replace the current rounds with the imported ones? (Players were already imported.)`,
      () => {
        t.roundsData = data.roundsData.map(rd => ({
          date: rd.date || '', time: '', site: '',
          pairings: rd.pairings.map((pr, i) => ({
            board: pr.board || i + 1, whiteId: pr.whiteId, blackId: pr.blackId,
            result: pr.result || '', manual: !!pr.manual
          })),
          byes: rd.byes || []
        }));
        t.currentRound = t.roundsData.length;
        if (t.roundsData.length > t.rounds) t.rounds = t.roundsData.length;
        toast(`XML imported: ${added} added, ${updated} updated, ${t.roundsData.length} round(s).`);
        commit();
      }, 'Replace rounds');
    // players are already merged; persist that even if rounds are declined
    commit();
  } else {
    applyPlayersToast();
    commit();
  }
}
