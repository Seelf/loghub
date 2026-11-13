// Powiadomienia: reguly, kanaly (ntfy, Telegram, ...) i lista ostatnich alertow.
async function napi(path, method, body) {
  if (demo()) return demo().notify(path, method, body);
  const r = await fetch('/api/notify/' + path, {
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
const RULES = [
  ['host_offline', 'Serwer bez kontaktu z centralą', [['minutes', 'po', ' min']]],
  ['service_down', 'Padnięty kontener Dockera lub usługa systemd', []],
  ['cron_failed', 'Zadanie cron zakończone błędem', []],
  ['disk', 'Zapełniony dysk (każdy osobno)', [['pct', 'od', '%']]],
  ['disk_health', 'Awaria dysku (SMART) lub pula ZFS nie w stanie ONLINE', []],
  ['ports', 'Nowy port otwarty na świat w zaporze ufw (jedno powiadomienie na zmianę)', []],
  [
    'cpu',
    'Wysokie CPU',
    [
      ['pct', 'od', '%'],
      ['minutes', 'średnio przez', ' min'],
    ],
  ],
  [
    'mem',
    'Wysoki RAM',
    [
      ['pct', 'od', '%'],
      ['minutes', 'średnio przez', ' min'],
    ],
  ],
  [
    'errors',
    'Dużo błędów w logach jednego źródła',
    [
      ['count', 'od', ' błędów'],
      ['minutes', 'w ciągu', ' min'],
    ],
  ],
];
const CHT = {
  ntfy: [
    'ntfy',
    [
      ['url', 'Adres tematu, np. https://ntfy.sh/twoj-temat'],
      ['token', 'Token (opcjonalnie)'],
    ],
  ],
  telegram: [
    'Telegram',
    [
      ['bot_token', 'Token bota (od @BotFather)'],
      ['chat_id', 'Chat ID'],
    ],
  ],
  discord: ['Discord', [['url', 'Adres webhooka kanału']]],
  webhook: ['Webhook', [['url', 'Adres (POST z JSON)']]],
  email: [
    'E-mail',
    [
      ['host', 'Serwer SMTP'],
      ['port', 'Port (587 albo 465)'],
      ['user', 'Login'],
      ['password', 'Hasło'],
      ['from', 'Nadawca'],
      ['to', 'Odbiorca'],
    ],
  ],
};
let NC = null,
  ndirty = false;
function alertRow(a, hist) {
  const ev = a.since && a.since === a.until,
    r = el('div', 'al ' + (hist && !ev ? 'ok' : a.sev || 'error')),
    d = el('div');
  d.append(el('b', '', a.title));
  if (a.detail) d.append(el('small', '', a.detail));
  const t = el(
    'time',
    '',
    hist
      ? ev
        ? rel(a.since * 1e3)
        : 'minęło ' +
          rel(a.until * 1e3) +
          (a.since ? ' · trwało ' + dur(Math.max(60, a.until - a.since)) : '')
      : 'od ' + rel(a.since * 1e3).replace(' temu', ''),
  );
  r.append(d, t);
  if (a.host && D.hosts.has(a.host)) {
    r.classList.add('click');
    r.tabIndex = 0;
    const u = D.units.find(x => x.host === a.host && x.unit === a.unit);
    r.onclick = () =>
      u
        ? pick(u.sel, { title: short(u.unit), host: u.host, source: u.source, unit: u.unit }, '')
        : pick('{host=' + quote(a.host) + '}', { title: a.host, host: a.host, multi: true }, '');
    r.onkeydown = x => {
      if (x.key === 'Enter') r.onclick();
    };
  }
  return r;
}
async function loadNotif(full) {
  if (!me) return;
  try {
    const s = await napi('state');
    const n = s.active.length;
    $('#nnot').hidden = !n;
    $('#nnot').textContent = n;
    if (view !== 'notif') return;
    const act = $('#nact'),
      hist = $('#nhist');
    act.textContent = '';
    hist.textContent = '';
    for (const a of s.active) act.append(alertRow(a, false));
    if (!n) act.append(el('div', 'n', 'Brak aktywnych problemów.'));
    for (const a of s.history.slice(0, 60)) hist.append(alertRow(a, true));
    if (!s.history.length) hist.append(el('div', 'n', 'Jeszcze nic się nie wydarzyło.'));
    $('#nsub').textContent =
      (s.error ? s.error + ' ' : '') +
      'Ostatnie sprawdzenie: ' +
      (s.checked_at ? rel(s.checked_at * 1e3) : 'jeszcze nie było') +
      '. ' +
      (s.channels
        ? 'Kanały powiadomień: ' + s.channels + '.'
        : 'Nie ustawiono żadnego kanału, więc powiadomienia widać tylko tutaj.');
    if (me.role === 'admin' && full && !ndirty) {
      NC = await napi('config');
      renderNset();
    }
    $('#nset').hidden = me.role !== 'admin';
  } catch (e) {
    if (view === 'notif') $('#nsub').textContent = 'Nie udało się wczytać powiadomień: ' + e.message;
  }
}
function renderNset() {
  const box = $('#nrules');
  box.textContent = '';
  for (const [k, label, fields] of RULES) {
    const r = NC.rules[k],
      row = el('div', 'rule'),
      cb = el('input');
    cb.type = 'checkbox';
    cb.checked = r.on;
    cb.id = 'r_' + k;
    cb.onchange = () => {
      r.on = cb.checked;
      ndirty = true;
    };
    const lb = el('label', '', label);
    lb.htmlFor = cb.id;
    const nums = el('span', 'nums');
    for (const [f, pre, post] of fields) {
      const i = el('input');
      i.type = 'number';
      i.min = 1;
      i.value = r[f];
      i.setAttribute('aria-label', label + ' ' + pre);
      i.oninput = () => {
        r[f] = +i.value || 1;
        ndirty = true;
      };
      nums.append(el('span', '', pre), i, el('span', '', post.trim()));
    }
    row.append(cb, lb, nums);
    box.append(row);
  }
  $('#nres').checked = NC.notify_resolved;
  $('#nrep').value = NC.repeat_hours;
  const chs = $('#nchs');
  chs.textContent = '';
  NC.channels.forEach((c, ix) => {
    const [nm, fields] = CHT[c.type],
      w = el('div', 'chn'),
      top = el('div', 'top'),
      on = el('input'),
      del = el('button', '', 'Usuń');
    on.type = 'checkbox';
    on.checked = c.on !== false;
    on.title = 'włączony';
    on.onchange = () => {
      c.on = on.checked;
      ndirty = true;
    };
    del.onclick = () => {
      NC.channels.splice(ix, 1);
      ndirty = true;
      renderNset();
    };
    const name = el('input');
    name.placeholder = 'nazwa (opcjonalnie)';
    name.value = c.name || '';
    name.oninput = () => {
      c.name = name.value;
      ndirty = true;
    };
    top.append(on, el('b', '', nm), name, del);
    w.append(top);
    for (const [f, label] of fields) {
      const l = el('label', '', label),
        i = el('input');
      i.value = c[f] || '';
      if (/token|password/.test(f)) i.type = 'password';
      i.autocomplete = 'off';
      i.oninput = () => {
        c[f] = i.value;
        ndirty = true;
      };
      l.append(i);
      w.append(l);
    }
    chs.append(w);
  });
  if (!NC.channels.length)
    chs.append(
      el(
        'div',
        'mut',
        'Brak kanałów. Najprościej: ntfy, czyli darmowa aplikacja na telefon (ntfy.sh); wymyśl nazwę tematu i wpisz ją tutaj i w aplikacji.',
      ),
    );
}
$('#nadd').onchange = e => {
  const t = e.target.value;
  if (!t) return;
  NC.channels.push({ type: t, on: true });
  e.target.value = '';
  ndirty = true;
  renderNset();
};
$('#nres').onchange = e => {
  NC.notify_resolved = e.target.checked;
  ndirty = true;
};
$('#nrep').oninput = e => {
  NC.repeat_hours = +e.target.value || 0;
  ndirty = true;
};
$('#nsave').onclick = async () => {
  const m = $('#nmsg');
  m.style.color = '';
  m.textContent = 'Zapisuję…';
  try {
    NC = await napi('config', 'PUT', NC);
    ndirty = false;
    renderNset();
    m.style.color = 'var(--acc)';
    m.textContent = 'Zapisano.';
    loadNotif();
  } catch (e) {
    m.style.color = 'var(--err)';
    m.textContent = 'Nie zapisano: ' + e.message;
  }
};
$('#ntest').onclick = async () => {
  const m = $('#nmsg');
  m.style.color = '';
  if (ndirty) {
    m.style.color = 'var(--warn)';
    m.textContent = 'Najpierw zapisz ustawienia.';
    return;
  }
  m.textContent = 'Wysyłam…';
  try {
    const r = await napi('test', 'POST', {});
    m.style.color = r.results.every(x => x.ok) ? 'var(--acc)' : 'var(--err)';
    m.textContent = r.results.length
      ? r.results.map(x => x.channel + ': ' + (x.ok ? 'wysłano' : 'błąd (' + x.error + ')')).join(' · ')
      : 'Brak włączonych kanałów.';
  } catch (e) {
    m.style.color = 'var(--err)';
    m.textContent = 'Nie wysłano: ' + e.message;
  }
};
