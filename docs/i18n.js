// Interface strings and locale-aware formatting. Add another language by adding a dictionary
// with the same keys and passing its code to createI18n().

import { kyivDate, TIME_ZONE } from './schedule.js';

const dictionaries = {
  uk: {
    locale: 'uk-UA',
    title: 'Графік відключень світла — Львівщина',
    loading: 'Завантаження графіка…',
    groupApartment: 'Квартира',
    groupHouse: 'Будинок',
    statusOff: 'Світла немає',
    statusOn: 'Світло є',
    statusUnknown: 'Немає даних',
    nextOff: ({ when }) => `Відключення ${when}`,
    nextOn: ({ when }) => `Світло з’явиться ${when}`,
    nextOnUnknown: ({ when }) => `Світла не буде щонайменше до ${when}`,
    nextNoneToday: 'До 24:00 відключень немає',
    nextNoneTomorrow: 'Відключень немає до кінця завтра',
    tomorrowPending: 'Графіка на завтра ще немає',
    at: ({ time }) => (time.startsWith('11:') ? `об ${time}` : `о ${time}`),
    tomorrowAt: ({ time }) => `завтра ${time.startsWith('11:') ? 'об' : 'о'} ${time}`,
    atLeast: ({ duration }) => `щонайменше ${duration}`,
    inDuration: ({ h, m }) =>
      h === 0 ? `через ${m} хв` : m === 0 ? `через ${h} год` : `через ${h} год ${m} хв`,
    axisToday: 'сьогодні',
    axisTomorrow: 'завтра',
    lineOn: ({ rel }) => `світло ${rel}`,
    lineOnUnknown: ({ rel }) => `світло щонайменше ${rel}`,
    lineOff: ({ rel }) => `відключення ${rel}`,
    lineNoneToday: 'до 24:00 без відключень',
    lineNone: 'без відключень',
    unpublishedDay: ({ date }) => `Графік на ${date} ще не опубліковано`,
    unpublishedHint: 'З’явиться тут автоматично',
    hours: ({ h }) => `${h} год`,
    hoursMinutes: ({ h, m }) => `${h} год ${m} хв`,
    minutes: ({ m }) => `${m} хв`,
    sourceUpdated: ({ when }) => `Оновлено ${when}`,
    lastChecked: ({ when, ago }) => `перевірено ${when} (${ago})`,
    checkAgree: 'текст і зображення збігаються',
    checkDisagree: ({ groups }) => `текст ≠ зображення (${groups})`,
    checkTextOnly: 'текст, зображення не перевірено',
    checkImageOnly: 'з зображення, текст не прочитано',
    checkUnavailable: 'графік не опубліковано',
    checkLegacy: 'порівняння ще немає',
    notAvailable: 'немає',
    staleWarning: ({ ago }) =>
      `Дані можуть бути застарілими: останню успішну перевірку джерела виконано ${ago}. Перевірте офіційний сайт.`,
    agoMinutes: ({ n }) => (n === 0 ? 'щойно' : `${n} хв тому`),
    agoHours: ({ h, m }) => (m === 0 ? `${h} год тому` : `${h} год ${m} хв тому`),
    errorTitle: 'Дані недоступні',
    errorBody: 'Не вдалося завантажити графік. Скористайтеся офіційним сайтом Львівобленерго.',
    retry: 'Спробувати ще раз',
    officialSource: 'Офіційний графік: poweron.loe.lviv.ua',
    rawData: 'Дані у форматі JSON',
  },
};

export function createI18n(lang = 'uk') {
  const dict = dictionaries[lang] ?? dictionaries.uk;
  const timeFormat = new Intl.DateTimeFormat(dict.locale, {
    timeZone: TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const dateFormat = new Intl.DateTimeFormat(dict.locale, {
    timeZone: TIME_ZONE,
    day: 'numeric',
    month: 'long',
  });
  const dateTimeFormat = new Intl.DateTimeFormat(dict.locale, {
    timeZone: TIME_ZONE,
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });

  const t = (key, params) => {
    const value = dict[key];
    if (value === undefined) throw new Error(`Missing string: ${key}`);
    return typeof value === 'function' ? value(params) : value;
  };

  return {
    lang,
    t,
    time: (ms) => timeFormat.format(ms),
    /** Formats an interval end, showing midnight that ends `date` as 24:00. */
    endTime: (ms, date) => (kyivDate(ms) > date ? '24:00' : timeFormat.format(ms)),
    date: (isoDate) => dateFormat.format(Date.parse(`${isoDate}T12:00:00Z`)),
    dateTime: (ms) => dateTimeFormat.format(ms),
    /** "о 20:00", "об 11:00", "завтра о 10:00"; midnight ending today reads "о 24:00". */
    when(ms, now) {
      const today = kyivDate(now);
      const time = timeFormat.format(ms);
      if (kyivDate(ms) === today) return t('at', { time });
      if (time === '00:00' && kyivDate(ms - 1) === today) return t('at', { time: '24:00' });
      return t('tomorrowAt', { time });
    },
    /** Length of an interval: "3 год", "1 год 30 хв", "30 хв". */
    duration: (ms) => {
      const minutes = Math.round(ms / 60_000);
      const h = Math.floor(minutes / 60);
      const m = minutes % 60;
      return h === 0
        ? t('minutes', { m })
        : m === 0
          ? t('hours', { h })
          : t('hoursMinutes', { h, m });
    },
    relative: (ms, now) => {
      const minutes = Math.max(0, Math.round((ms - now) / 60_000));
      return t('inDuration', { h: Math.floor(minutes / 60), m: minutes % 60 });
    },
    ago: (ms, now) => {
      const minutes = Math.max(0, Math.round((now - ms) / 60_000));
      return minutes < 60
        ? t('agoMinutes', { n: minutes })
        : t('agoHours', { h: Math.floor(minutes / 60), m: minutes % 60 });
    },
  };
}
