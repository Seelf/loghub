// Dane: lista zrodel, wolumeny, bazowe poziomy bledow i nowe bledy (wczytywane etapami).
async function hits(query, from, step, fields = []) {
  const now = Date.now(),
    t0 = Math.floor(from / step) * step,
    n = Math.ceil((now - t0) / step);
  const p = [
    ['query', query],
    ['start', new Date(from).toISOString()],
    ['end', new Date(now).toISOString()],
    ['step', step / 1e3 + 's'],
    ...fields.map(f => ['field', f]),
  ];
  const j = await (await api('hits', p)).json();
  return (j.hits || []).map(h => {
    const v = new Array(n).fill(0);
    (h.timestamps || []).forEach((ts, i) => {
      const k = Math.floor((Date.parse(ts) - t0) / step);
      if (k >= 0 && k < n) v[k] += h.values[i];
    });
    return { f: h.fields || {}, v, total: h.total || 0, t0 };
  });
}
const last24 = v => {
  const a = v.slice(-24);
  while (a.length < 24) a.unshift(0);
  return a;
};

// ciezsze zapytania (7 dni, wzorce bledow, cron) ida rzadziej i w tle, zeby strona rysowala sie od razu
const I = {
  base: new Map(),
  baseOk: false,
  baseT: 0,
  news: [],
  newsT: 0,
  seen: new Map(),
  seenT: 0,
  cronT: 0,
  defs: null,
  defsT: 0,
};
const iso = t => new Date(t).toISOString();
let MUTE = new Set();
try {
  MUTE = new Set(JSON.parse(localStorage.getItem('loghub.mute') || '[]'));
} catch {}
const saveMute = () => {
  try {
    localStorage.setItem('loghub.mute', JSON.stringify([...MUTE]));
  } catch {}
};
const vis = x => !MUTE.has(x.k);
const pl = (n, a, b, c) =>
  n === 1 ? a : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? b : c;

async function refresh() {
  if (!me) return;
  try {
    const now = Date.now();
    // etap 1: lekkie zapytania - lista zrodel z 24 h, kto pisze teraz, stan maszyn
    const [all, up, st] = await Promise.all([
      hits(EXCL, now - 24 * H, H, F),
      api('query', { query: '_time:5m ' + EXCL + ' | stats by (host, source, unit) count() c' })
        .then(r => r.text())
        .then(t => new Set(parseLines(t).map(key)))
        .catch(() => null),
      api('query', { query: '{source="stat"} _time:10m', limit: 500 })
        .then(r => r.text())
        .then(parseLines)
        .catch(() => []),
    ]);
    D.stat = readStat(st);
    D.all = all;
    D.up = up;
    D.now = now;
    build();
    paint();
    loadHist();
    // etap 2: bledy i ostrzezenia z 24 h
    const [er, wa] = await Promise.all([
      hits(ERR + ' ' + EXCL, now - 24 * H, H, F).catch(() => null),
      hits(WARN + ' ' + EXCL, now - 24 * H, H, F).catch(() => null),
    ]);
    if (er) D.er = er;
    if (wa) D.wa = wa;
    build();
    paint();
    // etap 3: w tle i rzadziej
    if (now - I.seenT > 10 * 6e4) loadSeen();
    if (now - I.baseT > 15 * 6e4) loadBase();
    if (now - I.newsT > 10 * 6e4) loadNews();
    if (now - I.cronT > 5 * 6e4) loadCron();
  } catch (e) {
    status('Nie udało się odświeżyć listy źródeł: ' + e.message);
  }
}
function build() {
  const now = D.now || Date.now(),
    A = new Map((D.all || []).map(h => [key(h.f), h])),
    E = new Map((D.er || []).map(h => [key(h.f), h])),
    W = new Map((D.wa || []).map(h => [key(h.f), h]));
  D.units = [];
  for (const k of new Set([...A.keys(), ...I.seen.keys()])) {
    const h = A.get(k),
      f = h ? h.f : I.seen.get(k).f;
    if (!f.host || f.source === 'crondef' || f.source === 'stat') continue;
    const li = h ? h.v.findLastIndex(x => x > 0) : -1,
      v = h ? last24(h.v) : new Array(24).fill(0),
      isUp = D.up ? D.up.has(k) : !!h && li >= h.v.length - 1;
    const ev = E.has(k) ? last24(E.get(k).v) : null,
      old = I.seen.has(k) ? I.seen.get(k).t : 0;
    D.units.push({
      host: f.host,
      source: f.source || '?',
      unit: f.unit || '?',
      k,
      v,
      c24: sum(v),
      ev,
      e24: ev ? sum(ev) : 0,
      w24: W.has(k) ? sum(last24(W.get(k).v)) : 0,
      up: isUp,
      last: isUp ? now : li < 0 ? old : Math.min(now, h.t0 + (li + 1) * H),
    });
  }
  // konto z ograniczonym dostepem: tylko jego maszyny i zrodla (centrala i tak filtruje dane, to druga warstwa)
  if (me && me.role !== 'admin' && Array.isArray(me.hosts)) {
    const okH = new Set(me.hosts),
      okU = new Set((me.units || []).map(x => x.join('\n')));
    D.units = D.units.filter(u => okH.has(u.host) || okU.has(u.k));
    for (const h of [...D.stat.keys()]) if (!okH.has(h)) D.stat.delete(h);
  }
  // kontenery bez logow i padniete uslugi tez maja byc widoczne
  for (const [host, s] of D.stat) {
    const have = new Set(D.units.filter(u => u.host === host).map(u => u.source + '\n' + u.unit));
    const add = (source, unit) => {
      if (!have.has(source + '\n' + unit))
        D.units.push({
          host,
          source,
          unit,
          k: host + '\n' + source + '\n' + unit,
          v: new Array(24).fill(0),
          c24: 0,
          ev: null,
          e24: 0,
          w24: 0,
          up: false,
          last: 0,
        });
    };
    for (const c of s.cmap.keys()) add('docker', c);
    for (const [n, x] of s.umap) if (x[1] === 'failed') add('journald', n);
  }
  // zdarzenia z 24 h: skoki ponad norme zrodla i nowe rodzaje bledow
  D.base = I.baseOk ? I.base : baseOf(D.er || []);
  D.inc = incidentsFrom(D.er || [], D.base, now - 24 * H, I.news);
  const ic = new Map(),
    nc = new Map();
  for (const x of D.inc.filter(vis)) {
    ic.set(x.k, (ic.get(x.k) || 0) + 1);
    nc.set(x.k, (nc.get(x.k) || 0) + x.news.length);
  }
  for (const u of D.units) {
    u.sel = selOf(u);
    [u.st, u.stt] = ustate(u);
    u.inc = ic.get(u.k) || 0;
    u.nnew = nc.get(u.k) || 0;
    u.norm = D.base.get(u.k) || null;
  }
  D.hosts = new Map();
  for (const u of D.units) {
    const h =
      D.hosts.get(u.host) ||
      D.hosts
        .set(u.host, {
          name: u.host,
          units: [],
          c24: 0,
          e24: 0,
          w24: 0,
          inc: 0,
          nnew: 0,
          up: false,
          last: 0,
          v: new Array(24).fill(0),
          ev: new Array(24).fill(0),
        })
        .get(u.host);
    h.units.push(u);
    h.c24 += u.c24;
    h.e24 += u.e24;
    h.w24 += u.w24;
    h.inc += u.inc;
    h.nnew += u.nnew;
    h.up = h.up || u.up;
    h.last = Math.max(h.last, u.last);
    if (u.st === 'bad') (h.bad = h.bad || []).push(u);
    u.v.forEach((x, i) => {
      h.v[i] += x;
    });
    if (u.ev)
      u.ev.forEach((x, i) => {
        h.ev[i] += x;
      });
  }
  // serwer jest online, gdy agent przyslal stan w ciagu 3 minut (gdy brak pomiarow: gdy pisze logi)
  for (const h of D.hosts.values()) {
    const s = D.stat.get(h.name);
    h.bad = h.bad || [];
    if (s) {
      h.up = now - s.t < 3 * 6e4;
      h.last = Math.max(h.last, s.t);
    }
  }
}
function paint() {
  const sc = tree.scrollTop;
  renderTree();
  tree.scrollTop = sc;
  renderOver();
  if (view === 'logs') headStats();
  if (!D.units.length && I.seenT)
    status('Brak logów z ostatnich 7 dni. Zainstaluj agenta na pierwszej maszynie.');
}
// zrodla, ktore milcza dluzej niz dobe, ale pisaly w ciagu 7 dni
async function loadSeen() {
  I.seenT = Date.now();
  try {
    const rows = parseLines(
      await (
        await api('query', { query: '_time:7d ' + EXCL + ' | stats by (host, source, unit) max(_time) t' })
      ).text(),
    );
    I.seen = new Map(
      rows
        .filter(o => o.host)
        .map(o => [key(o), { f: { host: o.host, source: o.source, unit: o.unit }, t: Date.parse(o.t) || 0 }]),
    );
    build();
    paint();
  } catch {}
}
// norma bledow kazdego zrodla z 7 dni (godzinowo)
async function loadBase() {
  I.baseT = Date.now();
  try {
    I.base = baseOf(await hits(ERR + ' ' + EXCL, Date.now() - 7 * 24 * H, H, F));
    I.baseOk = true;
    build();
    paint();
  } catch {}
}
async function loadNews() {
  I.newsT = Date.now();
  try {
    const now = Date.now();
    I.news = await patterns(now - 24 * H, now);
    build();
    paint();
  } catch {}
}
