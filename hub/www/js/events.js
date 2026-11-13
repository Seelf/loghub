// Zdarzenia: skoki liczby bledow i nowe rodzaje bledow, grupowane we wzorce.
// norma zrodla: 75. percentyl bledow na godzine; staly szum: bledy w co najmniej polowie godzin
function baseOf(series) {
  const m = new Map();
  for (const h of series) {
    if (!h.f.host) continue;
    const v = h.v.slice(0, -1),
      s = v.slice().sort((a, b) => a - b),
      nz = v.filter(x => x > 0).length;
    m.set(key(h.f), {
      p75: s[Math.floor(s.length * 0.75)] || 0,
      chronic: v.length >= 23 && nz / v.length >= 0.5,
      rate: sum(v) / Math.max(1, v.length),
    });
  }
  return m;
}
const thrOf = b => Math.max(5, Math.ceil(4 * (b ? b.p75 : 0)));
// rodzaje bledow (liczby zwiniete do <N>), ktore pierwszy raz pojawily sie w [from, to]; porownanie z 14 dniami wczesniej
async function patterns(from, to) {
  const q =
    ERR +
    ' ' +
    EXCL +
    ' | collapse_nums | stats by (host, source, unit, _msg) min(_time) first, count() c | sort by (first desc) | limit 400';
  const rows = parseLines(
    await (await api('query', { query: q, start: iso(from - 14 * 24 * H), end: iso(to) })).text(),
  );
  return rows
    .filter(o => o.host && o.source !== 'stat' && o.source !== 'crondef')
    .map(o => ({
      f: { host: o.host, source: o.source, unit: o.unit },
      k: key(o),
      msg: o._msg || '',
      first: Date.parse(o.first),
      c: +o.c || 0,
    }))
    .filter(p => p.first >= from);
}
function incidentsFrom(series, base, from, news) {
  const out = [],
    by = new Map(),
    push = c => {
      out.push(c);
      (by.get(c.k) || by.set(c.k, []).get(c.k)).push(c);
    };
  for (const h of series) {
    if (!h.f.host) continue;
    const k = key(h.f),
      b = base.get(k),
      thr = thrOf(b);
    let c = null;
    h.v.forEach((x, i) => {
      const t = h.t0 + i * H;
      if (t + H <= from || x < thr) return;
      if (c && t - c.to <= H) {
        c.to = t + H;
        c.lines += x;
        c.peak = Math.max(c.peak, x);
      } else {
        c = { f: h.f, k, from: t, to: t + H, lines: x, peak: x, norm: b ? b.p75 : 0, spike: true, news: [] };
        push(c);
      }
    });
  }
  // nowe rodzaje bledow: doklejone do skoku tego samego zrodla albo jako osobne zdarzenie
  const nk = new Map();
  for (const p of news || []) (nk.get(p.k) || nk.set(p.k, []).get(p.k)).push(p);
  for (const [k, ps] of nk) {
    ps.sort((a, b) => a.first - b.first);
    if (ps.length > 12) {
      // wiele naraz: nowe zrodlo albo duza zmiana - jedno zdarzenie
      push({
        f: ps[0].f,
        k,
        from: Math.floor(ps[0].first / H) * H,
        to: Math.floor(ps[ps.length - 1].first / H) * H + H,
        lines: sum(ps.map(p => p.c)),
        peak: 0,
        spike: false,
        many: true,
        news: ps.slice().sort((a, b) => b.c - a.c),
      });
      continue;
    }
    for (const p of ps) {
      let c = (by.get(k) || []).find(x => !x.many && p.first >= x.from - H && p.first < x.to + H);
      if (!c) {
        const hb = Math.floor(p.first / H) * H;
        c = { f: p.f, k, from: hb, to: hb + H, lines: 0, peak: 0, spike: false, news: [] };
        push(c);
      }
      c.news.push(p);
      if (!c.spike) c.lines += p.c;
    }
  }
  return out.sort((a, b) => b.from - a.from);
}
