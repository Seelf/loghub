// Zadania cron: lista zadan, ostatnie uruchomienia i harmonogram slownie.
// uruchomienia: zrodlo "cron" (jeden wpis na uruchomienie, z kodem wyjscia); lista zadan: zrodlo "crondef"
async function loadCron() {
  const jobs = new Map(),
    jk = (h, u) => h + '\n' + u;
  for (const u of D.units.filter(u => u.source === 'cron'))
    jobs.set(jk(u.host, u.unit), {
      host: u.host,
      unit: u.unit,
      sel: u.sel,
      c24: u.c24,
      e24: u.e24,
      runs: [],
      def: null,
    });
  I.cronT = Date.now();
  try {
    if (!I.defs || Date.now() - I.defsT > 10 * 6e4) {
      I.defs = parseLines(
        await (await api('query', { query: '{source="crondef"} _time:100d', limit: 1000 })).text(),
      );
      I.defsT = Date.now();
    }
    const defs = I.defs,
      scan = {};
    for (const d of defs) scan[d.host] = Math.max(scan[d.host] || 0, +d.cron_scan || 0);
    for (const d of defs) {
      if ((+d.cron_scan || 0) !== scan[d.host]) continue;
      const k = jk(d.host, d.unit),
        j =
          jobs.get(k) ||
          jobs
            .set(k, {
              host: d.host,
              unit: d.unit,
              sel: selOf({ host: d.host, source: 'cron', unit: d.unit }),
              c24: 0,
              e24: 0,
              runs: [],
            })
            .get(k);
      j.def = d;
    }
  } catch {}
  // ostatnie uruchomienia wszystkich zadan jednym zapytaniem (po 20 na zadanie)
  let runs = null;
  try {
    runs = parseLines(
      await (
        await api('query', {
          query: '{source="cron"} _time:30d | sort by (_time desc) limit 20 partition by (host, unit)',
        })
      ).text(),
    );
  } catch {}
  if (runs) {
    for (const o of runs) {
      if (!o.host) continue;
      const k = jk(o.host, o.unit),
        j =
          jobs.get(k) ||
          jobs
            .set(k, {
              host: o.host,
              unit: o.unit,
              sel: selOf({ host: o.host, source: 'cron', unit: o.unit }),
              c24: 0,
              e24: 0,
              runs: [],
            })
            .get(k);
      j.runs.push(o);
    }
    for (const j of jobs.values()) j.runs = j.runs.sort((a, b) => (a._time < b._time ? 1 : -1)).slice(0, 20);
  } else
    await Promise.all(
      [...jobs.values()].slice(0, 80).map(async j => {
        try {
          j.runs = parseLines(
            await (await api('query', { query: j.sel + ' _time:30d', limit: 20 })).text(),
          ).sort((a, b) => (a._time < b._time ? 1 : -1));
        } catch {}
      }),
    );
  C = [...jobs.values()];
  window.C_ALL = C;
  for (const j of C) {
    j.last = j.runs[0] || null;
    j.bad = !!j.last && j.last.cron_state !== 'ok';
  }
  const bad = C.filter(j => j.bad).length;
  $('#ncron').hidden = !bad;
  $('#ncron').textContent = bad;
  renderCron();
  const sc = tree.scrollTop;
  renderTree();
  tree.scrollTop = sc;
}
const DOWL = ['niedziele', 'poniedziałki', 'wtorki', 'środy', 'czwartki', 'piątki', 'soboty', 'niedziele'],
  DOWG = ['niedzieli', 'poniedziałku', 'wtorku', 'środy', 'czwartku', 'piątku', 'soboty', 'niedzieli'];
const MONG = [
  'stycznia',
  'lutego',
  'marca',
  'kwietnia',
  'maja',
  'czerwca',
  'lipca',
  'sierpnia',
  'września',
  'października',
  'listopada',
  'grudnia',
];
function dowPl(x) {
  if (x === '1-5') return 'w dni robocze';
  if (x === '0,6' || x === '6,0' || x === '6-7' || x === '6,7') return 'w weekendy';
  if (/^[0-7](,[0-7])*$/.test(x))
    return (
      'w ' +
      x
        .split(',')
        .map(d => DOWL[+d])
        .join(', ')
    );
  if (/^[0-7]-[0-7]$/.test(x)) {
    const [a, b] = x.split('-');
    return 'od ' + DOWG[a] + ' do ' + DOWG[b];
  }
  return null;
}
// harmonogram crona po polsku; null, gdy wyrazenie jest zbyt nietypowe
function cronPl(s) {
  const at = {
    '@reboot': 'przy starcie systemu',
    '@hourly': 'co godzinę',
    '@daily': 'codziennie o 00:00',
    '@midnight': 'codziennie o 00:00',
    '@weekly': 'w niedziele o 00:00',
    '@monthly': '1. dnia miesiąca o 00:00',
    '@yearly': '1 stycznia o 00:00',
    '@annually': '1 stycznia o 00:00',
  };
  if (!s) return null;
  if (at[s]) return at[s][0].toUpperCase() + at[s].slice(1);
  const f = s.trim().split(/\s+/);
  if (f.length !== 5) return null;
  const [mi, ho, dm, mo, dw] = f,
    isN = x => /^\d+$/.test(x);
  let when,
    days = '';
  if (mi === '*' && ho === '*') when = 'co minutę';
  else if (/^\*\/\d+$/.test(mi) && ho === '*') when = 'co ' + mi.slice(2) + ' min';
  else if (/^\d+-\d+\/\d+$/.test(mi) && ho === '*') {
    const [r, st] = mi.split('/'),
      [a, b] = r.split('-');
    when = 'co ' + st + ' min (od ' + a + '. do ' + b + '. minuty)';
  } else if (/^\d+(,\d+)+$/.test(mi) && ho === '*')
    when = 'co godzinę, w minutach ' + mi.split(',').join(', ');
  else if (isN(mi) && ho === '*') when = +mi ? 'co godzinę, w ' + mi + '. minucie' : 'co pełną godzinę';
  else if (isN(mi) && /^\*\/\d+$/.test(ho)) when = 'co ' + ho.slice(2) + ' godz., w ' + mi + '. minucie';
  else if (isN(mi) && /^\d+(,\d+)*$/.test(ho))
    when =
      'o ' +
      ho
        .split(',')
        .map(x => pad(x) + ':' + pad(mi))
        .join(' i ');
  else if (isN(mi) && /^\d+-\d+$/.test(ho)) {
    const [a, b] = ho.split('-');
    when = 'co godzinę od ' + pad(a) + ':' + pad(mi) + ' do ' + pad(b) + ':' + pad(mi);
  } else return null;
  if (dm === '*' && mo === '*' && dw === '*') days = when.startsWith('o ') ? 'codziennie' : '';
  else if (dm === '*' && mo === '*') {
    days = dowPl(dw);
    if (!days) return null;
  } else if (/^\d+(,\d+)*$/.test(dm) && mo === '*' && dw === '*')
    days = dm.split(',').join(', ') + '. dnia miesiąca';
  else if (isN(dm) && isN(mo) && dw === '*' && +mo >= 1 && +mo <= 12) days = dm + ' ' + MONG[mo - 1];
  else return null;
  const out = (days ? days + ' ' : '') + when;
  return out[0].toUpperCase() + out.slice(1);
}
const dur = s =>
  s == null || s === ''
    ? ''
    : s < 90
      ? s + ' s'
      : s < 5400
        ? Math.round(s / 60) + ' min'
        : dec(s / 3600) + ' godz.';
function showCron(host) {
  cronHost = host;
  renderCron();
  show('cron');
  if (Date.now() - I.cronT > 6e4) loadCron();
}
function renderCron() {
  const t = $('#cs').value.trim().toLowerCase(),
    f = $('#cf').value,
    tiles = $('#ctiles'),
    tbl = $('#ctbl');
  const fam = cronHost ? family(cronHost) : null,
    C = fam ? window.C_ALL.filter(j => fam.includes(j.host)) : window.C_ALL;
  $('#ctitle').textContent = cronHost ? 'Zadania cron: ' + cronHost : 'Zadania cron';
  $('#csub').textContent = cronHost
    ? (fam.length > 1 ? 'Ta maszyna i jej kontenery (' + fam.slice(1).join(', ') + ').' : 'Ta maszyna.') +
      ' Wszystkie maszyny: „Zadania cron” w menu.'
    : 'Ostatnie uruchomienia, kody wyjścia i harmonogramy ze wszystkich maszyn.';
  const bad = C.filter(j => j.bad).length,
    never = C.filter(j => !j.last).length;
  tiles.textContent = '';
  for (const [v, l, c] of [
    [C.length, 'zadań', ''],
    [C.length - bad - never, 'ostatnio zakończone poprawnie', 'g'],
    [bad, 'z błędem w ostatnim uruchomieniu', bad ? 'e' : ''],
    [num(sum(C.map(j => j.c24))), 'uruchomień w 24 h', ''],
    [num(sum(C.map(j => j.e24))), 'nieudanych w 24 h', sum(C.map(j => j.e24)) ? 'e' : ''],
  ]) {
    const d = el('div', c);
    d.append(el('b', '', v), el('span', 'mut', l));
    tiles.append(d);
  }
  const js = C.filter(
    j => (!t || (j.host + ' ' + j.unit).toLowerCase().includes(t)) && (!f || (f === 'bad' ? j.bad : !j.last)),
  ).sort(
    (a, b) =>
      b.bad - a.bad ||
      (b.last ? Date.parse(b.last._time) : 0) - (a.last ? Date.parse(a.last._time) : 0) ||
      a.unit.localeCompare(b.unit),
  );
  tbl.textContent = '';
  const hd = el('div', 'tr h');
  for (const x of ['Stan', 'Zadanie', 'Serwer', 'Harmonogram', 'Ostatnie uruchomienie', 'Kod', 'Historia'])
    hd.append(el('span', '', x));
  tbl.append(hd);
  for (const j of js) {
    const r = el('div', 'tr'),
      L = j.last,
      d = j.def,
      st = el('span');
    st.append(
      el(
        'span',
        'chip ' + (!L ? '' : j.bad ? 'bad' : 'ok'),
        !L
          ? 'nie uruchomione'
          : L.cron_state === 'ok'
            ? 'OK'
            : L.cron_state === 'signal'
              ? 'przerwane'
              : 'błąd',
      ),
    );
    const job = el('span', 'job'),
      cmd = el('b', '', (L && L.cron_cmd) || (d && d.cron_cmd) || j.unit);
    cmd.title = cmd.textContent;
    job.append(
      cmd,
      el(
        'small',
        '',
        [(L && L.cron_user) || (d && d.cron_user), d ? d.cron_file : 'usunięte z crontaba']
          .filter(Boolean)
          .join(' · '),
      ),
    );
    const when = el('span', 'job');
    if (L) {
      const dt = new Date(L._time);
      when.append(
        el('span', '', rel(+dt)),
        el('small', '', [fmt(dt), dur(L.duration_s)].filter(Boolean).join(' · ')),
      );
      when.title = dt.toLocaleString('sv');
    } else when.append(el('span', 'mut', '–'));
    const code = el('span', 'num', L ? String(L.exit_code ?? '') : '–');
    if (j.bad) code.style.color = 'var(--err)';
    const hist = el('span', 'hist');
    for (const x of j.runs.slice().reverse()) {
      const b = el('i', x.cron_state === 'ok' ? '' : 'e'),
        xd = new Date(x._time);
      b.title =
        fmt(xd) +
        ' · ' +
        (x.cron_state === 'ok' ? 'OK' : 'kod ' + x.exit_code) +
        (x.duration_s != null ? ' · ' + dur(x.duration_s) : '');
      hist.append(b);
    }
    const sch = el('span', 'job');
    if (d) {
      const w = cronPl(d.cron_sched);
      sch.append(el('span', '', w || d.cron_sched), el('small', '', w ? d.cron_sched : 'nietypowy zapis'));
      sch.querySelector('small').style.fontFamily = 'var(--mono)';
    } else sch.append(el('span', 'mut', '–'));
    r.append(st, job, el('span', '', j.host), sch, when, code, hist);
    r.tabIndex = 0;
    r.onclick = () =>
      pick(j.sel, { title: short(j.unit), host: j.host, source: 'cron', unit: j.unit }, '', '30d');
    r.onkeydown = x => {
      if (x.key === 'Enter') r.onclick();
    };
    tbl.append(r);
  }
  if (!js.length)
    tbl.append(
      el(
        'div',
        'n',
        C.length
          ? 'Żadne zadanie nie pasuje do filtra.'
          : 'Brak zadań cron. Agent zbiera je z maszyn z cronem z Debiana, Ubuntu lub Proxmoxa.',
      ),
    );
}
$('#cs').oninput = $('#cf').onchange = renderCron;
