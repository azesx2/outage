// Page controller: loads data/latest.json, renders it and keeps it current.
// All dynamic text is set via textContent; nothing from the data is parsed as HTML.

import { createI18n } from './i18n.js';
import { assertSupported, computeView, kyivDate, kyivMidnight, overview } from './schedule.js';

const DATA_URL = 'data/latest.json';
const STORAGE_KEY = 'loe-outage:group';
const RENDER_EVERY_MS = 30_000;
const RELOAD_EVERY_MS = 5 * 60_000;

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

function renderGroupOptions() {
  const container = $('group-options');
  if (container.dataset.groups === data.groups.join()) return;
  container.dataset.groups = data.groups.join();
  container.replaceChildren(
    ...data.groups.flatMap((g) => {
      const input = el('input', { type: 'radio', name: 'group', id: `group-${g}`, value: g });
      input.addEventListener('change', () => {
        group = g;
        storage.set(g);
        render();
      });
      return [input, el('label', { htmlFor: `group-${g}`, textContent: g })];
    }),
  );
}

function renderStatus(view) {
  const card = $('status');
  card.dataset.status = view.status;
  $('status-group').textContent = `${t('groupLegend')}: ${view.group}`;
  $('status-label').textContent = t(
    { off: 'statusOff', on: 'statusOn', unknown: 'statusUnknown' }[view.status],
  );
  const { next, now } = view;
  let text = t('statusUnknownHint');
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

  const list = section.querySelector('.intervals');
  if (!day.published) {
    list.replaceChildren(el('li', { className: 'empty', textContent: t('notPublished') }));
  } else if (day.intervals.length === 0) {
    list.replaceChildren(el('li', { className: 'empty', textContent: t('noOutages') }));
  } else {
    list.replaceChildren(
      ...day.intervals.map((iv) =>
        el('li', {
          className: 'off',
          textContent: t('intervalOff', {
            from: i18n.time(iv.start),
            to: i18n.endTime(iv.end, day.date),
          }),
        }),
      ),
    );
  }
}

function renderOverview(now) {
  const date = kyivDate(now);
  const rows = overview(data, date);
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
        el('td', { textContent: g }),
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
  if (!data.groups.includes(group)) group = data.groups[0];
  renderGroupOptions();
  const checked = $(`group-${group}`);
  if (checked) checked.checked = true;

  const view = computeView(data, group, now);
  const stale = $('stale');
  stale.hidden = !view.stale;
  stale.textContent = view.stale ? t('staleWarning', { ago: i18n.ago(view.fetchedAt, now) }) : '';

  renderStatus(view);
  renderDay('day-today', 'today', view.today, now);
  renderDay('day-tomorrow', 'tomorrow', view.tomorrow, now);
  renderOverview(now);
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
