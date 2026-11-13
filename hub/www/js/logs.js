// Logi: strumien na zywo, wczytywanie starszych, wybrany dzien, przewijanie.
function pick(sel, meta, lvl, range, win) {
  cur = { sel, meta, win: win || null };
  if (lvl != null) $('#lvl').value = lvl;
  const rs = $('#range');
  let wo = rs.querySelector('option[value=win]');
  if (win) {
    if (!wo) {
      wo = new Option('', 'win');
      rs.append(wo);
    }
    wo.textContent = winLabel(win[0], win[1]);
    rs.value = 'win';
  } else {
    if (wo) {
      wo.remove();
      if (!range) rs.value = '1h';
    }
    if (range) rs.value = range;
  }
  syncDay();
  const t = $('#title');
  t.textContent = '';
  const us = matching(),
    hh = meta.host ? D.hosts.get(meta.host) : null,
    st = meta.unit ? us[0] && us[0].st : hh ? (hh.up ? (hh.bad.length ? 'bad' : 'up') : null) : null;
  t.append(el('i', dotc(st)), el('b', '', meta.title));
  if (meta.unit) t.append(el('span', 'chip', meta.host), el('span', 'chip', SRC[meta.source] || meta.source));
  else
    t.append(
      el(
        'span',
        'chip',
        meta.host
          ? 'cały serwer · ' + us.length + ' źródeł'
          : D.hosts.size + ' serwerów · ' + us.length + ' źródeł',
      ),
    );
  show('logs');
  headStats();
  reload();
}
const matching = () =>
  !cur
    ? []
    : D.units.filter(u => cur.sel === ALL || (cur.meta.unit ? u.sel === cur.sel : u.host === cur.meta.host));
// zasoby w naglowku logow: kontener Dockera, caly serwer albo stan uslugi
function resBox() {
  if (!cur) return;
  const m = cur.meta,
    s = m.host ? D.stat.get(m.host) : null,
    box = $('#resbox');
  let lab = '',
    val = '';
  if (s && m.source === 'docker') {
    const c = s.cmap.get(m.unit);
    if (c) {
      lab = 'Kontener';
      val =
        c.cpu != null
          ? 'CPU ' +
            pc(fnum(c.cpu)) +
            ' · RAM ' +
            String(c.mem || '')
              .split('/')[0]
              .trim()
          : cstate(c)[1];
    }
  } else if (s && !m.unit) {
    lab = 'Serwer';
    val =
      'CPU ' +
      pc(s.cpu) +
      ' · RAM ' +
      pc(s.mem) +
      ' · dysk ' +
      (s.disks.length ? pc(Math.max(...s.disks.map(d => (d[3] / d[4]) * 100))) : pc(s.disk));
  } else if (s && m.source === 'journald' && /\.service$/.test(m.unit)) {
    lab = 'Usługa';
    val = ustate({ host: m.host, source: 'journald', unit: m.unit })[1];
  }
  box.hidden = !val;
  $('#reslbl').textContent = lab;
  $('#resval').textContent = val;
}
async function headStats() {
  if (!cur) return;
  const e = sum(matching().map(u => u.inc || 0)),
    eb = $('#e24');
  eb.textContent = e;
  eb.style.color = e ? 'var(--err)' : '';
  eb.title = num(sum(matching().map(u => u.e24))) + ' linii z błędami w 24 h';
  resBox();
  try {
    const sel = cur.sel,
      h = await hits(sel + ' ' + EXCL, Date.now() - 60 * 6e4, 6e4);
    if (!cur || cur.sel !== sel) return;
    const v = (h[0] ? h[0].v : new Array(61).fill(0)).slice(-60),
      r = sum(v.slice(-6, -1)) / 5;
    $('#rate').textContent = r >= 10 ? Math.round(r) : r.toFixed(1).replace('.', ',');
    spark($('#rsp'), v, null, 6e4);
  } catch {}
}

// poziom wiersza: priorytet z journald, potem znacznik w tresci ([Warn], level=error, |WARNING |), na koncu slowa kluczowe
function level(o, m) {
  const lv = parseInt(o.level, 10);
  if (!isNaN(lv)) return lv <= 3 ? 'e' : lv === 4 ? 'w' : '';
  const t = m.match(
    /(?:^|[\[|"=(])\s*(err|error|fatal|crit|critical|panic|wrn|warn|warning|inf|info|notice|dbg|debug)\b/i,
  );
  if (t) return /^(err|fat|cri|pan)/i.test(t[1]) ? 'e' : /^w/i.test(t[1]) ? 'w' : '';
  return /\b(error|fatal|panic|fail(ed|ure)?|critical)\b/i.test(m)
    ? 'e'
    : /\bwarn(ing)?\b/i.test(m)
      ? 'w'
      : '';
}
function mark(span, text) {
  if (!word) {
    span.textContent = text;
    return;
  }
  const low = text.toLowerCase(),
    w = word.toLowerCase();
  let i = 0,
    j;
  while ((j = low.indexOf(w, i)) >= 0) {
    span.append(text.slice(i, j), el('mark', '', text.slice(j, j + w.length)));
    i = j + w.length;
  }
  span.append(text.slice(i));
}
function row(o, multi) {
  const m = o._msg || '',
    dt = new Date(o._time),
    d = el('div', 'r ' + level(o, m));
  d.dataset.t = +dt;
  const t = el('time', '', fmt(dt));
  t.title = dt.toLocaleString('sv');
  d.append(t, el('i', 'lv'));
  if (multi) d.append(el('b', '', (o.host || '') + '/' + short(o.unit)));
  const s = el('span');
  mark(s, m);
  d.append(s);
  return d;
}
const atEnd = () => log.scrollHeight - log.scrollTop - log.clientHeight < 60;
function toEnd() {
  log.scrollTop = log.scrollHeight;
  fresh = 0;
  jump.hidden = true;
  pos.hidden = true;
}
function append(objs, initial) {
  const stick = initial || atEnd(),
    frag = document.createDocumentFragment(),
    multi = !cur.meta.unit;
  let n = 0;
  for (const o of objs) {
    const k = o._time + '|' + o._stream + '|' + o._msg;
    if (seen.has(k)) continue;
    seen.add(k);
    frag.append(row(o, multi));
    n++;
  }
  if (n) {
    const e = log.querySelector('.n');
    if (e) e.remove();
  }
  log.append(frag);
  while (log.childElementCount > MAX) log.firstElementChild.remove();
  if (seen.size > MAX * 2) seen = new Set([...seen].slice(-MAX));
  if (stick) toEnd();
  else if (n) {
    fresh += n;
    jump.textContent = '↓ ' + fresh + ' nowych';
    jump.hidden = false;
  }
  $('#cnt').textContent = log.querySelectorAll('.r').length + ' linii';
}
async function reload() {
  if (!cur) return;
  if (ctl) ctl.abort();
  ctl = new AbortController();
  const signal = ctl.signal;
  log.textContent = '';
  seen = new Set();
  fresh = 0;
  jump.hidden = true;
  pos.hidden = true;
  $('#cnt').textContent = '';
  marks();
  word = $('#q').value.trim();
  const lv = $('#lvl').value,
    rv = $('#range').value;
  if (rv !== 'win' && cur.win) {
    cur.win = null;
    const wo = $('#range option[value=win]');
    if (wo) wo.remove();
  }
  if (rv === 'day') cur.win = dayWin();
  const win = cur.win;
  const q =
    cur.sel +
    ' ' +
    EXCL +
    (lv === 'e' ? ' ' + ERR : lv === 'w' ? ' (' + ERR + ' OR ' + WARN + ')' : '') +
    (word ? ' ~' + quote('(?i)' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) : '');
  try {
    status('Wczytuję…');
    const txt = await (
      await api(
        'query',
        win
          ? { query: q, start: iso(win[0]), end: iso(win[1]), limit: LIMIT }
          : { query: q + ' _time:' + rv, limit: LIMIT },
        signal,
      )
    ).text();
    if (signal.aborted) return; // w miedzyczasie zmieniono zakres - nie mieszaj wynikow
    const rows = parseLines(txt).sort((a, b) => (a._time < b._time ? -1 : a._time > b._time ? 1 : 0));
    if (!rows.length)
      log.append(
        el(
          'div',
          'n',
          'Brak logów w wybranym zakresie.' + (live && !win ? ' Nowe linie pojawią się tutaj same.' : ''),
        ),
      );
    append(rows, true);
    status(
      rows.length >= LIMIT
        ? 'Pokazano ' + LIMIT + ' najnowszych linii z zakresu. Zawęź wyszukiwanie, żeby zobaczyć starsze.'
        : '',
    );
    if (live && !win) {
      cur.q = q;
      await tail(q, signal);
    }
  } catch (e) {
    if (e.name !== 'AbortError' && me) status('Błąd: ' + e.message);
  }
}
// na zywo: strumien z bazy; po zerwaniu (restart centrali, tunel Cloudflare ucinajacy ciche polaczenia)
// dociagamy brakujace linie z ostatnich minut i laczymy sie ponownie
let lastData = 0;
async function tail(q, signal) {
  lastData = Date.now();
  let rd;
  try {
    rd = (await api('tail', { query: q }, signal)).body.getReader();
  } catch (e) {
    if (!signal.aborted && e.name !== 'AbortError') again(q, signal, e);
    return;
  }
  const dec = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { done, value } = await rd.read();
      if (done) break;
      lastData = Date.now();
      buf += dec.decode(value, { stream: true });
      const i = buf.lastIndexOf('\n');
      if (i < 0) continue;
      append(parseLines(buf.slice(0, i)));
      buf = buf.slice(i + 1);
    }
  } catch (e) {
    if (signal.aborted || e.name === 'AbortError') return;
    return again(q, signal, e);
  }
  if (!signal.aborted) again(q, signal);
}
function again(q, signal, e) {
  status('Połączenie na żywo przerwane' + (e ? ' (' + e.message + ')' : '') + ', łączę ponownie…');
  setTimeout(async () => {
    if (signal.aborted) return;
    await catchUp(q, signal);
    if (!signal.aborted) {
      status('');
      tail(q, signal);
    }
  }, 3000);
}
// linie z ostatnich minut, ktorych strumien mogl nie dowiezc (duplikaty odrzuca append)
async function catchUp(q, signal) {
  try {
    const rows = parseLines(
      await (await api('query', { query: q + ' _time:5m', limit: 500 }, signal)).text(),
    ).sort((a, b) => (a._time < b._time ? -1 : a._time > b._time ? 1 : 0));
    if (!signal.aborted) append(rows);
  } catch {}
}
let posT;
log.onscroll = () => {
  if (atEnd()) {
    fresh = 0;
    jump.hidden = true;
    pos.hidden = true;
    return;
  }
  const rows = log.children,
    max = log.scrollHeight - log.clientHeight;
  if (!rows.length || !rows[0].dataset.t || max <= 0) return;
  let lo = 0,
    hi = rows.length - 1;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (rows[m].offsetTop + rows[m].offsetHeight <= log.scrollTop) lo = m + 1;
    else hi = m;
  }
  const p = Math.round((log.scrollTop / max) * 100);
  pos.children[0].textContent = rel(+rows[lo].dataset.t);
  pos.querySelector('u i').style.width = p + '%';
  pos.children[2].textContent = p + '%';
  pos.hidden = false;
  clearTimeout(posT);
  posT = setTimeout(() => {
    pos.hidden = true;
  }, 1500);
};
