import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const views = await readFile(new URL('../renderer/js/views.js', import.meta.url), 'utf8');
const app = await readFile(new URL('../renderer/js/app.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../renderer/styles.css', import.meta.url), 'utf8');

test('new tournament actions open the setup wizard and Setup replaces the old settings destination', () => {
  assert.match(views, /go\('setup-wizard'\)/);
  assert.match(app, /go\('setup-wizard'\)/);
  assert.match(views, /id:\s*'setup'.*label:\s*'Setup'/);
  assert.match(views, /case 'setup-wizard':\s*return SetupWizard/);
  assert.match(views, /case 'setup':\s*return Setup/);
});

test('setup wizard exposes the parent-led six-stage tournament setup flow', () => {
  for (const label of ['Tournament details', 'Schedule & venue', 'Competition rules', 'First section', 'Eligibility & capacity', 'Review']) {
    assert.ok(views.includes(label), `missing wizard stage ${label}`);
  }
  assert.match(views, /setupStatus\(/);
  assert.match(views, /applyRatingPolicy\(/);
  assert.match(views, /Finish setup & add registrations/);
  assert.match(views, /go\('registrations'\)/);
});

test('section Setup keeps familiar tabs while inherited competition rules are read only until overridden', () => {
  const sectionTabs = views.match(/const SECTION_SETUP_TABS = \[([\s\S]*?)\n\];/)?.[1] ?? '';
  for (const label of ['General', 'Pairing', 'Scoring', 'Tie-breaks', 'Schedule', 'Administration']) {
    assert.ok(views.includes(label), `missing Setup tab ${label}`);
  }
  assert.doesNotMatch(sectionTabs, /Publishing/);
  assert.match(views, /openChildTournamentDialog\(event\)/);
  assert.match(views, /store\.duplicateSection/);
  assert.match(views, /store\.deleteSection/);
  assert.match(views, /Confirm pairing setup/);
  for (const label of ['Section identity & eligibility', 'Override tournament rule', 'Use tournament rule', 'Inherited', 'Overridden', 'Locked']) {
    assert.ok(views.includes(label), `missing ownership UI ${label}`);
  }
  assert.match(views, /function Setup\(t\)[\s\S]*general:\s*\(\) => sectionSetupFields\(event, t\)/);
  assert.doesNotMatch(views, /function Setup\(t\)[\s\S]{0,500}eventSetupFields\(event, t\)/);
  assert.doesNotMatch(views, /function administrationSetupFields[\s\S]*Lists and board reports/);
  assert.doesNotMatch(views, /function administrationSetupFields[\s\S]*Workspace defaults/);
});

test('parent Setup owns the schedule, competition profiles, eligibility, and publishing flow', () => {
  assert.match(views, /function EventSetup\(event\)/);
  for (const label of ['Details', 'Schedule & venue', 'Competition rules', 'Sections & eligibility', 'Publishing & reports']) {
    assert.ok(views.includes(label), `missing parent Setup area ${label}`);
  }
  assert.match(views, /eventIdentityFields\(event\)/);
  assert.match(views, /eventScheduleFields\(event\)/);
  assert.match(views, /competitionProfileFields\(event\)/);
  assert.match(views, /sectionsEligibilityFields\(event\)/);
  assert.match(views, /publishingSetupFields\(event\)/);
  assert.match(app, /Workspace settings/);
  assert.match(views, /setupHeading\('Section eligibility'/);
  assert.doesNotMatch(views, /Add U8 \/ U12 \/ U16 \/ Open/);
  for (const label of ['Initial color for No. 1', 'Acceleration', 'Bye to weakest']) {
    assert.ok(views.includes(label), `missing parent competition default ${label}`);
  }
});

test('section setup inherits parent pairing defaults and FIDE reporting codes', () => {
  for (const field of ['timeControl', 'initialColor', 'acceleration', 'byeWeakest', 'fideEventCode', 'fideReportCode']) {
    assert.match(views, new RegExp(`inheritedSetupField\\(event, t, '${field}'`), `${field} should use inherited setup UI`);
  }
  assert.match(views, /'timeControl'[\s\S]{0,300}Inherited from the parent competition profile; you can override it at any time\./);
  assert.match(views, /'ratingType'[\s\S]{0,300}Editable after pairing/);
  assert.match(views, /'rated'[\s\S]{0,300}Editable after pairing/);
  assert.match(views, /setupHeading\('Schedule'[\s\S]{0,250}editable after pairing/);
});

test('registration setup accepts full DOB while retaining birth-year fallback', () => {
  assert.match(views, /setupField\('Date of birth'/);
  assert.match(views, /birthDate:/);
  assert.match(views, /\['birthdate', 'dob', 'dateofbirth'\]/);
  assert.match(views, /Needs DOB review/);
});

test('setup wizard and setup workspace have responsive, non-card-nested layout styles', () => {
  for (const selector of ['.setup-shell', '.setup-steps', '.setup-panel', '.setup-grid', '.setup-footer', '.setup-status']) {
    assert.ok(css.includes(selector), `missing ${selector}`);
  }
  assert.ok(css.includes('.setup-inherited-field'));
  assert.match(css, /@media \(max-width:\s*760px\)/);
});

test('setup surfaces use identities matching their ownership level', () => {
  assert.match(views, /function tournamentPageIdentity\(/);
  assert.match(views, /function sectionPageIdentity\(/);
  assert.match(views, /onclick:\s*\(\)\s*=>\s*cycleIcon\(iconOwner \?\? titleOwner\)/);
  assert.match(views, /if \(event\) updateEvent\(event, 'name', e\.target\.value\)/);
  assert.match(views, /function SetupWizard[\s\S]*tournamentPageIdentity\(event, event, sectionDisplayName\(t\)\)/);
  assert.match(views, /function EventSetup[\s\S]*tournamentPageIdentity\(event, event/);
  assert.match(views, /function Setup\(t\)[\s\S]*sectionPageIdentity\(event, t/);
  assert.match(views, /function Setup\(t\)[\s\S]*class:\s*'props section-setup-properties'/);
  assert.match(views, /function Setup\(t\)[\s\S]*'Setup status'/);
  assert.match(views, /function Setup\(t\)[\s\S]*'Section setup'/);
  assert.match(css, /\.section-setup-workspace[\s\S]*max-width:\s*860px/);
  assert.match(css, /\.section-setup-workspace \.setup-field[\s\S]*grid-template-columns:\s*170px/);
  assert.equal(css.includes('.setup-wizard-header'), false);
});

test('started section fields are disabled and use a red lock icon instead of a Locked pill', () => {
  const inheritedField = views.slice(views.indexOf('function inheritedSetupField'), views.indexOf('function changeSectionType'));
  assert.match(inheritedField, /controlFactory\(\{ disabled: inherited \|\| locked, onChange: changeValue \}\)/);
  assert.match(inheritedField, /class:\s*'setup-lock-icon'/);
  assert.doesNotMatch(inheritedField, /locked \? 'Locked'/);
  assert.doesNotMatch(inheritedField, /valueLocked/);
  assert.match(css, /\.setup-lock-icon\s*\{[\s\S]*color:\s*var\(--red\)/);
});
