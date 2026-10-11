// TourneyLab renderer shell (MIT)
import { store } from './store.js';
import { EVENT_VIEWS, renderView, VIEWS } from './views.js';
import { RATING_SOURCES, RATING_TYPES } from './setup/presets.js';
import { registrationSectionLabels } from './setup/defaults.js';
import { createNavigationHistory } from './navigation.js';
import { createTournamentAccordion } from './sidebar-tournament-accordion.js';
import { sectionHasActiveRound } from './sidebar-round-status.js';
import { CONTENT_ZOOM_DEFAULT, contentZoomForAction, normalizeContentZoom } from './content-zoom.js';

document.documentElement.dataset.platform = window.tl?.platform ?? 'unknown';

function applyWindowMode(mode) {
  document.documentElement.dataset.windowMode = mode === 'fullscreen' ? 'fullscreen' : 'windowed';
}

applyWindowMode('windowed');
window.tl?.windowMode?.().then(applyWindowMode).catch(() => {});
window.tl?.onWindowModeChanged?.(applyWindowMode);

const EVENT_ROUTE_IDS = new Set(EVENT_VIEWS.map(view => view.id));
const SECTION_ROUTE_IDS = new Set(VIEWS.map(view => view.id));
const CONTENT_ZOOM_KEY = 'tourneylab.contentZoom';
let contentZoom = CONTENT_ZOOM_DEFAULT;

// ------------------------------------------------- tiny DOM helpers
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else if (v != null && v !== false) el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(c));
  }
  return el;
}

export function toast(msg, ms = 2600) {
  const el = h('div', { class: 'toast' }, msg);
  document.getElementById('toast-root').append(el);
  setTimeout(() => el.remove(), ms);
}

function savedContentZoom() {
  try {
    return normalizeContentZoom(window.localStorage?.getItem(CONTENT_ZOOM_KEY));
  } catch {
    return CONTENT_ZOOM_DEFAULT;
  }
}

function applyContentZoom(value, announce = false) {
  contentZoom = normalizeContentZoom(value);
  document.documentElement.style.setProperty('--content-zoom', String(contentZoom));
  document.documentElement.classList.toggle('content-zoom-compact', contentZoom >= 1.25);
  try {
    window.localStorage?.setItem(CONTENT_ZOOM_KEY, String(contentZoom));
  } catch {}
  if (announce) toast(`Content zoom ${Math.round(contentZoom * 100)}%`);
}

applyContentZoom(savedContentZoom());
window.tl?.onContentZoomShortcut?.(action => {
  applyContentZoom(contentZoomForAction(contentZoom, action), true);
});

export const ICONS = {
  '♟': 'chess-pawn',
  '♟️': 'chess-pawn',
  '♞': 'chess-knight',
  '♜': 'chess-rook',
  '♛': 'chess-queen',
  '♚': 'chess-king',
  '🏠': 'home',
  '📄': 'document',
  '👥': 'users',
  '🔀': 'shuffle',
  '🏆': 'trophy',
  '⚙': 'settings',
  '⚙️': 'settings',
  '📤': 'export',
  '📂': 'folder-open',
  '🗂': 'category',
  '🗂️': 'category',
  '🔁': 'repeat',
  '📍': 'map-pin',
  '🏳': 'flag',
  '🏳️': 'flag',
  '🧑‍⚖️': 'gavel',
  '📅': 'calendar',
  '💡': 'lightbulb',
  '🎯': 'target',
  '🎲': 'dice',
  '📈': 'trending-up',
  '📥': 'import',
  '🚫': 'ban',
  '⚠': 'warning',
  '⚠️': 'warning',
  '🕓': 'clock',
  '🖨': 'printer',
  '⛔': 'stop',
  '🔒': 'lock',
  '🗑': 'trash',
  '📊': 'chart',
  '💾': 'save',
  '⚔': 'swords',
  '⚔️': 'swords',
  '↕': 'sort',
  '⇄': 'swap',
  '↑': 'arrow-up',
  '↓': 'arrow-down',
  '✕': 'x',
  'archive': 'archive',
  '＋': 'plus',
  'ℹ': 'info',
  'ℹ️': 'info'
};

export const CHESS_ICON_TOKENS = new Set(['♟', '♟️', '♞', '♜', '♛', '♚']);

export function icon(token, attrs = {}) {
  const key = ICONS[token] ?? token;
  const known = Object.values(ICONS).includes(key);
  if (!known) return h('span', { class: attrs.class ?? 'emoji-fallback' }, token);
  if (CHESS_ICON_TOKENS.has(token) || key.startsWith('chess-')) {
    return h('img', {
      ...attrs,
      class: `ui-icon ui-icon-img ${attrs.class ?? ''}`.trim(),
      src: `../icons/${key}.svg`,
      alt: attrs.alt ?? '',
      'aria-hidden': attrs['aria-hidden'] ?? 'true'
    });
  }
  const el = h('span', {
    ...attrs,
    class: `ui-icon ${attrs.class ?? ''}`.trim(),
    'aria-hidden': attrs['aria-hidden'] ?? 'true'
  });
  el.style.setProperty('--icon-url', `url("../icons/${key}.svg")`);
  return el;
}

export function iconLabel(token, label, attrs = {}) {
  return h('span', { class: `icon-label ${attrs.class ?? ''}`.trim() }, icon(token), label);
}

export function modal(title, body, actions, options = {}) {
  const titleId = `modal-title-${Math.random().toString(36).slice(2, 8)}`;
  const previousFocus = document.activeElement;
  const overlay = h('div', {
    class: 'overlay',
    onclick: e => { if (e.target === overlay) close(); },
    onkeydown: e => { if (e.key === 'Escape') close(); }
  });
  const close = () => { overlay.remove(); previousFocus?.focus?.(); };
  const m = h('div', {
    class: `modal${options.wide ? ' wide' : ''}`,
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': titleId
  },
    h('h3', { id: titleId }, title), body,
    h('div', { class: 'row' }, actions.map(a =>
      h('button', { class: `btn ${a.kind ?? ''}`, onclick: () => { if (a.onClick?.() !== false) close(); } }, a.label))));
  m.addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    const focusable = [...m.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
      .filter(element => !element.disabled && element.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  overlay.append(m);
  document.body.append(overlay);
  m.querySelector('button, input, select, textarea')?.focus();
  return close;
}

export function confirmModal(title, text, onYes, yesLabel = 'Delete', yesKind = 'danger') {
  modal(title, h('p', { class: 'muted' }, text), [
    { label: 'Cancel' },
    { label: yesLabel, kind: yesKind, onClick: onYes }
  ]);
}

// ------------------------------------------------- routing
export const route = { view: 'home' };
let navigationHistory = null;
const tournamentAccordion = createTournamentAccordion();

function syncTournamentAccordion(view = route.view, eventId = store.activeEvent?.id) {
  if (!eventId || view === 'home' || view === 'archives' || view === 'settings') return;
  tournamentAccordion.select(eventId);
}

function currentNavigationEntry(view = route.view) {
  return {
    view,
    eventId: store.activeEvent?.id ?? store.data.activeEventId ?? null,
    sectionId: store.data.activeId ?? null
  };
}

function navigationEntryAvailable(entry) {
  if (entry.view === 'home' || entry.view === 'archives' || entry.view === 'settings') return true;
  const eventExists = store.data.events?.some(event => event.id === entry.eventId);
  if (!eventExists) return false;
  if (!SECTION_ROUTE_IDS.has(entry.view)) return true;
  return store.data.tournaments?.some(section => section.id === entry.sectionId && section.eventId === entry.eventId);
}

export function go(view) {
  route.view = view;
  syncTournamentAccordion(view);
  const entry = currentNavigationEntry(view);
  if (navigationHistory) navigationHistory.push(entry);
  else navigationHistory = createNavigationHistory(entry);
  render();
}

function travelNavigationHistory(direction) {
  const entry = direction < 0
    ? navigationHistory?.back(navigationEntryAvailable)
    : navigationHistory?.forward(navigationEntryAvailable);
  if (!entry) return;
  store.data.activeEventId = entry.eventId;
  store.data.activeId = entry.sectionId;
  route.view = entry.view;
  syncTournamentAccordion(entry.view, entry.eventId);
  render();
  document.getElementById('page')?.focus({ preventScroll: true });
}

// ------------------------------------------------- sidebar
const SIDEBAR_COLLAPSED_KEY = 'tourneylab.sidebarCollapsed';
let sidebarOpeningTournamentId = null;

function sidebarCollapsed() {
  try {
    return window.localStorage?.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function applySidebarCollapsed(collapsed) {
  document.getElementById('app')?.classList.toggle('sidebar-collapsed', collapsed);
  const sb = document.getElementById('sidebar');
  sb?.setAttribute('aria-expanded', String(!collapsed));
}

function setSidebarCollapsed(collapsed) {
  try {
    window.localStorage?.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0');
  } catch {}
  applySidebarCollapsed(collapsed);
}

function toggleSidebar() {
  setSidebarCollapsed(!sidebarCollapsed());
  renderSidebar();
  renderTopbar();
}

function expandSidebarIfCollapsed() {
  if (!sidebarCollapsed()) return false;
  setSidebarCollapsed(false);
  renderSidebar();
  renderTopbar();
  return true;
}

const WORKSPACE_BRAND_DOUBLE_CLICK_DELAY_MS = 300;
let workspaceBrandClickTimer = null;

function clearWorkspaceBrandClickTimer() {
  if (workspaceBrandClickTimer == null) return;
  window.clearTimeout(workspaceBrandClickTimer);
  workspaceBrandClickTimer = null;
}

function activateWorkspaceBrand() {
  if (route.view === 'home' && expandSidebarIfCollapsed()) return;
  go('home');
}

function handleWorkspaceBrandClick(event) {
  event.stopPropagation();
  if (event.detail === 0) {
    clearWorkspaceBrandClickTimer();
    activateWorkspaceBrand();
    return;
  }
  if (event.detail > 1) {
    clearWorkspaceBrandClickTimer();
    return;
  }
  clearWorkspaceBrandClickTimer();
  workspaceBrandClickTimer = window.setTimeout(() => {
    workspaceBrandClickTimer = null;
    activateWorkspaceBrand();
  }, WORKSPACE_BRAND_DOUBLE_CLICK_DELAY_MS);
}

function handleWorkspaceBrandDoubleClick(event) {
  event.preventDefault();
  event.stopPropagation();
  clearWorkspaceBrandClickTimer();
  toggleSidebar();
}

function openWorkspaceSettings() {
  const settings = store.data.settings ??= {};
  const federation = h('input', { type: 'text', value: settings.defaultFederation ?? '', placeholder: 'e.g. SGP' });
  const ratingType = h('select', {}, RATING_TYPES.map(choice => h('option', {
    value: choice.id, selected: settings.defaultRatingType === choice.id
  }, choice.label)));
  const ratingSource = h('select', {}, RATING_SOURCES.map(choice => h('option', {
    value: choice.id, selected: settings.defaultRatingSource === choice.id
  }, choice.label)));
  const backups = h('input', { type: 'number', min: 0, max: 9, value: settings.backupGenerations ?? 3 });
  const field = (label, control, note = '') => h('label', { class: 'setup-field' },
    h('span', { class: 'setup-label' }, label), control,
    note ? h('span', { class: 'setup-note' }, note) : null);

  modal('Workspace settings', h('div', {},
    h('p', { class: 'muted small' }, 'Defaults here apply only when creating new tournaments.'),
    h('div', { class: 'setup-grid workspace-settings-grid' },
      field('Default federation', federation),
      field('Default rating type', ratingType),
      field('Default rating source', ratingSource),
      field('Backup generations', backups, 'Used when saving .tlab files.'))
  ), [
    { label: 'Cancel' },
    { label: 'Save settings', kind: 'primary', onClick: () => {
      settings.defaultFederation = federation.value.trim().toUpperCase();
      settings.defaultRatingType = ratingType.value;
      settings.defaultRatingSource = ratingSource.value;
      settings.backupGenerations = Math.max(0, Math.min(9, Number(backups.value) || 0));
      store.emit();
    }}
  ]);
}

function renderSidebar() {
  const sb = document.getElementById('sidebar');
  const collapsed = sidebarCollapsed();
  applySidebarCollapsed(collapsed);
  sb.setAttribute('role', 'navigation');
  sb.setAttribute('aria-label', 'Workspace navigation');
  sb.replaceChildren();
  const scrollArea = h('div', { class: 'sb-scroll-area' });
  sb.append(scrollArea);
  scrollArea.append(
    h('div', { class: 'sb-workspace' },
      h('button', {
        class: 'workspace-brand',
        title: 'Home · Double-click to toggle sidebar',
        'aria-label': 'Home',
        onclick: handleWorkspaceBrandClick,
        ondblclick: handleWorkspaceBrandDoubleClick
      },
      h('img', { class: 'workspace-brand-logo', src: '../icons/tourneylab-logo.svg', alt: '' }),
      h('img', { class: 'workspace-brand-wordmark', src: '../icons/tourneylab-wordmark.svg', alt: '' })),
      h('button', {
        class: 'sb-toggle',
        title: collapsed ? 'Expand sidebar' : 'Collapse sidebar',
        'aria-label': collapsed ? 'Expand sidebar' : 'Collapse sidebar',
        'aria-expanded': String(!collapsed),
        onclick: e => { e.stopPropagation(); toggleSidebar(); }
      }, icon('⇄'))),
    item('home', '🏠', 'Home'),
    item('archives', 'archive', 'Archived tournaments'),
    item('settings', '⚙️', 'Settings'),
  );

  const activeEvents = (store.data.events ?? []).filter(event => !event.archived);

  scrollArea.append(h('div', { class: 'sb-section' }, 'Tournaments'));
  for (const event of activeEvents) appendTournament(event);
  scrollArea.append(h('div', {
    class: 'addrow',
    title: 'New tournament',
    role: 'button',
    tabindex: '0',
    onclick: () => { store.newEvent(); go('setup-wizard'); },
    onkeydown: e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      store.newEvent();
      go('setup-wizard');
    }
  }, h('span', { class: 'icon' }, '＋'), h('span', { class: 'label' }, 'New tournament')));

  function appendTournament(event) {
    const sections = store.childrenForEvent(event.id);
    const activeRoundSections = sections.filter(sectionHasActiveRound);
    const sectionLabels = registrationSectionLabels(event, sections);
    const eventActive = store.activeEvent?.id === event.id && (EVENT_ROUTE_IDS.has(route.view) || route.view === 'event-dashboard');
    const expanded = tournamentAccordion.isExpanded(event.id);
    const childrenId = `sidebar-tournament-${event.id}`;
    const archiveAction = {
      title: 'Archive tournament',
      label: `Archive ${event.name || 'Untitled tournament'}`,
      icon: 'archive',
      onClick: () => confirmModal(
        'Archive tournament',
        `Archive “${event.name}”? It will move to Archived tournaments and all tournament data will be kept.`,
        () => {
          const wasOpen = store.activeEvent?.id === event.id && route.view !== 'home';
          store.archiveEvent(event.id);
          if (wasOpen) go('home'); else render();
        },
        'Archive',
        'primary'
      )
    };
    const deleteAction = {
      title: 'Delete tournament',
      label: `Delete ${event.name || 'Untitled tournament'}`,
      icon: '✕',
      onClick: () => confirmModal(
        'Delete tournament',
        `Delete “${event.name}” and all of its sections permanently? Saved .tlab files are not affected.`,
        () => {
          const wasOpen = store.activeEvent?.id === event.id && route.view !== 'home';
          store.deleteEvent(event.id);
          if (wasOpen) go('home'); else render();
        }
      )
    };
    const group = h('div', { class: 'sb-tournament' });
    group.append(item(null, event.icon ?? '♟️', event.name || 'Untitled tournament', {
      active: eventActive,
      onclick: () => {
        if (!expanded) sidebarOpeningTournamentId = event.id;
        tournamentAccordion.select(event.id);
        store.data.activeEventId = event.id;
        store.data.activeId = sections[0]?.id ?? null;
        go('event-overview');
      },
      disclosure: {
        expanded,
        controls: childrenId,
        label: `${expanded ? 'Collapse' : 'Expand'} ${event.name || 'Untitled tournament'}`,
        onClick: () => {
          if (!expanded) sidebarOpeningTournamentId = event.id;
          tournamentAccordion.toggle(event.id);
          renderSidebar();
        }
      },
      roundActiveIcon: !expanded && activeRoundSections.length > 0,
      roundActiveLabel: activeRoundSections.length
        ? activeRoundSections.length === 1
          ? 'One section has a round in progress'
          : `${activeRoundSections.length} sections have rounds in progress`
        : null,
      actions: [archiveAction, deleteAction]
    }));
    const children = h('div', {
      id: childrenId,
      class: `sb-tournament-children${sidebarOpeningTournamentId === event.id ? ' opening' : ''}`,
      hidden: !expanded
    });
    for (const [index, section] of sections.entries()) {
      const roundActive = sectionHasActiveRound(section);
      children.append(item(null, section.icon ?? '♟️', sectionLabels[index] || section.sectionName || section.name || 'Section', {
        sub: true,
        active: store.data.activeId === section.id && SECTION_ROUTE_IDS.has(route.view),
        roundActive,
        roundActiveLabel: roundActive ? `Round ${section.currentRound || section.roundsData?.length || 1} in progress` : null,
        onclick: () => {
          tournamentAccordion.select(event.id);
          store.data.activeId = section.id;
          store.data.activeEventId = event.id;
          go('rounds');
        }
      }));
    }
    group.append(children);
    scrollArea.append(group);
  }

  const t = store.active;
  const event = store.activeEvent;
  if (event && (EVENT_ROUTE_IDS.has(route.view) || route.view === 'event-dashboard')) {
    scrollArea.append(h('div', { class: 'sb-section' }, 'Tournament pages'));
    for (const view of EVENT_VIEWS) {
      scrollArea.append(item(view.id, view.icon, view.label, { sub: true, active: route.view === view.id || (route.view === 'event-dashboard' && view.id === 'event-overview') }));
    }
  } else if (t && SECTION_ROUTE_IDS.has(route.view)) {
    scrollArea.append(h('div', { class: 'sb-section' }, 'Section pages'));
    for (const v of VIEWS) {
      const teamSection=['team-swiss','team-rr'].includes(t.type);
      if(v.teamOnly && !teamSection) continue;
      if(teamSection && v.id==='standings') continue;
      const roundActive = v.id === 'rounds' && sectionHasActiveRound(t);
      scrollArea.append(item(v.id, v.icon, v.id==='players' && teamSection ? 'Teams & rosters' : v.label, {
        sub: true,
        active: route.view === v.id,
        roundActive,
        roundActiveLabel: roundActive ? `Round ${t.currentRound || t.roundsData?.length || 1} in progress` : null
      }));
    }
  }
  sidebarOpeningTournamentId = null;

  function item(view, icon, label, opts = {}) {
    const active = opts.active ?? (route.view === view);
    const navigate = opts.onclick ?? (() => view && go(view));
    const el = h('div', {
      class: `sb-item${opts.sub ? ' sub' : ''}${opts.disclosure ? ' tournament' : ''}${opts.disclosure?.expanded ? ' tournament-expanded' : ''}${opts.roundActive ? ' round-active' : ''}${opts.roundActiveIcon ? ' round-active-icon' : ''}${active ? ' active' : ''}`,
      title: opts.roundActiveLabel ? `${label} · ${opts.roundActiveLabel}` : label
    });
    el.append(h('button', {
      class: 'sb-item-main',
      'aria-current': active ? 'page' : null,
      onclick: event => {
        if (active && expandSidebarIfCollapsed()) return;
        const button = event.currentTarget;
        if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
          navigate();
          return;
        }
        button.classList.add('clicking');
        window.setTimeout(navigate, 110);
      }
    },
    h('span', { class: 'icon' }, windowIcon(icon)),
    h('span', { class: 'label' }, label),
    opts.roundActiveLabel ? h('span', { class: 'visually-hidden' }, opts.roundActiveLabel) : null));
    if (opts.actions?.length) {
      el.append(h('span', { class: 'sb-item-actions' }, opts.actions.map(action => h('button', {
        class: 'sb-item-action',
        title: action.title,
        'aria-label': action.label,
        onclick: e => { e.stopPropagation(); action.onClick(); }
      }, windowIcon(action.icon)))));
    }
    if (opts.disclosure) {
      el.append(h('button', {
        class: 'sb-item-disclosure',
        title: opts.disclosure.label,
        'aria-label': opts.disclosure.label,
        'aria-expanded': String(opts.disclosure.expanded),
        'aria-controls': opts.disclosure.controls,
        onclick: e => {
          e.stopPropagation();
          opts.disclosure.onClick();
        }
      }, h('span', { class: 'sb-item-disclosure-glyph', 'aria-hidden': 'true' })));
    }
    return el;
  }

  function windowIcon(token) {
    return icon(token);
  }
}

// ------------------------------------------------- topbar
function renderTopbar() {
  const tb = document.getElementById('topbar');
  const collapsed = sidebarCollapsed();
  tb.setAttribute('role', 'navigation');
  tb.setAttribute('aria-label', 'Breadcrumb');
  tb.replaceChildren();
  const t = store.active;
  const event = store.activeEvent;
  tb.append(h('div', { class: 'titlebar-controls', role: 'group', 'aria-label': 'App navigation' },
    h('button', {
      class: 'titlebar-control titlebar-sidebar-toggle',
      title: collapsed ? 'Expand sidebar' : 'Collapse sidebar',
      'aria-label': collapsed ? 'Expand sidebar' : 'Collapse sidebar',
      'aria-expanded': String(!collapsed),
      onclick: toggleSidebar
    }, h('span', { class: 'sidebar-glyph', 'aria-hidden': 'true' })),
    h('button', {
      class: 'titlebar-control titlebar-history-button',
      title: 'Back',
      'aria-label': 'Back',
      disabled: !navigationHistory?.canBack(navigationEntryAvailable),
      onclick: () => travelNavigationHistory(-1)
    }, h('span', { class: 'history-glyph', 'aria-hidden': 'true' }, '←')),
    h('button', {
      class: 'titlebar-control titlebar-history-button',
      title: 'Forward',
      'aria-label': 'Forward',
      disabled: !navigationHistory?.canForward(navigationEntryAvailable),
      onclick: () => travelNavigationHistory(1)
    }, h('span', { class: 'history-glyph', 'aria-hidden': 'true' }, '→')),
    h('button', {
      class: 'titlebar-control titlebar-settings-button',
      title: 'Workspace settings',
      'aria-label': 'Workspace settings',
      onclick: openWorkspaceSettings
    }, icon('⚙', { 'aria-hidden': 'true' }))));
  tb.append(h('button', { class: 'crumb', onclick: () => go('home') }, 'Home'));
  if (route.view === 'archives') {
    tb.append(h('span', { class: 'crumb-sep' }, '/'), h('span', { class: 'crumb current', 'aria-current': 'page' }, 'Archived tournaments'));
  }
  if (route.view === 'settings') {
    tb.append(h('span', { class: 'crumb-sep' }, '/'), h('span', { class: 'crumb current', 'aria-current': 'page' }, 'Settings'));
  }
  if (event && route.view !== 'home' && route.view !== 'archives' && route.view !== 'settings') {
    const eventView = EVENT_VIEWS.find(view => view.id === route.view);
    const sectionView = VIEWS.find(view => view.id === route.view);
    tb.append(
      h('span', { class: 'crumb-sep' }, '/'),
      h('button', { class: 'crumb with-icon', onclick: () => go('event-overview') }, icon(event?.icon ?? t?.icon ?? '♟️'), event?.name || t?.name || 'Untitled'),
    );
    if (eventView && eventView.id !== 'event-overview') {
      tb.append(h('span', { class: 'crumb-sep' }, '/'), h('span', { class: 'crumb current', 'aria-current': 'page' }, eventView.label));
    }
    if (t && SECTION_ROUTE_IDS.has(route.view)) {
      const sections = store.childrenForEvent(event.id);
      const labels = registrationSectionLabels(event, sections);
      const sectionLabel = labels[sections.findIndex(section => section.id === t.id)] ?? t.sectionName ?? t.name ?? 'Section';
      tb.append(h('span', { class: 'crumb-sep' }, '/'), h('button', { class: 'crumb', onclick: () => go('overview') }, sectionLabel));
    }
    if (sectionView && sectionView.id !== 'overview') {
      tb.append(h('span', { class: 'crumb-sep' }, '/'), h('span', { class: 'crumb current', 'aria-current': 'page' }, sectionView.label));
    }
  }
  tb.append(h('span', { class: 'spacer' }));
  if (t && SECTION_ROUTE_IDS.has(route.view)) {
    tb.append(h('span', { class: 'pill' }, t.currentRound > 0 ? `Round ${t.currentRound} of ${t.rounds}` : 'Not started'));
  }
}

// ------------------------------------------------- render
export function render() {
  navigationHistory?.replace(currentNavigationEntry());
  renderSidebar();
  renderTopbar();
  const page = document.getElementById('page-zoom');
  page.replaceChildren();
  page.append(renderView(route.view));
}

(async function boot() {
  await store.init();
  if (store.activeEvent) {
    route.view = 'event-overview';
    syncTournamentAccordion(route.view);
  }
  navigationHistory = createNavigationHistory(currentNavigationEntry());
  store.subscribe(() => { /* data persisted via store.emit */ });
  render();
})();
