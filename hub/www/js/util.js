// Stale, stan strony i drobne funkcje pomocnicze (formatowanie liczb, dat, elementy DOM).
const $ = s => document.querySelector(s),
  MAX = 5000,
  LIMIT = 1000,
  ALL = '*',
  H = 36e5,
  F = ['host', 'source', 'unit'];
// filtry poziomu po stronie bazy: priorytet z journald, a gdy go brak - slowa w tresci
const ERR =
  '(level:<=3 OR (level:"" (i(error) OR i(err) OR i(fatal) OR i(panic) OR i(failed) OR i(critical))))';
const WARN = '(level:4 OR (level:"" (i(warn) OR i(warning) OR i(wrn))))';
const SRC = { journald: 'systemd', docker: 'docker', file: 'pliki', cron: 'cron' };
// rekordy techniczne agenta (stan i zasoby, lista zadan cron) nie sa zwyklymi logami
const EXCL = 'NOT source:=stat NOT source:=crondef';
const log = $('#log'),
  tree = $('#tree'),
  jump = $('#jump'),
  pos = $('#pos'),
  demo = () => window.loghubDemo;
window.C_ALL = [];
let cronHost = null,
  me = null,
  D = { units: [], hosts: new Map(), stat: new Map(), hist: new Map() },
  C = [],
  cur = null,
  ctl = null,
  live = true,
  seen = new Set(),
  fresh = 0,
  word = '',
  view = 'over',
  tab = 'hosts',
  started = false;

const quote = v => JSON.stringify(String(v));
const short = u =>
  String(u || '')
    .replace(/^\/var\/log\//, '')
    .replace(/\.service$/, '');
const parseLines = t =>
  t
    .split('\n')
    .filter(Boolean)
    .map(l => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
const status = t => {
  $('#msg').textContent = t;
};
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const dec = x => x.toFixed(1).replace('.0', '').replace('.', ',');
const num = n =>
  n >= 1e6
    ? dec(n / 1e6) + 'M'
    : n >= 1e4
      ? Math.round(n / 1e3) + 'k'
      : n >= 1e3
        ? dec(n / 1e3) + 'k'
        : String(n);
const sum = a => a.reduce((x, y) => x + y, 0);
const pad = n => String(n).padStart(2, '0');
const key = f => f.host + '\n' + f.source + '\n' + f.unit;
const selOf = u => '{host=' + quote(u.host) + ',source=' + quote(u.source) + ',unit=' + quote(u.unit) + '}';
function rel(t) {
  if (!t) return 'brak';
  const s = (Date.now() - t) / 1e3;
  return s < 90
    ? 'przed chwilą'
    : s < 5400
      ? Math.round(s / 60) + ' min temu'
      : s < 129600
        ? Math.round(s / 3600) + ' godz. temu'
        : Math.round(s / 86400) + ' dni temu';
}
const relS = t => (!t ? 'brak' : rel(t) === 'przed chwilą' ? 'teraz' : rel(t).replace(' temu', ''));
function fmt(d) {
  const h = pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  return d.toDateString() === new Date().toDateString()
    ? h
    : pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + ' ' + h;
}
