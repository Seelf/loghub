// Panel boczny: drzewo maszyn i zrodel, filtr, wybor zrodla.
function item(label, sel, meta, u) {
  const it = el('div', 'it');
  it.dataset.sel = sel;
  it.dataset.k = meta.k;
  it.tabIndex = 0;
  it.setAttribute('role', 'button');
  if (u) {
    const d = el('i', dotc(u.st));
    if (!u.st) d.style.visibility = 'hidden';
    d.title = u.stt;
    it.append(d);
  }
  const n = el('span', '', label);
  n.title = meta.title || label;
  it.append(n);
  if (u && u.inc) {
    const c = el('span', 'chip bad', u.inc);
    c.title = u.inc + ' ' + pl(u.inc, 'zdarzenie', 'zdarzenia', 'zdarzeń') + ' w 24 h';
    it.append(c);
  }
  if (u) it.append(el('small', '', num(u.c24)));
  if (cur && cur.sel === sel) it.classList.add('on');
  it.onclick = () => pick(sel, meta);
  it.onkeydown = e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      it.onclick();
    }
  };
  return it;
}
// maszyna matka: host Proxmoxa, ktorego lista gosci (LXC/VM) zawiera nazwe innej maszyny z agentem
function linkParents() {
  // przy kilku gosciach o tej samej nazwie wygrywa dzialajacy kontener LXC (tam instaluje sie agent)
  const by = new Map(),
    score = g => (g.status === 'running' ? 2 : 0) + (g.type === 'lxc' ? 1 : 0);
  for (const [host, s] of D.stat)
    for (const g of s.guests)
      if (g.name && g.name !== host) {
        const o = by.get(g.name);
        if (!o || score(g) > score(o.g)) by.set(g.name, { parent: host, g });
      }
  for (const h of D.hosts.values()) {
    const x = by.get(h.name);
    h.parent = x && D.hosts.has(x.parent) ? x.parent : null;
    h.guest = h.parent ? x.g : null;
  }
}
const kids = name =>
  [...D.hosts.values()].filter(h => h.parent === name).sort((a, b) => a.name.localeCompare(b.name));
const family = name => [name, ...kids(name).flatMap(k => family(k.name))];
function hostNode(h, open, first) {
  const d = el('details');
  d.dataset.h = h.name;
  d.open = open.has(h.name);
  const sm = el('summary'),
    dot = el('i', 'dot' + (h.up ? (h.bad.length ? ' bad' : ' up') : ''));
  dot.title = h.up
    ? h.bad.length
      ? h.bad.length + ' usług z problemem'
      : 'agent działa'
    : 'brak kontaktu z agentem';
  const s = D.stat.get(h.name),
    lab = el('span', '', h.name);
  lab.style.overflow = 'hidden';
  lab.style.textOverflow = 'ellipsis';
  sm.append(dot, lab);
  if (h.guest)
    sm.append(el('span', 'chip', (h.guest.type === 'qemu' ? 'VM ' : 'LXC ') + (h.guest.vmid || '')));
  sm.append(el('small', '', s ? 'CPU ' + pc(s.cpu) : num(h.c24)));
  if (s) sm.title = 'CPU ' + pc(s.cpu) + ' · RAM ' + pc(s.mem) + ' · dysk ' + pc(s.disk);
  d.append(sm);
  d.append(
    item('cały serwer', '{host=' + quote(h.name) + '}', {
      k: h.name.toLowerCase(),
      title: h.name,
      host: h.name,
      multi: true,
    }),
  );
  // zadania cron tej maszyny (dla maszyny matki: razem z jej kontenerami)
  const fam = family(h.name),
    cj = C.filter(j => fam.includes(j.host)),
    cb = cj.filter(j => j.bad).length;
  if (cj.length) {
    const it = el('div', 'it');
    it.tabIndex = 0;
    it.setAttribute('role', 'button');
    it.dataset.k = (h.name + ' cron').toLowerCase();
    it.dataset.sel = 'cron:' + h.name;
    it.append(el('span', '', 'zadania cron'));
    if (cb) it.append(el('span', 'chip bad', cb));
    it.append(el('small', '', cj.length));
    it.onclick = () => showCron(h.name);
    it.onkeydown = e => {
      if (e.key === 'Enter') it.onclick();
    };
    d.append(it);
  }
  for (const src of [...new Set(h.units.map(u => u.source))].filter(x => x !== 'cron').sort()) {
    d.append(el('div', 'grp', SRC[src] || src));
    for (const u of h.units.filter(u => u.source === src).sort((a, b) => a.unit.localeCompare(b.unit)))
      d.append(
        item(
          short(u.unit),
          u.sel,
          {
            k: (u.host + ' ' + src + ' ' + u.unit).toLowerCase(),
            title: short(u.unit),
            host: u.host,
            source: src,
            unit: u.unit,
          },
          u,
        ),
      );
  }
  // goscie Proxmoxa: z agentem jako zagniezdzone maszyny, bez agenta jako sam stan
  const ks = kids(h.name),
    withAgent = new Set(ks.map(k => k.guest && k.guest.id)),
    bare = s ? s.guests.filter(g => !withAgent.has(g.id)) : [];
  if (ks.length || bare.length) {
    d.append(el('div', 'grp', 'LXC i VM'));
    for (const k of ks) d.append(hostNode(k, open, first));
    for (const g of bare.sort((a, b) => String(a.name).localeCompare(String(b.name)))) {
      const on = g.status === 'running',
        it = el('div', 'it ghost');
      it.dataset.k = (h.name + ' ' + g.name).toLowerCase();
      const dt = el('i', 'dot' + (on ? ' up' : ''));
      dt.title = g.status || '';
      it.append(
        dt,
        el('span', '', (g.name || g.id) + ' · ' + (g.type === 'qemu' ? 'VM ' : 'LXC ') + (g.vmid || '')),
        el('small', '', on ? pc((g.cpu || 0) * 100) : 'stop'),
      );
      it.title = 'bez agenta loghub: widać tylko stan i zużycie z Proxmoxa';
      d.append(it);
    }
  }
  return d;
}
function renderTree() {
  const open = new Set([...tree.querySelectorAll('details[open]')].map(d => d.dataset.h)),
    first = !tree.children.length;
  linkParents();
  tree.textContent = '';
  for (const h of [...D.hosts.values()].filter(h => !h.parent).sort((a, b) => a.name.localeCompare(b.name)))
    tree.append(hostNode(h, open, first));
  const e = (D.inc || []).filter(vis).length;
  $('#nerr').hidden = !e;
  $('#nerr').textContent = e;
  $('#nerr').title = e + ' ' + pl(e, 'zdarzenie', 'zdarzenia', 'zdarzeń') + ' w 24 h';
  filterTree();
  marks();
}
function filterTree() {
  const t = $('#f').value.trim().toLowerCase();
  for (const it of tree.querySelectorAll('.it')) it.hidden = !!t && !it.dataset.k.includes(t);
  for (const d of tree.querySelectorAll('details')) {
    d.hidden = !!t && !d.querySelector('.it:not([hidden])');
    if (t && !d.hidden) d.open = true;
  }
}
function marks() {
  for (const x of tree.querySelectorAll('.it'))
    x.classList.toggle(
      'on',
      (view === 'logs' && !!cur && x.dataset.sel === cur.sel) ||
        (view === 'cron' && !!cronHost && x.dataset.sel === 'cron:' + cronHost),
    );
  const k =
    view === 'cron' && cronHost
      ? ''
      : view !== 'logs'
        ? view
        : cur && cur.sel === ALL
          ? $('#lvl').value
            ? 'err'
            : 'all'
          : '';
  for (const b of document.querySelectorAll('#nav button')) b.classList.toggle('on', b.dataset.go === k);
}
function show(v) {
  view = v;
  $('#over').hidden = v !== 'over';
  $('#logs').hidden = v !== 'logs';
  $('#cronv').hidden = v !== 'cron';
  $('#notv').hidden = v !== 'notif';
  $('#usersv').hidden = v !== 'users';
  $('#statv').hidden = v !== 'status';
  $('#addv').hidden = v !== 'add';
  marks();
  if (v === 'add') loadAdd();
  if (v === 'notif') loadNotif(true);
  if (v === 'users') loadUsers();
  if (v === 'status') loadStat();
}
