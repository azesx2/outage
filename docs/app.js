// Page controller: loads data/latest.json, renders it and keeps it current.
// All dynamic text is set via textContent; nothing from the data is parsed as HTML.

import { createI18n } from './i18n.js';
import { assertSupported, computeView, kyivDate, kyivMidnight, overview } from './schedule.js';

const DATA_URL = 'data/latest.json';
const STORAGE_KEY = 'loe-outage:group';
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
let group = null;

/** Display groups present in the loaded data. */
const availableGroups = () => DISPLAY_GROUPS.filter((g) => data.groups.includes(g.id));

const storage = {
  get() {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  },
  set(value) {
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // Private mode or blocked storage: the choice just is not remembered.
    }
  },
};

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

function renderGroupOptions(groups) {
  const container = $('group-options');
  const ids = groups.map((g) => g.id).join();
  if (container.dataset.groups === ids) return;
  container.dataset.groups = ids;
  container.replaceChildren(
    ...groups.flatMap(({ id, labelKey }) => {
      const input = el('input', { type: 'radio', name: 'group', id: `group-${id}`, value: id });
      input.addEventListener('change', () => {
        group = id;
        storage.set(id);
        render();
      });
      return [input, el('label', { htmlFor: `group-${id}`, textContent: t(labelKey) })];
    }),
  );
}

function renderStatus(view) {
  const card = $('status');
  card.dataset.status = view.status;
  $('status-label').textContent = t(
    { off: 'statusOff', on: 'statusOn', unknown: 'statusUnknown' }[view.status],
  );
  const { next, now } = view;
  let text = '';
  if (next?.type === 'on') {
    text = next.known
      ? t('nextOn', { time: i18n.time(next.at), rel: i18n.relative(next.at, now) })
      : t('nextOnUnknown', { date: i18n.date(kyivDate(next.at - 1)) });
  } else if (next?.type === 'off') {
    text = t('nextOff', { time: i18n.time(next.at), rel: i18n.relative(next.at, now) });
  } else if (next?.type === 'none') {
    text = t('nextNone', { date: i18n.date(kyivDate(next.until - 1)) });
  }
  $('status-next').textContent = text;
}

function renderDay(id, labelKey, day, now) {
  const section = $(id);
  section.querySelector('h2').textContent = t('dayHeading', {
    label: t(labelKey),
    date: i18n.date(day.date),
  });

  const timeline = section.querySelector('.timeline');
  timeline.classList.toggle('unpublished', !day.published);
  const start = kyivMidnight(day.date);
  const length = kyivMidnight(kyivDate(start + 36 * 3_600_000)) - start; // 23, 24 or 25 h
  const pct = (ms) => `${(((ms - start) / length) * 100).toFixed(3)}%`;
  timeline.replaceChildren(
    ...day.intervals.map((iv) =>
      el('div', {
        className: 'segment',
        style: `left:${pct(iv.start)};width:calc(${pct(iv.end)} - ${pct(iv.start)})`,
      }),
    ),
  );
  if (now >= start && now < start + length) {
    timeline.append(el('div', { className: 'now', style: `left:${pct(now)}` }));
  }
  if (!timeline.nextElementSibling?.classList.contains('ticks')) {
    timeline.after(
      el(
        'div',
        { className: 'ticks', ariaHidden: 'true' },
        ...['00', '06', '12', '18', '24'].map((h) => el('span', { textContent: h })),
      ),
    );
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
    ...rows.map(({ group: g, intervals }) =>
      el(
        'tr',
        { className: g === group ? 'selected' : '' },
        el('td', { textContent: t(groups.find((d) => d.id === g).labelKey) }),
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
  const groups = availableGroups();
  if (groups.length === 0) {
    console.error('None of the display groups are present in the data:', DISPLAY_GROUPS);
    showState('error');
    return;
  }
  if (!groups.some((g) => g.id === group)) group = groups[0].id;
  renderGroupOptions(groups);
  const checked = $(`group-${group}`);
  if (checked) checked.checked = true;

  const view = computeView(data, group, now);
  const stale = $('stale');
  stale.hidden = !view.stale;
  stale.textContent = view.stale ? t('staleWarning', { ago: i18n.ago(view.fetchedAt, now) }) : '';

  renderStatus(view);
  renderDay('day-today', 'today', view.today, now);
  renderDay('day-tomorrow', 'tomorrow', view.tomorrow, now);
  renderOverview(groups, now);
  $('meta-source').textContent = view.sourceUpdatedAt
    ? i18n.dateTime(view.sourceUpdatedAt)
    : t('notAvailable');
  $('meta-checked').textContent =
    `${i18n.dateTime(view.fetchedAt)} (${i18n.ago(view.fetchedAt, now)})`;
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
group = storage.get();
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
