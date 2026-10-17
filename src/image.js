// Fetch the image belonging to the same API item; OCR never reads rawHtml.
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { API_BASE } from './source.js';

const execute = promisify(execFile);
const MAX_BYTES = 10 * 1024 * 1024;

export function officialImageUrl(value) {
  if (typeof value !== 'string' || !value) return null;
  try {
    const url = new URL(value, API_BASE);
    return url.origin === API_BASE && url.pathname.startsWith('/media/') ? url.href : null;
  } catch {
    return null;
  }
}

export async function readScheduleImage(response, { fetchImpl = fetch } = {}) {
  if (!response.imageUrl) throw new Error('No official image published');
  const url = officialImageUrl(response.imageUrl);
  if (!url) throw new Error('Unexpected official image URL');
  const directory = await mkdtemp(join(tmpdir(), 'loe-image-'));
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(20_000), redirect: 'error' });
    if (!res.ok) throw new Error(`Image HTTP ${res.status}`);
    const chunks = [];
    let length = 0;
    for await (const chunk of res.body) {
      length += chunk.length;
      if (length > MAX_BYTES) throw new Error('Image exceeds download limit');
      chunks.push(chunk);
    }
    const path = join(directory, 'schedule.png');
    await writeFile(path, Buffer.concat(chunks));
    const { stdout } = await execute(
      process.env.PYTHON ?? 'python3',
      [new URL('../scripts/image_schedule.py', import.meta.url).pathname, path],
      { timeout: 90_000, maxBuffer: 1024 * 1024 },
    );
    const result = JSON.parse(stdout);
    if (typeof result.rawHtml !== 'string' || !result.rawHtml.trim()) {
      throw new Error('Image parser returned no schedule');
    }
    return { ...response, rawHtml: result.rawHtml };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
