// Sterowanie: menu, motyw, skroty klawiszowe, telefon i start strony.
for (const b of document.querySelectorAll('#nav button'))
  b.onclick = () => {
    const g = b.dataset.go;
    if (g === 'cron') {
      cronHost = null;
      renderCron();
      show(g);
      if (Date.now() - I.cronT > 6e4) loadCron();
      return;
    }
    if (g === 'over' || g === 'notif' || g === 'users' || g === 'status' || g === 'add') return show(g);
    pick(
      ALL,
      { title: g === 'err' ? 'Błędy i ostrzeżenia' : 'Wszystkie logi', multi: true },
      g === 'err' ? 'w' : '',
      g === 'err' ? '1d' : null,
    );
  };
for (const b of document.querySelectorAll('[data-tog]'))
  b.onclick = () => document.body.classList.toggle('nos');
// telefon: panel jest szuflada; zamyka sie po wybraniu widoku albo zrodla i po kliknieciu obok
const narrow = () => innerWidth < 760;
$('#scrim').onclick = () => document.body.classList.add('nos');
document.querySelector('aside').addEventListener('click', e => {
  if (narrow() && e.target.closest('#nav button,.it:not(.ghost)')) document.body.classList.add('nos');
});
addEventListener('keydown', e => {
  if (e.key === 'Escape' && narrow()) document.body.classList.add('nos');
});
// wyglad strony: zapamietany w tej przegladarce
const THEMES = [
  ['', 'systemowy'],
  ['dark', 'ciemny'],
  ['light', 'jasny'],
  ['glass', 'Apple ciemny'],
  ['glass-light', 'Apple jasny'],
];
function setTheme(t) {
  if (t) document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  try {
    t ? localStorage.setItem('loghub.theme', t) : localStorage.removeItem('loghub.theme');
  } catch {}
}
{
  const ts = $('#theme');
  for (const [v, l] of THEMES) ts.append(new Option(l, v));
  ts.value = document.documentElement.dataset.theme || '';
  ts.onchange = () => setTheme(ts.value);
}
$('#f').oninput = filterTree;
$('#range').onchange = () => {
  syncDay();
  reload();
};
$('#lvl').onchange = reload;
// logi z wybranego dnia (opcjonalnie zawezone do godzin); dzisiaj konczy sie na teraz
const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
function syncDay() {
  const on = $('#range').value === 'day';
  for (const x of ['#day', '#dfrom', '#dto']) $(x).hidden = !on;
  if (on) {
    const t = ymd(new Date());
    $('#day').max = t;
    if (!$('#day').value) $('#day').value = t;
  }
}
function dayWin() {
  const d = $('#day').value || ymd(new Date()),
    a = new Date(d + 'T' + ($('#dfrom').value || '00:00')),
    b = new Date(d + 'T' + ($('#dto').value || '23:59'));
  let from = +a,
    to = +b + 6e4;
  if (to <= from) to = from + 6e4;
  return [from, Math.min(to, Date.now())];
}
for (const x of ['#day', '#dfrom', '#dto'])
  $(x).onchange = () => {
    if ($('#range').value === 'day') reload();
  };
let deb;
$('#q').oninput = () => {
  clearTimeout(deb);
  deb = setTimeout(reload, 400);
};
$('#q').onkeydown = e => {
  if (e.key === 'Escape') {
    e.target.value = '';
    reload();
  }
};
$('#live').onclick = () => {
  live = !live;
  $('#live').setAttribute('aria-pressed', live);
  $('#live span').textContent = live ? 'Na żywo' : 'Wstrzymane';
  reload();
};
jump.onclick = toEnd;
document.onkeydown = e => {
  if (!me) return;
  if (e.key === '/' && view === 'logs' && !/INPUT|SELECT/.test(e.target.tagName)) {
    e.preventDefault();
    $('#q').focus();
  }
  if (e.key === 'k' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    document.body.classList.remove('nos');
    $('#f').focus();
  }
};

if (innerWidth < 760) document.body.classList.add('nos');
async function boot() {
  try {
    const { status: s, data: d } = await auth('me');
    if (s === 200 && d.user) return enter(d);
  } catch {}
  showLogin('');
}
if (!demo() && new URLSearchParams(location.search).has('demo')) {
  const s = document.createElement('script');
  s.src = 'demo.js';
  s.onload = s.onerror = boot;
  document.head.append(s);
} else boot();
