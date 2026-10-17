// Page controller: loads data/latest.json, renders it and keeps it current.
// All dynamic text is set via textContent; nothing from the data is parsed as HTML.

import { createI18n } from './i18n.js';
import {
  assertSupported,
  computeView,
  kyivDate,
  kyivMidnight,
  kyivWallInstant,
  nextDate,
  STALE_AFTER_MS,
  summarizeVerification,
} from './schedule.js';

const DATA_URL = 'data/latest.json';
const RENDER_EVERY_MS = 30_000;
const RELOAD_EVERY_MS = 5 * 60_000;
/** Vertical scale of the chart: 48 hours ≈ 980 px. */
const PX_PER_MINUTE = 0.34;
/** Hide the text inside outage blocks shorter than this, in pixels. */
const MIN_LABEL_PX = 16;
/** Groups shown on the page: the first on the left, the second on the right. */
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
/** Status card elements per group id, created once and updated on every render. */
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

function card({ id, labelKey }) {
  if (!cards.has(id)) {
    const state = el('p', { className: 'state', ariaLive: 'polite' });
    const next = el('p', { className: 'next' });
    // Countdown or a secondary note; always present so every card keeps the same rows.
    const sub = el('p', { className: 'sub' });
    const node = el(
      'section',
      { className: 'head' },
      el('h2', { className: 'name', textContent: t(labelKey) }),
      state,
      next,
      sub,
    );
    cards.set(id, { node, state, next, sub });
    $('heads').append(node);
  }
  return cards.get(id);
}

/** Texts for one group: the status card and the label on the "now" line. */
function describe(view) {
  const { next, now } = view;
  const tomorrowEnd = kyivMidnight(nextDate(view.tomorrow.date));
  if (next?.type === 'off') {
    const rel = i18n.relative(next.at, now);
    return {
      next: t('nextOff', { when: i18n.when(next.at, now) }),
      count: rel,
      line: t('lineOff', { rel }),
      event: 'off',
    };
  }
  if (next?.type === 'on') {
    const rel = i18n.relative(next.at, now);
    return next.known
      ? {
          next: t('nextOn', { when: i18n.when(next.at, now) }),
          count: rel,
          line: t('lineOn', { rel }),
          event: 'on',
        }
      : {
          next: t('nextOnUnknown', { when: '24:00' }),
          count: t('atLeast', { duration: i18n.duration(next.at - now) }),
          line: t('lineOnUnknown', { rel }),
          event: 'on',
        };
  }
  if (next?.type === 'none') {
    const onlyToday = next.until < tomorrowEnd;
    return {
      next: t(onlyToday ? 'nextNoneToday' : 'nextNoneTomorrow'),
      extra: view.tomorrow.published ? '' : t('tomorrowPending'),
      line: t(onlyToday ? 'lineNoneToday' : 'lineNone'),
      event: 'none',
    };
  }
  return { line: '', event: 'none' };
}

function renderCard(group, view, text) {
  const c = card(group);
  c.node.dataset.s = view.status;
  c.state.textContent = t(
    { off: 'statusOff', on: 'statusOn', unknown: 'statusUnknown' }[view.status],
  );
  c.next.textContent = text.next ?? '';
  c.sub.textContent = text.count ?? text.extra ?? '';
  c.sub.classList.toggle('count', Boolean(text.count));
  // Text may be clipped to fit the fixed card size; the full text stays available on hover.
  for (const node of [c.state, c.next, c.sub]) node.title = node.textContent;
}

function renderChart(entries, now) {
  const { today, tomorrow } = entries[0].view;
  const start = kyivMidnight(today.date);
  const midnight = kyivMidnight(tomorrow.date);
  const end = kyivMidnight(nextDate(tomorrow.date));
  const y = (ms) => ((ms - start) / 60_000) * PX_PER_MINUTE;
  const px = (n) => `${n.toFixed(1)}px`;

  const side = ({ view }, cls) => {
    const track = el('div', { className: 'track' });
    for (const day of [view.today, view.tomorrow]) {
      const dayStart = kyivMidnight(day.date);
      const dayEnd = kyivMidnight(nextDate(day.date));
      if (!day.published) {
        // Leave the 3 px midnight gap above tomorrow; today starts at the top edge.
        const inset = dayStart === start ? 0 : 3;
        track.append(
          el(
            'div',
            {
              className: 'unpub',
              style: `top:${px(y(dayStart) + inset)};height:${px(y(dayEnd) - y(dayStart) - inset)}`,
            },
            el('strong', { textContent: t('unpublishedDay', { date: i18n.date(day.date) }) }),
            el('span', { textContent: t('unpublishedHint') }),
          ),
        );
        continue;
      }
      for (const iv of day.intervals) {
        const height = y(iv.end) - y(iv.start);
        const block = el('div', {
          className: 'blk',
          style: `top:${px(y(iv.start))};height:${px(height)}`,
        });
        if (height >= MIN_LABEL_PX) {
          block.append(
            el('span', {
              textContent: `${i18n.time(iv.start)}–${i18n.endTime(iv.end, day.date)}`,
            }),
            el('small', { textContent: i18n.duration(iv.end - iv.start) }),
          );
        }
        track.append(block);
      }
    }
    track.append(el('div', { className: 'gap', style: `top:${px(y(midnight) - 1)}` }));
    return el('div', { className: `side ${cls}` }, track);
  };

  const axis = el('div', { className: 'axis', ariaHidden: 'true' });
  axis.append(
    el('span', { className: 'day', textContent: t('axisToday'), style: `top:${px(0)}` }),
    el('span', {
      className: 'day',
      textContent: t('axisTomorrow'),
      style: `top:${px(y(midnight))}`,
    }),
  );
  for (const [day, faded] of [
    [today, false],
    [tomorrow, !tomorrow.published],
  ]) {
    for (let h = 2; h < 24; h += 2) {
      axis.append(
        el('span', {
          className: faded ? 'faded' : '',
          textContent: String(h).padStart(2, '0'),
          style: `top:${px(y(kyivWallInstant(day.date, h * 60)))}`,
        }),
      );
    }
  }

  const chart = $('chart');
  chart.style.height = px(y(end));
  chart.replaceChildren(
    side(entries[0], 'l'),
    axis,
    side(entries[1], 'r'),
    el('div', { className: 'daysplit', style: `top:${px(y(midnight))}` }),
  );
  if (now >= start && now < end) {
    chart.append(
      el(
        'div',
        { className: 'nowline', style: `top:${px(y(now))}` },
        el('b', { textContent: i18n.time(now) }),
        ...entries.map(({ text }, i) =>
          el('em', {
            className: `${i === 0 ? 'l' : 'r'} ev-${text.event}`,
            textContent: text.line,
          }),
        ),
      ),
    );
  }
}

/** "18:56" for today, "17 жовтня о 18:56" otherwise. */
function stamp(ms, now) {
  return kyivDate(ms) === kyivDate(now) ? i18n.time(ms) : i18n.dateTime(ms);
}

function renderStatusLine(fetchedAt, now) {
  const check = summarizeVerification(data.verification);
  const checkKey = {
    agree: 'checkAgree',
    disagree: 'checkDisagree',
    'text-only': 'checkTextOnly',
    'image-only': 'checkImageOnly',
    unavailable: 'checkUnavailable',
    legacy: 'checkLegacy',
  }[check.status];
  const checkNode = el('span', {
    textContent: t(checkKey, { groups: check.differingGroups.join(', ') }),
  });
  checkNode.dataset.check = check.status;
  $('statusline').replaceChildren(
    el('span', {
      textContent: t('sourceUpdated', {
        when: data.sourceUpdatedAt
          ? stamp(Date.parse(data.sourceUpdatedAt), now)
          : t('notAvailable'),
      }),
    }),
    el('span', {
      textContent: t('lastChecked', { when: stamp(fetchedAt, now), ago: i18n.ago(fetchedAt, now) }),
    }),
    checkNode,
  );
}

function render() {
  if (!data) return;
  const now = Date.now();
  const groups = DISPLAY_GROUPS.filter((g) => data.groups.includes(g.id));
  if (groups.length !== DISPLAY_GROUPS.length) {
    console.error('Display groups missing from the data:', DISPLAY_GROUPS);
    showState('error');
    return;
  }

  const entries = groups.map((group) => {
    const view = computeView(data, group.id, now);
    return { group, view, text: describe(view) };
  });
  for (const { group, view, text } of entries) renderCard(group, view, text);
  renderChart(entries, now);

  const fetchedAt = Date.parse(data.fetchedAt);
  const stale = now - fetchedAt > STALE_AFTER_MS;
  $('stale').hidden = !stale;
  $('stale').textContent = stale ? t('staleWarning', { ago: i18n.ago(fetchedAt, now) }) : '';
  renderStatusLine(fetchedAt, now);
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
