// Przeglad: kafle, karty serwerow, zdarzenia, tabele zrodel, portow i zasobow.
function renderOver(light) {
  const hs = [...D.hosts.values()],
    us = D.units,
    upH = hs.filter(h => h.up).length,
    bad = us.filter(u => u.st === 'bad').length,
    inc = (D.inc || []).filter(vis),
    nn = sum(inc.map(x => x.news.length));
  const tiles = $('#tiles');
  tiles.textContent = '';
  for (const [v, l, c, go] of [
    [num(sum(us.map(u => u.c24))), 'linii w 24 h', ''],
    [inc.length, pl(inc.length, 'zdarzenie', 'zdarzenia', 'zdarzeń') + ' w 24 h', inc.length ? 'e' : 'g', 1],
    [nn, pl(nn, 'nowy rodzaj', 'nowe rodzaje', 'nowych rodzajów') + ' błędów', nn ? 'w' : '', 1],
    [upH + ' / ' + hs.length, 'serwerów online', upH < hs.length ? 'w' : 'g'],
    [bad, 'usług z problemem', bad ? 'e' : 'g'],
  ]) {
    const d = el('div', c + (go ? ' go' : ''));
    d.append(el('b', '', v), el('span', 'mut', l));
    if (go) {
      d.title = 'pokaż zdarzenia';
      d.onclick = () => openInc('');
    }
    tiles.append(d);
  }
  const cards = $('#cards');
  cards.textContent = '';
  for (const h of hs.sort(
    (a, b) => a.up - b.up || b.bad.length - a.bad.length || b.inc - a.inc || a.name.localeCompare(b.name),
  )) {
    const c = el('div', 'card' + (h.up ? '' : ' off')),
      hd = el('header');
    hd.append(
      el('i', 'dot' + (h.up ? (h.bad.length ? ' bad' : ' up') : '')),
      el('b', '', h.name),
      el(
        'span',
        'chip ' + (!h.up ? 'wrn' : h.bad.length ? 'bad' : 'ok'),
        !h.up ? 'milczy: ' + rel(h.last) : h.bad.length ? h.bad.length + ' z problemem' : 'online',
      ),
    );
    const s = D.stat.get(h.name),
      res = [];
    if (s) {
      const ms = el('div', 'meters');
      const top = s.disks.length ? s.disks.slice().sort((a, b) => b[3] / b[4] - a[3] / a[4])[0] : null;
      ms.append(
        meter('CPU', s.cpu, s.cores + ' rdz., obc. ' + (s.load == null ? '–' : dec(s.load))),
        meter('RAM', s.mem, s.memT ? gb(s.memT - s.memA) + ' / ' + gb(s.memT) : ''),
        top
          ? meter('Dysk', (top[3] / top[4]) * 100, top[0] + ' · ' + gb(top[3]) + ' / ' + gb(top[4]))
          : meter('Dysk /', s.disk, s.diskT ? gb(s.diskU) + ' / ' + gb(s.diskT) : ''),
      );
      res.push(ms);
      if (s.disks.length > 1 || s.smart.length || s.pools.length) {
        const dl = el('div', 'dlist');
        dl.append(el('span', 'lbl', 'Dyski i udziały'));
        for (const d of s.disks.slice().sort((a, b) => a[0].localeCompare(b[0]))) {
          const r = el('div', 'dl'),
            v = (d[3] / d[4]) * 100,
            b = el('div', 'bar'),
            i = el('i', lvlc(v));
          i.style.width = Math.min(100, v) + '%';
          b.append(i);
          const n = el('span', '', d[0]);
          n.title = d[0] + ' · ' + d[2] + ' · ' + d[1];
          r.append(n, b, el('span', 'num', gb(d[3]) + ' / ' + gb(d[4])));
          dl.append(r);
        }
        const chips = el('div', 'probs');
        for (const x of s.smart) {
          const [st, txt] = smartState(x);
          const c = el(
            'span',
            'chip ' + (st === 'bad' ? 'bad' : st === 'warn' ? 'wrn' : 'ok'),
            x[0].replace('/dev/', '') + (x[4] != null ? ' ' + x[4] + '°C' : '') + ' · ' + txt,
          );
          c.title =
            (x[1] || '') + (x[5] != null ? ' · ' + num(x[5]) + ' h pracy' : '') + (x[8] ? ' · ' + x[8] : '');
          chips.append(c);
        }
        for (const p of s.pools) {
          const ok = p[3] === 'ONLINE',
            c = el('span', 'chip ' + (ok ? 'ok' : 'bad'), 'ZFS ' + p[0] + ' · ' + p[3]);
          chips.append(c);
        }
        if (chips.children.length) dl.append(chips);
        res.push(dl);
      }
      if (s.ports) {
        const pub = s.ports.filter(x => pscope(x[1]) === 'all' && x[0] === 'tcp').length,
          b = el(
            'button',
            'chip' + (s.ufwState === 'inactive' ? ' wrn' : ''),
            s.ports.length +
              ' portów nasłuchuje' +
              (pub ? ', ' + pub + ' TCP na wszystkich interfejsach' : '') +
              (s.ufwState === 'active'
                ? ' · ufw: ' + s.ufw.length + ' otwartych na świat'
                : s.ufwState === 'inactive'
                  ? ' · ufw wyłączony'
                  : ''),
          );
        b.style.alignSelf = 'flex-start';
        b.onclick = () => {
          $('#ps').value = h.name;
          document.querySelector('#tabs button[data-tab=ports]').click();
        };
        res.push(b);
      }
      const hi = D.hist.get(h.name);
      if (hi) {
        const r2 = el('div', 'row');
        r2.append(
          el('span', 'lbl', 'CPU 24 h'),
          el(
            'span',
            'num mut',
            'śr. ' +
              pc(sum(hi.cpu.filter(x => x != null)) / Math.max(1, hi.cpu.filter(x => x != null).length)),
          ),
        );
        const sp2 = el('div', 'sp');
        sparkPct(sp2, hi.cpu, 30 * 6e4);
        res.push(r2, sp2);
      }
    }
    if (h.bad.length) {
      const pr = el('div', 'probs');
      for (const u of h.bad.slice(0, 6)) {
        const b = el('button', 'chip bad', short(u.unit));
        b.title = u.stt;
        b.onclick = () =>
          pick(u.sel, { title: short(u.unit), host: u.host, source: u.source, unit: u.unit }, '');
        pr.append(b);
      }
      if (h.bad.length > 6) pr.append(el('span', 'chip bad', '+' + (h.bad.length - 6)));
      res.push(pr);
    }
    if (s && s.guests.length) {
      const g = el('div', 'guests');
      g.append(el('span', 'lbl', 'Kontenery LXC i VM na tym Proxmoxie'));
      const gs = s.guests
        .slice()
        .sort((a, b) => (b.status === 'running') - (a.status === 'running') || (b.cpu || 0) - (a.cpu || 0));
      for (const x of gs.slice(0, 8)) {
        const r3 = el('div'),
          on = x.status === 'running';
        r3.append(
          el('i', 'dot' + (on ? ' up' : '')),
          el(
            'span',
            '',
            (x.name || x.id) + ' · ' + (x.type === 'qemu' ? 'VM' : 'LXC') + ' ' + (x.vmid || ''),
          ),
          el('span', 'num', on ? pc((x.cpu || 0) * 100) : '–'),
          el(
            'span',
            'num mut',
            on && x.maxmem ? gb(x.mem / 1024) + ' / ' + gb(x.maxmem / 1024) : x.status || '',
          ),
        );
        r3.title = on ? 'CPU liczone od przydzielonych rdzeni (' + (x.maxcpu || '?') + ')' : 'zatrzymany';
        g.append(r3);
      }
      if (gs.length > 8) g.append(el('span', 'mut', '+' + (gs.length - 8) + ' więcej w zakładce Zasoby'));
      res.push(g);
    }
    const r = el('div', 'row');
    r.append(el('span', 'lbl', 'Aktywność 24 h'), el('span', 'num mut', num(h.c24) + ' linii'));
    const sp = el('div', 'sp');
    spark(sp, h.v, h.ev, H);
    const types = el(
      'div',
      'mut',
      [...new Set(h.units.map(u => u.source))]
        .sort()
        .map(s => h.units.filter(u => u.source === s).length + ' ' + (SRC[s] || s))
        .join(' · '),
    );
    const kv = el('div', 'kv');
    for (const [v, l, k] of [
      [num(h.c24), 'linie', ''],
      [h.inc, pl(h.inc, 'zdarzenie', 'zdarzenia', 'zdarzeń'), h.inc ? 'e' : ''],
      [h.nnew, 'nowe błędy', h.nnew ? 'w' : ''],
      [relS(h.last), 'ostatni log', ''],
    ]) {
      const d = el('div');
      d.append(el('b', k, v), el('span', 'mut', l));
      kv.append(d);
    }
    const ft = el('footer'),
      b1 = el('button', '', 'Logi'),
      b2 = el('button', '', 'Zdarzenia');
    const meta = { title: h.name, host: h.name, multi: true };
    b1.onclick = () => pick('{host=' + quote(h.name) + '}', meta, '');
    b2.onclick = () => openInc(h.name);
    b2.disabled = !h.inc;
    ft.append(b1, b2);
    c.append(hd, ...res, r, sp, types, kv, ft);
    cards.append(c);
  }
  renderUnits();
  renderRes();
  renderDisks();
  renderPorts();
  const lt = Math.max(0, ...[...D.stat.values()].map(s => s.t));
  $('#osub').textContent =
    'Stan serwerów i logi z ostatnich 24 godzin.' +
    (lt ? ' Zasoby odświeżane na bieżąco, ostatni pomiar ' + rel(lt) + '.' : '');
  if (tab === 'errs' && !light) loadInc();
}
function renderUnits() {
  const t = $('#us').value.trim().toLowerCase(),
    by = $('#usort').value,
    dir = +$('#udir').value,
    tbl = $('#tbl');
  const us = D.units
    .filter(u => !t || (u.host + ' ' + u.unit).toLowerCase().includes(t))
    .sort(
      (a, b) =>
        (by === 'unit' ? a.unit.localeCompare(b.unit) : a[by] - b[by]) * dir || a.unit.localeCompare(b.unit),
    );
  const max = Math.max(1, ...us.map(u => u.c24));
  tbl.textContent = '';
  const hd = el('div', 'tr h');
  for (const x of ['Źródło', 'Serwer', 'Typ', 'Linie 24 h', 'Zdarzenia', 'Błędy zwykle', 'Ostatni log'])
    hd.append(el('span', '', x));
  tbl.append(hd);
  for (const u of us) {
    const r = el('div', 'tr'),
      n = el('span'),
      dt = el('i', dotc(u.st));
    if (!u.st) dt.style.visibility = 'hidden';
    dt.title = u.stt;
    n.append(dt, el('span', '', short(u.unit)));
    n.title = u.unit;
    const vol = el('span', 'vol'),
      bar = el('i');
    bar.style.width = Math.round((u.c24 / max) * 100) + '%';
    vol.append(el('span', '', num(u.c24)), bar);
    const e = el('span');
    if (u.inc) {
      const c = el('span', 'chip bad', u.inc);
      c.title = num(u.e24) + ' linii z błędami w 24 h';
      e.append(c);
    } else e.textContent = '–';
    const w = el('span', 'mut'),
      nm = u.norm;
    if (nm && nm.chronic) {
      const c = el('span', 'chip wrn', MUTE.has(u.k) ? 'wyciszone' : 'stały szum');
      c.title = 'średnio ~' + rate(nm.rate) + ' błędów na godzinę';
      w.append(c);
    } else w.textContent = nm && nm.rate >= 0.05 ? '~' + rate(nm.rate) + '/h' : '–';
    r.append(
      n,
      el('span', '', u.host),
      el('span', 'mut', SRC[u.source] || u.source),
      vol,
      e,
      w,
      el('span', 'mut', rel(u.last)),
    );
    r.tabIndex = 0;
    r.onclick = () => pick(u.sel, { title: short(u.unit), host: u.host, source: u.source, unit: u.unit }, '');
    r.onkeydown = x => {
      if (x.key === 'Enter') r.onclick();
    };
    tbl.append(r);
  }
  if (!us.length) tbl.append(el('div', 'n', 'Żadne źródło nie pasuje do wyszukiwania.'));
}
const rate = x => (x >= 10 ? num(Math.round(x)) : dec(x));
const WD = ['niedz.', 'pon.', 'wt.', 'śr.', 'czw.', 'pt.', 'sob.'];
const dlab = d => WD[d.getDay()] + ' ' + pad(d.getDate()) + '.' + pad(d.getMonth() + 1);
function winLabel(a, b) {
  const A = new Date(a),
    B = new Date(b),
    t = d => pad(d.getHours()) + ':' + pad(d.getMinutes());
  if (A.toDateString() === new Date(b - 1).toDateString())
    return dlab(A) + ', ' + t(A) + '–' + (t(B) === '00:00' ? '24:00' : t(B));
  return dlab(A) + ' ' + t(A) + ' – ' + dlab(B) + ' ' + t(B);
}
let IR = { k: '', t: 0, list: [], base: new Map(), days: 1, day: null };
function openInc(host) {
  if (view !== 'over') show('over');
  $('#ir').value = '1d';
  IR.day = null;
  fillHosts();
  $('#ih').value = host || '';
  document.querySelector('#tabs button[data-tab=errs]').click();
}
function fillHosts() {
  const ih = $('#ih'),
    cv = ih.value;
  ih.textContent = '';
  ih.append(new Option('wszystkie serwery', ''));
  for (const n of [...D.hosts.keys()].sort())
    ih.append(new Option(n + (kids(n).length ? ' (z kontenerami)' : ''), n));
  ih.value = D.hosts.has(cv) ? cv : '';
}
async function loadInc() {
  fillHosts();
  const r = $('#ir').value,
    days = { '1d': 1, '7d': 7, '30d': 30, '90d': 90 }[r] || 1,
    now = Date.now();
  if (days === 1) {
    IR = {
      k: r,
      t: now,
      list: D.inc || [],
      base: D.base || new Map(),
      days: 1,
      day: IR.k === r ? IR.day : null,
    };
    $('#imsg').textContent = '';
    return renderInc();
  }
  if (IR.k === r && now - IR.t < 5 * 6e4) return renderInc();
  $('#imsg').textContent = 'Liczę zdarzenia z ' + days + ' dni…';
  try {
    const from = now - days * 24 * H,
      series = await hits(ERR + ' ' + EXCL, from - 7 * 24 * H, H, F),
      base = baseOf(series);
    const news = await patterns(from, now).catch(() => []);
    if ($('#ir').value !== r) return;
    IR = { k: r, t: now, list: incidentsFrom(series, base, from, news), base, days, day: null };
    $('#imsg').textContent = '';
  } catch (e) {
    $('#imsg').textContent = 'Nie udało się policzyć zdarzeń: ' + e.message;
    return;
  }
  renderInc();
}
function renderInc() {
  const hf = $('#ih').value,
    fam = hf ? family(hf) : null,
    L = IR.list.filter(x => vis(x) && (!fam || fam.includes(x.f.host)));
  // pasek: godziny (24 h) albo dni; kolor zalezy od liczby zdarzen
  const box = $('#idays'),
    hourly = IR.days === 1,
    starts = [];
  box.textContent = '';
  if (hourly) {
    const e = Math.floor(Date.now() / H) * H;
    for (let i = 23; i >= 0; i--) starts.push(e - i * H);
  } else {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    for (let i = IR.days - 1; i >= 0; i--) {
      const x = new Date(d);
      x.setDate(d.getDate() - i);
      starts.push(+x);
    }
  }
  const ends = starts.map((x, i) => (i + 1 < starts.length ? starts[i + 1] : x + (hourly ? H : 24 * H)));
  const cnt = starts.map((x, i) => L.filter(y => y.from < ends[i] && y.to > x).length),
    mx = Math.max(1, ...cnt);
  starts.forEach((x, i) => {
    const c = cnt[i],
      b = el('button', c ? 'l' + (c / mx > 0.66 ? 3 : c / mx > 0.33 ? 2 : 1) : ''),
      d = new Date(x);
    b.append(
      el('b', '', c || ''),
      el(
        'span',
        '',
        hourly ? pad(d.getHours()) : IR.days > 31 ? d.getDate() : d.getDate() + '.' + pad(d.getMonth() + 1),
      ),
    );
    b.title =
      (hourly
        ? pad(d.getHours()) + ':00–' + pad(new Date(ends[i]).getHours()) + ':00'
        : d.toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' })) +
      ' · ' +
      (c ? c + ' ' + pl(c, 'zdarzenie', 'zdarzenia', 'zdarzeń') : 'spokój');
    if (IR.day && IR.day[0] === x) b.classList.add('on');
    b.onclick = () => {
      IR.day = IR.day && IR.day[0] === x ? null : [x, ends[i]];
      renderInc();
    };
    box.append(b);
  });
  const sel = IR.day ? L.filter(x => x.from < IR.day[1] && x.to > IR.day[0]) : L,
    lb = $('#ilist');
  lb.textContent = '';
  const head = el('div', 'inc');
  head.style.gridTemplateColumns = '1fr auto';
  head.append(
    el(
      'span',
      'lbl',
      (IR.day
        ? hourly
          ? 'Godzina ' + pad(new Date(IR.day[0]).getHours()) + ':00'
          : new Date(IR.day[0]).toLocaleDateString('pl-PL', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })
        : 'Cały okres') +
        ' · ' +
        sel.length +
        ' ' +
        pl(sel.length, 'zdarzenie', 'zdarzenia', 'zdarzeń'),
    ),
  );
  if (IR.day) {
    const b = el('button', '', 'pokaż cały okres');
    b.onclick = () => {
      IR.day = null;
      renderInc();
    };
    head.append(b);
  }
  lb.append(head);
  for (const x of sel.slice(0, 300)) lb.append(incRow(x));
  if (!sel.length)
    lb.append(
      el(
        'div',
        'n',
        IR.day
          ? 'W tym czasie nic się nie działo.'
          : 'Brak zdarzeń w tym okresie: żadnych skoków ponad normę ani nowych rodzajów błędów.',
      ),
    );
  if (sel.length > 300)
    lb.append(el('div', 'n', 'Pokazano 300 najnowszych. Wybierz dzień na pasku, żeby zobaczyć resztę.'));
  renderNoise(fam);
}
function incRow(x) {
  const r = el('div', 'inc'),
    wh = el('div', 'what'),
    act = el('div', 'act');
  const nm = el('b', '', x.f.host + ' › ' + short(x.f.unit));
  nm.title = x.f.host + ' · ' + x.f.unit;
  wh.append(nm, el('span', 'mut', SRC[x.f.source] || x.f.source));
  if (x.spike) {
    const c = el('span', 'chip bad', 'skok: ' + num(x.lines) + ' linii z błędami');
    c.title = 'w szczycie ' + num(x.peak) + ' na godzinę, zwykle do ~' + num(x.norm) + ' na godzinę';
    wh.append(c);
  }
  if (x.many) wh.append(el('span', 'chip wrn', x.news.length + ' nowych rodzajów błędów naraz'));
  else if (x.news.length) {
    const n = x.news.length;
    wh.append(
      el('span', 'chip wrn', n === 1 ? 'nowy błąd' : n + ' ' + pl(n, '', 'nowe błędy', 'nowych błędów')),
    );
  }
  const bl = el('button', '', 'Logi');
  bl.title = 'błędy z tego źródła w tym oknie czasu';
  bl.onclick = () =>
    pick(
      selOf(x.f),
      { title: short(x.f.unit), host: x.f.host, source: x.f.source, unit: x.f.unit },
      'e',
      null,
      [x.from, x.to],
    );
  act.append(bl);
  r.append(el('div', 'when', winLabel(x.from, x.to)), wh, act);
  const ms = el('div', 'msgs');
  for (const p of x.news.slice(0, 3)) {
    const d = el('div', '', p.msg);
    d.title = p.msg + '\npierwszy raz: ' + fmt(new Date(p.first)) + ' · razem ' + p.c + '×';
    ms.append(d);
  }
  if (x.news.length > 3) ms.append(el('div', '', '… i ' + (x.news.length - 3) + ' innych'));
  if (x.spike && !x.news.length) {
    const b = el('button', '', 'najczęstsze komunikaty');
    b.onclick = async () => {
      b.disabled = true;
      b.textContent = 'Wczytuję…';
      try {
        const rows = parseLines(
          await (
            await api('query', {
              query:
                selOf(x.f) +
                ' ' +
                ERR +
                ' | collapse_nums | stats by (_msg) count() c | sort by (c desc) | limit 3',
              start: iso(x.from),
              end: iso(x.to),
            })
          ).text(),
        );
        b.remove();
        for (const o of rows) {
          const d = el('div', '', (+o.c > 1 ? num(+o.c) + '× ' : '') + (o._msg || ''));
          d.title = o._msg || '';
          ms.append(d);
        }
        if (!rows.length) ms.append(el('div', '', 'brak'));
      } catch (e) {
        b.disabled = false;
        b.textContent = 'Nie udało się, spróbuj ponownie';
      }
    };
    ms.append(b);
  }
  if (ms.children.length) r.append(ms);
  return r;
}
// staly szum: zrodla sypiace bledami prawie bez przerwy; mozna je wyciszyc (zapamietane w tej przegladarce)
function renderNoise(fam) {
  const box = $('#inoise');
  box.textContent = '';
  const rows = [...IR.base.entries()]
    .filter(([k, b]) => b.chronic || MUTE.has(k))
    .map(([k, b]) => {
      const [host, source, unit] = k.split('\n');
      return { k, b, f: { host, source, unit } };
    })
    .filter(x => !fam || fam.includes(x.f.host));
  if (!rows.length) return;
  box.append(
    el('div', 'lbl', 'Stały szum'),
    el(
      'div',
      'mut',
      'Te źródła sypią błędami prawie bez przerwy. Ich zwykły poziom nie jest zdarzeniem; zdarzeniem jest dopiero wyraźny skok ponad normę albo nowy rodzaj błędu. Wyciszone nie pokazują żadnych zdarzeń. Wyciszenie zapamiętuje ta przeglądarka.',
    ),
  );
  const t = el('div', 'ilist');
  for (const x of rows.sort((a, b) => b.b.rate - a.b.rate)) {
    const r = el('div', 'inc'),
      m = MUTE.has(x.k),
      wh = el('div', 'what'),
      nm = el('b', '', x.f.host + ' › ' + short(x.f.unit));
    nm.title = x.f.unit;
    wh.append(nm, el('span', 'mut', SRC[x.f.source] || x.f.source));
    if (m) wh.append(el('span', 'chip', 'wyciszone'));
    const b = el('button', '', m ? 'Przywróć' : 'Wycisz');
    b.onclick = () => {
      if (m) MUTE.delete(x.k);
      else MUTE.add(x.k);
      saveMute();
      build();
      paint();
      renderInc();
    };
    const act = el('div', 'act');
    act.append(b);
    r.append(el('div', 'when', '~' + rate(x.b.rate) + ' błędów / godz.'), wh, act);
    t.append(r);
  }
  box.append(t);
}
for (const b of document.querySelectorAll('#tabs button'))
  b.onclick = () => {
    tab = b.dataset.tab;
    for (const x of document.querySelectorAll('#tabs button')) x.classList.toggle('on', x === b);
    $('#cards').hidden = tab !== 'hosts';
    $('#units').hidden = tab !== 'units';
    $('#errs').hidden = tab !== 'errs';
    $('#resv').hidden = tab !== 'res';
    $('#diskv').hidden = tab !== 'disks';
    $('#portv').hidden = tab !== 'ports';
    if (tab === 'errs') loadInc();
  };
$('#ir').onchange = () => {
  IR.day = null;
  loadInc();
};
$('#ih').onchange = renderInc;
$('#us').oninput = $('#usort').onchange = $('#udir').onchange = renderUnits;

// stan dysku z SMART: [stan, opis]
function smartState(x) {
  const hl = String(x[3] || '').toUpperCase();
  if (hl && hl !== 'PASSED' && hl !== 'OK') return ['bad', 'awaria (' + x[3] + ')'];
  if ((x[6] || 0) > 0 || (x[7] || 0) > 0)
    return ['warn', 'sektory: ' + (x[6] || 0) + ' przen., ' + (x[7] || 0) + ' oczek.'];
  return hl ? ['ok', 'SMART OK'] : ['', 'brak danych SMART'];
}
// zakres adresu nasluchu
function pscope(a) {
  a = String(a);
  if (a === '*' || a === '0.0.0.0' || a === '::') return 'all';
  if (/^127\.|^::1$|^localhost/.test(a)) return 'local';
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|^fd7a:115c:a1e0/i.test(a)) return 'ts';
  return 'lan';
}
const PSC = {
  all: 'wszystkie interfejsy',
  local: 'tylko lokalnie',
  ts: 'Tailscale',
  lan: 'sieć lokalna / adres',
};
function renderDisks() {
  const tbl = $('#dtbl');
  tbl.textContent = '';
  const hd = el('div', 'tr h');
  for (const x of ['Maszyna', 'Punkt montowania', 'Typ', 'Zajętość', 'Źródło / stan'])
    hd.append(el('span', '', x));
  tbl.append(hd);
  let n = 0;
  for (const [host, s] of [...D.stat].sort((a, b) => a[0].localeCompare(b[0]))) {
    for (const d of s.disks.slice().sort((a, b) => a[0].localeCompare(b[0]))) {
      const r = el('div', 'tr'),
        v = (d[3] / d[4]) * 100,
        c = el('span', 'vol'),
        b = el('i');
      b.style.width = Math.max(1, Math.min(100, v)) + '%';
      if (lvlc(v)) b.style.background = lvlc(v) === 'e' ? 'var(--err)' : 'var(--warn)';
      c.append(el('span', '', pc(v)), b);
      c.title = gb(d[3]) + ' / ' + gb(d[4]);
      const m = el('span', '', d[0]);
      m.style.fontFamily = 'var(--mono)';
      r.append(
        el('span', '', host),
        m,
        el('span', 'mut', d[1]),
        c,
        el('span', 'mut', gb(d[3]) + ' / ' + gb(d[4]) + ' · ' + d[2]),
      );
      tbl.append(r);
      n++;
    }
    for (const x of s.smart) {
      const [st, txt] = smartState(x),
        r = el('div', 'tr'),
        c = el('span');
      c.append(el('span', 'chip ' + (st === 'bad' ? 'bad' : st === 'warn' ? 'wrn' : 'ok'), txt));
      r.append(
        el('span', '', host),
        el('span', '', x[0] + ' · ' + (x[1] || 'dysk')),
        el('span', 'mut', (x[8] || 'dysk').toUpperCase()),
        c,
        el(
          'span',
          'mut',
          [
            x[2] ? gb(x[2] / 1024) : '',
            x[4] != null ? x[4] + '°C' : '',
            x[5] != null ? num(x[5]) + ' h pracy' : '',
          ]
            .filter(Boolean)
            .join(' · '),
        ),
      );
      tbl.append(r);
      n++;
    }
    for (const p of s.pools) {
      const r = el('div', 'tr'),
        ok = p[3] === 'ONLINE',
        v = p[1] ? (p[2] / p[1]) * 100 : null,
        c = el('span');
      c.append(el('span', 'chip ' + (ok ? 'ok' : 'bad'), p[3]));
      r.append(
        el('span', '', host),
        el('span', '', 'pula ZFS ' + p[0]),
        el('span', 'mut', 'ZFS'),
        c,
        el('span', 'mut', v == null ? '' : pc(v) + ' · ' + gb(p[2] / 1024) + ' / ' + gb(p[1] / 1024)),
      );
      tbl.append(r);
      n++;
    }
  }
  if (!n)
    tbl.append(el('div', 'n', 'Brak danych o dyskach. Zaktualizuj agentów (ta sama komenda instalacji).'));
}
function renderPorts() {
  const t = $('#ps').value.trim().toLowerCase(),
    sc = $('#pscope').value,
    pr = $('#pproto').value,
    tbl = $('#ptbl');
  tbl.textContent = '';
  const hd = el('div', 'tr h');
  for (const x of ['Maszyna', 'Prot.', 'Adres', 'Port', 'Proces', 'Nasłuchuje na', 'Zapora ufw'])
    hd.append(el('span', '', x));
  tbl.append(hd);
  const rows = [];
  // czy regula ufw (np. "22/tcp", "10011", "6000:6010/tcp") wpuszcza dany port z calego swiata
  const ufwOpen = (s, proto, port) =>
    s.ufw.some(r => {
      const m = String(r).match(/^(\d+)(?::(\d+))?(?:\/(tcp|udp))?$/);
      return m && (!m[3] || m[3] === proto) && port >= +m[1] && port <= +(m[2] || m[1]);
    });
  for (const [host, s] of D.stat)
    for (const x of s.ports || [])
      rows.push({
        host,
        proto: x[0],
        addr: x[1],
        port: x[2],
        proc: x[3] || '',
        sc: pscope(x[1]),
        fw: !s.ufwState
          ? ''
          : s.ufwState === 'inactive'
            ? 'off'
            : pscope(x[1]) === 'local'
              ? ''
              : ufwOpen(s, x[0], x[2])
                ? 'open'
                : 'closed',
      });
  const rs = rows
    .filter(
      r =>
        (!sc || r.sc === sc) &&
        (!pr || r.proto === pr) &&
        (!t || (r.host + ' ' + r.port + ' ' + r.proc + ' ' + r.addr).toLowerCase().includes(t)),
    )
    .sort((a, b) => a.host.localeCompare(b.host) || a.port - b.port || a.proto.localeCompare(b.proto));
  for (const r of rs) {
    const row = el('div', 'tr'),
      sp = el('span');
    sp.append(el('span', 'chip ' + (r.sc === 'all' ? 'wrn' : r.sc === 'local' ? '' : 'ok'), PSC[r.sc]));
    const pt = el('span', 'num', r.port);
    pt.style.fontFamily = 'var(--mono)';
    const fw = el('span');
    if (r.fw)
      fw.append(
        el(
          'span',
          'chip ' + (r.fw === 'open' ? 'wrn' : r.fw === 'off' ? 'bad' : 'ok'),
          r.fw === 'open' ? 'otwarty na świat' : r.fw === 'off' ? 'ufw wyłączony' : 'zablokowany',
        ),
      );
    else fw.append(el('span', 'mut', '–'));
    row.append(
      el('span', '', r.host),
      el('span', 'mut', r.proto.toUpperCase()),
      el('span', 'mut', r.addr),
      pt,
      el('span', '', r.proc || '–'),
      sp,
      fw,
    );
    tbl.append(row);
  }
  if (!rs.length)
    tbl.append(
      el(
        'div',
        'n',
        rows.length
          ? 'Nic nie pasuje do filtra.'
          : 'Brak danych o portach. Zaktualizuj agentów (ta sama komenda instalacji).',
      ),
    );
}
$('#ps').oninput = $('#pscope').onchange = $('#pproto').onchange = renderPorts;

// zakladka Zasoby: maszyny, kontenery Docker, goscie Proxmoxa
function renderRes() {
  const rows = [];
  for (const [host, s] of D.stat) {
    const hh = D.hosts.get(host),
      on = hh ? hh.up : true;
    rows.push({
      type: 'host',
      name: host,
      kind: 'maszyna',
      where: '',
      st: on ? (hh && hh.bad.length ? 'bad' : 'up') : 'down',
      stt: on ? 'agent działa' : 'brak kontaktu',
      cpu: s.cpu,
      cpuT: pc(s.cpu) + ' z ' + s.cores + ' rdz.',
      ram: s.mem,
      ramT: s.memT ? gb(s.memT - s.memA) + ' / ' + gb(s.memT) : '',
      note:
        (s.disks.length
          ? s.disks.length + ' dysk. · max ' + pc(Math.max(...s.disks.map(d => (d[3] / d[4]) * 100)))
          : 'dysk ' + pc(s.disk)) + (s.load != null ? ' · obc. ' + dec(s.load) : ''),
      sel: '{host=' + quote(host) + '}',
      meta: { title: host, host, multi: true },
    });
    for (const c of s.cmap.values()) {
      const [st, stt] = cstate(c),
        cpu = fnum(c.cpu),
        ram = fnum(c.memp);
      rows.push({
        type: 'ct',
        name: c.n,
        kind: 'Docker',
        where: host,
        st,
        stt,
        cpu,
        cpuT: cpu == null ? '–' : pc(cpu),
        ram,
        ramT: c.mem ? String(c.mem).split('/')[0].trim() : '',
        note: c.st || '',
        sel: selOf({ host, source: 'docker', unit: c.n }),
        meta: { title: c.n, host, source: 'docker', unit: c.n },
      });
    }
    for (const g of s.guests) {
      const on = g.status === 'running',
        cpu = on ? (g.cpu || 0) * 100 : null,
        ram = on && g.maxmem ? (g.mem / g.maxmem) * 100 : null;
      rows.push({
        type: 'guest',
        name: g.name || g.id,
        kind: g.type === 'qemu' ? 'VM' : 'LXC',
        where: host + ' · ' + (g.vmid || ''),
        st: on ? 'up' : 'down',
        stt: g.status || '',
        cpu,
        cpuT: cpu == null ? '–' : pc(cpu) + ' z ' + (g.maxcpu || '?') + ' rdz.',
        ram,
        ramT: on && g.maxmem ? gb(g.mem / 1024) + ' / ' + gb(g.maxmem / 1024) : '',
        note: on && g.maxdisk ? 'dysk ' + pc((g.disk / g.maxdisk) * 100) : g.status || '',
      });
    }
  }
  const t = $('#rs').value.trim().toLowerCase(),
    ty = $('#rtype').value,
    by = $('#rsort').value,
    tbl = $('#rtbl');
  const rs = rows
    .filter(r => (!ty || r.type === ty) && (!t || (r.name + ' ' + r.where).toLowerCase().includes(t)))
    .sort((a, b) =>
      by === 'name'
        ? a.name.localeCompare(b.name)
        : (b[by] ?? -1) - (a[by] ?? -1) || a.name.localeCompare(b.name),
    );
  tbl.textContent = '';
  const hd = el('div', 'tr h');
  for (const x of ['Nazwa', 'Rodzaj', 'Gdzie', 'CPU', 'RAM', 'Uwagi']) hd.append(el('span', '', x));
  tbl.append(hd);
  for (const r of rs) {
    const row = el('div', 'tr'),
      n = el('span'),
      d = el('i', dotc(r.st));
    d.title = r.stt;
    n.append(d, el('span', '', r.name));
    n.title = r.name + ' · ' + r.stt;
    const cell = (v, txt) => {
      const c = el('span', 'vol'),
        b = el('i');
      b.style.width = Math.min(100, Math.max(1, v || 0)) + '%';
      if (lvlc(v || 0)) b.style.background = lvlc(v) === 'e' ? 'var(--err)' : 'var(--warn)';
      c.append(el('span', '', v == null ? '–' : pc(v)), b);
      c.title = txt;
      return c;
    };
    row.append(
      n,
      el('span', 'mut', r.kind),
      el('span', '', r.where),
      cell(r.cpu, r.cpuT),
      cell(r.ram, r.ramT),
      el('span', 'mut', r.note),
    );
    if (r.sel) {
      row.style.cursor = 'pointer';
      row.tabIndex = 0;
      row.onclick = () => pick(r.sel, r.meta, '');
      row.onkeydown = x => {
        if (x.key === 'Enter') row.onclick();
      };
    }
    tbl.append(row);
  }
  if (!rs.length)
    tbl.append(
      el(
        'div',
        'n',
        D.stat.size
          ? 'Nic nie pasuje do filtra.'
          : 'Brak pomiarów. Zaktualizuj agentów (ta sama komenda instalacji), żeby zbierały zasoby.',
      ),
    );
}
$('#rs').oninput = $('#rsort').onchange = $('#rtype').onchange = renderRes;
