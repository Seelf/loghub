// Stan i zasoby maszyn: rekordy "stat" od agentow (CPU, RAM, dyski, uslugi, porty).
const pj = x => {
  if (Array.isArray(x)) return x;
  try {
    const v = JSON.parse(x || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};
const fnum = x => {
  const v = parseFloat(String(x ?? '').replace(',', '.'));
  return isNaN(v) ? null : v;
};
function readStat(rows) {
  const m = new Map();
  for (const o of rows) {
    const t = Date.parse(o._time);
    if (!o.host || (m.has(o.host) && m.get(o.host).t >= t)) continue;
    const cs = new Map(pj(o.cstats).map(c => [c.n, c]));
    m.set(o.host, {
      t,
      o,
      cpu: fnum(o.cpu),
      mem: fnum(o.mem_pct),
      disk: fnum(o.disk_pct),
      cores: +o.cores || 1,
      load: fnum(o.load1),
      memT: +o.mem_total_kb || 0,
      memA: +o.mem_avail_kb || 0,
      diskU: +o.disk_used_kb || 0,
      diskT: +o.disk_total_kb || 0,
      cmap: new Map(pj(o.containers).map(c => [c.n, Object.assign({}, c, cs.get(c.n) || {})])),
      umap: new Map(pj(o.units).map(x => [x[0], x])),
      guests: pj(o.guests),
      disks: pj(o.disks).filter(d => Array.isArray(d) && d[4] > 0),
      pools: pj(o.pools),
      smart: pj(o.smart),
      ports: o.ports == null ? null : pj(o.ports),
      ufwState: o.ufw_state || null,
      ufw: pj(o.ufw),
    });
  }
  return m;
}
// stan kontenera lub uslugi: 'up' dziala, 'down' zatrzymane bez bledu, 'bad' padlo; null gdy nie wiadomo
function cstate(c) {
  if (c.s === 'running')
    return /unhealthy/.test(c.st)
      ? ['bad', 'działa, ale nie przechodzi kontroli zdrowia']
      : ['up', 'działa' + (/healthy/.test(c.st) ? ', zdrowy' : '')];
  if (c.s === 'restarting') return ['bad', 'ciągle się restartuje'];
  if (c.s === 'exited') return /Exited \(0\)/.test(c.st) ? ['down', 'zatrzymany'] : ['bad', 'padł: ' + c.st];
  if (c.s === 'paused') return ['down', 'wstrzymany'];
  return ['down', c.st || c.s || 'nie działa'];
}
function ustate(u) {
  const s = D.stat.get(u.host);
  if (!s) return [null, ''];
  if (u.source === 'docker') {
    const c = s.cmap.get(u.unit);
    return c ? cstate(c) : [null, ''];
  }
  if (u.source === 'journald' && /\.service$/.test(u.unit)) {
    const x = s.umap.get(u.unit);
    if (!x) return ['down', 'nieaktywna (zakończona albo zatrzymana)'];
    return x[1] === 'failed'
      ? ['bad', 'padła (failed)']
      : x[1] === 'active'
        ? ['up', 'działa' + (x[2] === 'exited' ? ' (jednorazowa, zakończona)' : '')]
        : ['up', x[1] + ' / ' + x[2]];
  }
  return [null, ''];
}
const dotc = st => 'dot' + (st === 'up' ? ' up' : st === 'bad' ? ' bad' : '');
const gb = kb => dec(kb / 1048576) + ' GB';
const pc = v => (v == null ? '–' : dec(v) + '%');
const lvlc = v => (v >= 90 ? 'e' : v >= 75 ? 'w' : '');
function meter(label, v, sub) {
  const m = el('div', 'mt'),
    r = el('div', 'row'),
    b = el('div', 'bar'),
    i = el('i', lvlc(v || 0));
  i.style.width = Math.min(100, Math.max(0, v || 0)) + '%';
  b.append(i);
  r.append(el('span', 'lbl', label), el('b', '', pc(v)));
  const s = el('small', '', sub || '');
  s.title = sub || '';
  m.append(r, b, s);
  return m;
}
// zasoby i stan na zywo: agenci mierza co ok. 20 s, strona pyta co 15 s
async function pollStat() {
  if (!me || document.hidden) return;
  try {
    D.stat = readStat(
      parseLines(await (await api('query', { query: '{source="stat"} _time:10m', limit: 500 })).text()),
    );
    const now = Date.now();
    for (const u of D.units) [u.st, u.stt] = ustate(u);
    for (const h of D.hosts.values()) {
      h.bad = h.units.filter(u => u.st === 'bad');
      const s = D.stat.get(h.name);
      if (s) {
        h.up = now - s.t < 3 * 6e4;
        h.last = Math.max(h.last, s.t);
      }
    }
    const sc = tree.scrollTop;
    renderTree();
    tree.scrollTop = sc;
    if (view === 'over') renderOver(true);
    if (view === 'logs') resBox();
  } catch {}
}

// srednie CPU i RAM z ostatnich 24 h, w kubelkach po 30 min
async function loadHist() {
  try {
    const rows = parseLines(
      await (
        await api('query', {
          query: '{source="stat"} _time:24h | stats by (host, _time:30m) avg(cpu) cpu, avg(mem_pct) mem',
        })
      ).text(),
    );
    const step = 30 * 6e4,
      end = Math.floor(Date.now() / step) * step,
      m = new Map();
    for (const o of rows) {
      const k = 47 - Math.round((end - Date.parse(o._time)) / step);
      if (k < 0 || k > 47) continue;
      const x =
        m.get(o.host) ||
        m.set(o.host, { cpu: new Array(48).fill(null), mem: new Array(48).fill(null) }).get(o.host);
      x.cpu[k] = fnum(o.cpu);
      x.mem[k] = fnum(o.mem);
    }
    D.hist = m;
    renderOver();
  } catch {}
}
function sparkPct(box, v, stepMs) {
  box.textContent = '';
  const end = Date.now(),
    top = Math.max(25, ...v.filter(x => x != null));
  v.forEach((x, i) => {
    const b = el('i', x == null ? 'z' : lvlc(x) === 'e' ? 'e' : '');
    b.style.height = x == null ? '' : Math.max(6, Math.round((x / top) * 100)) + '%';
    if (lvlc(x || 0) === 'w') b.style.background = 'var(--warn)';
    const d = new Date(end - (v.length - 1 - i) * stepMs);
    b.title =
      pad(d.getHours()) + ':' + pad(d.getMinutes()) + ' · CPU ' + (x == null ? 'brak pomiaru' : pc(x));
    box.append(b);
  });
}

function spark(box, v, ev, stepMs) {
  box.textContent = '';
  const max = Math.max(1, ...v),
    end = Date.now();
  v.forEach((x, i) => {
    const b = el('i', x ? '' : 'z');
    b.style.height = x ? Math.max(8, Math.round((x / max) * 100)) + '%' : '';
    if (x && ev && ev[i]) {
      const p = Math.min(100, Math.max(15, Math.round((ev[i] / x) * 100)));
      b.style.background = 'linear-gradient(to top,var(--err) ' + p + '%,var(--acc) ' + p + '%)';
    }
    if (stepMs) {
      const d = new Date(end - (v.length - 1 - i) * stepMs);
      b.title =
        pad(d.getHours()) +
        ':' +
        pad(stepMs < H ? d.getMinutes() : 0) +
        ' · ' +
        x +
        ' linii' +
        (ev && ev[i] ? ' · ' + ev[i] + ' błędów' : '');
    }
    box.append(b);
  });
}
