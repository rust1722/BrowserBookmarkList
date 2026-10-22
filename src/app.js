/* ============================================================
   Bookmark Station — one-file bookmark manager
   No server, no build step, no dependencies.
   Data lives in localStorage + optional real JSON file on disk.
   ============================================================ */
(function () {
'use strict';

/* ============================================================
   1. Tiny helpers
   ============================================================ */
const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = (p) => (p || 'id') + '_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const debounce = (fn, ms) => { let t; return function () { const a = arguments; clearTimeout(t); t = setTimeout(() => fn.apply(null, a), ms); }; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function hashStr(str) {
  let h = 0;
  for (let i = 0; i < String(str).length; i++) { h = (h * 31 + String(str).charCodeAt(i)) | 0; }
  return Math.abs(h);
}
function hslFor(str, sat, light) {
  const h = hashStr(str) % 360;
  return `hsl(${h} ${sat}% ${light}%)`;
}
function safeArr(v) { return Array.isArray(v) ? v : []; }

function escRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function hl(text, query) {
  const t = String(text == null ? '' : text);
  if (!query) return esc(t);
  const terms = query.trim().split(/\s+/).filter(Boolean).slice(0, 6).map(escRe);
  if (!terms.length) return esc(t);
  const re = new RegExp('(' + terms.join('|') + ')', 'ig');
  return t.split(re).map((part, i) => (i % 2 ? '<mark>' + esc(part) + '</mark>' : esc(part))).join('');
}

/* ---------- URLs ---------- */
function normalizeUrl(raw) {
  let u = String(raw || '').trim();
  if (!u) return '';
  if (/^(javascript|data|vbscript|blob):/i.test(u)) return u;
  if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return u;
  if (u.startsWith('//')) return 'https:' + u;
  if (/^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?(\/|$)/i.test(u)) return 'http://' + u;
  return 'https://' + u;
}
function isSafeUrl(u) { return !/^\s*(javascript|data|vbscript):/i.test(String(u || '')); }
function domainOf(u) {
  try {
    const url = new URL(normalizeUrl(u));
    const host = url.hostname.replace(/^www\./, '');
    return host || url.protocol.replace(':', '');
  } catch (e) {
    return String(u || '').replace(/^[a-z]+:\/\//i, '').split(/[/?#]/)[0].replace(/^www\./, '');
  }
}
function pathOf(u) {
  try {
    const url = new URL(normalizeUrl(u));
    const p = decodeURIComponent(url.pathname).replace(/\/$/, '');
    return p.length > 1 ? p : '';
  } catch (e) { return ''; }
}
function faviconUrl(u, service) {
  const host = domainOf(u);
  if (!host) return '';
  if (service === 'duckduckgo') return 'https://icons.duckduckgo.com/ip3/' + encodeURIComponent(host) + '.ico';
  if (service === 'none') return '';
  return 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(host) + '&sz=64';
}
function initialOf(text) {
  const t = String(text || '').replace(/^https?:\/\/(www\.)?/i, '').trim();
  const m = t.match(/[a-zа-яё0-9]/i);
  return (m ? m[0] : '?').toUpperCase();
}

/* ---------- dates ---------- */
const rtf = (() => {
  try { return new Intl.RelativeTimeFormat('ru', { numeric: 'auto' }); } catch (e) { return null; }
})();
function fmtRel(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const abs = Math.abs(diff);
  const min = 60000, hour = 3600000, day = 86400000;
  if (abs < min) return 'только что';
  if (abs < hour) return rtf ? rtf.format(-Math.round(diff / min), 'minute') : Math.round(diff / min) + ' мин назад';
  if (abs < day) return rtf ? rtf.format(-Math.round(diff / hour), 'hour') : Math.round(diff / hour) + ' ч назад';
  if (abs < day * 7) return rtf ? rtf.format(-Math.round(diff / day), 'day') : Math.round(diff / day) + ' дн назад';
  return new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: new Date(ts).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}
function fmtDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function fmtBytes(n) {
  if (n < 1024) return n + ' Б';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' КБ';
  return (n / 1048576).toFixed(2) + ' МБ';
}

/* ============================================================
   2. Icons
   ============================================================ */
const P = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m4.5 12.5 4.5 4.5L19.5 6.5"/>',
  chevronRight: '<path d="m9.5 6 6 6-6 6"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  folder: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2.5h7.5A2.5 2.5 0 0 1 21 10v7.5A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5Z"/>',
  folderPlus: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2.5h7.5A2.5 2.5 0 0 1 21 10v7.5A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5Z"/><path d="M12 10.5v5M9.5 13h5"/>',
  star: '<path d="m12 3.6 2.65 5.37 5.93.86-4.29 4.18 1.01 5.9L12 17.12l-5.3 2.79 1.01-5.9L3.42 9.83l5.93-.86z"/>',
  archive: '<rect x="3" y="4" width="18" height="4.5" rx="1.3"/><path d="M5 8.5V19a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19V8.5M10 12.5h4"/>',
  trash: '<path d="M4 7h16M9.5 7V4.8a1.3 1.3 0 0 1 1.3-1.3h2.4a1.3 1.3 0 0 1 1.3 1.3V7M6.5 7l.8 12.1a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4L17.5 7"/><path d="M10.4 11v5.6M13.6 11v5.6"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.4V12l3.1 2"/>',
  history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3.5 4.4V10H9"/><path d="M12 8.2V12l3 1.8"/>',
  grid: '<rect x="3.8" y="3.8" width="7.4" height="7.4" rx="1.8"/><rect x="12.8" y="3.8" width="7.4" height="7.4" rx="1.8"/><rect x="3.8" y="12.8" width="7.4" height="7.4" rx="1.8"/><rect x="12.8" y="12.8" width="7.4" height="7.4" rx="1.8"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.4" cy="6" r="1.3" fill="currentColor" stroke="none"/><circle cx="4.4" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="4.4" cy="18" r="1.3" fill="currentColor" stroke="none"/>',
  sliders: '<path d="M4 7h8M17.5 7H21M4 17h3M12 17h9"/><circle cx="14.7" cy="7" r="2.4"/><circle cx="9.4" cy="17" r="2.4"/>',
  more: '<circle cx="5.5" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.5" fill="currentColor" stroke="none"/>',
  external: '<path d="M14 4h6v6M20 4l-8.5 8.5"/><path d="M19 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 18.5v-11A1.5 1.5 0 0 1 6.5 6H11"/>',
  download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14"/>',
  upload: '<path d="M12 20V9M7.5 13.5 12 9l4.5 4.5M5 4.5h14"/>',
  link: '<path d="M10 13.5a4 4 0 0 0 5.7 0l2.8-2.8a4 4 0 0 0-5.7-5.7l-1.4 1.4"/><path d="M14 10.5a4 4 0 0 0-5.7 0l-2.8 2.8a4 4 0 0 0 5.7 5.7l1.4-1.4"/>',
  tag: '<path d="M20.5 13.3 12.8 21a1.8 1.8 0 0 1-2.6 0l-7.2-7.2A1.8 1.8 0 0 1 2.5 12.5V4.3A1.8 1.8 0 0 1 4.3 2.5h8.2c.5 0 1 .2 1.3.6l6.7 6.7a1.8 1.8 0 0 1 0 2.5z"/><circle cx="7.4" cy="7.4" r="1.3"/>',
  fire: '<path d="M12 21c3.9 0 6.5-2.6 6.5-6 0-4.4-4-6.2-4.6-10.5-1.4 1.4-2.2 3-2.4 4.6-1.2-.6-2-1.5-2.4-2.8C7 8 5.5 10.5 5.5 15c0 3.4 2.6 6 6.5 6z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2.5 12h2M19.5 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20.5 14.8A8.7 8.7 0 0 1 9.2 3.5 8.8 8.8 0 1 0 20.5 14.8z"/>',
  monitor: '<rect x="2.8" y="4" width="18.4" height="12.5" rx="2"/><path d="M9 20.5h6M12 16.5v4"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2.2"/><path d="M6.2 10h.01M9.6 10h.01M13 10h.01M16.4 10h.01M6.2 13.4h.01M9.6 13.4h.01M13 13.4h.01M16.4 13.4h.01M8.4 16h7.2"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.2a2.6 2.6 0 1 1 3.5 2.5c-.7.25-1.1.9-1.1 1.6v.4"/><circle cx="12" cy="17" r=".95" fill="currentColor" stroke="none"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="2.4"/><path d="M9.2 4v16"/>',
  sparkles: '<path d="m11.5 3 1.55 4.15L17.2 8.7l-4.15 1.55L11.5 14.4 9.95 10.25 5.8 8.7l4.15-1.55z"/><path d="m18.2 14.6.75 2.05 2.05.75-2.05.75-.75 2.05-.75-2.05-2.05-.75 2.05-.75z"/>',
  pencil: '<path d="M4 20h4L20.2 7.8a2.15 2.15 0 0 0-3-3L5 17v3z"/><path d="m14.8 6.2 3 3"/>',
  copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2.2"/><path d="M15.5 5.6v-1a2.1 2.1 0 0 0-2.1-2.1h-9A2.1 2.1 0 0 0 2.3 4.6v9a2.1 2.1 0 0 0 2.1 2.1h1"/>',
  restore: '<path d="M4.2 10.2a8.2 8.2 0 1 1 2.2 7"/><path d="M4.2 4.6v5.6h5.6"/>',
  database: '<ellipse cx="12" cy="5.8" rx="8" ry="3"/><path d="M4 5.8v6.2c0 1.66 3.58 3 8 3s8-1.34 8-3V5.8"/><path d="M4 12v6.2c0 1.66 3.58 3 8 3s8-1.34 8-3V12"/>',
  save: '<path d="M5 3.5h10.8L20 7.7V19a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19V5a1.5 1.5 0 0 1 1-1.5z"/><path d="M7.5 3.5v6h8v-6M7.5 15h9v5.5h-9z"/>',
  file: '<path d="M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8z"/><path d="M14 3v5h5"/>',
  home: '<path d="M4 10.4 12 4l8 6.4V20a1 1 0 0 1-1 1h-4.4v-6.2h-5.2V21H5a1 1 0 0 1-1-1z"/>',
  arrowUpRight: '<path d="M7 17 17 7M9 7h8v8"/>',
  move: '<path d="M4 12h15M13.5 6l6 6-6 6"/>',
  pin: '<path d="M9.3 3.5h5.4l-.9 5.6 3.7 3.6v1.8H6.5v-1.8l3.7-3.6z"/><path d="M12 14.5v6"/>',
  shield: '<path d="M12 3 5 6v5.5c0 4.4 2.9 7.9 7 9.5 4.1-1.6 7-5.1 7-9.5V6z"/><path d="m9 12 2.2 2.2L15.4 10"/>',
  book: '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H10a2.5 2.5 0 0 1 2 1v14a2 2 0 0 0-1.7-1H4z"/><path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H14a2.5 2.5 0 0 0-2 1v14a2 2 0 0 1 1.7-1H20z"/>',
  stack: '<path d="m12 3 9 4.6-9 4.6-9-4.6z"/><path d="m3.6 12.4 8.4 4.3 8.4-4.3M3.6 16.8 12 21l8.4-4.2"/>',
  eye: '<path d="M2.5 12S5.8 5.8 12 5.8 21.5 12 21.5 12 18.2 18.2 12 18.2 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  sort: '<path d="M7 4v16M3.5 16.5 7 20l3.5-3.5M17 20V4M13.5 7.5 17 4l3.5 3.5"/>',
  tagPlus: '<path d="M20.5 13.3 12.8 21a1.8 1.8 0 0 1-2.6 0l-7.2-7.2A1.8 1.8 0 0 1 2.5 12.5V4.3A1.8 1.8 0 0 1 4.3 2.5h8.2c.5 0 1 .2 1.3.6l6.7 6.7a1.8 1.8 0 0 1 0 2.5z"/><path d="M7.5 10.5v4M5.5 12.5h4"/>',
  logo: '<path d="M7 4.5h10a1 1 0 0 1 1 1V21l-6-3.4L6 21V5.5a1 1 0 0 1 1-1z"/>',
  inInbox: '<path d="M4 13.5V6.5A2 2 0 0 1 6 4.5h12a2 2 0 0 1 2 2v7"/><path d="M4 13.5h4l1.5 3h5l1.5-3h4v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/>'
};
function icon(name, size, cls) {
  const body = P[name] || P.link;
  return '<svg viewBox="0 0 24 24" width="' + (size || 18) + '" height="' + (size || 18) + '" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" class="' + (cls || '') + '" aria-hidden="true">' + body + '</svg>';
}

/* ============================================================
   3. Constants
   ============================================================ */
const LS_KEY = 'bookmarkStation.v1';
const LS_SNAPS = 'bookmarkStation.snaps.v1';
const THEMES = ['auto', 'dark', 'light'];
const ACCENTS = ['#6c8cff', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#ef4444', '#64748b'];
const EMOJIS = ['📁', '📌', '⭐', '🔥', '💡', '🎨', '💼', '🧠', '📚', '🛠', '🚀', '🌱', '🎬', '🎵', '🛒', '✈️', '🍔', '💻', '📊', '🔖', '🧪', '🏠', '❤️', '🔒', '🌍', '⚙️', '📝', '🎯', '🧩', '☕', '🐙', '📷', '🎮', '🧾', '💬', '🧭'];
const SORTS = [
  { id: 'manual', label: 'Вручную' },
  { id: 'recent', label: 'Сначала новые' },
  { id: 'oldest', label: 'Сначала старые' },
  { id: 'name', label: 'По названию' },
  { id: 'domain', label: 'По сайту' },
  { id: 'popular', label: 'По частоте' }
];

/* ============================================================
   4. State
   ============================================================ */
function defaultSettings() {
  return {
    theme: 'auto',
    accent: '#6c8cff',
    view: 'grid',
    density: 'comfortable',
    cardMin: 248,
    showFavicons: true,
    faviconService: 'google',
    openNewTab: true,
    confirmDelete: true,
    autoBackup: true,
    autoSnapshots: true,
    sidebarWidth: 272,
    clickOpens: true,
    demo: false
  };
}
function emptyState() {
  return {
    version: 1,
    settings: defaultSettings(),
    dock: [],
    folders: [],
    bookmarks: [],
    trash: [],
    meta: { created: Date.now(), updated: Date.now(), demo: false }
  };
}
let state = emptyState();
let ui = {
  view: 'all',
  selectMode: false,
  limit: 320,
  folderId: null,
  tag: null,
  query: '',
  sort: 'manual',
  selection: new Set(),
  anchorId: null,
  collapsed: new Set(),
  archiveFilter: false
};
let drag = null;            // { kind, id, label }
let dropHintEl = null;
let menuEl = null;
let modalStack = [];
let fileHandle = null;
let fileState = { mode: 'off', name: '', lastSaved: 0, busy: false, error: '' };
const saveFileDebounced = debounce(() => { void writeToLinkedFile(false); }, 700);
const persistLocal = debounce(() => { try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) { console.warn('localStorage full', e); } }, 220);

/* ============================================================
   5. IndexedDB (stores the file handle between sessions)
   ============================================================ */
const idb = (() => {
  let dbp = null;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      try {
        if (!window.indexedDB) return reject(new Error('no idb'));
        const req = indexedDB.open('bookmarkStation', 1);
        req.onupgradeneeded = () => { try { req.result.createObjectStore('kv'); } catch (e) {} };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('idb error'));
      } catch (e) { reject(e); }
    }).catch(() => null);
    return dbp;
  }
  async function get(key) {
    const db = await open(); if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction('kv', 'readonly');
        const r = tx.objectStore('kv').get(key);
        r.onsuccess = () => resolve(r.result || null);
        r.onerror = () => resolve(null);
      } catch (e) { resolve(null); }
    });
  }
  async function set(key, val) {
    const db = await open(); if (!db) return false;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(val, key);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (e) { resolve(false); }
    });
  }
  async function del(key) {
    const db = await open(); if (!db) return false;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').delete(key);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (e) { resolve(false); }
    });
  }
  return { get, set, del };
})();

/* ============================================================
   6. Persistence
   ============================================================ */
function coalesceState(raw) {
  const s = emptyState();
  if (!raw || typeof raw !== 'object') return s;
  s.version = 1;
  s.settings = Object.assign(s.settings, raw.settings || {});
  s.meta = Object.assign(s.meta, raw.meta || {});
  s.dock = safeArr(raw.dock).filter((x) => x && x.url).map((x, i) => ({
    id: x.id || uid('dock'),
    title: String(x.title || domainOf(x.url) || 'Сайт'),
    url: normalizeUrl(x.url),
    iconType: x.iconType || 'favicon',
    icon: x.icon || '',
    color: x.color || '#6c8cff',
    order: Number.isFinite(x.order) ? x.order : i
  })).sort((a, b) => a.order - b.order).map((x, i) => Object.assign(x, { order: i }));
  const folders = safeArr(raw.folders).filter((f) => f && f.name).map((f, i) => ({
    id: f.id || uid('f'),
    name: String(f.name).slice(0, 120),
    parentId: f.parentId || null,
    emoji: f.emoji || '📁',
    color: f.color || '',
    order: Number.isFinite(f.order) ? f.order : i,
    createdAt: f.createdAt || Date.now(),
    note: f.note || ''
  }));
  const fids = new Set(folders.map((f) => f.id));
  folders.forEach((f) => { if (f.parentId && !fids.has(f.parentId)) f.parentId = null; });
  s.folders = folders;
  const mapBm = (b, i) => ({
    id: b.id || uid('b'),
    title: String(b.title || domainOf(b.url) || 'Без названия').slice(0, 300),
    url: normalizeUrl(b.url || ''),
    description: String(b.description || '').slice(0, 2000),
    notes: String(b.notes || '').slice(0, 4000),
    tags: safeArr(b.tags).map((t) => String(t).trim()).filter(Boolean).slice(0, 20),
    folderId: b.folderId && fids.has(b.folderId) ? b.folderId : null,
    favorite: !!b.favorite,
    archived: !!b.archived,
    iconType: b.iconType || 'favicon',
    icon: b.icon || '',
    color: b.color || '',
    clicks: Math.max(0, parseInt(b.clicks, 10) || 0),
    createdAt: Number(b.createdAt) || Date.now(),
    updatedAt: Number(b.updatedAt) || Date.now(),
    lastOpened: Number(b.lastOpened) || 0,
    order: Number.isFinite(b.order) ? b.order : i
  });
  s.bookmarks = safeArr(raw.bookmarks).filter((b) => b && b.url).map(mapBm);
  s.trash = safeArr(raw.trash).filter((b) => b && b.url).map((b, i) => Object.assign(mapBm(b, i), { deletedAt: Number(b.deletedAt) || Date.now() }));
  s.meta.demo = !!(raw.meta && raw.meta.demo);
  return s;
}

function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    state = coalesceState(parsed);
    ui.sort = 'manual';
    return true;
  } catch (e) {
    console.warn('load failed', e);
    return false;
  }
}

function saveAll(opts) {
  const o = opts || {};
  state.meta.updated = Date.now();
  persistLocal();
  if (o.snapshot) maybeSnapshot();
  if (fileHandle) saveFileDebounced();
  updateSyncPill();
}

/* ---------- snapshots / backups ---------- */
function dataPayload() {
  return {
    version: 1,
    settings: state.settings,
    dock: state.dock,
    folders: state.folders,
    bookmarks: state.bookmarks,
    trash: state.trash,
    meta: state.meta
  };
}
function readSnapshots() {
  try { return JSON.parse(localStorage.getItem(LS_SNAPS) || '[]'); } catch (e) { return []; }
}
function maybeSnapshot(force) {
  if (!state.settings.autoSnapshots && !force) return;
  try {
    const snaps = readSnapshots();
    const payload = JSON.stringify(dataPayload());
    if (snaps.length && snaps[0].data === payload) return;
    if (!force && snaps.length && Date.now() - snaps[0].at < 3 * 60 * 1000) return;
    snaps.unshift({ id: uid('snap'), at: Date.now(), data: payload });
    const trimmed = snaps.slice(0, 8);
    localStorage.setItem(LS_SNAPS, JSON.stringify(trimmed));
  } catch (e) { /* quota — ignore */ }
}

/* ============================================================
   7. Theme & settings application
   ============================================================ */
function hexToRgb(hex) {
  const h = String(hex).replace('#', '').trim();
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  if (isNaN(n)) return [108, 140, 255];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
}
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (mx + mn) / 2;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h * 360, s * 100, l * 100];
}
function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360; s = clamp(s, 0, 100) / 100; l = clamp(l, 0, 100) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let rgb = [0, 0, 0];
  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return rgbToHex((rgb[0] + m) * 255, (rgb[1] + m) * 255, (rgb[2] + m) * 255);
}
function accentPair(hex) {
  const [r, g, b] = hexToRgb(hex);
  const [h, s, l] = rgbToHsl(r, g, b);
  return [hex, hslToHex(h + 28, clamp(s + 6, 0, 92), clamp(l + 8, 0, 72))];
}
function resolveTheme() {
  const t = state.settings.theme || 'auto';
  if (t === 'auto') return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  return t;
}
function applyTheme() {
  document.documentElement.dataset.theme = resolveTheme();
}
function applyAccent() {
  const [a, b] = accentPair(state.settings.accent || '#6c8cff');
  const [r, g, bl] = hexToRgb(a);
  document.documentElement.style.setProperty('--accent', a);
  document.documentElement.style.setProperty('--accent-rgb', r + ', ' + g + ', ' + bl);
  document.documentElement.style.setProperty('--accent-2', b);
}
function applyLayout() {
  const st = state.settings;
  const app = $('#app');
  document.documentElement.style.setProperty('--sidebar-w', clamp(st.sidebarWidth || 272, 220, 420) + 'px');
  document.documentElement.style.setProperty('--card-min', clamp(st.cardMin || 248, 190, 420) + 'px');
  document.documentElement.style.setProperty('--card-pad', st.density === 'compact' ? '12px' : '16px');
  document.documentElement.style.setProperty('--gap', st.density === 'compact' ? '10px' : '14px');
  if (app) {
    app.classList.toggle('sidebar-collapsed', !!st._collapsed && window.innerWidth > 900);
    app.classList.toggle('sidebar-open', false);
  }
}

/* ============================================================
   8. Toasts
   ============================================================ */
function toast(message, opts) {
  const o = opts || {};
  const root = $('#toasts');
  if (!root) return;
  $$('.toast', root).forEach((t) => {
    if (t.dataset.msg === String(message)) t.remove();
  });
  const el = document.createElement('div');
  el.dataset.msg = String(message);
  el.className = 'toast ' + (o.type || '');
  const ic = o.type === 'error' ? 'x' : (o.type === 'success' ? 'check' : 'sparkles');
  el.innerHTML =
    '<div class="tico">' + icon(o.icon || ic, 17) + '</div>' +
    '<div class="msg">' + esc(message) + '</div>' +
    (o.actionLabel ? '<button type="button" class="toast-action">' + esc(o.actionLabel) + '</button>' : '');
  root.appendChild(el);
  let removed = false;
  const kill = () => {
    if (removed) return; removed = true;
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 200);
  };
  if (o.actionLabel) {
    el.querySelector('.toast-action').addEventListener('click', () => {
      try { o.onAction && o.onAction(); } catch (e) { console.warn(e); }
      kill();
    });
  }
  setTimeout(kill, o.duration || (o.actionLabel ? 7000 : 3200));
}

/* ============================================================
   9. Menus & modals
   ============================================================ */
function closeMenu() {
  if (menuEl) { menuEl.remove(); menuEl = null; }
}
function closeAllMenus() { closeMenu(); }
function openMenu(items, x, y, opts) {
  closeMenu();
  const menu = document.createElement('div');
  menu.className = 'menu';
  const rows = [];
  items.forEach((it) => {
    if (!it) return;
    if (it.sep) { rows.push('<div class="menu-sep"></div>'); return; }
    if (it.title) { rows.push('<div class="menu-title">' + esc(it.title) + '</div>'); return; }
    rows.push(
      '<button type="button" class="menu-item ' + (it.danger ? 'danger' : '') + '" data-mi="' + rows.length + '">' +
      '<span class="ico">' + icon(it.icon || 'link', 15) + '</span>' +
      '<span class="lbl">' + esc(it.label) + (it.hint ? ' <span class="kbd">' + esc(it.hint) + '</span>' : '') + '</span>' +
      (it.checked ? '<span class="check">' + icon('check', 15) + '</span>' : '') +
      '</button>'
    );
  });
  menu.innerHTML = rows.join('');
  document.body.appendChild(menu);
  const pad = 8;
  const rect = menu.getBoundingClientRect();
  let left = x, top = y;
  if (left + rect.width > window.innerWidth - pad) left = window.innerWidth - rect.width - pad;
  if (top + rect.height > window.innerHeight - pad) top = Math.max(pad, window.innerHeight - rect.height - pad);
  menu.style.left = Math.max(pad, left) + 'px';
  menu.style.top = Math.max(pad, top) + 'px';
  menuEl = menu;

  const actionable = items.filter((it) => it && it.label && !it.title && !it.sep);
  const buttons = $$('.menu-item', menu);
  buttons.forEach((btn, i) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const item = actionable[i];
      closeMenu();
      if (item && item.onClick) item.onClick();
    });
  });
  if (opts && opts.scrollTop) menu.scrollTop = 0;
}

function openModal(opts) {
  const layer = document.createElement('div');
  layer.className = 'modal-layer' + (opts.sheet ? ' right' : '');
  const modal = document.createElement('div');
  modal.className = 'modal' + (opts.wide ? ' wide' : '') + (opts.narrow ? ' narrow' : '') + (opts.sheet ? ' sheet' : '');
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.innerHTML =
    '<div class="modal-head">' +
      '<div style="min-width:0">' +
        '<div class="mtitle">' + esc(opts.title || '') + '</div>' +
        (opts.subtitle ? '<div class="msub">' + esc(opts.subtitle) + '</div>' : '') +
      '</div>' +
      '<button type="button" class="icon-btn small" data-close="1" aria-label="Закрыть">' + icon('x', 16) + '</button>' +
    '</div>' +
    '<div class="modal-body">' + (opts.body || '') + '</div>' +
    (opts.footer ? '<div class="modal-foot">' + opts.footer + '</div>' : '');
  layer.appendChild(modal);
  $('#modalRoot').appendChild(layer);
  const entry = {
    layer, modal,
    close: () => {
      layer.remove();
      modalStack = modalStack.filter((m) => m !== entry);
      if (opts.onClose) opts.onClose();
      if (modalStack.length) { const top = modalStack[modalStack.length - 1]; if (top.focusFirst) top.focusFirst(); }
    }
  };
  modalStack.push(entry);

  layer.addEventListener('mousedown', (e) => { if (e.target === layer && !opts.noBackdropClose) entry.close(); });
  $$('[data-close]', modal).forEach((b) => b.addEventListener('click', entry.close));
  entry.focusFirst = () => {
    const first = $('input:not([type=color]):not([type=file]), textarea, select', modal);
    if (first) { first.focus(); if (first.select && first.type === 'text') { try { first.select(); } catch (e) {} } }
  };
  if (opts.onMount) opts.onMount(modal, entry);
  setTimeout(() => entry.focusFirst(), 40);
  return entry;
}

function confirmDialog(opts) {
  return new Promise((resolve) => {
    let decided = false;
    const entry = openModal({
      title: opts.title || 'Подтвердите действие',
      subtitle: opts.subtitle || '',
      narrow: true,
      body: '<p style="margin:2px 0 6px;color:var(--text-dim);font-size:13px;line-height:1.6">' + esc(opts.text || '') + '</p>' +
        (opts.note ? '<div class="hint" style="font-size:11.5px;color:var(--muted)">' + esc(opts.note) + '</div>' : ''),
      footer:
        '<div class="left"></div>' +
        '<button type="button" class="btn" data-no="1">' + esc(opts.cancelLabel || 'Отмена') + '</button>' +
        '<button type="button" class="btn ' + (opts.danger ? 'danger' : 'primary') + '" data-yes="1">' + esc(opts.confirmLabel || 'Подтвердить') + '</button>',
      onClose: () => { if (!decided) { decided = true; resolve(false); } }
    });
    const finish = (v) => { if (decided) return; decided = true; resolve(v); entry.close(); };
    $('[data-no]', entry.modal).addEventListener('click', () => finish(false));
    $('[data-yes]', entry.modal).addEventListener('click', () => finish(true));
    entry.modal.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    });
  });
}

/* A promise-based list of choices. Resolves with the chosen value or null. */
function chooserModal(opts) {
  return new Promise((resolve) => {
    let settled = false;
    const entry = openModal({
      title: opts.title,
      subtitle: opts.subtitle,
      narrow: true,
      body: (opts.intro ? '<p style="margin:2px 0 10px;color:var(--text-dim);font-size:13px;line-height:1.6">' + opts.intro + '</p>' : '') +
        '<div style="display:flex;flex-direction:column;gap:7px">' +
        opts.options.map((o) =>
          '<button type="button" class="btn block" data-choice="' + esc(o.value) + '" style="justify-content:flex-start;height:auto;padding:11px 12px;text-align:left">' +
            '<span style="color:var(--accent);display:grid;place-items:center">' + icon(o.icon || 'link', 17) + '</span>' +
            '<span style="text-align:left"><b style="display:block;font-weight:600">' + esc(o.label) + '</b>' +
            (o.desc ? '<span style="font-size:11px;color:var(--muted)">' + esc(o.desc) + '</span>' : '') + '</span>' +
          '</button>').join('') +
        '</div>',
      footer: '<div class="left"></div><button type="button" class="btn" data-cancel>Отмена</button>',
      onClose: () => { if (!settled) { settled = true; resolve(null); } }
    });
    const choose = (v) => { if (settled) return; settled = true; resolve(v); entry.close(); };
    $$('[data-choice]', entry.modal).forEach((b) => b.addEventListener('click', () => choose(b.dataset.choice)));
    $('[data-cancel]', entry.modal).addEventListener('click', () => choose(null));
    entry.modal.addEventListener('keydown', (e) => { if (e.key === 'Escape') choose(null); });
  });
}

/* ---------- small UI builders ---------- */
function toastUndo(message, snapshot, opts) {
  toast(message, Object.assign({
    actionLabel: 'Отменить',
    onAction: () => { restoreSnapshot(snapshot); toast('Действие отменено', { icon: 'restore' }); }
  }, opts || {}));
}
function dataSnapshot() {
  return JSON.stringify({ dock: state.dock, folders: state.folders, bookmarks: state.bookmarks, trash: state.trash });
}
function restoreSnapshot(snap) {
  try {
    const d = JSON.parse(snap);
    state.dock = d.dock; state.folders = d.folders; state.bookmarks = d.bookmarks; state.trash = d.trash;
    ui.selection.clear();
    saveAll({ snapshot: false });
    render();
  } catch (e) { console.warn(e); }
}

/* ---------- date input helpers ---------- */
function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

/* ============================================================
   10. Read-only model helpers
   ============================================================ */
function folderById(id) { return state.folders.find((f) => f.id === id) || null; }
function bookmarkById(id) { return state.bookmarks.find((b) => b.id === id) || state.trash.find((b) => b.id === id) || null; }
function activeBookmarks() { return state.bookmarks.filter((b) => !b.archived); }
function childFolders(parentId) {
  return state.folders.filter((f) => (f.parentId || null) === (parentId || null)).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'ru'));
}
function folderPath(id) {
  const out = [];
  let cur = folderById(id);
  let guard = 0;
  while (cur && guard++ < 40) { out.unshift(cur); cur = cur.parentId ? folderById(cur.parentId) : null; }
  return out;
}
function descendantIds(id) {
  const out = [id];
  for (let i = 0; i < out.length; i++) {
    state.folders.filter((f) => f.parentId === out[i]).forEach((f) => out.push(f.id));
  }
  return out;
}
function bookmarksInFolder(id, deep) {
  const ids = new Set(deep ? descendantIds(id) : [id]);
  return state.bookmarks.filter((b) => !b.archived && b.folderId && ids.has(b.folderId));
}
function folderStats(id) {
  const direct = state.bookmarks.filter((b) => !b.archived && b.folderId === id).length;
  const kids = state.folders.filter((f) => f.parentId === id).length;
  return { direct, kids };
}
function allTags() {
  const map = new Map();
  activeBookmarks().forEach((b) => (b.tags || []).forEach((t) => map.set(t, (map.get(t) || 0) + 1)));
  return Array.from(map.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ru'));
}
function tagColor(tag) {
  if (state.settings.tagColors && state.settings.tagColors[tag]) return state.settings.tagColors[tag];
  return hslFor(tag, 62, 55);
}
function isRecent(b) {
  const ts = b.lastOpened || b.updatedAt || b.createdAt;
  return Date.now() - ts < 1000 * 60 * 60 * 24 * 14;
}
function compareBookmarks(mode) {
  const m = mode || 'manual';
  return (a, b) => {
    if (m === 'name') return a.title.localeCompare(b.title, 'ru');
    if (m === 'domain') return domainOf(a.url).localeCompare(domainOf(b.url), 'ru') || a.title.localeCompare(b.title, 'ru');
    if (m === 'recent') return (b.createdAt || 0) - (a.createdAt || 0);
    if (m === 'oldest') return (a.createdAt || 0) - (b.createdAt || 0);
    if (m === 'popular') return (b.clicks || 0) - (a.clicks || 0) || a.title.localeCompare(b.title, 'ru');
    return (a.order || 0) - (b.order || 0) || (a.createdAt || 0) - (b.createdAt || 0);
  };
}

function viewTitle() {
  switch (ui.view) {
    case 'all': return { t: 'Все закладки', icon: 'stack' };
    case 'folder': { const f = folderById(ui.folderId); return f ? { t: f.name, e: f.emoji, color: f.color, folder: f } : { t: 'Папка', e: '📁' }; }
    case 'favorites': return { t: 'Избранное', icon: 'star' };
    case 'recent': return { t: 'Недавние', icon: 'clock' };
    case 'popular': return { t: 'Часто открываю', icon: 'fire' };
    case 'archive': return { t: 'Архив', icon: 'archive' };
    case 'trash': return { t: 'Корзина', icon: 'trash' };
    case 'tag': return { t: '#' + (ui.tag || ''), icon: 'tag' };
    case 'search': return { t: 'Поиск', icon: 'search' };
    default: return { t: 'Все закладки', icon: 'stack' };
  }
}

function currentBookmarks() {
  const q = ui.query.trim().toLowerCase();
  let arr;
  switch (ui.view) {
    case 'folder': arr = state.bookmarks.filter((b) => !b.archived && b.folderId === ui.folderId); break;
    case 'favorites': arr = activeBookmarks().filter((b) => b.favorite); break;
    case 'recent': arr = activeBookmarks().filter(isRecent); break;
    case 'popular': arr = activeBookmarks().filter((b) => b.clicks > 0); break;
    case 'archive': arr = state.bookmarks.filter((b) => b.archived); break;
    case 'trash': arr = state.trash.slice(); break;
    case 'tag': arr = activeBookmarks().filter((b) => (b.tags || []).includes(ui.tag)); break;
    default: arr = activeBookmarks();
  }
  if (q && ui.view !== 'trash' && ui.view !== 'tag') {
    /* a query searches the whole library, not just the current folder */
    arr = state.bookmarks.slice();
  }
  if (q) {
    const terms = q.split(/\s+/).filter(Boolean);
    arr = arr.filter((b) => {
      const hay = (b.title + ' ' + b.url + ' ' + (b.description || '') + ' ' + (b.notes || '') + ' ' + (b.tags || []).join(' ') + ' ' + folderPath(b.folderId).map((f) => f.name).join(' ')).toLowerCase();
      return terms.every((t) => hay.indexOf(t) !== -1);
    });
  }
  if (ui.view === 'recent') arr.sort((a, b) => (b.lastOpened || b.updatedAt) - (a.lastOpened || a.updatedAt));
  else if (ui.view === 'trash') arr.sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));
  else arr.sort(compareBookmarks(ui.sort));
  return arr;
}

/* ============================================================
   11. Icon rendering
   ============================================================ */
function letterColor(b) {
  if (b && b.color) return b.color;
  return hslFor(b && b.url ? domainOf(b.url) : (b && b.title) || 'bm', 58, 48);
}
function bmIconHTML(b) {
  const st = state.settings;
  let type = b.iconType || 'favicon';
  if (type === 'favicon' && !st.showFavicons) type = 'letter';
  const letter = initialOf(b.title || domainOf(b.url));
  const color = letterColor(b);
  if (type === 'emoji') {
    return '<div class="bm-icon emoji" style="background:color-mix(in srgb, ' + color + ' 18%, transparent)"><span>' + esc(b.icon || '🔖') + '</span></div>';
  }
  if (type === 'url' && b.icon) {
    return '<div class="bm-icon"><img src="' + esc(b.icon) + '" alt="" loading="lazy" onerror="this.remove()"></div>';
  }
  if (type === 'letter') {
    return '<div class="bm-icon letter" style="background:' + esc(color) + '"><span>' + esc(letter) + '</span></div>';
  }
  const src = faviconUrl(b.url, st.faviconService);
  if (!src) return '<div class="bm-icon letter" style="background:' + esc(color) + '"><span>' + esc(letter) + '</span></div>';
  return '<div class="bm-icon favicon">' +
    '<span class="fb" style="background:' + esc(color) + '">' + esc(letter) + '</span>' +
    '<img src="' + esc(src) + '" alt="" loading="lazy" referrerpolicy="no-referrer" ' +
      'onload="this.parentNode.classList.add(\'loaded\')" onerror="this.remove()">' +
    '</div>';
}
function dockIconHTML(item) {
  const st = state.settings;
  let type = item.iconType || 'favicon';
  if (type === 'favicon' && !st.showFavicons) type = 'letter';
  const letter = initialOf(item.title || domainOf(item.url));
  const color = item.color || hslFor(item.url || item.title, 58, 48);
  if (type === 'emoji') return '<div class="dock-icon emoji"><span>' + esc(item.icon || '⭐') + '</span></div>';
  if (type === 'letter') return '<div class="dock-icon" style="background:' + esc(color) + '">' + esc(letter) + '</div>';
  if (type === 'url' && item.icon) return '<div class="dock-icon"><img src="' + esc(item.icon) + '" alt="" loading="lazy" onerror="this.remove()"></div>';
  const src = faviconUrl(item.url, st.faviconService);
  if (!src) return '<div class="dock-icon" style="background:' + esc(color) + '">' + esc(letter) + '</div>';
  return '<div class="dock-icon favicon">' +
    '<span class="fb" style="background:' + esc(color) + '">' + esc(letter) + '</span>' +
    '<img src="' + esc(src) + '" alt="" loading="lazy" referrerpolicy="no-referrer" ' +
      'onload="this.parentNode.classList.add(\'loaded\')" onerror="this.remove()">' +
    '</div>';
}

/* ============================================================
   12. Render
   ============================================================ */
function folderGlyph(f, size) {
  const emoji = f && f.emoji;
  if (!emoji || emoji === '📁' || emoji === '📂') {
    const col = (f && f.color) || '';
    return '<span class="f-ico" style="' + (col ? 'color:' + esc(col) : '') + '">' + icon('folder', size || 16) + '</span>';
  }
  return '<span class="emoji-font">' + esc(emoji) + '</span>';
}
let rendering = false;
function render() {
  if (rendering) return;
  rendering = true;
  try {
    renderSidebar();
    renderDock();
    renderContent();
    renderSelectionBar();
    updateSyncPill();
  } catch (e) {
    console.error('render failed', e);
  } finally {
    rendering = false;
  }
}

/* ---------- sidebar ---------- */
function renderSidebar() {
  const root = $('#sideScroll');
  if (!root) return;
  const counts = {
    all: activeBookmarks().length,
    favorites: activeBookmarks().filter((b) => b.favorite).length,
    recent: activeBookmarks().filter(isRecent).length,
    popular: activeBookmarks().filter((b) => b.clicks > 0).length,
    archive: state.bookmarks.filter((b) => b.archived).length,
    trash: state.trash.length
  };
  const nav = (view, ic, label, count) =>
    '<button type="button" class="nav-item ' + (ui.view === view ? 'active' : '') + '" data-act="nav" data-view="' + view + '">' +
      '<span class="ico">' + icon(ic, 17) + '</span>' +
      '<span class="name">' + esc(label) + '</span>' +
      (count ? '<span class="cnt">' + count + '</span>' : '') +
    '</button>';

  let html = '<div class="side-section">' +
    nav('all', 'stack', 'Все закладки', counts.all) +
    nav('favorites', 'star', 'Избранное', counts.favorites) +
    nav('recent', 'clock', 'Недавние', counts.recent) +
    nav('popular', 'fire', 'Часто открываю', counts.popular) +
    nav('archive', 'archive', 'Архив', counts.archive) +
    (counts.trash ? nav('trash', 'trash', 'Корзина', counts.trash) : '') +
    '</div>';

  html += '<div class="side-section">' +
    '<div class="side-title">Папки' +
      '<span class="count">' + state.folders.length + '</span>' +
      '<button type="button" class="icon-btn small" data-act="new-folder" title="Новая папка" style="margin-left:4px">' + icon('plus', 15) + '</button>' +
    '</div>' +
    '<div class="tree">' + treeHTML(null, 0) + '</div>' +
    '<button type="button" class="side-add" data-act="new-folder">' + icon('folderPlus', 15) + ' Новая папка</button>' +
  '</div>';

  const tags = allTags();
  if (tags.length) {
    html += '<div class="side-section">' +
      '<div class="side-title">Теги<span class="count">' + tags.length + '</span></div>' +
      '<div class="tag-cloud">' +
        tags.slice(0, 40).map(([t, n]) =>
          '<button type="button" class="tag-pill ' + (ui.view === 'tag' && ui.tag === t ? 'active' : '') + '" data-act="tag" data-tag="' + esc(t) + '" title="' + esc(t) + ' · ' + n + '">' +
            '<span>' + esc(t) + '</span><span class="n">' + n + '</span>' +
          '</button>').join('') +
      '</div>' +
    '</div>';
  }
  root.innerHTML = html;

  const bytes = new Blob([JSON.stringify(state)]).size;
  const limit = 5 * 1024 * 1024;
  $('#storageBar').style.width = clamp((bytes / limit) * 100, 1.5, 100) + '%';
  $('#storageLabel').innerHTML = '<span>' + fmtBytes(bytes) + ' локально</span><span>' + fmtBytes(limit) + '</span>';
}

function treeHTML(parentId, depth) {
  const kids = childFolders(parentId);
  if (!kids.length) return depth === 0 ? '<div class="tree-empty">Пока нет папок</div>' : '';
  return kids.map((f) => {
    const hasKids = state.folders.some((x) => x.parentId === f.id);
    const collapsed = ui.collapsed.has(f.id);
    const active = ui.view === 'folder' && ui.folderId === f.id;
    const count = folderStats(f.id).direct;
    return '<div class="tree-node ' + (collapsed ? '' : 'open') + '" data-folder-row="' + f.id + '">' +
      '<div class="tree-row">' +
        '<button type="button" class="nav-item ' + (active ? 'active' : '') + '" data-act="open-folder" data-id="' + f.id + '" draggable="true" title="' + esc(folderPath(f.id).map((x) => x.name).join(' / ')) + '">' +
          (hasKids
            ? '<span class="caret" data-act="toggle-folder" data-id="' + f.id + '">' + icon('chevronRight', 13) + '</span>'
            : '<span class="caret" style="opacity:0">' + icon('chevronRight', 13) + '</span>') +
          '<span class="folder-emoji">' + folderGlyph(f, 16) + '</span>' +
          '<span class="name">' + esc(f.name) + '</span>' +
          (count ? '<span class="cnt">' + count + '</span>' : '') +
          '<span class="more" data-act="folder-menu" data-id="' + f.id + '" role="button" aria-label="Меню папки">' + icon('more', 14) + '</span>' +
        '</button>' +
      '</div>' +
      (hasKids && !collapsed ? '<div class="tree-children">' + treeHTML(f.id, depth + 1) + '</div>' : '') +
    '</div>';
  }).join('');
}

/* ---------- dock ---------- */
function renderDock() {
  const root = $('#dock');
  if (!root) return;
  const items = state.dock.slice().sort((a, b) => a.order - b.order);
  const label = $('#dockLabel');
  if (label) {
    label.innerHTML = '<span>Быстрый доступ</span><span class="n">' + items.length + '</span>' +
      '<button type="button" data-act="dock-add">' + icon('plus', 13) + ' Добавить</button>';
  }
  root.innerHTML = items.map((it) =>
    '<div class="dock-tile" data-act="dock-open" data-id="' + it.id + '" draggable="true" title="' + esc(it.title + '\n' + it.url) + '">' +
      '<span class="edit" data-act="dock-edit" data-id="' + it.id + '">' + icon('pencil', 10) + '</span>' +
      dockIconHTML(it) +
      '<span class="t">' + esc(it.title) + '</span>' +
    '</div>'
  ).join('') +
  '<div class="dock-tile add" data-act="dock-add" title="Добавить быструю ссылку">' +
    '<div class="dock-icon">' + icon('plus', 18) + '</div><span class="t">Добавить</span>' +
  '</div>' +
  (items.length === 0 ? '<div class="dock-empty">Сюда можно перетащить закладку — она станет быстрой кнопкой</div>' : '');
}

/* ---------- content ---------- */
function renderContent() {
  const root = $('#content');
  if (!root) return;
  const scrollTop = root.scrollTop;
  const info = viewTitle();
  const list = currentBookmarks();
  const q = ui.query.trim();
  const st = state.settings;
  const isListView = st.view === 'list';

  /* header */
  let head = '<div class="content-head"><div class="head-main">';
  const path = info.folder ? folderPath(info.folder.id) : [];
  head += '<div class="breadcrumb">' + (path.length
    ? '<button type="button" data-act="nav" data-view="all">Библиотека</button>' +
      path.map((f, i) => '<span class="sep">/</span><button type="button" data-act="open-folder" data-id="' + f.id + '">' + esc(f.name) + '</button>').join('')
    : '<span>Библиотека</span><span class="sep">/</span><span>' + esc(info.t) + '</span>') +
  '</div>';
  head += '<h1>' +
    (info.folder
      ? '<span class="emoji" style="' + (info.folder.color ? 'color:' + esc(info.folder.color) : 'color:var(--accent)') + '">' + folderGlyph(info.folder, 20) + '</span>'
      : '<span class="h-ico">' + icon(info.icon || 'stack', 20) + '</span>') +
    '<span>' + esc(info.t) + '</span>' +
    '<span class="chip ' + (q ? 'accent' : 'muted') + '">' + list.length + '</span>' +
    '</h1>';
  const subs = [];
  if (q) subs.push('поиск: «' + esc(q) + '»');
  if (info.folder) {
    const direct = folderStats(info.folder.id);
    subs.push(direct.direct + ' закладок');
    if (direct.kids) subs.push(direct.kids + ' вложенных папок');
  } else {
    subs.push(state.folders.length + ' папок · ' + activeBookmarks().length + ' закладок');
  }
  if (ui.view === 'trash') subs.push('Удалённое хранится только здесь');
  if (ui.view === 'archive') subs.push('Скрыто с глаз, но под рукой');
  if (subs.length) head += '<div class="head-sub">' + subs.join(' · ') + '</div>';
  head += '</div>';

  head += '<div class="head-actions">';
  head += '<select class="sort-select" data-act="sort" aria-label="Сортировка">' +
    SORTS.map((s) => '<option value="' + s.id + '"' + (ui.sort === s.id ? ' selected' : '') + '>' + esc(s.label) + '</option>').join('') +
    '</select>';
  head += '<button type="button" class="btn sm ' + (ui.selectMode ? 'primary' : '') + '" data-act="select-mode" title="Режим выделения: клик выбирает закладки"' + (ui.selectMode ? ' aria-pressed="true"' : '') + '>' +
    icon('check', 14) + '<span class="cmd-extra">' + (ui.selectMode ? 'Готово' : 'Выбрать') + '</span></button>';
  head += '<div class="seg" role="group" aria-label="Вид">' +
    '<button type="button" class="' + (!isListView ? 'active' : '') + '" data-act="set-view" data-mode="grid" title="Сетка">' + icon('grid', 15) + '</button>' +
    '<button type="button" class="' + (isListView ? 'active' : '') + '" data-act="set-view" data-mode="list" title="Список">' + icon('list', 15) + '</button>' +
    '</div>';
  if (ui.view === 'folder') {
    head += '<button type="button" class="icon-btn" data-act="folder-menu" data-id="' + ui.folderId + '" title="Настройки папки" aria-label="Настройки папки">' + icon('sliders', 17) + '</button>';
  }
  if (ui.view !== 'trash') {
    head += '<button type="button" class="icon-btn" data-act="new-folder" title="Новая папка (Ctrl+Shift+N)" aria-label="Новая папка">' + icon('folderPlus', 17) + '</button>';
    head += '<button type="button" class="btn sm primary" data-act="new-bm">' + icon('plus', 14) + '<span class="cmd-extra">Закладка</span></button>';
  } else {
    head += '<button type="button" class="btn sm" data-act="trash-empty">' + icon('trash', 14) + 'Очистить</button>';
  }
  head += '</div></div>';

  if (ui.selectMode) {
    head += '<div class="filter-bar">' + icon('check', 14) +
      '<span>Режим выделения: кликайте карточки, чтобы выбрать несколько. Затем — действия внизу экрана.</span>' +
      '<button type="button" class="btn sm ghost" data-act="select-mode" style="margin-left:auto">Выйти</button></div>';
  }
  if (q) {
    head += '<div class="filter-bar">' + icon('search', 14) + '<span>Найдено <b>' + list.length + '</b> по запросу «<b>' + esc(q) + '</b>»</span>' +
      '<button type="button" class="btn sm ghost" data-act="clear-search" style="margin-left:auto">' + icon('x', 12) + 'Сбросить</button></div>';
  }

  let body = '';

  /* child folders */
  const showFolders = !q && (ui.view === 'all' || ui.view === 'folder');
  if (showFolders) {
    const kids = childFolders(ui.view === 'folder' ? ui.folderId : null);
    if (kids.length) {
      body += '<div class="section-label">Папки <span class="line"></span><span style="letter-spacing:0;text-transform:none;font-weight:600">' + kids.length + '</span></div>' +
        '<div class="folders-grid">' + kids.map((f) => {
          const s = folderStats(f.id);
          return '<div class="folder-card" data-act="open-folder" data-id="' + f.id + '" draggable="true" title="' + esc(folderPath(f.id).map((x) => x.name).join(' / ')) + '">' +
            '<div class="fc-icon" style="background:' + esc(f.color ? 'color-mix(in srgb, ' + f.color + ' 20%, transparent)' : 'rgba(108,140,255,.12)') + ';color:' + esc(f.color || 'var(--accent)') + '">' + folderGlyph(f, 19) + '</div>' +
            '<div class="fc-body"><div class="fc-title">' + esc(f.name) + '</div>' +
              '<div class="fc-meta">' + s.direct + ' закл.' + (s.kids ? ' · ' + s.kids + ' пап.' : '') + '</div></div>' +
            '<button type="button" class="icon-btn small more" data-act="folder-menu" data-id="' + f.id + '" aria-label="Меню папки">' + icon('more', 15) + '</button>' +
          '</div>';
        }).join('') + '</div>';
    } else if (ui.view === 'folder') {
      body += '<div class="section-label">Вложенные папки <span class="line"></span></div>' +
        '<div style="color:var(--muted);font-size:12.5px;margin:-2px 0 16px 2px">Пока пусто — можно создать вложенную папку.</div>';
    }
  }

  /* bookmarks */
  if (list.length) {
    const showHead = showFolders && childFolders(ui.view === 'folder' ? ui.folderId : null).length > 0;
    const label = ui.view === 'trash' ? 'Удалённые' : (ui.view === 'archive' ? 'В архиве' : (showHead ? 'Закладки' : ''));
    if (label) body += '<div class="section-label">' + label + ' <span class="line"></span><span style="letter-spacing:0;text-transform:none;font-weight:600">' + list.length + '</span></div>';
    const visible = list.slice(0, ui.limit);
    body += '<div class="' + (isListView ? 'bookmarks-list' : 'bookmarks-grid') + '" data-drop-list="1">' +
      visible.map((b) => bookmarkHTML(b, q, isListView)).join('') + '</div>';
    if (list.length > visible.length) {
      body += '<div style="display:flex;justify-content:center;padding:18px 0 4px">' +
        '<button type="button" class="btn" data-act="show-more">' + icon('chevronDown', 14) +
        'Показать ещё ' + Math.min(320, list.length - visible.length) + ' из ' + list.length + '</button></div>';
    }
  } else {
    body += emptyStateHTML();
  }

  root.innerHTML = head + body;
  root.scrollTop = scrollTop;

  /* drag & drop affordances */
  attachDnD(root);
}

function bookmarkHTML(b, q, isList) {
  const selected = ui.selection.has(b.id);
  const tags = (b.tags || []).slice(0, 4);
  const dom = domainOf(b.url);
  const path = folderPath(b.folderId);
  const isTrash = ui.view === 'trash';
  const meta = isTrash ? ('удалено ' + fmtRel(b.deletedAt)) : fmtRel(b.createdAt);
  return '<article class="bookmark ' + (selected ? 'selected' : '') + '" data-act="open-bm" data-id="' + esc(b.id) + '" tabindex="0" draggable="' + (!isTrash) + '" ' +
    'aria-label="' + esc(b.title) + '" title="' + esc(b.title + '\n' + b.url + (path.length ? '\n📁 ' + path.map((f) => f.name).join(' / ') : '')) + '">' +
    (b.favorite ? '<span class="pin-flag"></span>' : '') +
    '<button type="button" class="star-btn ' + (b.favorite ? 'on' : '') + '" data-act="bm-star" data-id="' + esc(b.id) + '" aria-label="В избранное">' + icon('star', 14) + '</button>' +
    '<div class="bm-top">' + bmIconHTML(b) +
      '<div class="bm-head">' +
        '<div class="bm-title">' + hl(b.title, q) + '</div>' +
        '<div class="bm-domain">' + icon('link', 11) + '<span>' + esc(dom) + '</span></div>' +
      '</div>' +
    '</div>' +
    (b.description ? '<div class="bm-desc">' + hl(b.description, q) + '</div>' : '') +
    (tags.length ? '<div class="bm-tags">' + tags.map((t) => '<span class="bm-tag" style="color:' + tagColor(t) + '">#' + esc(t) + '</span>').join('') +
      ((b.tags || []).length > 4 ? '<span class="bm-tag">+' + ((b.tags || []).length - 4) + '</span>' : '') + '</div>' : '') +
    '<div class="bm-foot">' +
      '<span class="date" title="' + esc(fmtDate(b.createdAt)) + '">' + esc(meta) + (b.clicks ? ' · ' + b.clicks + ' откр.' : '') + '</span>' +
      '<div class="bm-actions">' +
        (isTrash
          ? '<button type="button" class="icon-btn" data-act="trash-restore" data-id="' + esc(b.id) + '" title="Восстановить">' + icon('restore', 14) + '</button>' +
            '<button type="button" class="icon-btn" data-act="trash-delete" data-id="' + esc(b.id) + '" title="Удалить навсегда">' + icon('trash', 14) + '</button>'
          : '<button type="button" class="icon-btn" data-act="bm-edit" data-id="' + esc(b.id) + '" title="Изменить">' + icon('pencil', 14) + '</button>' +
            '<button type="button" class="icon-btn" data-act="bm-menu" data-id="' + esc(b.id) + '" title="Ещё">' + icon('more', 14) + '</button>') +
      '</div>' +
    '</div>' +
  '</article>';
}

function emptyStateHTML() {
  const q = ui.query.trim();
  if (q) {
    return '<div class="empty"><div class="art">' + icon('search', 30) + '</div>' +
      '<h3>Ничего не нашлось</h3><p>По запросу «' + esc(q) + '» пусто. Попробуйте другое слово или создайте закладку с этим названием.</p>' +
      '<div class="row"><button type="button" class="btn" data-act="clear-search">Сбросить поиск</button>' +
      '<button type="button" class="btn primary" data-act="new-bm">' + icon('plus', 14) + 'Новая закладка</button></div></div>';
  }
  if (ui.view === 'trash') {
    return '<div class="empty"><div class="art">' + icon('trash', 30) + '</div><h3>Корзина пуста</h3><p>Удалённые закладки попадают сюда — их можно восстановить.</p></div>';
  }
  if (ui.view === 'archive') {
    return '<div class="empty"><div class="art">' + icon('archive', 30) + '</div><h3>Архив пуст</h3><p>Отправляйте сюда закладки, которые пока не нужны, но жалко удалять.</p></div>';
  }
  if (ui.view === 'favorites') {
    return '<div class="empty"><div class="art">' + icon('star', 30) + '</div><h3>Избранного пока нет</h3><p>Нажмите звёздочку на любой закладке — она появится здесь и всегда будет под рукой.</p></div>';
  }
  if (ui.view === 'folder') {
    return '<div class="empty"><div class="art">' + icon('folder', 30) + '</div><h3>Папка пуста</h3>' +
      '<p>Добавьте закладку, перетащите существующую сюда или создайте вложенную папку.</p>' +
      '<div class="row"><button type="button" class="btn primary" data-act="new-bm">' + icon('plus', 14) + 'Добавить закладку</button>' +
      '<button type="button" class="btn" data-act="new-folder">' + icon('folderPlus', 14) + 'Вложенная папка</button></div></div>';
  }
  if (ui.view === 'popular') {
    return '<div class="empty"><div class="art">' + icon('fire', 30) + '</div><h3>Статистика копится</h3><p>Открывайте закладки — здесь появятся самые частые.</p></div>';
  }
  if (ui.view === 'all') {
    return '<div class="empty"><div class="art">' + icon('sparkles', 30) + '</div><h3>Библиотека пуста</h3>' +
      '<p>Создайте первую закладку или папку. Данные хранятся локально и могут синхронизироваться с JSON-файлом на диске.</p>' +
      '<div class="row"><button type="button" class="btn primary" data-act="new-bm">' + icon('plus', 14) + 'Новая закладка</button>' +
      '<button type="button" class="btn" data-act="new-folder">' + icon('folderPlus', 14) + 'Новая папка</button>' +
      '<button type="button" class="btn" data-act="load-demo">' + icon('sparkles', 14) + 'Загрузить примеры</button></div></div>';
  }
  return '<div class="empty"><div class="art">' + icon('book', 30) + '</div><h3>Пока пусто</h3>' +
    '<p>Добавьте закладки, чтобы эта коллекция наполнилась.</p>' +
    '<div class="row"><button type="button" class="btn primary" data-act="new-bm">' + icon('plus', 14) + 'Новая закладка</button></div></div>';
}

/* ---------- selection bar ---------- */
function renderSelectionBar() {
  let bar = $('#selectBar');
  const n = ui.selection.size;
  if (!n) { if (bar) bar.remove(); return; }
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'selectBar';
    bar.className = 'select-bar';
    document.body.appendChild(bar);
  }
  bar.innerHTML =
    '<span class="count">Выбрано: ' + n + '</span>' +
    '<span class="sep"></span>' +
    '<button type="button" class="btn sm" data-act="sel-open">' + icon('external', 13) + 'Открыть</button>' +
    '<button type="button" class="btn sm" data-act="sel-star">' + icon('star', 13) + 'В избранное</button>' +
    '<button type="button" class="btn sm" data-act="sel-move">' + icon('folder', 13) + 'В папку</button>' +
    '<button type="button" class="btn sm" data-act="sel-archive">' + icon('archive', 13) + 'В архив</button>' +
    '<button type="button" class="btn sm danger" data-act="sel-delete">' + icon('trash', 13) + 'Удалить</button>' +
    '<span class="sep"></span>' +
    '<button type="button" class="icon-btn small" data-act="sel-clear" title="Снять выделение">' + icon('x', 15) + '</button>';
}

/* ---------- sync pill ---------- */
function updateSyncPill() {
  const pill = $('#syncPill');
  if (!pill) return;
  const st = state.settings;
  let cls = '';
  let label = '';
  let title = '';
  if (fileState.mode === 'on' && fileHandle) {
    cls = 'on';
    label = fileState.busy ? 'Сохранение…' : (fileState.name || 'JSON файл');
    title = 'Связано с файлом: ' + (fileState.name || '') + (fileState.lastSaved ? '\nПоследнее сохранение: ' + fmtDate(fileState.lastSaved) : '') + '\nКаждое изменение автоматически записывается в этот файл.';
  } else if (fileState.mode === 'ask') {
    cls = 'warn';
    label = 'Разрешить запись';
    title = 'Браузер ждёт подтверждения доступа к файлу. Нажмите, чтобы разрешить.';
  } else if (!('showSaveFilePicker' in window) || inFrame) {
    cls = '';
    label = 'Автосохранение';
    title = inFrame
      ? 'В предпросмотре браузер запрещает запись в файл. Скачайте HTML и откройте его локально — тогда можно подключить JSON.'
      : 'Этот браузер не умеет писать в файл напрямую. Используйте кнопку «Скачать JSON».';
  } else {
    label = st.autoBackup ? 'Локально' : 'Не сохраняется';
    title = st.autoBackup ? 'Данные в localStorage. Подключите JSON-файл, чтобы хранить их на диске.' : 'Автосохранение отключено.';
  }
  pill.className = 'sync-pill ' + cls;
  pill.setAttribute('title', title);
  pill.innerHTML = '<span class="dot"></span><span class="label">' + esc(label) + '</span>';
}

/* ============================================================
   13. Actions — bookmarks, folders, dock
   ============================================================ */
function nextOrder(folderId) {
  const arr = state.bookmarks.filter((b) => b.folderId === folderId);
  return arr.length ? Math.max.apply(null, arr.map((b) => b.order || 0)) + 1 : 0;
}
function reindexBookmarks(folderId) {
  const arr = state.bookmarks.filter((b) => b.folderId === folderId).sort((a, b) => a.order - b.order);
  arr.forEach((b, i) => { b.order = i; });
}
function reindexFolders(parentId) {
  const arr = childFolders(parentId);
  arr.forEach((f, i) => { f.order = i; });
}
function moveBookmark(id, folderId, targetId, after) {
  const bm = bookmarkById(id);
  if (!bm) return;
  const oldFolder = bm.folderId;
  const target = state.bookmarks.filter((b) => b.folderId === folderId && b.id !== id).sort((a, b) => a.order - b.order);
  let idx = target.length;
  if (targetId) {
    const ti = target.findIndex((b) => b.id === targetId);
    if (ti >= 0) idx = ti + (after ? 1 : 0);
  }
  target.splice(idx, 0, bm);
  bm.folderId = folderId;
  bm.updatedAt = Date.now();
  target.forEach((b, i) => { b.order = i; });
  if (oldFolder !== folderId) reindexBookmarks(oldFolder);
}
function moveFolder(id, parentId, targetId, after) {
  const f = folderById(id);
  if (!f || id === parentId || descendantIds(id).includes(parentId)) return false;
  const oldParent = f.parentId;
  const target = childFolders(parentId).filter((x) => x.id !== id);
  let idx = target.length;
  if (targetId) {
    const ti = target.findIndex((x) => x.id === targetId);
    if (ti >= 0) idx = ti + (after ? 1 : 0);
  }
  target.splice(idx, 0, f);
  f.parentId = parentId;
  target.forEach((x, i) => { x.order = i; });
  if (oldParent !== parentId) reindexFolders(oldParent);
  return true;
}
function openBookmark(id, forceNewTab) {
  const bm = bookmarkById(id);
  if (!bm) return;
  if (!isSafeUrl(bm.url)) { toast('Эта ссылка заблокирована из соображений безопасности', { type: 'error' }); return; }
  bm.clicks = (bm.clicks || 0) + 1;
  bm.lastOpened = Date.now();
  saveAll();
  const newTab = forceNewTab === undefined ? state.settings.openNewTab : forceNewTab;
  try {
    if (newTab) window.open(bm.url, '_blank', 'noopener');
    else window.location.href = bm.url;
  } catch (e) { toast('Не удалось открыть ссылку', { type: 'error' }); }
  if (ui.view === 'popular' || ui.view === 'recent') render();
}
function createBookmark(data) {
  const folderId = data.folderId || null;
  const now = Date.now();
  const bm = {
    id: uid('b'),
    title: (data.title || domainOf(data.url) || 'Без названия').trim().slice(0, 300),
    url: normalizeUrl(data.url),
    description: (data.description || '').slice(0, 2000),
    notes: (data.notes || '').slice(0, 4000),
    tags: (data.tags || []).map((t) => String(t).trim()).filter(Boolean).slice(0, 20),
    folderId,
    favorite: !!data.favorite,
    archived: !!data.archived,
    iconType: data.iconType || 'favicon',
    icon: data.icon || '',
    color: data.color || '',
    clicks: 0,
    createdAt: now,
    updatedAt: now,
    lastOpened: 0,
    order: nextOrder(folderId)
  };
  state.bookmarks.push(bm);
  return bm;
}
function patchBookmark(id, patch) {
  const bm = bookmarkById(id);
  if (!bm) return;
  const oldFolder = bm.folderId;
  if (patch.url !== undefined) patch.url = normalizeUrl(patch.url);
  Object.assign(bm, patch, { updatedAt: Date.now() });
  if (patch.folderId !== undefined && patch.folderId !== oldFolder) {
    bm.order = nextOrder(bm.folderId);
    reindexBookmarks(oldFolder);
  }
  if (patch.favorite || patch.archived || patch.clicks) saveAll(); else saveAll();
}
function trashBookmarks(ids) {
  const set = new Set(ids);
  const moved = state.bookmarks.filter((b) => set.has(b.id));
  if (!moved.length) return 0;
  state.bookmarks = state.bookmarks.filter((b) => !set.has(b.id));
  moved.forEach((b) => { b.deletedAt = Date.now(); state.trash.unshift(b); });
  [...new Set(moved.map((b) => b.folderId))].forEach(reindexBookmarks);
  return moved.length;
}
function archiveBookmarks(ids, archived) {
  const set = new Set(ids);
  let n = 0;
  state.bookmarks.forEach((b) => {
    if (set.has(b.id) && !!b.archived !== archived) { b.archived = archived; b.updatedAt = Date.now(); n++; }
  });
  return n;
}
function uniqueFilename(base) {
  const d = new Date();
  const stamp = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  return base + '-' + stamp;
}
function downloadBlob(content, filename, type) {
  const blob = new Blob([content], { type: type || 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
function downloadJSON() {
  downloadBlob(JSON.stringify(dataPayload(), null, 2), uniqueFilename('bookmarks') + '.json', 'application/json');
  toast('JSON скачан в загрузки', { type: 'success', icon: 'download' });
}

/* ============================================================
   14. Dialogs — bookmark / folder / dock
   ============================================================ */
function folderOptionsHTML(selected, excludeId) {
  const blocked = excludeId ? new Set(descendantIds(excludeId)) : new Set();
  let out = '<option value="">Без папки (корень)</option>';
  (function walk(parentId, depth) {
    childFolders(parentId).forEach((f) => {
      if (blocked.has(f.id)) return;
      out += '<option value="' + esc(f.id) + '"' + (selected === f.id ? ' selected' : '') + '>' +
        '\u00a0\u00a0'.repeat(depth) + (depth ? '└ ' : '') + (f.emoji ? f.emoji + ' ' : '') + esc(f.name) + '</option>';
      walk(f.id, depth + 1);
    });
  })(null, 0);
  return out;
}
function iconEditorHTML(prefix, seed) {
  const s = seed || {};
  const type = s.iconType || 'favicon';
  const tabs = [['favicon', 'Фавикон'], ['letter', 'Буква'], ['emoji', 'Эмодзи'], ['url', 'Ссылка']];
  return '<div class="icon-editor" data-icon-editor="' + prefix + '" data-type="' + esc(type) + '">' +
    '<div class="icon-preview-row">' +
      '<div class="icon-preview" data-iprev></div>' +
      '<div style="flex:1;min-width:0">' +
        '<div class="icon-type-tabs">' + tabs.map(([t, l]) => '<button type="button" data-it="' + t + '" class="' + (type === t ? 'active' : '') + '">' + l + '</button>').join('') + '</div>' +
        '<div data-pane="favicon" class="hint" style="margin-top:2px">Иконка сайта подгружается из интернета (если сайт её отдаёт).</div>' +
        '<div data-pane="letter" class="hint" style="margin-top:2px">Первая буква названия на выбранном цвете.</div>' +
        '<div data-pane="emoji"><div class="emoji-grid" style="max-height:96px">' +
          EMOJIS.map((e) => '<button type="button" data-emoji="' + e + '" title="' + e + '">' + e + '</button>').join('') +
        '</div></div>' +
        '<div data-pane="url"><input class="input" data-icon-url placeholder="https://example.com/icon.png" value="' + esc(s.iconType === 'url' ? s.icon || '' : '') + '" style="height:32px"></div>' +
      '</div>' +
    '</div>' +
    '<div class="swatches" style="margin-top:10px">' +
      '<button type="button" class="swatch auto ' + (!s.color ? 'active' : '') + '" data-color="" title="Авто"></button>' +
      ACCENTS.map((c) => '<button type="button" class="swatch ' + (s.color === c ? 'active' : '') + '" style="background:' + c + '" data-color="' + c + '"></button>').join('') +
      '<input type="color" data-color-custom value="' + esc(s.color || '#6c8cff') + '" title="Свой цвет">' +
    '</div>' +
  '</div>';
}
function wireIconEditor(root, getMeta) {
  const ed = root.querySelector('[data-icon-editor]');
  if (!ed) return { get: () => ({}), refresh: () => {} };
  let type = ed.dataset.type || 'favicon';
  let color = ed.querySelector('[data-color].active') ? ed.querySelector('[data-color].active').dataset.color : '';
  let emoji = (EMOJIS.find((e) => e === ed.querySelector('[data-emoji].active')?.dataset.emoji) || ed.dataset.emoji || '') || '';
  const urlField = ed.querySelector('[data-icon-url]');
  const custom = ed.querySelector('[data-color-custom]');
  const prev = ed.querySelector('[data-iprev]');
  let iconUrlType = '';

  function syncPanes() {
    $$('[data-pane]', ed).forEach((p) => { p.style.display = p.dataset.pane === type ? '' : 'none'; });
    $$('[data-it]', ed).forEach((b) => b.classList.toggle('active', b.dataset.it === type));
    $$('[data-color]', ed).forEach((b) => b.classList.toggle('active', (b.dataset.color || '') === color));
    $$('[data-emoji]', ed).forEach((b) => b.classList.toggle('active', b.dataset.emoji === emoji));
    ed.dataset.type = type;
    paint();
  }
  function paint() {
    const meta = getMeta ? getMeta() : { title: '', url: '' };
    const fake = {
      title: meta.title || 'X', url: meta.url || '', color,
      iconType: type, icon: type === 'emoji' ? emoji : (type === 'url' ? (urlField ? urlField.value.trim() : '') : '')
    };
    prev.className = 'icon-preview';
    prev.innerHTML = bmIconHTML(fake);
  }
  ed.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-it]');
    if (tab) { type = tab.dataset.it; syncPanes(); return; }
    const col = e.target.closest('[data-color]');
    if (col) {
      color = col.dataset.color;
      if (color && custom) custom.value = color;
      syncPanes(); return;
    }
    const em = e.target.closest('[data-emoji]');
    if (em) { emoji = em.dataset.emoji; type = 'emoji'; syncPanes(); return; }
  });
  if (urlField) urlField.addEventListener('input', paint);
  if (custom) custom.addEventListener('input', () => {
    color = custom.value;
    $$('[data-color]', ed).forEach((b) => b.classList.remove('active'));
    paint();
  });
  // preselect existing emoji
  const cur = getMeta && getMeta();
  if (ed.dataset.icon) { emoji = ed.dataset.icon; }
  if (cur && cur.icon && type === 'emoji') emoji = cur.icon;
  syncPanes();
  return {
    get: () => ({
      iconType: type,
      icon: type === 'emoji' ? emoji : (type === 'url' ? (urlField ? urlField.value.trim() : '') : ''),
      color
    }),
    refresh: syncPanes
  };
}

function parseTags(str) {
  return String(str || '').split(/[,;]+/).map((s) => s.trim().replace(/^#/, '')).filter(Boolean).slice(0, 20);
}

function bookmarkDialog(opts) {
  const o = opts || {};
  const editing = o.bookmarkId ? bookmarkById(o.bookmarkId) : null;
  const seed = editing || {
    title: o.title || '', url: o.url || '', description: '', tags: [], folderId: o.folderId !== undefined ? o.folderId : (ui.view === 'folder' ? ui.folderId : null),
    favorite: false, iconType: 'favicon', icon: '', color: ''
  };
  const isNew = !editing;
  const allTagList = allTags().map(([t]) => t);
  const body =
    '<div class="field"><label for="bmUrl">Адрес</label>' +
      '<input class="input" id="bmUrl" data-field="url" placeholder="example.com/страница" value="' + esc(seed.url) + '" autocomplete="off" spellcheck="false">' +
      '<div class="url-preview" data-url-preview></div>' +
    '</div>' +
    '<div class="field"><label for="bmTitle">Название</label>' +
      '<input class="input" id="bmTitle" data-field="title" placeholder="Как назвать закладку" value="' + esc(seed.title) + '">' +
    '</div>' +
    '<div class="field"><label for="bmDesc">Описание</label>' +
      '<textarea class="textarea" id="bmDesc" data-field="description" placeholder="Зачем это нужно? Пара слов для будущего себя." style="min-height:60px">' + esc(seed.description || '') + '</textarea>' +
    '</div>' +
    '<div class="field-row">' +
      '<div class="field"><label for="bmFolder">Папка</label><select class="input" id="bmFolder" data-field="folderId">' + folderOptionsHTML(seed.folderId, null) + '</select></div>' +
      '<div class="field"><label for="bmTags">Теги</label>' +
        '<input class="input" id="bmTags" data-field="tags" placeholder="работа, читать" value="' + esc((seed.tags || []).join(', ')) + '" list="tagList">' +
        '<datalist id="tagList">' + allTagList.map((t) => '<option value="' + esc(t) + '">').join('') + '</datalist>' +
      '</div>' +
    '</div>' +
    '<div class="set-row" style="padding:2px 0 6px">' +
      '<div class="set-text"><div class="set-name">В избранное</div><div class="set-desc">Показывать в разделе «Избранное»</div></div>' +
      '<button type="button" class="switch ' + (seed.favorite ? 'on' : '') + '" data-fav-toggle aria-label="Избранное"></button>' +
    '</div>' +
    (isNew ? '<input type="hidden" data-new="1">' : '') +
    '<div class="field" style="margin-top:6px"><span class="field-label">Иконка и цвет</span>' + iconEditorHTML('bm', seed) + '</div>';

  const footer =
    '<div class="left">' +
      (editing ? '<button type="button" class="icon-btn small" data-act-inline="open" title="Открыть">' + icon('external', 15) + '</button>' +
        '<button type="button" class="icon-btn small" data-act-inline="copy" title="Копировать ссылку">' + icon('copy', 15) + '</button>' : '') +
    '</div>' +
    '<button type="button" class="btn" data-cancel>Отмена</button>' +
    '<button type="button" class="btn primary" data-save>' + (editing ? 'Сохранить' : 'Добавить закладку') + '</button>';

  const entry = openModal({
    title: editing ? 'Редактировать закладку' : 'Новая закладка',
    subtitle: editing ? 'Изменения сохранятся автоматически' : 'Ctrl + Enter — быстрое сохранение',
    body, footer, wide: true
  });
  const modal = entry.modal;
  const urlIn = $('[data-field="url"]', modal);
  const titleIn = $('[data-field="title"]', modal);
  const favToggle = $('[data-fav-toggle]', modal);
  const editor = wireIconEditor(modal, () => ({ title: titleIn.value, url: urlIn.value, icon: seed.icon }));
  editor.refresh();

  function updatePreview() {
    const raw = urlIn.value.trim();
    const prev = $('[data-url-preview]', modal);
    if (!raw) { prev.innerHTML = ''; return; }
    const norm = normalizeUrl(raw);
    const host = domainOf(norm);
    const fav = faviconUrl(norm, state.settings.faviconService);
    prev.innerHTML = (fav ? '<img src="' + esc(fav) + '" alt="">' : '') + '<span>' + esc(host) + '</span>';
  }
  urlIn.addEventListener('input', () => { urlIn.classList.remove('invalid'); updatePreview(); editor.refresh(); });
  titleIn.addEventListener('input', () => editor.refresh());
  updatePreview();
  favToggle.addEventListener('click', () => favToggle.classList.toggle('on'));

  $('[data-cancel]', modal).addEventListener('click', entry.close);
  $$('[data-act-inline]', modal).forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.actInline === 'open' && editing) openBookmark(editing.id, true);
    if (b.dataset.actInline === 'copy' && editing) copyText(editing.url);
  }));

  function save() {
    const rawUrl = urlIn.value.trim();
    if (!rawUrl) {
      urlIn.classList.add('invalid'); urlIn.focus();
      toast('Укажите адрес закладки', { type: 'error' });
      return;
    }
    if (!isSafeUrl(rawUrl)) {
      urlIn.classList.add('invalid'); urlIn.focus();
      toast('Ссылки javascript:/data: не поддерживаются', { type: 'error' });
      return;
    }
    const iconData = editor.get();
    const payload = {
      url: normalizeUrl(rawUrl),
      title: titleIn.value.trim() || domainOf(rawUrl) || 'Без названия',
      description: $('[data-field="description"]', modal).value.trim(),
      tags: parseTags($('[data-field="tags"]', modal).value),
      folderId: $('[data-field="folderId"]', modal).value || null,
      favorite: favToggle.classList.contains('on'),
      iconType: iconData.iconType,
      icon: iconData.icon,
      color: iconData.color || ''
    };
    if (editing) {
      patchBookmark(editing.id, payload);
      saveAll({ snapshot: true });
      toast('Закладка обновлена', { type: 'success' });
    } else {
      const bm = createBookmark(payload);
      saveAll({ snapshot: true });
      toast('Закладка добавлена' + (payload.folderId ? ' в папку' : ''), {
        type: 'success', actionLabel: 'Отменить',
        onAction: () => { state.bookmarks = state.bookmarks.filter((b) => b.id !== bm.id); saveAll(); render(); }
      });
    }
    entry.close();
    render();
  }
  $('[data-save]', modal).addEventListener('click', save);
  modal.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); }
  });
  return entry;
}

function folderDialog(opts) {
  const o = opts || {};
  const editing = o.folderId ? folderById(o.folderId) : null;
  const seed = editing || { name: '', emoji: o.emoji || '📁', color: '', parentId: o.parentId !== undefined ? o.parentId : (ui.view === 'folder' ? ui.folderId : null) };
  let emoji = seed.emoji || '📁';
  let color = seed.color || '';
  const body =
    '<div class="field"><label for="fName">Название папки</label>' +
      '<input class="input" id="fName" data-field="name" placeholder="Например, «Надо посмотреть»" value="' + esc(seed.name) + '">' +
    '</div>' +
    '<div class="field"><label for="fParent">Где разместить</label>' +
      '<select class="input" id="fParent" data-field="parentId">' + folderOptionsHTML(seed.parentId, editing ? editing.id : null) + '</select>' +
    '</div>' +
    '<div class="field"><span class="field-label">Иконка папки</span>' +
      '<div class="emoji-grid">' + EMOJIS.map((e) => '<button type="button" data-emoji="' + e + '" class="' + (e === emoji ? 'active' : '') + '">' + e + '</button>').join('') + '</div>' +
    '</div>' +
    '<div class="field"><span class="field-label">Цвет</span>' +
      '<div class="swatches">' +
        '<button type="button" class="swatch auto ' + (!color ? 'active' : '') + '" data-color="" title="Без цвета"></button>' +
        ACCENTS.map((c) => '<button type="button" class="swatch ' + (color === c ? 'active' : '') + '" style="background:' + c + '" data-color="' + c + '"></button>').join('') +
      '</div>' +
    '</div>';
  const entry = openModal({
    title: editing ? 'Настройки папки' : 'Новая папка',
    subtitle: editing ? 'Внутри: ' + folderStats(editing.id).direct + ' закладок' : 'Папки можно вкладывать друг в друга',
    body,
    footer: '<div class="left"></div><button type="button" class="btn" data-cancel>Отмена</button>' +
      '<button type="button" class="btn primary" data-save>' + (editing ? 'Сохранить' : 'Создать папку') + '</button>'
  });
  const modal = entry.modal;
  const nameIn = $('[data-field="name"]', modal);
  modal.addEventListener('click', (e) => {
    const em = e.target.closest('[data-emoji]');
    if (em) {
      emoji = em.dataset.emoji;
      $$('[data-emoji]', modal).forEach((b) => b.classList.toggle('active', b === em));
    }
    const col = e.target.closest('[data-color]');
    if (col) {
      color = col.dataset.color;
      $$('[data-color]', modal).forEach((b) => b.classList.toggle('active', b === col));
    }
  });
  function save() {
    const name = nameIn.value.trim();
    if (!name) { nameIn.classList.add('invalid'); nameIn.focus(); toast('Введите название папки', { type: 'error' }); return; }
    const parentId = $('[data-field="parentId"]', modal).value || null;
    if (editing) {
      editing.name = name.slice(0, 120);
      editing.emoji = emoji;
      editing.color = color;
      if (parentId !== editing.parentId) {
        editing.parentId = parentId;
        editing.order = childFolders(parentId).length + 1;
        reindexFolders(parentId);
      }
      saveAll({ snapshot: true });
      toast('Папка обновлена', { type: 'success' });
    } else {
      const f = { id: uid('f'), name: name.slice(0, 120), parentId, emoji, color, order: nextFolderOrder(parentId), createdAt: Date.now() };
      state.folders.push(f);
      saveAll({ snapshot: true });
      ui.view = 'folder'; ui.folderId = f.id;
      toast('Папка «' + name + '» создана', { type: 'success' });
    }
    entry.close();
    render();
  }
  function nextFolderOrder(parentId) {
    const arr = childFolders(parentId);
    return arr.length ? Math.max.apply(null, arr.map((f) => f.order || 0)) + 1 : 0;
  }
  $('[data-save]', modal).addEventListener('click', save);
  nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
  return entry;
}

function dockDialog(opts) {
  const o = opts || {};
  const item = o.dockId ? state.dock.find((d) => d.id === o.dockId) : null;
  const seed = item || { title: o.title || '', url: o.url || '', iconType: 'favicon', icon: o.icon || '⭐', color: '' };
  const body =
    '<div class="field"><label for="dTitle">Название</label>' +
      '<input class="input" id="dTitle" data-field="title" placeholder="Например, Почта" value="' + esc(seed.title) + '">' +
    '</div>' +
    '<div class="field"><label for="dUrl">Адрес</label>' +
      '<input class="input" id="dUrl" data-field="url" placeholder="mail.google.com" value="' + esc(seed.url) + '" spellcheck="false">' +
    '</div>' +
    '<div class="field"><span class="field-label">Иконка</span>' + iconEditorHTML('dock', seed) + '</div>';
  const entry = openModal({
    title: item ? 'Изменить быструю ссылку' : 'Быстрая ссылка',
    subtitle: 'Кнопка на верхней панели для самых нужных сайтов',
    body,
    footer: (item ? '<div class="left"><button type="button" class="btn danger sm" data-del>' + icon('trash', 13) + 'Удалить</button></div>' : '<div class="left"></div>') +
      '<button type="button" class="btn" data-cancel>Отмена</button>' +
      '<button type="button" class="btn primary" data-save>' + (item ? 'Сохранить' : 'Добавить') + '</button>'
  });
  const modal = entry.modal;
  const titleIn = $('[data-field="title"]', modal);
  const urlIn = $('[data-field="url"]', modal);
  const editor = wireIconEditor(modal, () => ({ title: titleIn.value, url: urlIn.value, icon: seed.icon }));
  editor.refresh();
  urlIn.addEventListener('input', () => editor.refresh());
  titleIn.addEventListener('input', () => editor.refresh());
  $('[data-cancel]', modal).addEventListener('click', entry.close);
  if (item) {
    $('[data-del]', modal).addEventListener('click', () => {
      state.dock = state.dock.filter((d) => d.id !== item.id);
      reindexDock();
      saveAll({ snapshot: true }); entry.close(); render();
      toast('Быстрая ссылка удалена');
    });
  }
  function save() {
    const rawUrl = urlIn.value.trim();
    if (!rawUrl) { urlIn.classList.add('invalid'); urlIn.focus(); return; }
    if (!isSafeUrl(rawUrl)) { toast('Недопустимая ссылка', { type: 'error' }); return; }
    const iconData = editor.get();
    const payload = {
      title: titleIn.value.trim() || domainOf(rawUrl),
      url: normalizeUrl(rawUrl),
      iconType: iconData.iconType,
      icon: iconData.icon,
      color: iconData.color || ''
    };
    if (item) Object.assign(item, payload);
    else state.dock.push(Object.assign({ id: uid('dock'), order: state.dock.length }, payload));
    reindexDock();
    saveAll({ snapshot: true });
    entry.close(); render();
    toast(item ? 'Быстрая ссылка обновлена' : 'Добавлено в быстрый доступ', { type: 'success' });
  }
  function reindexDock() {
    state.dock.sort((a, b) => a.order - b.order).forEach((d, i) => { d.order = i; });
  }
  $('[data-save]', modal).addEventListener('click', save);
  urlIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
  return entry;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Ссылка скопирована', { type: 'success', icon: 'copy' });
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('Ссылка скопирована', { type: 'success', icon: 'copy' }); }
    catch (err) { toast('Не удалось скопировать', { type: 'error' }); }
    ta.remove();
  }
}

/* ---------- menus for entities ---------- */
function bookmarkMenu(bm, x, y) {
  const folderItems = [];
  const path = folderPath(bm.folderId).map((f) => f.name).join(' / ');
  folderItems.push({ title: 'Переместить в' });
  folderItems.push({ label: 'Без папки (корень)', icon: 'home', checked: !bm.folderId, onClick: () => { moveBookmark(bm.id, null, null, false); saveAll(); render(); toast('Перемещено в корень'); } });
  const walk = (pid, depth) => childFolders(pid).forEach((f) => {
    folderItems.push({
      label: '\u00a0\u00a0'.repeat(depth) + (f.emoji || '📁') + ' ' + f.name,
      icon: '', checked: bm.folderId === f.id,
      onClick: () => { moveBookmark(bm.id, f.id, null, false); saveAll(); render(); toast('Перемещено в «' + f.name + '»'); }
    });
    walk(f.id, depth + 1);
  });
  walk(null, 0);
  const items = [
    { label: 'Открыть в новой вкладке', icon: 'external', hint: 'Enter', onClick: () => openBookmark(bm.id, true) },
    { label: 'Открыть в этой вкладке', icon: 'arrowUpRight', onClick: () => openBookmark(bm.id, false) },
    { label: 'Копировать ссылку', icon: 'copy', onClick: () => copyText(bm.url) },
    { sep: true },
    { label: 'Изменить', icon: 'pencil', hint: 'E', onClick: () => bookmarkDialog({ bookmarkId: bm.id }) },
    { label: bm.favorite ? 'Убрать из избранного' : 'В избранное', icon: 'star', checked: bm.favorite, onClick: () => { bm.favorite = !bm.favorite; saveAll(); render(); } },
    { label: bm.archived ? 'Вернуть из архива' : 'В архив', icon: 'archive', onClick: () => { bm.archived = !bm.archived; saveAll(); render(); toast(bm.archived ? 'Скрыто в архив' : 'Возвращено из архива'); } },
    { label: 'На быструю панель', icon: 'sparkles', onClick: () => addDockFromBookmark(bm) },
    { label: 'Дублировать', icon: 'copy', onClick: () => {
      const copy = Object.assign({}, bm, { id: uid('b'), title: bm.title + ' (копия)', order: nextOrder(bm.folderId), createdAt: Date.now(), updatedAt: Date.now(), clicks: 0, lastOpened: 0 });
      state.bookmarks.push(copy); saveAll(); render(); toast('Закладка продублирована');
    } },
    { sep: true },
    folderItems[0],
    folderItems.slice(1),
    { sep: true },
    { label: 'Удалить', icon: 'trash', danger: true, hint: 'Del', onClick: () => removeBookmarksWithUndo([bm.id]) }
  ];
  openMenu(items, x, y);
}
function addDockFromBookmark(bm) {
  if (state.dock.some((d) => d.url === bm.url)) { toast('Такая ссылка уже есть на панели'); return; }
  state.dock.push({ id: uid('dock'), title: bm.title, url: bm.url, iconType: bm.iconType, icon: bm.icon, color: bm.color, order: state.dock.length });
  saveAll(); render();
  toast('Добавлено на быструю панель', {
    type: 'success', actionLabel: 'Настроить',
    onAction: () => dockDialog({ dockId: state.dock[state.dock.length - 1].id })
  });
}
function folderMenu(f, x, y) {
  const items = [
    { label: 'Открыть', icon: 'folder', onClick: () => { ui.view = 'folder'; ui.folderId = f.id; ui.tag = null; render(); } },
    { label: 'Новая подпапка', icon: 'folderPlus', onClick: () => folderDialog({ parentId: f.id }) },
    { label: 'Изменить папку', icon: 'pencil', onClick: () => folderDialog({ folderId: f.id }) },
    { label: 'Добавить закладку', icon: 'plus', onClick: () => bookmarkDialog({ folderId: f.id }) },
    { sep: true },
    { title: 'Переместить в' },
    { label: 'Без папки (корень)', icon: 'home', checked: !f.parentId, onClick: () => { moveFolder(f.id, null, null, false); saveAll(); render(); } },
    childFolders(null).filter((x2) => !descendantIds(f.id).includes(x2.id)).map((x2) => ({
      label: (x2.emoji || '📁') + ' ' + x2.name, checked: f.parentId === x2.id,
      onClick: () => { moveFolder(f.id, x2.id, null, false); saveAll(); render(); toast('Папка перемещена'); }
    })),
    { sep: true },
    { label: 'Экспортировать папку', icon: 'download', onClick: () => exportFolder(f.id) },
    { label: 'Удалить папку', icon: 'trash', danger: true, onClick: () => deleteFolderFlow(f) }
  ];
  openMenu(items, x, y);
}
function removeBookmarksWithUndo(ids) {
  const snap = dataSnapshot();
  const n = trashBookmarks(ids);
  ui.selection.clear();
  saveAll();
  render();
  toastUndo('Удалено закладок: ' + n, snap);
}
function deleteFolderFlow(f) {
  const bms = state.bookmarks.filter((b) => b.folderId === f.id);
  confirmDialog({
    title: 'Удалить папку «' + f.name + '»?',
    text: 'В папке ' + bms.length + ' закладок и ' + childFolders(f.id).length + ' вложенных папок.',
    note: 'Закладки и подпапки переместятся в корень. Сама папка исчезнет.',
    confirmLabel: 'Удалить папку',
    danger: true
  }).then((ok) => {
    if (!ok) return;
    const snap = dataSnapshot();
    bms.forEach((b) => { b.folderId = null; });
    reindexBookmarks(null);
    childFolders(f.id).forEach((c) => { c.parentId = null; });
    state.folders = state.folders.filter((x) => x.id !== f.id);
    if (ui.view === 'folder' && ui.folderId === f.id) { ui.view = 'all'; ui.folderId = null; }
    saveAll();
    render();
    toastUndo('Папка удалена', snap);
  });
}

/* ============================================================
   15. Settings sheet
   ============================================================ */
let settingsPaint = null;
function segHTML(key, opts, value) {
  return '<div class="seg" data-seg="' + key + '">' + opts.map((o) =>
    '<button type="button" class="' + (value === o[0] ? 'active' : '') + '" data-set="' + key + '" data-val="' + o[0] + '" title="' + esc(o[1]) + '">' + (o[2] || esc(o[1])) + '</button>'
  ).join('') + '</div>';
}
function switchHTML(key, on) {
  return '<button type="button" class="switch ' + (on ? 'on' : '') + '" data-toggle="' + key + '" role="switch" aria-checked="' + !!on + '"></button>';
}
const inFrame = (() => { try { return window.self !== window.top; } catch (e) { return true; } })();
function fileSectionHTML() {
  const supported = 'showSaveFilePicker' in window;
  let statusText, statusCls;
  if (fileState.mode === 'on' && fileHandle) {
    statusCls = 'accent';
    statusText = 'Связано: ' + (fileState.name || 'файл') + (fileState.lastSaved ? ' · ' + fmtRel(fileState.lastSaved) : '');
  } else if (!supported) {
    statusCls = 'muted';
    statusText = 'Браузер не поддерживает прямую запись. Используйте скачивание JSON.';
  } else {
    statusCls = 'muted';
    statusText = 'Файл не подключён — данные живут только в браузере.';
  }
  return '<div class="set-group">' +
    '<h4>JSON-файл на диске</h4>' +
    '<div class="set-row" style="align-items:flex-start"><div class="set-text">' +
      '<div class="chip ' + statusCls + '" style="white-space:normal;height:auto;padding:5px 9px;line-height:1.5">' +
        icon(fileHandle ? 'shield' : 'database', 12) + '<span>' + esc(statusText) + '</span></div>' +
      '<div class="set-desc" style="margin-top:6px">Приложение пишет изменения прямо в выбранный JSON-файл. Так данные не зависят от браузера, их видно в проводнике и можно хранить в облаке (Dropbox, iCloud, Git).</div>' +
    '</div></div>' +
    '<div class="set-actions">' +
      '<button type="button" class="btn sm primary" data-act="file-connect">' + icon('folderPlus', 13) + (fileHandle ? 'Сменить файл' : 'Подключить файл') + '</button>' +
      (fileHandle ? '<button type="button" class="btn sm" data-act="file-save">' + icon('save', 13) + 'Сохранить сейчас</button>' : '') +
      (fileHandle ? '<button type="button" class="btn sm ghost" data-act="file-detach">' + icon('x', 13) + 'Отвязать</button>' : '') +
      '<button type="button" class="btn sm" data-act="export-json">' + icon('download', 13) + 'Скачать JSON</button>' +
    '</div>' +
    (inFrame
      ? '<div class="hint" style="margin-top:8px;color:#f0b35e">Открыто внутри предпросмотра (iframe): браузер запрещает здесь доступ к файлам. Скачайте файл и откройте его двойным щелчком — синхронизация с JSON заработает.</div>'
      : '<div class="hint" style="margin-top:8px">Подсказка: держите этот HTML рядом с JSON-файлом — тогда приложение можно открыть в любом браузере и данные всегда под рукой.</div>') +
  '</div>';
}
function settingsBodyHTML() {
  const st = state.settings;
  const counts = {
    bm: state.bookmarks.length,
    folders: state.folders.length,
    dock: state.dock.length,
    trash: state.trash.length,
    archived: state.bookmarks.filter((b) => b.archived).length
  };
  const snaps = readSnapshots();
  const bytes = new Blob([JSON.stringify(state)]).size;
  let html = '';

  html += '<div class="set-group"><h4>Внешний вид</h4>' +
    '<div class="set-row"><div class="set-text"><div class="set-name">Тема</div><div class="set-desc">Авто — как в системе</div></div>' +
      segHTML('theme', [['auto', 'Авто', icon('monitor', 14)], ['dark', 'Тёмная', icon('moon', 14)], ['light', 'Светлая', icon('sun', 14)]], st.theme) + '</div>' +
    '<div class="set-row" style="align-items:flex-start"><div class="set-text"><div class="set-name">Акцентный цвет</div><div class="set-desc">Кнопки, выделение, подсветка</div></div>' +
      '<div class="swatches" style="justify-content:flex-end;max-width:190px">' +
        ACCENTS.map((c) => '<button type="button" class="swatch ' + (st.accent === c ? 'active' : '') + '" style="background:' + c + '" data-set="accent" data-val="' + c + '"></button>').join('') +
      '</div></div>' +
    '<div class="set-row"><div class="set-text"><div class="set-name">Плотность</div><div class="set-desc">Размер отступов в карточках</div></div>' +
      segHTML('density', [['comfortable', 'Обычная'], ['compact', 'Компактно']], st.density) + '</div>' +
    '<div class="set-row" style="align-items:flex-start"><div class="set-text"><div class="set-name">Ширина карточек</div><div class="set-desc">' + st.cardMin + ' px · меньше — больше в ряд</div></div>' +
      '<input type="range" min="190" max="380" step="6" value="' + st.cardMin + '" data-range="cardMin" style="width:150px"></div>' +
    '<div class="set-row"><div class="set-text"><div class="set-name">Вид коллекции</div><div class="set-desc">Сетка или компактный список</div></div>' +
      segHTML('view', [['grid', 'Сетка', icon('grid', 14)], ['list', 'Список', icon('list', 14)]], st.view) + '</div>' +
    '<div class="set-row"><div class="set-text"><div class="set-name">Иконки сайтов</div><div class="set-desc">Подгружать фавиконы из интернета</div></div>' + switchHTML('showFavicons', st.showFavicons) + '</div>' +
    '<div class="set-row"><div class="set-text"><div class="set-name">Источник иконок</div><div class="set-desc">Если фавикон не грузится — покажем букву</div></div>' +
      '<select class="input" data-select="faviconService" style="width:150px">' +
        [['google', 'Google'], ['duckduckgo', 'DuckDuckGo'], ['none', 'Только буквы']].map(([v, l]) => '<option value="' + v + '"' + (st.faviconService === v ? ' selected' : '') + '>' + l + '</option>').join('') +
      '</select></div>' +
    '</div>';

  html += '<div class="set-group"><h4>Поведение</h4>' +
    '<div class="set-row"><div class="set-text"><div class="set-name">Открывать в новой вкладке</div><div class="set-desc">Иначе ссылка откроется вместо приложения</div></div>' + switchHTML('openNewTab', st.openNewTab) + '</div>' +
    '<div class="set-row"><div class="set-text"><div class="set-name">Клик по карточке открывает сайт</div><div class="set-desc">Выключите, чтобы клик только выделял (открытие — двойным кликом)</div></div>' + switchHTML('clickOpens', st.clickOpens) + '</div>' +
    '<div class="set-row"><div class="set-text"><div class="set-name">Спрашивать перед удалением</div><div class="set-desc">Закладки отправляются в корзину</div></div>' + switchHTML('confirmDelete', st.confirmDelete) + '</div>' +
    '<div class="set-row"><div class="set-text"><div class="set-name">Автоматические снимки</div><div class="set-desc">Локальные точки восстановления (8 последних)</div></div>' + switchHTML('autoSnapshots', st.autoSnapshots) + '</div>' +
    '<div class="set-row"><div class="set-text"><div class="set-name">Боковая панель</div><div class="set-desc">Скрыть, чтобы освободить место</div></div>' + switchHTML('_sidebar', !st._collapsed) + '</div>' +
    '</div>';

  html += fileSectionHTML();

  html += '<div class="set-group"><h4>Импорт и экспорт</h4>' +
    '<div class="set-actions">' +
      '<button type="button" class="btn sm" data-act="import-json">' + icon('upload', 13) + 'Импорт JSON</button>' +
      '<button type="button" class="btn sm" data-act="import-html">' + icon('upload', 13) + 'Импорт HTML</button>' +
      '<button type="button" class="btn sm" data-act="export-html">' + icon('download', 13) + 'Экспорт HTML</button>' +
      '<button type="button" class="btn sm" data-act="export-json">' + icon('download', 13) + 'Экспорт JSON</button>' +
    '</div>' +
    '<div class="hint" style="margin-top:8px">HTML понимают Chrome, Firefox, Safari и Edge («Импорт закладок» в настройках браузера). JSON — полная копия со всеми настройками, тегами и архивом.</div>' +
    '</div>';

  html += '<div class="set-group"><h4>Коллекция</h4>' +
    '<div class="set-stats">' +
      '<div class="stat-box"><div class="v">' + counts.bm + '</div><div class="k">закладок</div></div>' +
      '<div class="stat-box"><div class="v">' + counts.folders + '</div><div class="k">папок</div></div>' +
      '<div class="stat-box"><div class="v">' + state.dock.length + '</div><div class="k">быстрых</div></div>' +
    '</div>' +
    '<div class="set-actions">' +
      '<button type="button" class="btn sm" data-act="nav-settings-archive">' + icon('archive', 13) + 'Архив · ' + counts.archived + '</button>' +
      '<button type="button" class="btn sm" data-act="nav-settings-trash">' + icon('trash', 13) + 'Корзина · ' + counts.trash + '</button>' +
      (state.meta.demo ? '<button type="button" class="btn sm" data-act="delete-demo">' + icon('sparkles', 13) + 'Убрать демо-данные</button>' : '') +
    '</div>' +
    '<div class="hint" style="margin-top:8px">Локальная копия: ' + fmtBytes(bytes) + ' · создана ' + fmtDate(state.meta.created) + '</div>' +
    '</div>';

  html += '<div class="set-group"><h4>Точки восстановления</h4>' +
    '<div class="set-actions" style="margin-top:0;margin-bottom:8px">' +
      '<button type="button" class="btn sm" data-act="snapshot-now">' + icon('save', 13) + 'Сделать снимок</button>' +
    '</div>' +
    (snaps.length
      ? '<div class="menu-scroll" style="max-height:150px;display:flex;flex-direction:column;gap:4px">' + snaps.map((s, i) =>
          '<div class="set-row" style="padding:4px 0;min-height:32px"><div class="set-text"><div class="set-name" style="font-size:12px">' + fmtDate(s.at) + (i === 0 ? ' · последний' : '') + '</div>' +
          '<div class="set-desc">' + fmtBytes(s.data.length) + '</div></div>' +
          '<button type="button" class="btn sm" data-act="restore-snap" data-snap="' + s.id + '">Восстановить</button></div>').join('') + '</div>'
      : '<div class="hint">Снимков пока нет. Они создаются автоматически при изменениях.</div>') +
    '</div>';

  html += '<div class="set-group"><h4>Опасная зона</h4>' +
    '<div class="set-actions" style="margin-top:0">' +
      '<button type="button" class="btn sm danger" data-act="wipe-all">' + icon('trash', 13) + 'Удалить все данные</button>' +
      '<button type="button" class="btn sm ghost" data-act="shortcuts">' + icon('keyboard', 13) + 'Горячие клавиши</button>' +
    '</div>' +
    '<div class="hint" style="margin-top:8px">Bookmark Station · один HTML-файл · работает офлайн, без сервера и аккаунтов.</div>' +
    '</div>';

  return html;
}
function wireSettings(root) {
  root.addEventListener('click', (e) => {
    const segBtn = e.target.closest('[data-set]');
    if (segBtn) {
      const key = segBtn.dataset.set;
      const val = segBtn.dataset.val;
      state.settings[key] = val;
      applyTheme(); applyAccent(); applyLayout();
      saveAll(); render(); if (settingsPaint) settingsPaint();
    }
    const tg = e.target.closest('[data-toggle]');
    if (tg) {
      const key = tg.dataset.toggle;
      if (key === '_sidebar') { state.settings._collapsed = !state.settings._collapsed; }
      else { state.settings[key] = !state.settings[key]; }
      applyTheme(); applyAccent(); applyLayout(); saveAll(); render(); if (settingsPaint) settingsPaint();
    }
  });
  root.addEventListener('input', (e) => {
    const rng = e.target.closest('[data-range]');
    if (rng) { state.settings[rng.dataset.range] = parseInt(rng.value, 10); applyLayout(); }
  });
  root.addEventListener('change', (e) => {
    const rng = e.target.closest('[data-range]');
    if (rng) { saveAll(); render(); return; }
    const sel = e.target.closest('[data-select]');
    if (sel) { state.settings[sel.dataset.select] = sel.value; saveAll(); render(); if (settingsPaint) settingsPaint(); }
  });
}
function openSettings() {
  const entry = openModal({
    title: 'Настройки',
    subtitle: 'Всё хранится локально — вы контролируете данные',
    sheet: true,
    body: '<div id="setBody"></div>',
    footer: '<div class="left"><button type="button" class="btn sm ghost" data-act="shortcuts">' + icon('keyboard', 14) + 'Клавиши</button></div>' +
      '<button type="button" class="btn" data-close>Закрыть</button>'
  });
  const paint = () => {
    const holder = $('#setBody', entry.modal);
    if (!holder) return;
    const top = holder.scrollTop;
    holder.innerHTML = settingsBodyHTML();
    // move settings content into scrollable modal body bounds
    holder.scrollTop = top;
    if (!holder.dataset.wired) { wireSettings(holder); holder.dataset.wired = '1'; }
  };
  settingsPaint = paint;
  paint();
  entry.layer.addEventListener('mousedown', () => {});
  const origClose = entry.close;
  entry.close = () => { settingsPaint = null; origClose(); };
  entry.modal.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => entry.close()));
  return entry;
}

/* ============================================================
   16. File System Access — real JSON file on disk
   ============================================================ */
async function ensurePermission(handle, request) {
  try {
    if (!handle || !handle.queryPermission) return true;
    const opts = { mode: 'readwrite' };
    if (await handle.queryPermission(opts) === 'granted') return true;
    if (!request) return false;
    return (await handle.requestPermission(opts)) === 'granted';
  } catch (e) { return false; }
}
async function writeToLinkedFile(manual) {
  if (!fileHandle) {
    if (manual) toast('Сначала подключите JSON-файл', { type: 'error' });
    return false;
  }
  const ok = await ensurePermission(fileHandle, true);
  if (!ok) {
    fileState.mode = 'ask';
    updateSyncPill();
    if (manual) toast('Браузер не дал доступ к файлу — нажмите на индикатор справа сверху', { type: 'error' });
    return false;
  }
  fileState.mode = 'on';
  fileState.busy = true;
  updateSyncPill();
  try {
    const writable = await fileHandle.createWritable();
    await writable.write(new Blob([JSON.stringify(dataPayload(), null, 2)], { type: 'application/json' }));
    await writable.close();
    fileState.busy = false;
    fileState.lastSaved = Date.now();
    fileState.name = fileHandle.name || fileState.name;
    fileState.error = '';
    updateSyncPill();
    if (manual) toast('Сохранено в «' + (fileHandle.name || 'файл') + '»', { type: 'success', icon: 'save' });
    return true;
  } catch (e) {
    fileState.busy = false;
    fileState.error = String(e && e.message || e);
    fileState.mode = 'off';
    updateSyncPill();
    toast('Не удалось записать файл: ' + fileState.error, { type: 'error' });
    return false;
  }
}
async function attachHandle(handle, opts) {
  fileHandle = handle;
  fileState.mode = 'on';
  fileState.name = (handle && handle.name) || 'bookmarks.json';
  fileState.lastSaved = 0;
  await idb.set('fileHandle', handle);
  if (!(opts && opts.skipWrite)) await writeToLinkedFile(false);
  updateSyncPill();
  if (settingsPaint) settingsPaint();
}
async function connectFileDialog() {
  if (!('showSaveFilePicker' in window)) {
    downloadJSON();
    toast('Этот браузер не умеет писать файл напрямую — JSON скачан', { type: 'error', duration: 5000 });
    return;
  }
  const choice = await chooserModal({
    title: 'JSON-файл на диске',
    subtitle: 'Приложение сможет читать и записывать этот файл',
    options: [
      { value: 'new', icon: 'file', label: 'Создать новый файл', desc: 'bookmark-station.json в выбранной папке' },
      { value: 'open', icon: 'folder', label: 'Открыть существующий', desc: 'Продолжить работу с прошлым файлом или импортировать .html' }
    ]
  });
  if (!choice) return;
  try {
    if (choice === 'new') {
      const handle = await window.showSaveFilePicker({
        suggestedName: 'bookmark-station.json',
        types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }]
      });
      await attachHandle(handle);
      toast('Файл подключён — изменения сохраняются автоматически', { type: 'success', icon: 'shield', duration: 5000 });
    } else {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: 'JSON или HTML', accept: { 'application/json': ['.json'], 'text/html': ['.html', '.htm'] } }],
        multiple: false
      });
      if (!handle) return;
      const file = await handle.getFile();
      const text = await file.text();
      if (/\.(html?|htm)$/i.test(file.name)) {
        const parsed = parseNetscapeHTML(text);
        if (!parsed.bookmarks.length && !parsed.folders.length) { toast('В файле не найдено закладок', { type: 'error' }); return; }
        await importPayloadDialog(parsed, file.name, () => attachHandle(handle, { skipWrite: false }));
        return;
      }
      let payload;
      try { payload = JSON.parse(text); } catch (e) { toast('Это не JSON-файл Bookmark Station', { type: 'error' }); return; }
      if (!payload || (!payload.bookmarks && !payload.folders)) { toast('Файл не похож на базу закладок', { type: 'error' }); return; }
      const p = coalesceState(payload);
      const decision = await chooserModal({
        title: 'Что делать с данными из файла?',
        subtitle: file.name,
        intro: 'В файле <b>' + p.bookmarks.length + '</b> закладок и <b>' + p.folders.length + '</b> папок.',
        options: [
          { value: 'merge', icon: 'plus', label: 'Добавить к текущим', desc: 'Дубликаты по адресу будут пропущены' },
          { value: 'replace', icon: 'restore', label: 'Заменить всё содержимым файла', desc: 'Текущие данные останутся в снимке' }
        ]
      });
      if (!decision) return;
      maybeSnapshot(true);
      if (decision === 'replace') {
        state = p;
        ui.view = 'all'; ui.folderId = null; ui.tag = null; ui.selection.clear();
        applyTheme(); applyAccent(); applyLayout();
      } else {
        const res = mergePayload(p);
        toast('Добавлено ' + res.added + ' закладок, пропущено дублей: ' + res.skipped, { type: 'success' });
      }
      await attachHandle(handle);
      saveAll({ snapshot: true });
      render();
      if (settingsPaint) settingsPaint();
      toast('Файл подключён: ' + file.name, { type: 'success', icon: 'shield' });
    }
  } catch (e) {
    if (e && (e.name === 'AbortError')) return;
    console.warn(e);
    const msg = String(e && e.message || e);
    if (e && (e.name === 'SecurityError' || /not allowed|permissions policy|user gesture/i.test(msg))) {
      toast('Браузер заблокировал доступ к файлу (например, внутри iframe). Откройте bookmarks.html прямо с диска — тогда запись работает.', { type: 'error', duration: 8000 });
      return;
    }
    toast('Не удалось открыть файл: ' + msg, { type: 'error' });
  }
}
async function detachFile() {
  await idb.del('fileHandle');
  fileHandle = null;
  fileState = { mode: 'off', name: '', lastSaved: 0, busy: false, error: '' };
  updateSyncPill();
  if (settingsPaint) settingsPaint();
  toast('Файл отвязан. Данные остаются в браузере.');
}
async function restoreHandleOnStart() {
  if (!('showSaveFilePicker' in window)) return;
  const handle = await idb.get('fileHandle');
  if (!handle) return;
  fileHandle = handle;
  fileState.name = handle.name || 'bookmarks.json';
  const granted = await ensurePermission(handle, false);
  fileState.mode = granted ? 'on' : 'ask';
  updateSyncPill();
  if (granted) {
    const ok = await writeToLinkedFile(false);
    if (ok) maybeToastRestored();
  }
}
function maybeToastRestored() {
  toast('Данные синхронизированы с файлом «' + fileState.name + '»', { type: 'success', icon: 'shield' });
}

/* ============================================================
   17. Import / export
   ============================================================ */
function escHtml(s) { return String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
function exportJSON() { downloadJSON(); }
function exportFolder(folderId) {
  const ids = new Set(descendantIds(folderId));
  const payload = {
    version: 1,
    folders: state.folders.filter((f) => ids.has(f.id)),
    bookmarks: state.bookmarks.filter((b) => b.folderId && ids.has(b.folderId)),
    dock: [], trash: [],
    meta: { exported: Date.now(), app: 'Bookmark Station' }
  };
  const name = (folderById(folderId) || {}).name || 'folder';
  downloadBlob(JSON.stringify(payload, null, 2), uniqueFilename(name.replace(/[^\wа-яё\- ]+/gi, '').trim() || 'folder') + '.json');
  toast('Папка экспортирована в JSON', { type: 'success', icon: 'download' });
}
function buildHTMLExport() {
  const out = ['<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<!-- This is an automatically generated file. It will be read and overwritten by Bookmark Station. -->',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    '<TITLE>Bookmarks</TITLE>', '<H1>Bookmarks</H1>', '<DL><p>'];
  const ind = (n) => '\u00a0\u00a0\u00a0\u00a0'.repeat(n);
  function emitBookmark(b, depth) {
    out.push(ind(depth) + '<DT><A HREF="' + esc(b.url) + '" ADD_DATE="' + Math.floor((b.createdAt || Date.now()) / 1000) + '"' +
      (b.lastOpened ? ' LAST_VISIT="' + Math.floor(b.lastOpened / 1000) + '"' : '') +
      (b.tags && b.tags.length ? ' TAGS="' + esc(b.tags.join(',')) + '"' : '') + '>' + escHtml(b.title) + '</A>');
    if (b.description) out.push(ind(depth) + '<DD>' + escHtml(b.description));
  }
  function emitFolder(f, depth) {
    out.push(ind(depth) + '<DT><H3 ADD_DATE="' + Math.floor((f.createdAt || Date.now()) / 1000) + '">' + escHtml(f.name) + '</H3>');
    out.push(ind(depth) + '<DL><p>');
    state.bookmarks.filter((b) => !b.archived && b.folderId === f.id).sort(compareBookmarks('manual')).forEach((b) => emitBookmark(b, depth + 1));
    childFolders(f.id).forEach((c) => emitFolder(c, depth + 1));
    out.push(ind(depth) + '</DL><p>');
  }
  state.bookmarks.filter((b) => !b.archived && !b.folderId).sort(compareBookmarks('manual')).forEach((b) => emitBookmark(b, 1));
  childFolders(null).forEach((f) => emitFolder(f, 1));
  out.push('</DL><p>');
  return out.join('\n');
}
function exportHTML() {
  downloadBlob(buildHTMLExport(), uniqueFilename('bookmarks') + '.html', 'text/html');
  toast('HTML экспортирован — его понимают все браузеры', { type: 'success', icon: 'download' });
}
function parseNetscapeHTML(text) {
  const out = { folders: [], bookmarks: [] };
  let doc;
  try { doc = new DOMParser().parseFromString(text, 'text/html'); } catch (e) { return out; }
  const rootDL = doc.querySelector('dl');
  if (!rootDL) return out;
  const HOIST = /^(bookmarks?( bar| toolbar| menu| folder)?|bookmarks bar|панель закладок|закладки|избранное|favorites|other bookmarks|другие закладки|mobile bookmarks|закладки на мобильном|unsorted bookmarks|прочие закладки)$/i;
  const addFolder = (name, parentId) => {
    const f = { id: uid('f'), name: (name || 'Папка').trim().slice(0, 120), parentId, emoji: '📁', color: '', order: out.folders.filter((x) => x.parentId === parentId).length, createdAt: Date.now() };
    out.folders.push(f);
    return f;
  };
  function walk(dl, parentId, depth) {
    Array.from(dl.children).filter((n) => n.tagName === 'DT').forEach((dt) => {
      const h3 = Array.from(dt.children).find((c) => c.tagName === 'H3');
      const a = Array.from(dt.children).find((c) => c.tagName === 'A');
      const sub = Array.from(dt.children).find((c) => c.tagName === 'DL') || dt.querySelector('dl');
      if (h3) {
        const name = (h3.textContent || '').trim();
        const hoist = depth === 0 && HOIST.test(name);
        const fid = hoist ? parentId : addFolder(name, parentId).id;
        if (sub) walk(sub, fid, depth + 1);
        if (a && a.getAttribute('href')) {
          out.bookmarks.push(mkBookmark(a, dt, fid));
        }
      } else if (a && a.getAttribute('href')) {
        out.bookmarks.push(mkBookmark(a, dt, parentId));
      } else if (sub) {
        walk(sub, parentId, depth + 1);
      }
    });
  }
  function mkBookmark(a, dt, folderId) {
    const dd = Array.from(dt.children).find((c) => c.tagName === 'DD');
    const href = a.getAttribute('href') || '';
    const tagsAttr = a.getAttribute('tags') || '';
    const created = parseInt(a.getAttribute('add_date'), 10);
    return {
      id: uid('b'), url: normalizeUrl(href),
      title: (a.textContent || '').trim().slice(0, 300) || domainOf(href),
      description: dd ? (dd.textContent || '').trim().slice(0, 2000) : '',
      tags: tagsAttr ? tagsAttr.split(',').map((s) => s.trim()).filter(Boolean) : [],
      folderId,
      favorite: false, archived: false, iconType: 'favicon', icon: '', color: '',
      clicks: 0,
      createdAt: created && created > 1000000000 ? created * 1000 : Date.now(),
      updatedAt: Date.now(), lastOpened: 0, order: out.bookmarks.length
    };
  }
  walk(rootDL, null, 0);
  return out;
}
function mergePayload(p) {
  const map = new Map();
  const byKey = new Map();
  state.folders.forEach((f) => byKey.set(folderPath(f.id).map((x) => x.name).join('\u0001').toLowerCase(), f.id));
  const depthOf = (f) => { let d = 0, cur = f, g = 0; while (cur && cur.parentId && g++ < 40) { cur = p.folders.find((x) => x.id === cur.parentId); d++; } return d; };
  p.folders.slice().sort((a, b) => depthOf(a) - depthOf(b)).forEach((f) => {
    const newParent = f.parentId ? (map.get(f.parentId) || null) : null;
    const key = ((newParent ? folderPath(newParent).map((x) => x.name).join('\u0001').toLowerCase() + '\u0001' : '') + f.name.toLowerCase());
    let id = byKey.get(key);
    if (!id) {
      const nf = Object.assign({}, f, { id: uid('f'), parentId: newParent, order: childFolders(newParent).length });
      state.folders.push(nf);
      id = nf.id;
      byKey.set(key, id);
    }
    map.set(f.id, id);
  });
  let added = 0, skipped = 0;
  p.bookmarks.forEach((b) => {
    if (state.bookmarks.some((x) => x.url === b.url) || state.trash.some((x) => x.url === b.url)) { skipped++; return; }
    const folderId = b.folderId ? (map.get(b.folderId) || null) : null;
    state.bookmarks.push(Object.assign({}, b, { id: uid('b'), folderId, order: nextOrder(folderId) }));
    added++;
  });
  p.dock.forEach((d) => { if (!state.dock.some((x) => x.url === d.url)) state.dock.push(Object.assign({}, d, { id: uid('dock'), order: state.dock.length })); });
  return { added, skipped };
}
async function importPayloadDialog(payload, sourceName, afterAttach) {
  const p = payload.bookmarks || payload.folders ? payload : coalesceState(payload);
  const decision = await chooserModal({
    title: 'Импорт закладок',
    subtitle: sourceName || '',
    intro: 'Найдено <b>' + safeArr(p.bookmarks).length + '</b> закладок и <b>' + safeArr(p.folders).length + '</b> папок.',
    options: [
      { value: 'merge', icon: 'plus', label: 'Добавить к текущим', desc: 'Повторы по адресу пропустятся' },
      { value: 'replace', icon: 'restore', label: 'Заменить всё', desc: 'Текущие данные сохранятся в снимке' }
    ]
  });
  if (!decision) return false;
  maybeSnapshot(true);
  if (decision === 'replace') {
    state = coalesceState(p);
    ui.view = 'all'; ui.folderId = null; ui.tag = null; ui.query = ''; ui.selection.clear();
    applyTheme(); applyAccent(); applyLayout();
    toast('Данные заменены: ' + state.bookmarks.length + ' закладок', { type: 'success' });
  } else {
    const res = mergePayload(coalesceState(p));
    toast('Импортировано ' + res.added + ' закладок' + (res.skipped ? ', дублей пропущено: ' + res.skipped : ''), { type: 'success' });
  }
  saveAll({ snapshot: true });
  render();
  if (settingsPaint) settingsPaint();
  if (afterAttach) await afterAttach();
  return true;
}
let fileInputHandler = null;
function pickFile(accept, cb) {
  const inp = $('#fileInput');
  inp.value = '';
  inp.accept = accept;
  fileInputHandler = cb;
  inp.click();
}
function onFileInputChange() {
  const inp = $('#fileInput');
  const f = inp.files && inp.files[0];
  const handler = fileInputHandler;
  fileInputHandler = null;
  inp.value = '';
  if (f && handler) handler(f);
}
function importJSONFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let payload;
    try { payload = JSON.parse(String(reader.result)); } catch (e) { toast('Не удалось прочитать JSON: ' + e.message, { type: 'error' }); return; }
    if (!payload || (!payload.bookmarks && !payload.folders)) { toast('В файле нет закладок', { type: 'error' }); return; }
    importPayloadDialog(payload, file.name);
  };
  reader.onerror = () => toast('Ошибка чтения файла', { type: 'error' });
  reader.readAsText(file);
}
function importHTMLFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    const parsed = parseNetscapeHTML(String(reader.result));
    if (!parsed.bookmarks.length && !parsed.folders.length) { toast('Не нашёл закладок в HTML', { type: 'error' }); return; }
    importPayloadDialog(parsed, file.name);
  };
  reader.onerror = () => toast('Ошибка чтения файла', { type: 'error' });
  reader.readAsText(file);
}
function openShortcuts() {
  const rows = [
    ['Ctrl / ⌘ + K', 'Палитра команд и поиск'],
    ['Ctrl / ⌘ + N', 'Новая закладка'],
    ['Ctrl / ⌘ + Shift + N', 'Новая папка'],
    ['Ctrl / ⌘ + B', 'Показать/скрыть панель'],
    ['Ctrl / ⌘ + S', 'Сохранить в JSON-файл'],
    ['Ctrl / ⌘ + ,', 'Настройки'],
    ['/', 'Фокус в поиск'],
    ['Enter', 'Открыть закладку'],
    ['E', 'Изменить закладку'],
    ['Del', 'В корзину (для выделенных)'],
    ['Ctrl / ⌘ + клик', 'Добавить к выделению'],
    ['Shift + клик', 'Выделить диапазон'],
    ['Esc', 'Закрыть / снять выделение']
  ];
  openModal({
    title: 'Горячие клавиши',
    subtitle: 'Всё управляется с клавиатуры',
    narrow: true,
    body: '<div style="display:flex;flex-direction:column;gap:2px">' + rows.map((r) =>
      '<div class="set-row" style="padding:5px 0;min-height:30px"><div class="set-text"><div class="set-name" style="font-size:12.5px">' + esc(r[1]) + '</div></div><kbd>' + esc(r[0]) + '</kbd></div>').join('') + '</div>',
    footer: '<div class="left"></div><button type="button" class="btn" data-close>Понятно</button>'
  });
}

/* ============================================================
   18. Drag & drop
   ============================================================ */
let lastDragEnd = 0;
let dndBound = false;
let fileOverlay = null;

function attachDnD() {
  if (dndBound) return;
  dndBound = true;

  document.addEventListener('dragstart', (e) => {
    const bmEl = e.target.closest('.bookmark[draggable="true"]');
    const folderCard = e.target.closest('.folder-card');
    const treeItem = e.target.closest('.tree-row .nav-item[draggable="true"]');
    const dockTile = e.target.closest('.dock-tile:not(.add)');
    drag = null;
    if (bmEl) {
      const bm = bookmarkById(bmEl.dataset.id);
      if (!bm) return;
      drag = { kind: 'bookmark', id: bm.id, label: bm.title };
      bmEl.classList.add('dragging');
    } else if (folderCard) {
      const f = folderById(folderCard.dataset.id);
      if (!f) return;
      drag = { kind: 'folder', id: f.id, label: f.name };
      folderCard.classList.add('dragging');
    } else if (treeItem) {
      const f = folderById(treeItem.dataset.id);
      if (!f) return;
      drag = { kind: 'folder', id: f.id, label: f.name };
    } else if (dockTile) {
      const d = state.dock.find((x) => x.id === dockTile.dataset.id);
      if (!d) return;
      drag = { kind: 'dock', id: d.id, label: d.title };
      dockTile.classList.add('dragging');
    }
    if (drag) {
      try {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', drag.kind + ':' + drag.id);
        e.dataTransfer.setData('text/x-bookmark-station', JSON.stringify(drag));
      } catch (err) {}
    }
  });

  document.addEventListener('dragend', () => {
    lastDragEnd = Date.now();
    drag = null;
    $$('.dragging').forEach((el) => el.classList.remove('dragging'));
    clearDropMarks();
    showFileOverlay(false);
  });

  document.addEventListener('dragover', (e) => {
    const hasFiles = e.dataTransfer && Array.from(e.dataTransfer.types || []).indexOf('Files') !== -1;
    if (hasFiles) { e.preventDefault(); showFileOverlay(true); return; }
    if (!drag) return;

    /* auto-scroll content while dragging */
    const content = $('#content');
    if (content) {
      const r = content.getBoundingClientRect();
      if (e.clientY > r.top && e.clientY < r.bottom) {
        if (e.clientY < r.top + 60) content.scrollTop -= 14;
        else if (e.clientY > r.bottom - 70) content.scrollTop += 14;
      }
    }

    const bmEl = e.target.closest('.bookmark[draggable="true"]');
    const specialEl = e.target.closest('.nav-item[data-view="archive"], .nav-item[data-view="favorites"], .nav-item[data-view="trash"]');
    const folderEl = e.target.closest('.folder-card, .nav-item[data-act="open-folder"], .nav-item[data-view="all"]');
    const dockTile = e.target.closest('.dock-tile:not(.add)');
    const dockArea = e.target.closest('.dock');
    const contentArea = e.target.closest('#content');

    clearDropMarks();
    if (specialEl && drag.kind === 'bookmark') {
      e.preventDefault();
      specialEl.classList.add('drop-over');
      const map = { archive: 'В архив', favorites: 'В избранное', trash: 'В корзину' };
      dropHint(specialEl, map[specialEl.dataset.view] || 'Сюда');
      return;
    }
    if (folderEl && !(drag.kind === 'folder' && folderEl.dataset.id === drag.id)) {
      const fid = folderEl.dataset.view === 'all' ? null : folderEl.dataset.id;
      if (!(drag.kind === 'folder' && fid && descendantIds(drag.id).includes(fid))) {
        e.preventDefault();
        folderEl.classList.add('drop-over');
        const name = fid ? (folderById(fid) || {}).name : 'Все закладки';
        dropHint(folderEl, drag.kind === 'folder' ? 'В «' + name + '»' : 'В папку «' + name + '»');
        return;
      }
    }
    if (bmEl && drag.kind === 'bookmark' && bmEl.dataset.id !== drag.id) {
      e.preventDefault();
      const r = bmEl.getBoundingClientRect();
      const isList = !!bmEl.closest('.bookmarks-list');
      const after = isList ? e.clientY > r.top + r.height / 2 : e.clientX > r.left + r.width / 2;
      bmEl.classList.add(after ? 'drop-after' : 'drop-before');
      dropHint(bmEl, 'Переместить сюда');
      return;
    }
    if ((dockTile || dockArea) && drag.kind === 'bookmark') {
      e.preventDefault();
      (dockTile || dockArea).classList.add('drop-over');
      dropHint(dockTile || dockArea, 'На быструю панель');
      return;
    }
    if ((dockTile || dockArea) && drag.kind === 'dock') {
      e.preventDefault();
      (dockTile || dockArea).classList.add('drop-over');
      dropHint(dockTile || dockArea, 'Изменить порядок');
      return;
    }
    if (contentArea && drag.kind !== 'dock') {
      e.preventDefault();
      const fid = ui.view === 'folder' ? ui.folderId : null;
      (dockArea || content).classList.add('drop-root');
      dropHint(contentArea, fid ? 'В папку «' + (folderById(fid) || {}).name + '»' : 'В корень библиотеки');
    }
  });

  document.addEventListener('drop', (e) => {
    const files = e.dataTransfer && e.dataTransfer.files;
    if (files && files.length) {
      e.preventDefault();
      showFileOverlay(false);
      handleDroppedFiles(Array.from(files));
      return;
    }
    if (!drag) return;
    e.preventDefault();
    const payload = drag;
    const bmEl = e.target.closest('.bookmark[draggable="true"]');
    const folderEl = e.target.closest('.folder-card, .nav-item[data-act="open-folder"], .nav-item[data-view="all"]');
    const dockTile = e.target.closest('.dock-tile:not(.add)');
    const dockArea = e.target.closest('.dock');
    const contentArea = e.target.closest('#content');
    clearDropMarks();
    drag = null;

    if (payload.kind === 'bookmark') {
      const bm = bookmarkById(payload.id);
      if (!bm) return;
      const specialDrop = e.target.closest('.nav-item[data-view="archive"], .nav-item[data-view="favorites"], .nav-item[data-view="trash"]');
      if (specialDrop) {
        const view = specialDrop.dataset.view;
        if (view === 'archive') { bm.archived = true; saveAll(); render(); toast('Перемещено в архив', { icon: 'archive' }); }
        else if (view === 'favorites') { bm.favorite = true; saveAll(); render(); toast('Добавлено в избранное', { icon: 'star' }); }
        else if (view === 'trash') removeBookmarksWithUndo([bm.id]);
        return;
      }
      if (bmEl) {
        const other = bookmarkById(bmEl.dataset.id);
        if (!other) return;
        const r = bmEl.getBoundingClientRect();
        const isList = !!bmEl.closest('.bookmarks-list');
        const after = isList ? e.clientY > r.top + r.height / 2 : e.clientX > r.left + r.width / 2;
        moveBookmark(bm.id, other.folderId, other.id, after);
        saveAll(); render();
        toast('Перемещено');
        return;
      }
      if (dockTile || dockArea) {
        addDockFromBookmark(bm);
        return;
      }
      if (folderEl) {
        const fid = folderEl.dataset.view === 'all' ? null : folderEl.dataset.id;
        moveBookmark(bm.id, fid, null, false);
        saveAll(); render();
        toast(fid ? 'Перемещено в «' + (folderById(fid) || {}).name + '»' : 'Перемещено в корень');
        return;
      }
      if (contentArea) {
        const fid = ui.view === 'folder' ? ui.folderId : null;
        moveBookmark(bm.id, fid, null, false);
        saveAll(); render();
        toast('Перемещено');
      }
    } else if (payload.kind === 'folder') {
      if (folderEl) {
        const fid = folderEl.dataset.view === 'all' ? null : folderEl.dataset.id;
        if (moveFolder(payload.id, fid, null, false)) {
          saveAll(); render();
          toast('Папка перемещена' + (fid ? ' в «' + (folderById(fid) || {}).name + '»' : ' в корень'));
        } else {
          toast('Нельзя вложить папку в саму себя', { type: 'error' });
        }
        return;
      }
      if (contentArea) {
        const fid = ui.view === 'folder' ? ui.folderId : null;
        if (moveFolder(payload.id, fid, null, false)) { saveAll(); render(); toast('Папка перемещена'); }
      }
    } else if (payload.kind === 'dock') {
      if (dockTile || dockArea) {
        const items = state.dock.slice().sort((a, b) => a.order - b.order);
        const cur = items.findIndex((x) => x.id === payload.id);
        if (cur < 0) return;
        const [item] = items.splice(cur, 1);
        let idx = items.length;
        if (dockTile) {
          const targetId = dockTile.dataset.id;
          const ti = items.findIndex((x) => x.id === targetId);
          if (ti >= 0) {
            const r = dockTile.getBoundingClientRect();
            idx = ti + (e.clientX > r.left + r.width / 2 ? 1 : 0);
          }
        }
        items.splice(idx, 0, item);
        items.forEach((d, i) => { d.order = i; });
        state.dock = items;
        saveAll(); render();
      }
    }
  });
}
function clearDropMarks() {
  $$('.drop-over, .drop-before, .drop-after, .drop-root').forEach((el) => el.classList.remove('drop-over', 'drop-before', 'drop-after', 'drop-root'));
  if (dropHintEl) { dropHintEl.remove(); dropHintEl = null; }
}
function dropHint(el, text) {
  if (!dropHintEl) {
    dropHintEl = document.createElement('div');
    dropHintEl.className = 'drop-hint';
    document.body.appendChild(dropHintEl);
  }
  const r = el.getBoundingClientRect();
  dropHintEl.textContent = text;
  dropHintEl.style.left = clamp(r.left + Math.min(r.width / 2, 120), 70, window.innerWidth - 70) + 'px';
  dropHintEl.style.top = Math.max(50, r.top + 8) + 'px';
}
function showFileOverlay(on) {
  if (on && !fileOverlay) {
    fileOverlay = document.createElement('div');
    fileOverlay.className = 'import-overlay';
    fileOverlay.innerHTML = '<div class="import-card">' + icon('upload', 34) + '<div><b>Отпустите файл</b><span>JSON база или HTML с закладками</span></div></div>';
    document.body.appendChild(fileOverlay);
  } else if (!on && fileOverlay) {
    fileOverlay.remove();
    fileOverlay = null;
  }
}
function handleDroppedFiles(files) {
  const f = files.find((x) => /\.(json)$/i.test(x.name)) || files.find((x) => /\.(html?|htm)$/i.test(x.name));
  if (!f) { toast('Подойдёт .json или .html с закладками', { type: 'error' }); return; }
  if (/\.json$/i.test(f.name)) importJSONFile(f); else importHTMLFile(f);
}

/* ============================================================
   19. Selection
   ============================================================ */
function selectBookmark(id, e) {
  const ev = e || {};
  const list = currentBookmarks().map((b) => b.id);
  if (ev.shiftKey && ui.anchorId && list.indexOf(ui.anchorId) !== -1) {
    const a = list.indexOf(ui.anchorId), b = list.indexOf(id);
    if (b !== -1) {
      const [from, to] = a < b ? [a, b] : [b, a];
      for (let i = from; i <= to; i++) ui.selection.add(list[i]);
    }
  } else if (ev.ctrlKey || ev.metaKey) {
    if (ui.selection.has(id)) ui.selection.delete(id); else ui.selection.add(id);
    ui.anchorId = id;
  } else {
    ui.selection.clear();
    ui.selection.add(id);
    ui.anchorId = id;
  }
  renderSelectionBar();
  render();
}

/* ============================================================
   20. Command palette
   ============================================================ */
let paletteLayer = null;
function closePalette() { if (paletteLayer) { paletteLayer.remove(); paletteLayer = null; } }
function openPalette(initial) {
  closePalette();
  closeMenu();
  let items = [];
  let active = 0;
  const layer = document.createElement('div');
  layer.className = 'cmdk-layer';
  layer.innerHTML =
    '<div class="cmdk" role="dialog" aria-label="Палитра команд">' +
      '<div class="cmdk-search">' + icon('search', 17) +
        '<input placeholder="Команда, закладка, папка…" spellcheck="false" autocomplete="off" value="' + esc(initial || '') + '">' +
        '<kbd>Esc</kbd>' +
      '</div>' +
      '<div class="cmdk-list"></div>' +
      '<div class="cmdk-foot"><span><kbd>↑</kbd><kbd>↓</kbd> выбор</span><span><kbd>Enter</kbd> открыть</span><span><kbd>Ctrl</kbd>+<kbd>K</kbd> закрыть</span></div>' +
    '</div>';
  document.body.appendChild(layer);
  paletteLayer = layer;
  const input = $('input', layer);
  const listEl = $('.cmdk-list', layer);

  const commands = [
    { label: 'Новая закладка', icon: 'plus', kbd: 'Ctrl N', run: () => bookmarkDialog({}) },
    { label: 'Новая папка', icon: 'folderPlus', kbd: 'Ctrl ⇧ N', run: () => folderDialog({}) },
    { label: 'Быстрая ссылка на панель', icon: 'sparkles', run: () => dockDialog({}) },
    { label: 'Настройки', icon: 'sliders', kbd: 'Ctrl ,', run: () => openSettings() },
    { label: 'Переключить тему', icon: resolveTheme() === 'dark' ? 'sun' : 'moon', run: () => { state.settings.theme = resolveTheme() === 'dark' ? 'light' : 'dark'; applyTheme(); saveAll(); render(); } },
    { label: 'Экспорт в HTML (для браузера)', icon: 'download', run: () => exportHTML() },
    { label: 'Экспорт в JSON', icon: 'download', run: () => exportJSON() },
    { label: 'Импорт из файла', icon: 'upload', run: () => pickFile('.json,.html,.htm', (f) => (/\.json$/i.test(f.name) ? importJSONFile(f) : importHTMLFile(f))) },
    { label: 'Подключить JSON-файл на диске', icon: 'database', run: () => connectFileDialog() },
    { label: 'Показать/скрыть боковую панель', icon: 'panel', kbd: 'Ctrl B', run: () => toggleSidebar() },
    { label: 'Горячие клавиши', icon: 'keyboard', kbd: '?', run: () => openShortcuts() },
    { label: 'Все закладки', icon: 'stack', run: () => setView('all') },
    { label: 'Избранное', icon: 'star', run: () => setView('favorites') },
    { label: 'Архив', icon: 'archive', run: () => setView('archive') },
    { label: 'Корзина', icon: 'trash', run: () => setView('trash') }
  ];

  function build(q) {
    const query = q.trim().toLowerCase();
    items = [];
    const pushGroup = (title, arr) => { if (arr.length) items.push({ group: title }, ...arr); };
    const cmds = commands.filter((c) => !query || c.label.toLowerCase().includes(query));
    pushGroup('Команды', cmds.map((c) => ({ type: 'cmd', icon: c.icon, label: c.label, kbd: c.kbd, run: c.run })));
    if (query) {
      const folders = state.folders.filter((f) => f.name.toLowerCase().includes(query)).slice(0, 5)
        .map((f) => ({ type: 'folder', icon: 'folder', label: f.name, path: folderPath(f.id).slice(0, -1).map((x) => x.name).join(' / '), run: () => { closePalette(); setView('folder', f.id); } }));
      pushGroup('Папки', folders);
    }
    const bms = (query
      ? activeBookmarks().filter((b) => (b.title + ' ' + b.url + ' ' + (b.tags || []).join(' ') + ' ' + (b.description || '')).toLowerCase().includes(query))
      : activeBookmarks().slice().sort((a, b) => (b.lastOpened || 0) - (a.lastOpened || 0))
    ).slice(0, 12).map((b) => ({
      type: 'bookmark', icon: b.favorite ? 'star' : 'link', label: b.title, meta: domainOf(b.url), bm: b,
      path: folderPath(b.folderId).map((x) => x.name).join(' / '),
      run: () => { closePalette(); openBookmark(b.id); }
    }));
    pushGroup(query ? 'Закладки' : 'Недавние закладки', bms);
    const first = items.findIndex((it) => !it.group);
    active = first < 0 ? 0 : first;
    paint();
  }
  function paint() {
    listEl.innerHTML = items.map((it, i) => {
      if (it.group) return '<div class="cmdk-group">' + esc(it.group) + '</div>';
      return '<button type="button" class="cmdk-item ' + (i === active ? 'active' : '') + '" data-i="' + i + '">' +
        '<span class="ico">' + icon(it.icon || 'link', 16) + '</span>' +
        '<span class="lbl">' + (it.type === 'bookmark' ? hl(it.label, input.value) : esc(it.label)) + '</span>' +
        (it.kbd ? '<kbd style="margin-left:auto">' + esc(it.kbd) + '</kbd>' : '') +
        (it.path ? '<span class="path">' + esc(it.path) + '</span>' : (it.meta ? '<span class="path">' + esc(it.meta) + '</span>' : '')) +
      '</button>';
    }).join('') || '<div style="padding:18px;color:var(--muted);font-size:12.5px">Ничего не найдено</div>';
    const act = listEl.querySelector('.cmdk-item.active');
    if (act) act.scrollIntoView({ block: 'nearest' });
  }
  function move(delta) {
    const actionable = items.map((it, i) => ({ it, i })).filter((x) => !x.it.group).map((x) => x.i);
    if (!actionable.length) return;
    let pos = actionable.indexOf(active);
    pos = clamp(pos + delta, 0, actionable.length - 1);
    active = actionable[pos];
    paint();
  }
  function choose() {
    const it = items[active];
    if (!it || !it.run) return;
    const run = it.run;
    closePalette();
    run();
  }
  input.addEventListener('input', () => build(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(); }
    else if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
  });
  layer.addEventListener('click', (e) => {
    if (e.target === layer) { closePalette(); return; }
    const item = e.target.closest('.cmdk-item');
    if (item) { active = +item.dataset.i; choose(); }
  });
  build(initial || '');
  setTimeout(() => input.focus(), 20);
}

/* ============================================================
   21. Global actions
   ============================================================ */
function toggleSidebar() {
  const app = $('#app');
  if (window.innerWidth <= 900) app.classList.toggle('sidebar-open');
  else { state.settings._collapsed = !state.settings._collapsed; applyLayout(); saveAll(); }
}
function setView(view, folderId) {
  ui.limit = 320;
  ui.view = view;
  ui.folderId = view === 'folder' ? folderId || null : null;
  if (view !== 'tag') ui.tag = null;
  ui.selection.clear();
  const app = $('#app');
  if (window.innerWidth <= 900) app.classList.remove('sidebar-open');
  render();
  const c = $('#content');
  if (c) c.scrollTop = 0;
}
function clearSearch() {
  ui.limit = 320;
  ui.query = '';
  const inp = $('#searchInput');
  if (inp) {
    inp.value = '';
    inp.closest('.search').classList.remove('has-value');
  }
  render();
}
function deleteDemo() {
  const snap = dataSnapshot();
  state = emptyState();
  ui.selection.clear();
  applyTheme(); applyAccent(); applyLayout();
  saveAll();
  render();
  if (settingsPaint) settingsPaint();
  toastUndo('Демо-данные удалены — начинаем с чистого листа', snap, { type: 'success' });
}
function wipeAll() {
  confirmDialog({
    title: 'Удалить вообще всё?',
    text: 'Пропадут все закладки, папки, быстрые ссылки, архив и корзина.',
    note: 'Действие можно отменить кнопкой в уведомлении, а также восстановить из снимка.',
    confirmLabel: 'Удалить всё',
    danger: true
  }).then((ok) => {
    if (!ok) return;
    const snap = dataSnapshot();
    state = emptyState();
    ui.selection.clear();
    ui.view = 'all'; ui.folderId = null;
    applyTheme(); applyAccent(); applyLayout();
    saveAll();
    render();
    if (settingsPaint) settingsPaint();
    toastUndo('Все данные удалены', snap, { type: 'error' });
  });
}
function trashEmpty() {
  if (!state.trash.length) { toast('Корзина уже пуста'); return; }
  confirmDialog({
    title: 'Очистить корзину?',
    text: 'Будет удалено закладок навсегда: ' + state.trash.length + '.',
    confirmLabel: 'Очистить',
    danger: true
  }).then((ok) => {
    if (!ok) return;
    const snap = dataSnapshot();
    state.trash = [];
    saveAll();
    render();
    toastUndo('Корзина очищена', snap);
  });
}
function removeSelected() {
  const ids = Array.from(ui.selection);
  if (!ids.length) return;
  const doIt = () => removeBookmarksWithUndo(ids);
  if (!state.settings.confirmDelete || ids.length > 3) {
    if (ids.length > 3) {
      confirmDialog({
        title: 'Удалить ' + ids.length + ' закладок?',
        text: 'Они переместятся в корзину — оттуда можно восстановить.',
        confirmLabel: 'В корзину',
        danger: true
      }).then((ok) => { if (ok) doIt(); });
    } else doIt();
  } else doIt();
}
function handleAction(act, el, e) {
  const id = el.dataset.id;
  switch (act) {
    case 'nav': setView(el.dataset.view); return;
    case 'open-folder': setView('folder', id); return;
    case 'toggle-folder': {
      e.stopPropagation();
      if (ui.collapsed.has(id)) ui.collapsed.delete(id); else ui.collapsed.add(id);
      renderSidebar();
      return;
    }
    case 'folder-menu': {
      e.stopPropagation();
      const f = folderById(id);
      if (f) { const r = el.getBoundingClientRect(); folderMenu(f, r.left, r.bottom + 4); }
      return;
    }
    case 'tag': {
      ui.view = 'tag'; ui.tag = el.dataset.tag; ui.folderId = null; ui.selection.clear();
      render();
      return;
    }
    case 'clear-search': clearSearch(); return;
    case 'new-bm': bookmarkDialog({}); return;
    case 'new-folder': folderDialog({}); return;
    case 'set-view': state.settings.view = el.dataset.mode; saveAll(); render(); if (settingsPaint) settingsPaint(); return;
    case 'select-mode': {
      ui.selectMode = !ui.selectMode;
      if (!ui.selectMode) ui.selection.clear();
      render();
      return;
    }
    case 'show-more': {
      ui.limit += 320;
      render();
      return;
    }
    case 'open-bm': {
      if (ui.selectMode) {
        if (e.shiftKey) selectBookmark(id, e);
        else {
          if (ui.selection.has(id)) ui.selection.delete(id); else ui.selection.add(id);
          ui.anchorId = id;
          renderSelectionBar();
          render();
        }
        return;
      }
      if (e.ctrlKey || e.metaKey || e.shiftKey || !state.settings.clickOpens) {
        selectBookmark(id, e);
        return;
      }
      if (Date.now() - lastDragEnd < 240) return;
      openBookmark(id);
      return;
    }
    case 'bm-star': {
      e.stopPropagation();
      const bm = bookmarkById(id);
      if (!bm) return;
      bm.favorite = !bm.favorite;
      bm.updatedAt = Date.now();
      saveAll(); render();
      if (bm.favorite) toast('Добавлено в избранное', { icon: 'star', type: 'success' });
      return;
    }
    case 'bm-edit': e.stopPropagation(); bookmarkDialog({ bookmarkId: id }); return;
    case 'bm-menu': {
      e.stopPropagation();
      const bm = bookmarkById(id);
      if (bm) { const r = el.getBoundingClientRect(); bookmarkMenu(bm, r.right - 190, r.bottom + 4); }
      return;
    }
    case 'dock-add': dockDialog({}); return;
    case 'dock-open': if (Date.now() - lastDragEnd < 240) return; {
      const item = state.dock.find((d) => d.id === id);
      if (!item) return;
      if (!isSafeUrl(item.url)) { toast('Ссылка заблокирована', { type: 'error' }); return; }
      if (state.settings.openNewTab) window.open(item.url, '_blank', 'noopener');
      else window.location.href = item.url;
      return;
    }
    case 'dock-edit': {
      e.stopPropagation();
      const r = el.getBoundingClientRect();
      openMenu([
        { label: 'Открыть', icon: 'external', onClick: () => { const it = state.dock.find((d) => d.id === id); if (it) window.open(it.url, '_blank', 'noopener'); } },
        { label: 'Изменить', icon: 'pencil', onClick: () => dockDialog({ dockId: id }) },
        { sep: true },
        { label: 'Убрать с панели', icon: 'trash', danger: true, onClick: () => {
          const item = state.dock.find((d) => d.id === id);
          state.dock = state.dock.filter((d) => d.id !== id);
          state.dock.sort((a, b) => a.order - b.order).forEach((d, i) => { d.order = i; });
          saveAll(); render();
          toastUndo('Убрано с панели', dataSnapshot());
        } }
      ], r.right - 180, r.bottom + 4);
      return;
    }
    case 'trash-restore': {
      e.stopPropagation();
      const bm = state.trash.find((b) => b.id === id);
      if (!bm) return;
      state.trash = state.trash.filter((b) => b.id !== id);
      delete bm.deletedAt;
      if (bm.folderId && !folderById(bm.folderId)) bm.folderId = null;
      bm.order = nextOrder(bm.folderId);
      state.bookmarks.push(bm);
      saveAll(); render();
      toast('Закладка восстановлена', { type: 'success', icon: 'restore' });
      return;
    }
    case 'trash-delete': {
      e.stopPropagation();
      const snap = dataSnapshot();
      state.trash = state.trash.filter((b) => b.id !== id);
      saveAll(); render();
      toastUndo('Удалено навсегда', snap);
      return;
    }
    case 'trash-empty': trashEmpty(); return;
    case 'sel-clear': ui.selection.clear(); render(); return;
    case 'sel-open': {
      const list = currentBookmarks().filter((b) => ui.selection.has(b.id)).slice(0, 12);
      list.forEach((b, i) => setTimeout(() => openBookmark(b.id, true), i * 120));
      toast('Открываю ' + list.length + ' вкладок', { icon: 'external' });
      return;
    }
    case 'sel-star': {
      const ids = Array.from(ui.selection);
      ids.forEach((bid) => { const bm = bookmarkById(bid); if (bm) bm.favorite = true; });
      saveAll(); render();
      toast('Добавлено в избранное: ' + ids.length, { type: 'success', icon: 'star' });
      return;
    }
    case 'sel-move': {
      const r = el.getBoundingClientRect();
      const items = [{ title: 'Переместить в' },
        { label: 'Без папки (корень)', icon: 'home', onClick: () => moveSelectedTo(null) }];
      (function walk(pid, depth) {
        childFolders(pid).forEach((f) => {
          items.push({ label: '\u00a0\u00a0'.repeat(depth) + (f.emoji || '📁') + ' ' + f.name, onClick: () => moveSelectedTo(f.id) });
          walk(f.id, depth + 1);
        });
      })(null, 0);
      openMenu(items, r.left, r.top - 20 - Math.min(400, (state.folders.length + 2) * 34));
      return;
    }
    case 'sel-archive': {
      const n = archiveBookmarks(Array.from(ui.selection), true);
      ui.selection.clear();
      saveAll(); render();
      toast('В архив отправлено: ' + n, { icon: 'archive' });
      return;
    }
    case 'sel-delete': removeSelected(); return;
    case 'load-demo': seedDemo(true); return;
    case 'toggle-sidebar': toggleSidebar(); return;
    case 'settings': openSettings(); return;
    case 'palette': openPalette(); return;
    case 'shortcuts': openShortcuts(); return;
    case 'theme-toggle': {
      state.settings.theme = resolveTheme() === 'dark' ? 'light' : 'dark';
      applyTheme(); saveAll(); render();
      if (settingsPaint) settingsPaint();
      return;
    }
    case 'nav-settings-archive': setView('archive'); { const t = modalStack[modalStack.length - 1]; if (t) t.close(); } return;
    case 'nav-settings-trash': setView('trash'); { const t = modalStack[modalStack.length - 1]; if (t) t.close(); } return;
    case 'file-connect': connectFileDialog(); return;
    case 'file-save': if (fileHandle) writeToLinkedFile(true); else connectFileDialog(); return;
    case 'file-detach': detachFile(); return;
    case 'export-json': exportJSON(); return;
    case 'export-html': exportHTML(); return;
    case 'import-json': pickFile('.json', importJSONFile); return;
    case 'import-html': pickFile('.html,.htm', importHTMLFile); return;
    case 'snapshot-now': maybeSnapshot(true); toast('Снимок создан', { type: 'success', icon: 'save' }); if (settingsPaint) settingsPaint(); return;
    case 'restore-snap': {
      const snap = readSnapshots().find((s) => s.id === el.dataset.snap);
      if (!snap) return;
      confirmDialog({
        title: 'Восстановить снимок от ' + fmtDate(snap.at) + '?',
        text: 'Текущие данные заменятся содержимым снимка.',
        confirmLabel: 'Восстановить'
      }).then((ok) => {
        if (!ok) return;
        const cur = dataSnapshot();
        try {
          const d = JSON.parse(snap.data);
          if (d.settings) state.settings = Object.assign(state.settings, d.settings);
          state.dock = d.dock || []; state.folders = d.folders || []; state.bookmarks = d.bookmarks || []; state.trash = d.trash || [];
          applyTheme(); applyAccent(); applyLayout();
          saveAll(); render();
          if (settingsPaint) settingsPaint();
          toastUndo('Снимок восстановлен', cur, { type: 'success' });
        } catch (err) { toast('Снимок повреждён', { type: 'error' }); }
      });
      return;
    }
    case 'delete-demo': deleteDemo(); return;
    case 'wipe-all': wipeAll(); return;
    default: return;
  }
}
function moveSelectedTo(folderId) {
  const ids = Array.from(ui.selection);
  ids.forEach((id) => moveBookmark(id, folderId, null, false));
  ui.selection.clear();
  saveAll(); render();
  toast(folderId ? 'Перемещено в «' + (folderById(folderId) || {}).name + '»' : 'Перемещено в корень');
}

/* ============================================================
   22. Demo data
   ============================================================ */
function seedDemo(force) {
  const snap = force ? dataSnapshot() : null;
  const now = Date.now();
  const mkFolder = (name, emoji, color, parentId, order) => ({ id: uid('f'), name, emoji, color, parentId: parentId || null, order: order || 0, createdAt: now - 86400000 * 3 });
  const fLook = mkFolder('Надо посмотреть', '👀', '#6c8cff', null, 0);
  const fWork = mkFolder('Работа', '💼', '#10b981', null, 1);
  const fProj = mkFolder('Проекты', '🎯', '#06b6d4', fWork.id, 0);
  const fDesign = mkFolder('Дизайн', '🎨', '#ec4899', null, 2);
  const fRead = mkFolder('Читать', '📚', '#f59e0b', null, 3);
  const fTools = mkFolder('Инструменты', '🛠', '#8b5cf6', null, 4);
  const folders = [fLook, fWork, fProj, fDesign, fRead, fTools];

  const items = [
    ['Как устроен CSS Grid — полный гайд', 'https://css-tricks.com/snippets/css/complete-guide-grid/', fLook.id, ['css', 'фронтенд'], 'Шпаргалка по grid-раскладке, к которой возвращаюсь каждый раз.'],
    ['Web.dev — Core Web Vitals', 'https://web.dev/vitals/', fLook.id, ['performance'], 'Метрики скорости, которые влияют на SEO.'],
    ['Возможно, вы этого не знали про JavaScript', 'https://habr.com/ru/', fLook.id, ['js', 'статьи'], ''],
    ['Доклад: как мы строили дизайн-систему', 'https://www.youtube.com/', fLook.id, ['видео', 'дизайн'], '55 минут, но очень по делу.'],
    ['Актуальные задачи', 'https://linear.app/', fWork.id, ['работа', 'таск-трекер'], 'Спринт и беклог — всё здесь.'],
    ['Командная база знаний', 'https://www.notion.so/', fWork.id, ['работа', 'документы'], ''],
    ['GitHub — репозиторий проекта', 'https://github.com/', fWork.id, ['работа', 'код'], ''],
    ['Макеты текущего релиза', 'https://www.figma.com/', fProj.id, ['работа', 'макеты'], ''],
    ['Роадмап на квартал', 'https://docs.google.com/', fProj.id, ['работа', 'планы'], ''],
    ['Mobbin — паттерны мобильных приложений', 'https://mobbin.com/', fDesign.id, ['дизайн', 'референсы'], 'Когда нужно подсмотреть удачное решение.'],
    ['Dribbble', 'https://dribbble.com/', fDesign.id, ['дизайн'], ''],
    ['Figma Community', 'https://www.figma.com/community', fDesign.id, ['дизайн', 'плагины'], 'Бесплатные плагины и библиотеки.'],
    ['Хабр', 'https://habr.com/ru/', fRead.id, ['статьи', 'it'], 'Каждый день за чашкой кофе.'],
    ['Hacker News', 'https://news.ycombinator.com/', fRead.id, ['новости'], ''],
    ['Squoosh — сжатие картинок', 'https://squoosh.app/', fTools.id, ['инструменты'], 'Быстро ужать картинку до загрузки.', true],
    ['Проверка поддержки CSS', 'https://caniuse.com/', fTools.id, ['инструменты', 'css'], ''],
    ['Regex101', 'https://regex101.com/', fTools.id, ['инструменты', 'regex'], 'С подсветкой и объяснением регулярки.'],
    ['Старый таск-трекер (не нужен)', 'https://trello.com/', null, ['архив'], 'Оставил на память.', false, true]
  ];
  let order = {};
  const bookmarks = items.map(([title, url, folderId, tags, description, favorite, archived]) => {
    order[folderId] = (order[folderId] || 0);
    return {
      id: uid('b'), title, url, folderId, tags: tags || [], description: description || '', notes: '',
      favorite: !!favorite, archived: !!archived,
      iconType: 'favicon', icon: '', color: '',
      clicks: (favorite ? 12 : Math.floor(Math.random() * 6)),
      createdAt: now - Math.floor(Math.random() * 86400000 * 40),
      updatedAt: now - Math.floor(Math.random() * 86400000 * 5),
      lastOpened: now - Math.floor(Math.random() * 86400000 * 6),
      order: order[folderId]++
    };
  });
  const dock = [
    ['Почта', 'https://mail.google.com/', '#ef4444'],
    ['YouTube', 'https://www.youtube.com/', '#ef4444'],
    ['GitHub', 'https://github.com/', '#6c8cff'],
    ['Notion', 'https://www.notion.so/', '#334155'],
    ['Figma', 'https://www.figma.com/', '#8b5cf6'],
    ['ChatGPT', 'https://chatgpt.com/', '#10b981'],
    ['Карты', 'https://maps.google.com/', '#f59e0b'],
    ['Хабр', 'https://habr.com/ru/', '#06b6d4']
  ].map(([title, url, color], i) => ({ id: uid('dock'), title, url, iconType: 'favicon', icon: '⭐', color, order: i }));

  state = emptyState();
  state.folders = folders;
  state.bookmarks = bookmarks;
  state.dock = dock;
  state.trash = [{
    id: uid('b'), title: 'Что-то ненужное (пример корзины)', url: 'https://example.com/', folderId: null,
    tags: [], description: '', notes: '', favorite: false, archived: false, iconType: 'favicon', icon: '', color: '',
    clicks: 0, createdAt: now - 86400000 * 9, updatedAt: now - 86400000 * 2, lastOpened: 0, order: 0, deletedAt: now - 86400000
  }];
  state.meta.demo = true;
  ui.view = 'all'; ui.folderId = null; ui.query = ''; ui.tag = null; ui.selection.clear();
  applyTheme(); applyAccent(); applyLayout();
  saveAll();
  render();
  if (settingsPaint) settingsPaint();
  if (force) {
    toast('Загружены демо-данные — можно всё сломать и посмотреть', {
      type: 'success', actionLabel: 'Убрать демо', duration: 9000,
      onAction: () => deleteDemo()
    });
  }
}

/* ============================================================
   23. Boot
   ============================================================ */
function bindGlobalEvents() {
  document.addEventListener('click', (e) => {
    if (menuEl && !e.target.closest('.menu')) closeMenu();
    const actEl = e.target.closest('[data-act]');
    if (!actEl) {
      if (e.target.closest('#content') && !e.target.closest('.modal') && ui.selection.size) {
        ui.selection.clear();
        render();
      }
      return;
    }
    if (actEl.closest('.modal-layer') && !actEl.closest('[data-act="new-bm"], [data-act="new-folder"]')) {
      /* actions inside modals are wired locally; allow the generic ones too */
    }
    try { handleAction(actEl.dataset.act, actEl, e); } catch (err) { console.error(err); }
  });

  document.addEventListener('dblclick', (e) => {
    const bmEl = e.target.closest('.bookmark');
    if (bmEl && !state.settings.clickOpens) openBookmark(bmEl.dataset.id);
  });

  document.addEventListener('contextmenu', (e) => {
    const bmEl = e.target.closest('.bookmark');
    const folderEl = e.target.closest('.folder-card, .tree-row .nav-item[data-act="open-folder"]');
    const dockEl = e.target.closest('.dock-tile:not(.add)');
    if (bmEl) {
      e.preventDefault();
      const bm = bookmarkById(bmEl.dataset.id);
      if (bm) bookmarkMenu(bm, e.clientX, e.clientY);
    } else if (folderEl) {
      e.preventDefault();
      const f = folderById(folderEl.dataset.id);
      if (f) folderMenu(f, e.clientX, e.clientY);
    } else if (dockEl) {
      e.preventDefault();
      const item = state.dock.find((d) => d.id === dockEl.dataset.id);
      if (item) {
        openMenu([
          { label: 'Открыть', icon: 'external', onClick: () => window.open(item.url, '_blank', 'noopener') },
          { label: 'Изменить', icon: 'pencil', onClick: () => dockDialog({ dockId: item.id }) },
          { sep: true },
          { label: 'Убрать с панели', icon: 'trash', danger: true, onClick: () => {
            const snap = dataSnapshot();
            state.dock = state.dock.filter((d) => d.id !== item.id);
            state.dock.sort((a, b) => a.order - b.order).forEach((d, i) => { d.order = i; });
            saveAll(); render();
            toastUndo('Убрано с панели', snap);
          } }
        ], e.clientX, e.clientY);
      }
    }
  });

  document.addEventListener('change', (e) => {
    const sel = e.target.closest('select[data-act="sort"]');
    if (sel) { ui.sort = sel.value; render(); }
  });

  $('#fileInput').addEventListener('change', onFileInputChange);

  const searchInput = $('#searchInput');
  const doSearch = debounce(() => { ui.query = searchInput.value; ui.limit = 320; render(); }, 70);
  searchInput.addEventListener('input', () => {
    searchInput.closest('.search').classList.toggle('has-value', !!searchInput.value);
    doSearch();
  });
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); clearSearch(); searchInput.blur(); }
    if (e.key === 'Enter') {
      e.preventDefault();
      const first = currentBookmarks()[0];
      if (first) openBookmark(first.id);
    }
  });

  $('#syncPill').addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const items = [
      { title: 'JSON-файл' },
      { label: fileHandle ? 'Сменить файл' : 'Подключить файл', icon: 'database', onClick: () => connectFileDialog() },
      ...(fileHandle ? [
        { label: 'Сохранить сейчас', icon: 'save', onClick: () => writeToLinkedFile(true) },
        { label: 'Отвязать файл', icon: 'x', onClick: () => detachFile() }
      ] : []),
      { sep: true },
      { label: 'Скачать JSON', icon: 'download', onClick: () => downloadJSON() },
      { label: 'Экспорт для браузера (HTML)', icon: 'download', onClick: () => exportHTML() },
      { sep: true },
      { label: 'Все настройки', icon: 'sliders', onClick: () => openSettings() }
    ];
    openMenu(items, r.right - 220, r.bottom + 6);
  });

  document.addEventListener('keydown', (e) => {
    const target = document.activeElement;
    const typing = target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable);
    const mod = e.ctrlKey || e.metaKey;

    if (e.key === 'Escape') {
      if (menuEl) { closeMenu(); return; }
      if (paletteLayer) { closePalette(); return; }
      if (modalStack.length) { modalStack[modalStack.length - 1].close(); return; }
      if (ui.selection.size) { ui.selection.clear(); render(); return; }
      if (typing && target === searchInput) clearSearch();
      return;
    }
    if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); if (paletteLayer) closePalette(); else openPalette(); return; }
    if (mod && e.code === 'KeyN' && e.shiftKey) { e.preventDefault(); folderDialog({}); return; }
    if (mod && e.code === 'KeyN') { e.preventDefault(); bookmarkDialog({}); return; }
    if (mod && e.code === 'KeyB') { e.preventDefault(); toggleSidebar(); return; }
    if (mod && e.code === 'KeyS') { e.preventDefault(); if (fileHandle) writeToLinkedFile(true); else downloadJSON(); return; }
    if (mod && e.code === 'Comma') { e.preventDefault(); openSettings(); return; }
    if (typing) {
      if (e.key === 'Enter' && target && target.closest && target.closest('.bookmark')) {
        openBookmark(target.closest('.bookmark').dataset.id);
      }
      return;
    }
    if (e.key === '/') { e.preventDefault(); searchInput.focus(); return; }
    if (e.key === '?') { e.preventDefault(); openShortcuts(); return; }
    if (e.key === 'Enter' && target && target.closest && target.closest('.bookmark')) {
      e.preventDefault();
      openBookmark(target.closest('.bookmark').dataset.id);
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && ui.selection.size) { e.preventDefault(); removeSelected(); return; }
    if (e.code === 'KeyE' && ui.selection.size === 1) { e.preventDefault(); bookmarkDialog({ bookmarkId: Array.from(ui.selection)[0] }); return; }
    if (mod && e.code === 'KeyA' && e.target.closest && e.target.closest('#content')) {
      e.preventDefault();
      currentBookmarks().forEach((b) => ui.selection.add(b.id));
      render();
    }
  });

  window.addEventListener('resize', () => {
    const app = $('#app');
    if (window.innerWidth > 900) app.classList.remove('sidebar-open');
    applyLayout();
  });

  /* sidebar resize */
  const resizer = $('#sideResizer');
  let resizing = false;
  resizer.addEventListener('mousedown', (e) => {
    e.preventDefault();
    resizing = true;
    resizer.classList.add('active');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });
  window.addEventListener('mousemove', (e) => {
    if (!resizing) return;
    const w = clamp(e.clientX, 220, 440);
    state.settings.sidebarWidth = w;
    document.documentElement.style.setProperty('--sidebar-w', w + 'px');
  });
  window.addEventListener('mouseup', () => {
    if (!resizing) return;
    resizing = false;
    resizer.classList.remove('active');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    saveAll();
  });

  /* prevent app from dying when a thumb drag over the window */
  window.addEventListener('dragover', (e) => { if (e.dataTransfer && Array.from(e.dataTransfer.types || []).indexOf('Files') !== -1) e.preventDefault(); });
}

function boot() {
  const had = loadState();
  if (!had) {
    /* first visit — load a friendly demo set */
    seedDemo(false);
    setTimeout(() => {
      if (!state.meta.demo) return;
      toast('Это демо-данные — посмотрите, как всё устроено, и уберите их одной кнопкой', {
        actionLabel: 'Очистить', duration: 11000, onAction: () => deleteDemo()
      });
    }, 1200);
  } else {
    ui.view = 'all';
    render();
    if (state.meta.demo) {
      setTimeout(() => toast('Демо-данные всё ещё здесь — уберите их в настройках', { icon: 'sparkles' }), 1200);
    }
  }
  applyTheme(); applyAccent(); applyLayout();
  bindGlobalEvents();
  attachDnD();
  render();
  if (state.settings.autoSnapshots) maybeSnapshot(true);
  restoreHandleOnStart();
  /* theme reacts to the system */
  if (window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => { if (state.settings.theme === 'auto') applyTheme(); };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
  }
  /* flush to localStorage when the tab goes away */
  const flush = () => { try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) {} };
  window.addEventListener('pagehide', flush);
  window.addEventListener('beforeunload', flush);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });

  /* periodic snapshot while working */
  setInterval(() => { if (state.settings.autoSnapshots) maybeSnapshot(false); }, 120000);
  setTimeout(() => {
    const b = $('#boot');
    if (!b) return;
    b.classList.add('done');
    setTimeout(() => b.remove(), 700);
  }, 120);
  window.__bs = {
    state: () => state, ui: () => ui, render, openPalette, seedDemo, setView,
    importHTML: (text, name) => { const parsed = parseNetscapeHTML(text); return parsed.bookmarks.length ? importPayloadDialog(parsed, name || 'paste.html') : Promise.resolve(false); },
    importJSON: (obj) => importPayloadDialog(obj, 'paste.json'),
    exportPayload: dataPayload,
    exportHTMLString: buildHTMLExport,
    parseHTML: parseNetscapeHTML,
    coalesce: coalesceState,
    addBulk: (n) => {
      for (let i = 0; i < n; i++) {
        state.bookmarks.push({ id: 'bulk' + i, title: 'Закладка ' + i, url: 'https://bulk' + i + '.example/x', folderId: null, tags: ['bulk'], description: '', favorite: false, archived: false, iconType: 'letter', icon: '', color: '', clicks: 0, createdAt: Date.now(), updatedAt: Date.now(), lastOpened: 0, order: 1000 + i });
      }
      render();
    }
  };
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
})();
