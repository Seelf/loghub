// Uzytkownicy: lista kont, edytor uprawnien (rola, maszyny, pojedyncze zrodla), hasla i 2FA.
async function uapi(path, method, body) {
  if (demo()) return demo().users(path, method, body);
  const r = await fetch('/auth/users' + (path ? '/' + encodeURIComponent(path) : ''), {
    method: method || 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 401) {
    showLogin('Sesja wygasła. Zaloguj się ponownie.');
    throw new Error('sesja wygasła');
  }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'błąd ' + r.status);
  return d;
}
// edytor konta: rola, a dla ogladajacego cale maszyny albo pojedyncze zrodla (np. sam TeamSpeak z VPS)
let UED = null,
  UEXP = new Set();
const ukey = (h, src, u) => h + '\n' + src + '\n' + u;
function openEditor(u) {
  UED = {
    user: u ? u.user : null,
    role: u ? u.role : 'viewer',
    all: u ? u.hosts == null : false,
    hosts: new Set((u && u.hosts) || []),
    units: new Set(((u && u.units) || []).map(x => ukey(...x))),
  };
  UEXP = new Set([...UED.units].map(k => k.split('\n')[0]));
  $('#ued').hidden = false;
  $('#ufh').textContent = u ? 'Edycja konta: ' + u.user : 'Nowe konto';
  $('#un').value = u ? u.user : '';
  $('#un').disabled = !!u;
  $('#uq').value = '';
  $('#usave').textContent = u ? 'Zapisz zmiany' : 'Dodaj konto';
  $('#umsg').textContent = '';
  renderEditor();
  $('#usersv').scrollTop = 0;
  if (!u) $('#un').focus();
}
function closeEditor() {
  UED = null;
  $('#ued').hidden = true;
}
function renderEditor() {
  for (const b of $('#urole').children) b.classList.toggle('on', b.dataset.v === UED.role);
  for (const b of $('#uscope').children) b.classList.toggle('on', b.dataset.v === (UED.all ? 'all' : 'sel'));
  const adm = UED.role === 'admin';
  $('#uroleh').textContent = adm
    ? 'Administrator widzi wszystko i zarządza kontami, powiadomieniami i stroną statusu.'
    : 'Oglądający tylko przegląda logi i stan tego, co mu udostępnisz.';
  $('#uacc').hidden = adm;
  $('#upick').hidden = UED.all;
  $('#uallh').hidden = !UED.all;
  if (!adm && !UED.all) renderPick();
}
// drzewo: maszyny (kontenery pod swoim hostem), po rozwinieciu ich zrodla pogrupowane jak w panelu bocznym
function renderPick() {
  const box = $('#uhp'),
    q = $('#uq').value.trim().toLowerCase(),
    sc = box.scrollTop;
  box.textContent = '';
  const names = new Set(D.hosts.keys());
  for (const h of UED.hosts) names.add(h);
  for (const k of UED.units) names.add(k.split('\n')[0]);
  const srcOf = h => {
    const m = new Map();
    for (const u of (D.hosts.get(h) || { units: [] }).units)
      if (u.source !== 'stat') m.set(ukey(h, u.source, u.unit), u);
    for (const k of UED.units) {
      const [hh, s2, u2] = k.split('\n');
      if (hh === h && !m.has(k)) m.set(k, { host: h, source: s2, unit: u2, gone: true });
    }
    return [...m.values()];
  };
  const match = (h, list) =>
    !q || h.toLowerCase().includes(q) || list.some(u => u.unit.toLowerCase().includes(q));
  const roots = [...names]
    .filter(n => {
      const hh = D.hosts.get(n);
      return !hh || !hh.parent || !names.has(hh.parent);
    })
    .sort();
  let shown = 0;
  const row = (h, kid) => {
    const list = srcOf(h);
    if (!match(h, list)) return;
    shown++;
    const whole = UED.hosts.has(h),
      picked = list.filter(u => UED.units.has(ukey(h, u.source, u.unit))).length,
      open = UEXP.has(h) || (!!q && !h.toLowerCase().includes(q));
    const r = el('div', 'ph' + (kid ? ' kid' : '')),
      ex = el('button', 'exp' + (open ? ' open' : ''), '›'),
      lb = el('label'),
      cb = el('input');
    ex.disabled = !list.length;
    ex.title = 'pokaż źródła';
    ex.onclick = () => {
      UEXP.has(h) ? UEXP.delete(h) : UEXP.add(h);
      renderPick();
    };
    cb.type = 'checkbox';
    cb.checked = whole;
    cb.indeterminate = !whole && picked > 0;
    cb.onchange = () => {
      if (cb.checked) {
        UED.hosts.add(h);
        if (!kid) for (const k of family(h).slice(1)) UED.hosts.add(k);
      } else {
        UED.hosts.delete(h);
        if (!kid) for (const k of family(h).slice(1)) UED.hosts.delete(k);
      }
      renderPick();
    };
    lb.append(cb, el('b', '', h));
    const info = whole
      ? 'cała maszyna'
      : picked
        ? picked + ' z ' + list.length + ' źródeł'
        : list.length
          ? list.length + ' źródeł'
          : D.hosts.has(h)
            ? ''
            : 'brak danych';
    r.append(ex, lb, el('span', 'mut', info));
    box.append(r);
    if (open && list.length) {
      const pu = el('div', 'pu' + (kid ? ' kid' : ''));
      let grp = '';
      const items = list
        .filter(u => !q || h.toLowerCase().includes(q) || u.unit.toLowerCase().includes(q))
        .sort((a, b) => (a.source + a.unit).localeCompare(b.source + b.unit));
      for (const u of items) {
        if (u.source !== grp) {
          grp = u.source;
          pu.append(el('div', 'lbl', SRC[grp] || grp));
        }
        const k = ukey(h, u.source, u.unit),
          l = el('label', whole ? 'imp' : ''),
          c = el('input');
        c.type = 'checkbox';
        c.checked = whole || UED.units.has(k);
        c.disabled = whole;
        c.onchange = () => {
          c.checked ? UED.units.add(k) : UED.units.delete(k);
          renderPick();
        };
        l.title = whole ? 'cała maszyna jest zaznaczona' : u.unit;
        l.append(c, el('span', '', short(u.unit) + (u.gone ? ' (brak logów)' : '')));
        pu.append(l);
      }
      box.append(pu);
    }
  };
  for (const r of roots) {
    row(r, false);
    for (const k of family(r).slice(1)) if (names.has(k)) row(k, true);
  }
  if (!shown)
    box.append(
      el(
        'div',
        'n',
        q ? 'Nic nie pasuje do „' + q + '”.' : 'Brak maszyn. Najpierw dodaj agenta na jakiejś maszynie.',
      ),
    );
  box.scrollTop = sc;
  const nh = UED.hosts.size,
    nu = [...UED.units].filter(k => !UED.hosts.has(k.split('\n')[0])).length;
  $('#usum').textContent =
    !nh && !nu
      ? 'Nic nie jest zaznaczone: konto nie zobaczy żadnych logów.'
      : 'Widzi: ' +
        (nh ? nh + ' ' + pl(nh, 'całą maszynę', 'całe maszyny', 'całych maszyn') : '') +
        (nh && nu ? ' i ' : '') +
        (nu ? nu + ' ' + pl(nu, 'pojedyncze źródło', 'pojedyncze źródła', 'pojedynczych źródeł') : '') +
        '. Cała maszyna obejmuje też jej stan, zasoby i źródła dodane później; pojedyncze źródło to tylko jego logi.';
}
for (const b of $('#urole').children)
  b.onclick = () => {
    UED.role = b.dataset.v;
    renderEditor();
  };
for (const b of $('#uscope').children)
  b.onclick = () => {
    UED.all = b.dataset.v === 'all';
    renderEditor();
  };
$('#uq').oninput = renderPick;
$('#uexp').onclick = () => {
  const all = [...D.hosts.keys()];
  if (all.every(h => UEXP.has(h))) {
    UEXP.clear();
    $('#uexp').textContent = 'rozwiń wszystko';
  } else {
    UEXP = new Set(all);
    $('#uexp').textContent = 'zwiń wszystko';
  }
  renderPick();
};
$('#uclr').onclick = () => {
  UED.hosts.clear();
  UED.units.clear();
  renderPick();
};
$('#unew').onclick = () => openEditor(null);
$('#ucancel').onclick = closeEditor;
function showPw(user, pw, isNew) {
  const b = $('#upw');
  b.hidden = false;
  b.textContent = '';
  const r1 = el('div', 'row'),
    r2 = el('div', 'row'),
    cp = el('button', '', 'Kopiuj'),
    x = el('button', '', 'Zamknij');
  cp.onclick = () => copyText('Login: ' + user + '\nHasło: ' + pw, cp);
  x.onclick = () => {
    b.hidden = true;
  };
  r1.append(el('b', '', isNew ? 'Konto utworzone' : 'Nowe hasło dla ' + user));
  r2.append('Login', el('code', '', user), 'Hasło', el('code', '', pw), cp, x);
  b.append(
    r1,
    r2,
    el(
      'div',
      'mut',
      'Przekaż te dane bezpiecznie, hasło nie pokaże się ponownie. Przy pierwszym logowaniu użytkownik włączy 2FA.',
    ),
  );
  $('#usersv').scrollTop = 0;
}
$('#usave').onclick = async () => {
  const m = $('#umsg');
  m.style.color = '';
  m.textContent = 'Zapisuję…';
  const body = {
    role: UED.role,
    hosts: UED.role === 'admin' || UED.all ? 'all' : [...UED.hosts],
    units:
      UED.role === 'admin' || UED.all
        ? []
        : [...UED.units].map(k => k.split('\n')).filter(x => !UED.hosts.has(x[0])),
  };
  try {
    if (UED.user) {
      await uapi(UED.user, 'PUT', body);
      closeEditor();
      flashU('Zapisano zmiany konta. Działają od razu.');
    } else {
      const r = await uapi('', 'POST', Object.assign({ user: $('#un').value.trim() }, body));
      closeEditor();
      showPw(r.user, r.password, true);
    }
    loadUsers();
  } catch (e) {
    m.style.color = 'var(--err)';
    m.textContent = 'Nie zapisano: ' + e.message;
  }
};
function flashU(t) {
  const b = $('#upw');
  b.hidden = false;
  b.textContent = '';
  const r = el('div', 'row'),
    x = el('button', '', 'Zamknij');
  x.onclick = () => {
    b.hidden = true;
  };
  r.append(el('span', '', t), x);
  b.append(r);
  setTimeout(() => {
    if (b.contains(r)) b.hidden = true;
  }, 4000);
}
// skrot dostepu w liscie kont
function accessChips(u) {
  const sc = el('span', 'sc');
  if (u.role === 'admin' || u.hosts == null) {
    sc.append(el('span', 'chip ok', 'wszystko'));
    return sc;
  }
  const items = [
    ...u.hosts.map(h => [h + ' · cała', 'chip']),
    ...(u.units || []).map(x => [x[0] + ' › ' + short(x[2]), 'chip']),
  ];
  if (!items.length) {
    sc.append(el('span', 'chip bad', 'nic'));
    return sc;
  }
  for (const [t, c] of items.slice(0, 5)) {
    const x = el('span', c, t);
    x.title = t;
    sc.append(x);
  }
  if (items.length > 5) {
    const x = el('span', 'chip', '+' + (items.length - 5));
    x.title = items
      .slice(5)
      .map(i => i[0])
      .join('\n');
    sc.append(x);
  }
  return sc;
}
function confirmBtn(b, label, fn) {
  b.onclick = async () => {
    if (b.dataset.ok !== '1') {
      b.dataset.ok = '1';
      const o = b.textContent;
      b.textContent = label;
      b.style.color = 'var(--err)';
      setTimeout(() => {
        if (b.isConnected) {
          b.dataset.ok = '';
          b.textContent = o;
          b.style.color = '';
        }
      }, 4000);
      return;
    }
    b.disabled = true;
    try {
      await fn();
    } catch (e) {
      b.disabled = false;
      flashU('Nie udało się: ' + e.message);
    }
  };
}
async function loadUsers() {
  if (!me || me.role !== 'admin') return;
  const box = $('#ulist');
  try {
    const { users } = await uapi('');
    box.textContent = '';
    const hd = el('div', 'urow h');
    for (const x of ['Konto', 'Rola', 'Co widzi', '2FA', '']) hd.append(el('span', '', x));
    box.append(hd);
    for (const u of users) {
      const r = el('div', 'urow'),
        nm = el('span', 'nm', u.user);
      if (u.user === me.user) nm.append(el('span', 'chip', 'Ty'));
      const acts = el('span', 'acts'),
        be = el('button', '', 'Edytuj'),
        bp = el('button', '', 'Nowe hasło'),
        b2 = el('button', '', 'Reset 2FA'),
        bd = el('button', '', 'Usuń');
      be.onclick = () => openEditor(u);
      confirmBtn(bp, 'Na pewno nowe hasło?', async () => {
        const x = await uapi(u.user, 'PUT', { new_password: true });
        showPw(u.user, x.password, false);
        loadUsers();
      });
      confirmBtn(b2, 'Na pewno reset 2FA?', async () => {
        await uapi(u.user, 'PUT', { reset_2fa: true });
        flashU('2FA zresetowane: ' + u.user + ' ustawi je przy następnym logowaniu.');
        loadUsers();
      });
      confirmBtn(bd, 'Na pewno usunąć?', async () => {
        await uapi(u.user, 'DELETE');
        if (UED && UED.user === u.user) closeEditor();
        flashU('Usunięto konto ' + u.user + '.');
        loadUsers();
      });
      if (u.user === me.user) ((bd.disabled = true), (bd.title = 'nie można usunąć własnego konta'));
      acts.append(be, bp, b2, bd);
      r.append(
        nm,
        el('span', 'mut', u.role === 'admin' ? 'administrator' : 'oglądający'),
        accessChips(u),
        (() => {
          const t = el('span', u.totp ? '' : 'mut');
          t.append(el('span', 'm', '2FA: '), u.totp ? 'włączone' : 'przy 1. logowaniu');
          return t;
        })(),
        acts,
      );
      box.append(r);
    }
  } catch (e) {
    box.textContent = '';
    box.append(el('div', 'n', 'Nie udało się wczytać kont: ' + e.message));
  }
}
