import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readScheduleImage } from '../src/image.js';

test('only fetches images from the official media path', async () => {
  for (const imageUrl of [
    undefined,
    'http://[',
    'https://other.example/media/image.png',
    '/api/menu_items/238',
  ]) {
    await assert.rejects(
      readScheduleImage(
        { imageUrl },
        {
          fetchImpl: () => {
            throw new Error('must not fetch');
          },
        },
      ),
      /No official image|Unexpected official/,
    );
  }
});

test('rejects failed image downloads and oversized bodies', async () => {
  await assert.rejects(
    readScheduleImage(
      { imageUrl: '/media/test.png' },
      {
        fetchImpl: async () => new Response('', { status: 404 }),
      },
    ),
    /Image HTTP 404/,
  );
  await assert.rejects(
    readScheduleImage(
      { imageUrl: '/media/test.png' },
      {
        fetchImpl: async () => new Response(new Uint8Array(10 * 1024 * 1024 + 1)),
      },
    ),
    /download limit/,
  );
});
