#!/usr/bin/env node
// Generate local preview data without contacting the source or running OCR.
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { addDays, kyivDate, toKyivIso } from '../src/kyiv-time.js';
import { writeJsonAtomic } from '../src/last-known-good.js';
import { ITEMS, KNOWN_GROUPS, SCHEDULE_MENU } from '../src/source.js';
import { buildVerifiedSnapshot } from '../src/verified-snapshot.js';

const SCENARIOS = ['agree', 'disagree', 'fallback', 'unverified', 'unpublished'];

export async function createStubSnapshot(now = Date.now(), scenario = 'agree') {
  if (!Number.isFinite(now)) throw new Error('Invalid --now timestamp');
  if (!SCENARIOS.includes(scenario)) {
    throw new Error(`Unknown scenario "${scenario}". Choose: ${SCENARIOS.join(', ')}`);
  }
  const today = kyivDate(now);
  const displayDate = (date) => date.split('-').reverse().join('.');
  const updated = `${toKyivIso(now).slice(11, 16)} ${displayDate(today)}`;
  const responses = Object.fromEntries(
    Object.entries(ITEMS).map(([key, item], dayIndex) => {
      const date = addDays(today, dayIndex);
      const lines = [
        `Графік погодинних відключень на ${displayDate(date)}`,
        `Інформація станом на ${updated}`,
        ...KNOWN_GROUPS.map((group, index) => {
          const ranges = [
            null,
            'з 06:00 до 08:30, з 18:00 до 20:00',
            'з 10:00 до 14:00',
            'з 00:00 до 02:00, з 20:30 до 24:00',
          ][(index + dayIndex) % 4];
          return `Група ${group}. ${ranges ? `Електроенергії немає ${ranges}.` : 'Електроенергія є.'}`;
        }),
      ];
      return [
        key,
        {
          ...item,
          menu: SCHEDULE_MENU,
          rawHtml: scenario === 'unpublished' ? '' : lines.map((line) => `<p>${line}</p>`).join(''),
        },
      ];
    }),
  );
  const images = structuredClone(responses);
  if (scenario === 'fallback') {
    for (const response of Object.values(responses))
      response.rawHtml = '<p>Simulated changed wording</p>';
  }
  if (scenario === 'disagree') {
    for (const response of Object.values(images)) {
      response.rawHtml = response.rawHtml.replace('08:30', '09:00');
    }
  }
  return buildVerifiedSnapshot(responses, now, ITEMS, {
    imageReader: async (_response, key) => {
      if (scenario === 'unverified') throw new Error('Simulated unavailable image parser');
      return images[key];
    },
  });
}

async function main() {
  const { values } = parseArgs({
    options: {
      out: { type: 'string', default: 'docs/data/latest.json' },
      scenario: { type: 'string', default: 'agree' },
      now: { type: 'string' },
    },
  });
  const now = values.now === undefined ? Date.now() : Date.parse(values.now);
  const snapshot = await createStubSnapshot(now, values.scenario);
  await writeJsonAtomic(values.out, snapshot);
  console.log(
    `STUB DATA ONLY: wrote ${values.out} (${values.scenario}; ${kyivDate(now)}). Not a real outage schedule.`,
  );
  console.log('Run npm run serve to preview. Run npm run update to restore live data.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
