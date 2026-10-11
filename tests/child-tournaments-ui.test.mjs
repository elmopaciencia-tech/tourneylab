import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../renderer/js/app.js', import.meta.url), 'utf8');
const views = await readFile(new URL('../renderer/js/views.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../renderer/styles.css', import.meta.url), 'utf8');
const main = await readFile(new URL('../main.cjs', import.meta.url), 'utf8');

test('tournaments expose distinct parent pages and retain the dashboard alias', () => {
  assert.match(app, /EVENT_VIEWS/);
  assert.match(app, /go\('event-overview'\)/);
  assert.match(views, /case 'event-dashboard':\s*case 'event-overview':\s*return EventOverview/);
  for (const route of ['event-overview', 'registrations', 'event-sections', 'event-setup', 'event-export']) {
    assert.ok(views.includes(`id: '${route}'`), `missing parent route ${route}`);
  }
  assert.match(views, /function EventOverview[\s\S]*tournamentPageIdentity\(event, event,/);
  assert.match(views, /function EventSections/);
  for (const label of ['Add section', 'Build sections', 'Registrations', 'Section defaults', 'Allocate boards']) {
    assert.ok(views.includes(label), `missing ${label}`);
  }
  for (const oldLabel of ['Build divisions', 'build several divisions together', 'Division 1', 'Division 2', 'New divisions inherit']) {
    assert.equal(views.includes(oldLabel), false, `old division wording remains: ${oldLabel}`);
  }
  for (const heading of ['Section', 'Format', 'Rounds', 'Participants', 'Progress', 'Boards', 'Setup']) {
    assert.ok(views.includes(heading), `missing dashboard column ${heading}`);
  }
});

test('breadcrumbs always distinguish tournament pages from section pages', () => {
  assert.match(app, /EVENT_VIEWS\.find\(view => view\.id === route\.view\)/);
  assert.match(app, /SECTION_ROUTE_IDS/);
  assert.match(app, /registrationSectionLabels\(event, sections\)/);
  assert.match(app, /setAttribute\('aria-label', 'Breadcrumb'\)/);
});

test('single and bulk section creation expose snapshot, template, eligibility, and atomic review controls', () => {
  assert.match(views, /function openChildTournamentDialog/);
  assert.match(views, /function openDivisionBuilder/);
  for (const label of [
    'Setup source', 'Starting board', 'Target players', 'Age limit',
    'Minimum rating', 'Maximum rating', 'Minimum birth year', 'Maximum birth year', 'Side event',
    'Suggest codes & boards'
  ]) {
    assert.ok(views.includes(label), `missing child builder control ${label}`);
  }
  assert.match(views, /store\.createChildTournaments/);
  assert.match(views, /table\.replaceChildren\(head, \.\.\.bodyRows\)/);
  assert.equal(views.includes('Assign the same registrations'), false);
});

test('registration workspace supports reviewed suggestions and child roster actions', () => {
  assert.match(views, /case 'registrations':\s*return Registrations/);
  for (const label of [
    'New registration', 'Quick add registrations', 'Import registration CSV',
    'Suggest assignments', 'Review suggested assignments',
    'Assign from registrations', 'Unassign'
  ]) {
    assert.ok(views.includes(label), `missing registration action ${label}`);
  }
  assert.match(views, /store\.suggestAssignments/);
  assert.match(views, /store\.assignRegistration/);
  assert.match(views, /store\.unassignRegistration/);
  assert.ok(views.includes('Registration changes update every assigned section; pairing numbers and existing results stay unchanged.'));
  assert.equal(views.includes('started section ratings remain frozen'), false);
  assert.ok(views.includes('Save as section defaults'));
  for (const legacyLabel of ['Parent event', 'Add child tournament', 'Child defaults', 'Current child', 'Add competition', 'Competition defaults']) {
    assert.equal(views.includes(legacyLabel), false, `legacy user-facing label remains: ${legacyLabel}`);
  }
});

test('registration workspace uses the section assignment board as its sole layout', () => {
  assert.match(views, /registrationSectionLabels\(event, children\)/);
  assert.match(views, /function registrationBoard\(/);
  assert.match(views, /class:\s*'registration-board'/);
  assert.match(views, /registrationBoardSelection/);
  assert.match(views, /moveRegistrationBoardSelection/);
  assert.match(views, /registration-marquee[\s\S]*pointerdown/);
  assert.match(views, /draggable:\s*locked \? null : 'true'/);
  assert.match(views, /function registrationSectionSelect/);
  assert.match(views, /class:\s*'registration-section-picker'/);
  assert.match(views, /store\.setRegistrationSection\(event\.id, registration\.id/);
  assert.match(views, /store\.reinstateRegistration\(withdrawnAssignment\.child\.id, registration\.id/);
  for (const label of ['Unassigned', 'Not assigned', 'Multiple sections', 'Assign each registration to one section.']) {
    assert.ok(views.includes(label), `missing section picker guidance: ${label}`);
  }
  assert.ok(views.includes('Reinstate'), 'withdrawn registrations need an explicit recovery action');
  assert.equal(views.includes('Show sections'), false);
  assert.equal(views.includes('function registrationAssignmentCell'), false);
  assert.equal(views.includes('registrationViewMode'), false);
  assert.doesNotMatch(views.slice(views.indexOf('function Registrations'), views.indexOf('function registrationBoard')), /registration-matrix/);
  for (const selector of ['.registration-board', '.registration-board-lane', '.registration-board-card', '.registration-marquee']) {
    assert.ok(css.includes(selector), `missing ${selector}`);
  }
});

test('registration kanban lanes wrap into rows without overflowing the content area', () => {
  assert.match(css, /\.registrations-workspace\s*\{[\s\S]*?width:\s*100%[\s\S]*?min-width:\s*0/);
  assert.match(css, /\.registration-board\s*\{[\s\S]*?grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(min\(250px, 100%\), 1fr\)\)/);
  assert.match(css, /\.registration-board\s*\{[\s\S]*?max-width:\s*100%/);
  assert.match(css, /\.registration-board-lane\s*\{[\s\S]*?min-width:\s*0[\s\S]*?max-width:\s*100%/);
  assert.doesNotMatch(css, /\.registration-board\s*\{[^}]*grid-auto-flow:\s*column/);
});

test('suggested assignments also use a single section dropdown', () => {
  assert.match(views, /function reviewSuggestedAssignments[\s\S]*registrationSectionLabels\(event, children\)/);
  assert.match(views, /class:\s*'suggestion-section-picker'/);
  assert.match(views, /store\.setRegistrationSection\(event\.id, choice\.registration\.id/);
  assert.equal(views.includes("type: 'checkbox', checked: eligible"), false);
});

test('parent and section export pages expose only their owned output', () => {
  const parentExport = views.slice(views.indexOf('function EventExport'), views.indexOf('function SectionExportPage'));
  const sectionExport = views.slice(views.indexOf('function SectionExportPage'), views.indexOf('function viewRoundOr'));

  assert.match(parentExport, /exportReportSite/);
  assert.match(parentExport, /saveTournamentDocument/);
  assert.doesNotMatch(parentExport, /pairingListHTML|ratingAdminTRF|importXMLInto/);

  assert.match(sectionExport, /tournamentReportHTML/);
  assert.match(sectionExport, /pairingListHTML/);
  assert.match(sectionExport, /ratingAdminTRF/);
  assert.match(sectionExport, /importXMLInto/);
  assert.doesNotMatch(sectionExport, /eventReportBundle|exportReportSite|saveTournamentDocument/);
});

test('event and registration workspaces remain usable at collapsed and minimum widths', () => {
  for (const selector of ['.event-overview', '.event-sections', '.event-setup-workspace', '.event-command-bar', '.child-tournaments-table', '.registration-matrix', '.division-builder', '.modal.wide']) {
    assert.ok(css.includes(selector), `missing ${selector}`);
  }
  assert.match(css, /\.event-overview[\s\S]*max-width:\s*860px/);
  assert.match(css, /@media \(max-width:\s*760px\)[\s\S]*registration-matrix/);
});

test('tournament setup reuses the parent overview hierarchy', () => {
  const setupView = views.slice(views.indexOf('function EventSetup'), views.indexOf('function Setup(t)'));
  assert.match(setupView, /tournamentPageIdentity\(event, event,/);
  assert.match(setupView, /class:\s*'event-command-bar'/);
  assert.match(setupView, /class:\s*'props event-setup-properties'/);
  assert.match(setupView, /'Setup status'/);
  assert.match(setupView, /'Tournament setup'/);
  assert.match(css, /\.event-setup-workspace \.setup-field[\s\S]*grid-template-columns:\s*170px/);
});

test('section age eligibility is configured directly without preset age-band duplication', () => {
  assert.match(views, /setupHeading\('Section eligibility'/);
  assert.match(views, /sectionAgeLimitControl\(event, section\)/);
  assert.match(views, /'Under age'/);
  assert.match(views, /'All sections open'/);
  for (const legacyLabel of ['Tournament age scheme', 'Add U8 / U12 / U16 / Open', 'Link sections', 'Tournament age band', 'No parent age band']) {
    assert.equal(views.includes(legacyLabel), false, `legacy age-band UI remains: ${legacyLabel}`);
  }
});

test('workspace persistence creates one-time migration backups through schema v7', () => {
  assert.match(main, /pre-v3/);
  assert.match(main, /backupMigration\(workspaceFile\(\), data, 4\)/);
  assert.match(main, /backupMigration\(workspaceFile\(\), data, 5\)/);
  assert.match(main, /backupMigration\(workspaceFile\(\), data, 6\)/);
  assert.match(main, /backupMigration\(workspaceFile\(\), data, 7\)/);
  assert.match(main, /schemaVersion/);
  assert.match(main, /copyFileSync/);
});
