import { test } from 'node:test';
import assert from 'node:assert/strict';
import { htmlToLines, parseScheduleHtml } from '../src/parse.js';
import { KNOWN_GROUPS } from '../src/source.js';

const html = (lines) => `<div>${lines.map((l) => `<p>${l}</p>`).join('\n')}</div>`;
const header = [
  '<b>Графік погодинних відключень на 17.10.2026</b>',
  '<b>Інформація станом на 18:56 17.10.2026</b>',
];
const allOn = KNOWN_GROUPS.map((g) => `Група ${g}. Електроенергія є.`);
const withLine = (group, line) =>
  html([...header, ...allOn.map((l) => (l.startsWith(`Група ${group}.`) ? line : l))]);

test('htmlToLines strips tags, decodes entities and normalises whitespace', () => {
  assert.deepEqual(
    htmlToLines('<div><p><b>A&nbsp;&amp;  B</b></p>\n<p>&#1043;&#x0440;</p><p> </p></div>'),
    ['A & B', 'Гр'],
  );
});

test('empty or whitespace-only HTML means nothing is published', () => {
  assert.equal(parseScheduleHtml(''), null);
  assert.equal(parseScheduleHtml('<div><p> </p></div>'), null);
});

test('parses dates, update time and minutes', () => {
  const parsed = parseScheduleHtml(
    withLine('1.1', 'Група 1.1. Електроенергії немає з 00:00 до 02:30, з 22:00 до 24:00.'),
  );
  assert.equal(parsed.date, '2026-10-17');
  assert.equal(parsed.updatedDate, '2026-10-17');
  assert.equal(parsed.updatedMinutes, 18 * 60 + 56);
  assert.deepEqual(parsed.groups['1.1'], [
    [0, 150],
    [1320, 1440],
  ]);
  assert.deepEqual(parsed.groups['6.2'], []);
});

test('sorts intervals and merges touching ones', () => {
  const parsed = parseScheduleHtml(
    withLine(
      '1.1',
      'Група 1.1. Електроенергії немає з 14:00 до 16:00, з 10:00 до 12:00, з 12:00 до 13:00.',
    ),
  );
  assert.deepEqual(parsed.groups['1.1'], [
    [600, 780],
    [840, 960],
  ]);
});

const rejects = {
  'unknown group': [withLine('6.2', 'Група 7.1. Електроенергія є.'), 'unknown-group'],
  'impossible date': [
    html(['Графік погодинних відключень на 31.02.2026', header[1], ...allOn]),
    'invalid-date',
  ],
  'missing update line': [html([header[0], ...allOn]), 'unknown-line'],
  '24:00-24:00': [
    withLine('1.1', 'Група 1.1. Електроенергії немає з 24:00 до 24:00.'),
    'empty-or-reversed-interval',
  ],
  '24:30': [withLine('1.1', 'Група 1.1. Електроенергії немає з 20:00 до 24:30.'), 'invalid-time'],
  'too many intervals': [
    withLine(
      '1.1',
      `Група 1.1. Електроенергії немає ${Array.from({ length: 9 }, (_, i) => `з ${String(i * 2).padStart(2, '0')}:00 до ${String(i * 2 + 1).padStart(2, '0')}:00`).join(', ')}.`,
    ),
    'implausible-interval-count',
  ],
  'trailing text after the groups': [
    html([...header, ...allOn, 'Увага! Графік може змінюватися.']),
    'unknown-line',
  ],
  'missing final full stop': [
    withLine('1.1', 'Група 1.1. Електроенергії немає з 20:00 до 22:00'),
    'unknown-line',
  ],
};

for (const [name, [input, reason]] of Object.entries(rejects)) {
  test(`rejects ${name}`, () => {
    assert.throws(() => parseScheduleHtml(input), { reason });
  });
}
