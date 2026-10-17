// Constants describing the official Lvivoblenergo source. See adr/0001.

export const SOURCE_URL = 'https://poweron.loe.lviv.ua/';
export const API_BASE = 'https://api.loe.lviv.ua';
export const SCHEDULE_MENU_URL = `${API_BASE}/api/menus?page=1&type=photo-grafic`;
export const SCHEDULE_MENU = '/api/menus/9';

/** The two schedule items read on every run. `name` is how the source labels them. */
export const ITEMS = {
  today: { id: 238, name: 'Today' },
  tomorrow: { id: 256, name: 'Tomorrow' },
};

export const itemUrl = (id) => `${API_BASE}/api/menu_items/${id}`;

/** Every group seen in 526 archived publications (Oct 2025 – Oct 2026), in source order. */
export const KNOWN_GROUPS = [
  '1.1',
  '1.2',
  '2.1',
  '2.2',
  '3.1',
  '3.2',
  '4.1',
  '4.2',
  '5.1',
  '5.2',
  '6.1',
  '6.2',
];

/** The archive never exceeds 5 intervals per group; anything far above is suspicious. */
export const MAX_INTERVALS_PER_GROUP = 8;
