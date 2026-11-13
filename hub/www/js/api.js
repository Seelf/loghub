// Zapytania do bazy logow (przez usluge auth) oraz logowanie i wylogowanie.
async function api(path, params, signal) {
  const body = new URLSearchParams(params);
  const r = demo()
    ? await demo().api(path, body, signal)
    : await fetch('/select/logsql/' + path, { method: 'POST', body, signal });
  if (r.status === 401) {
    showLogin('Sesja wygasła. Zaloguj się ponownie.');
    throw new Error('sesja wygasła');
  }
  if (!r.ok) {
    const t = await r.text();
    throw new Error(
      r.status + (/^\s*</.test(t) ? ' (centrala albo tunel nie odpowiada)' : ' ' + t.slice(0, 200)),
    );
  }
  return r;
}
async function auth(path, body) {
  if (demo()) return demo().auth(path, body);
  const r = await fetch(
    '/auth/' + path,
    body
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : {},
  );
  return { status: r.status, data: await r.json().catch(() => ({})) };
}
function showLogin(msg) {
  me = null;
  if (ctl) ctl.abort();
  $('#app').hidden = true;
  $('#login').hidden = false;
  $('#enr').hidden = true;
  $('#lp').value = $('#lc').value = '';
  $('#lerr').textContent = msg || '';
  if (demo())
    $('#lhint').textContent =
      'Tryb demo: zaloguje dowolne dane. Wpisz użytkownika „nowy”, żeby zobaczyć pierwsze logowanie z włączaniem 2FA.';
  $('#lu').focus();
}
function enter(u) {
  me = u;
  $('#login').hidden = true;
  $('#app').hidden = false;
  $('#who').textContent = u.user;
  $('#role').textContent = u.role === 'admin' ? 'administrator' : 'oglądający';
  $('#role').title =
    u.role === 'admin'
      ? ''
      : !u.hosts
        ? 'widzi wszystko'
        : (u.hosts.length ? u.hosts.length + ' ' + pl(u.hosts.length, 'maszyna', 'maszyny', 'maszyn') : '') +
            ((u.units || []).length
              ? (u.hosts.length ? ' i ' : '') +
                u.units.length +
                ' ' +
                pl(u.units.length, 'źródło', 'źródła', 'źródeł')
              : '') || 'nic';
  $('#navusers').hidden = u.role !== 'admin';
  $('#navstat').hidden = u.role !== 'admin';
  $('#navadd').hidden = u.role !== 'admin';
  if ((view === 'status' || view === 'add') && u.role !== 'admin') view = 'over';
  $('#adv').hidden = !!u.hosts || !!demo();
  if (view === 'users' && u.role !== 'admin') view = 'over';
  if (demo()) {
    $('#demo').hidden = false;
    $('#adv').hidden = true;
  }
  if (!started) {
    started = true;
    setInterval(refresh, 6e4);
    setInterval(() => {
      if (me && view === 'logs') headStats();
    }, 3e4);
    setInterval(pollStat, 15e3);
    setInterval(loadNotif, 3e4);
    // gdy strumien milczy (np. tunel go wstrzymal), co 20 s dociagamy nowe linie zwyklym zapytaniem
    setInterval(() => {
      if (
        me &&
        view === 'logs' &&
        live &&
        cur &&
        cur.q &&
        !cur.win &&
        ctl &&
        !document.hidden &&
        Date.now() - lastData > 25e3
      )
        catchUp(cur.q, ctl.signal);
    }, 2e4);
  }
  show(view);
  refresh();
  loadNotif();
}
$('#lf').onsubmit = async e => {
  e.preventDefault();
  $('#lgo').disabled = true;
  $('#lerr').textContent = '';
  try {
    const { status: s, data: d } = await auth('login', {
      user: $('#lu').value,
      pass: $('#lp').value,
      code: $('#lc').value,
    });
    if (s === 200 && d.user) return enter(d);
    if (d.enroll) {
      $('#enr').hidden = false;
      $('#key').textContent = d.enroll.secret.replace(/(.{4})/g, '$1 ').trim();
      $('#kuri').href = d.enroll.uri;
      $('#kcopy').onclick = () =>
        navigator.clipboard
          .writeText(d.enroll.secret)
          .then(() => {
            $('#kcopy').textContent = 'skopiowano';
          })
          .catch(() => {});
      $('#lerr').textContent =
        s === 401 ? 'Kod się nie zgadza. Sprawdź, czy telefon ma dobrą godzinę, i wpisz aktualny kod.' : '';
      $('#lc').placeholder = '6 cyfr';
      $('#lc').focus();
    } else
      $('#lerr').textContent =
        s === 429
          ? 'Za dużo nieudanych prób. Spróbuj ponownie za ' + (d.retry || 60) + ' s.'
          : s === 401
            ? 'Nieprawidłowy użytkownik, hasło lub kod.'
            : 'Logowanie nie działa (błąd ' + s + '). Sprawdź, czy centrala jest uruchomiona.';
  } catch (x) {
    $('#lerr').textContent = 'Brak połączenia z centralą.';
  } finally {
    $('#lgo').disabled = false;
  }
};
$('#out').onclick = async () => {
  await auth('logout', {}).catch(() => {});
  showLogin('');
};
