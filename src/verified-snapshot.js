import { checkItem } from './parse.js';
import { buildSnapshot, assertSchema } from './snapshot.js';
import { readScheduleImage, officialImageUrl } from './image.js';
import { ITEMS, KNOWN_GROUPS } from './source.js';

/** Validate each representation independently, prefer text, and fall back per publication. */
export async function buildVerifiedSnapshot(responses, now, items = ITEMS, options = {}) {
  const selected = {};
  const verification = [];
  const imageReader = options.imageReader ?? ((response) => readScheduleImage(response));
  for (const key of ['today', 'tomorrow']) {
    const response = responses[key];
    // Identity errors must never be bypassed by OCR.
    checkItem({ ...response, rawHtml: '' }, items[key]);
    const hasText = typeof response.rawHtml === 'string' && response.rawHtml.trim().length > 0;
    const single = (candidate) => {
      const input = Object.fromEntries(
        Object.entries(responses).map(([k, value]) => [k, { ...value, rawHtml: '' }]),
      );
      input[key] = candidate;
      return buildSnapshot(input, now, items).days[0] ?? null;
    };
    let textDay, imageDay, imageResponse, textError, imageError;
    try {
      textDay = single(response);
    } catch (error) {
      textError = error;
    }
    // Empty text and no image means unpublished, not an all-clear.
    if (hasText || response.imageUrl) {
      try {
        imageResponse = await imageReader(response, key);
        imageDay = single(imageResponse);
        if (!imageDay) throw new Error('Image contains no schedule');
      } catch (error) {
        imageDay = null;
        imageError = error;
      }
    }
    const chosen = textDay ?? imageDay;
    if (!chosen && textError) {
      textError.details = { ...textError.details, imageError: imageError?.message ?? null };
      throw textError;
    }
    if (!chosen && (hasText || response.imageUrl)) {
      throw imageError ?? new Error('No valid schedule');
    }
    selected[key] = textDay ? response : imageDay ? imageResponse : response;
    const differingGroups =
      textDay && imageDay
        ? KNOWN_GROUPS.filter(
            (group) =>
              JSON.stringify(textDay.groups[group]) !== JSON.stringify(imageDay.groups[group]),
          )
        : [];
    const agrees =
      textDay &&
      imageDay &&
      textDay.date === imageDay.date &&
      textDay.sourceUpdatedAt === imageDay.sourceUpdatedAt &&
      differingGroups.length === 0;
    verification.push({
      item: key,
      date: chosen?.date ?? null,
      source: textDay ? 'text' : imageDay ? 'image' : 'none',
      status:
        textDay && imageDay
          ? agrees
            ? 'agree'
            : 'disagree'
          : imageDay
            ? 'image-only'
            : textDay
              ? 'text-only'
              : 'unavailable',
      differingGroups,
      textError: textError?.message ?? null,
      imageError: imageError?.message ?? null,
      imageUrl: officialImageUrl(response.imageUrl),
    });
  }
  const snapshot = buildSnapshot(selected, now, items);
  snapshot.verification = verification;
  assertSchema(snapshot);
  return snapshot;
}
