// Page controller: loads data/latest.json, renders it and keeps it current.
// All dynamic text is set via textContent; nothing from the data is parsed as HTML.

import { createI18n } from './i18n.js';
import {
  assertSupported,
  computeView,
  kyivDate,
  kyivMidnight,
  overview,
  STALE_AFTER_MS,
} from './schedule.js';

const DATA_URL = 'data/latest.json';
const RENDER_EVERY_MS = 30_000;
const RELOAD_EVERY_MS = 5 * 60_000;
/** Groups shown on the page, in order. The data still contains every group. */
const DISPLAY_GROUPS = [
  { id: '2.1', labelKey: 'groupApartment' },
  { id: '3.2', labelKey: 'groupHouse' },
];

const i18n = createI18n('uk');
const { t } = i18n;
const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

let data = null;
/** Card element references per group id, created once and updated on every render. */
const cards = new Map();

function applyStaticStrings() {
  document.title = t('title');
  for (const node of document.querySelectorAll('[data-i18n]')) {
    node.textContent = t(node.dataset.i18n);
  }
}

function showState(state) {
  $('loading').hidden = state !== 'loading';
  $('error').hidden = state !== 'error';
  $('content').hidden = state !== 'content';
}

function createDay() {
  const heading = el('h3');
  const timeline = el('div', { className: 'timeline', ariaHidden: 'true' });
  const ticks = el(
    'div',
    { className: 'ticks', ariaHidden: 'true' },
    ...['00', '06', '12', '18', '24'].map((h) => el('span', { textContent: h })),
  );
  return { node: el('div', { className: 'day' }, heading, timeline, ticks), heading, timeline };
}

function createCard({ id, labelKey }) {
  const titleId = `group-${id.replace('.', '-')}-title`;
  const label = el('p', { className: 'status-label', ariaLive: 'polite' });
  const next = el('p', { className: 'status-next' });
  const countdown = el('p', { className: 'status-countdown' });
  const indicator = el('div', { className: 'indicator' }, label, next, countdown);
  const today = createDay();
  const tomorrow = createDay();
  const node = el(
    'section',
    { className: 'card group' },
    el('h2', { id: titleId, textContent: t(labelKey) }),
    indicator,
    today.node,
    tomorrow.node,
  );
  node.setAttribute('aria-labelledby', titleId);
  return { node, indicator, label, next, countdown, today, tomorrow };
}

function renderIndicator(card, view) {
  const { next, now } = view;
  card.indicator.dataset.status = view.status;
  card.label.textContent = t(
    { off: 'statusOff', on: 'statusOn', unknown: 'statusUnknown' }[view.status],
  );
  let text = '';
  let countdown = '';
  if (next?.type === 'off') {
    text = t('nextOff', { when: i18n.when(next.at, now) });
    countdown = i18n.relative(next.at, now);
  } else if (next?.type === 'on' && next.known) {
    text = t('nextOn', { when: i18n.when(next.at, now) });
    countdown = i18n.relative(next.at, now);
  } else if (next?.type === 'on') {
    // The outage runs to the end of published data; the real end is not known yet.
    text = t('nextOnUnknown', { when: '24:00' });
    countdown = t('atLeast', { duration: i18n.relative(next.at, now) });
  } else if (next?.type === 'none') {
    text = t('nextNone', { date: i18n.date(kyivDate(next.until - 1)) });
  }
  card.next.textContent = text;
  card.countdown.textContent = countdown;
  card.countdown.hidden = countdown === '';
}

function renderDay(day, dayView, labelKey, now) {
  day.heading.textContent = t('dayHeading', { label: t(labelKey), date: i18n.date(dayView.date) });
  day.timeline.classList.toggle('unpublished', !dayView.published);
  const start = kyivMidnight(dayView.date);
  const length = kyivMidnight(kyivDate(start + 36 * 3_600_000)) - start; // 23, 24 or 25 h
  const pct = (ms) => `${(((ms - start) / length) * 100).toFixed(3)}%`;
  day.timeline.replaceChildren(
    ...dayView.intervals.map((iv) =>
      el('div', {
        className: 'segment',
        style: `left:${pct(iv.start)};width:calc(${pct(iv.end)} - ${pct(iv.start)})`,
      }),
    ),
  );
  if (now >= start && now < start + length) {
    day.timeline.append(el('div', { className: 'now', style: `left:${pct(now)}` }));
  }
}

function renderOverview(groups, now) {
  const date = kyivDate(now);
  const rows = overview(data, date)?.filter((row) => groups.some((g) => g.id === row.group));
  const body = $('overview-body');
  if (!rows) {
    body.replaceChildren(el('tr', {}, el('td', { colSpan: 2, textContent: t('notPublished') })));
    return;
  }
  body.replaceChildren(
    ...rows.map(({ group, intervals }) =>
      el(
        'tr',
        {},
        el('td', { textContent: t(groups.find((g) => g.id === group).labelKey) }),
        el('td', {
          textContent:
            intervals.length === 0
              ? t('noOutages')
              : intervals
                  .map((iv) => `${i18n.time(iv.start)}–${i18n.endTime(iv.end, date)}`)
                  .join(', '),
        }),
      ),
    ),
  );
}

function render() {
  if (!data) return;
  const now = Date.now();
  const groups = DISPLAY_GROUPS.filter((g) => data.groups.includes(g.id));
  if (groups.length === 0) {
    console.error('None of the display groups are present in the data:', DISPLAY_GROUPS);
    showState('error');
    return;
  }

  for (const group of groups) {
    if (!cards.has(group.id)) {
      const card = createCard(group);
      cards.set(group.id, card);
      $('groups').append(card.node);
    }
    const card = cards.get(group.id);
    const view = computeView(data, group.id, now);
    renderIndicator(card, view);
    renderDay(card.today, view.today, 'today', now);
    renderDay(card.tomorrow, view.tomorrow, 'tomorrow', now);
  }

  const fetchedAt = Date.parse(data.fetchedAt);
  const stale = now - fetchedAt > STALE_AFTER_MS;
  $('stale').hidden = !stale;
  $('stale').textContent = stale ? t('staleWarning', { ago: i18n.ago(fetchedAt, now) }) : '';
  renderOverview(groups, now);
  $('meta-source').textContent = data.sourceUpdatedAt
    ? i18n.dateTime(Date.parse(data.sourceUpdatedAt))
    : t('notAvailable');
  $('meta-checked').textContent = `${i18n.dateTime(fetchedAt)} (${i18n.ago(fetchedAt, now)})`;
  const verification = $('verification');
  verification.replaceChildren(el('h2', { textContent: t('verificationTitle') }));
  if (!data.verification) {
    verification.append(el('p', { textContent: t('verificationLegacy') }));
  }
  for (const result of data.verification ?? []) {
    const label = result.date ? i18n.date(result.date) : t(result.item);
    const source = t(
      { text: 'sourceText', image: 'sourceImage', none: 'sourceNone' }[result.source],
    );
    const status = t(
      {
        agree: 'comparisonAgree',
        disagree: 'comparisonDisagree',
        'text-only': 'comparisonTextOnly',
        'image-only': 'comparisonImageOnly',
        unavailable: 'comparisonUnavailable',
      }[result.status],
    );
    const row = el(
      'div',
      { className: 'verification-result' },
      el('h3', { textContent: label }),
      el('p', { textContent: `${t('verificationSource', { source })} ${status}` }),
    );
    row.dataset.comparison = result.status;
    if (result.differingGroups.length) {
      row.append(
        el('p', {
          textContent: t('differingGroups', { groups: result.differingGroups.join(', ') }),
        }),
      );
    }
    if (result.imageUrl?.startsWith('https://api.loe.lviv.ua/media/')) {
      row.append(
        el('a', { href: result.imageUrl, rel: 'noopener', textContent: t('viewSourceImage') }),
      );
    }
    verification.append(row);
  }
  showState('content');
}

async function load() {
  try {
    const res = await fetch(DATA_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const next = await res.json();
    assertSupported(next);
    data = next;
    render();
  } catch (error) {
    console.error('Failed to load schedule data:', error);
    // Keep showing previously loaded data; its age drives the stale warning.
    if (data) render();
    else showState('error');
  }
}

applyStaticStrings();
$('retry').addEventListener('click', () => {
  showState('loading');
  load();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') load();
});
setInterval(render, RENDER_EVERY_MS);
setInterval(load, RELOAD_EVERY_MS);
load();
