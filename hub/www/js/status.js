// Publiczna strona statusu: wybor uslug i ich grup.
let SC = { title: '', components: [], states: {} };
async function loadStat() {
  $('#sprev').hidden = !!demo();
  try {
    SC = await napi('status');
    SC.components = SC.components || [];
    renderStat();
  } catch (e) {
    $('#smsg').textContent = e.message;
  }
}
function renderStat() {
  $('#stitle').value = SC.title || '';
  const box = $('#scomps');
  box.textContent = '';
  if (!SC.components.length)
    box.append(
      el(
        'div',
        'mut',
        'Nie ma jeszcze żadnych usług. Dodaj pierwszą, np. „TeamSpeak” podpięty pod usługę teamspeak.service na VPS.',
      ),
    );
  SC.components.forEach((c, i) => box.append(statRow(c, i)));
}
function statRow(c, i) {
  const r = el('div', 'srow');
  const nm = el('input');
  nm.placeholder = 'nazwa na stronie, np. TeamSpeak';
  nm.maxLength = 60;
  nm.value = c.name || '';
  nm.oninput = () => {
    c.name = nm.value;
  };
  const gr = el('input');
  gr.placeholder = 'grupa (opcjonalnie)';
  gr.maxLength = 40;
  gr.value = c.group || '';
  gr.oninput = () => {
    c.group = gr.value;
  };
  const ty = el('select');
  for (const [v, l] of [
    ['docker', 'kontener Docker'],
    ['unit', 'usługa systemd'],
    ['host', 'cały serwer'],
  ])
    ty.append(new Option(l, v));
  ty.value = c.type || 'docker';
  const ho = el('select');
  ho.append(new Option('maszyna…', ''));
  for (const n of [...D.hosts.keys()].sort()) ho.append(new Option(n, n));
  if (c.host && !D.hosts.has(c.host)) ho.append(new Option(c.host, c.host));
  ho.value = c.host || '';
  const ta = el('select');
  const fill = () => {
    ta.textContent = '';
    ta.style.visibility = c.type === 'host' ? 'hidden' : '';
    const s = D.stat.get(c.host);
    let opts = s
      ? c.type === 'docker'
        ? [...s.cmap.keys()]
        : [...s.umap.keys()].filter(n => /\.service$/.test(n))
      : [];
    opts.sort();
    if (c.target && !opts.includes(c.target)) opts.unshift(c.target);
    ta.append(new Option(c.type === 'docker' ? 'kontener…' : 'usługa…', ''));
    for (const o of opts) ta.append(new Option(o, o));
    ta.value = c.target || '';
  };
  fill();
  ty.onchange = () => {
    c.type = ty.value;
    c.target = '';
    fill();
  };
  ho.onchange = () => {
    c.host = ho.value;
    c.target = '';
    fill();
  };
  ta.onchange = () => {
    c.target = ta.value;
  };
  const st = (SC.states || {})[c.id],
    chip = el(
      'span',
      'chip ' + (st === 'ok' ? 'ok' : st === 'partial' ? 'wrn' : st === 'down' ? 'bad' : ''),
      st === 'ok' ? 'działa' : st === 'partial' ? 'z problemem' : st === 'down' ? 'nie działa' : 'nowa',
    );
  chip.title = 'stan teraz (odświeża się co minutę po zapisaniu)';
  const up = el('button', '', '↑'),
    dn = el('button', '', '↓'),
    rm = el('button', '', '✕');
  up.title = 'wyżej';
  dn.title = 'niżej';
  rm.title = 'usuń z listy';
  up.disabled = !i;
  dn.disabled = i === SC.components.length - 1;
  const mv = d => {
    const a = SC.components;
    [a[i], a[i + d]] = [a[i + d], a[i]];
    renderStat();
  };
  up.onclick = () => mv(-1);
  dn.onclick = () => mv(1);
  rm.onclick = () => {
    SC.components.splice(i, 1);
    renderStat();
  };
  r.append(nm, gr, ty, ho, ta, chip, up, dn, rm);
  return r;
}
$('#sadd').onclick = () => {
  SC.components.push({ name: '', group: '', type: 'docker', host: '', target: '' });
  renderStat();
  const ins = $('#scomps').querySelectorAll('.srow input');
  if (ins.length) ins[ins.length - 2].focus();
};
$('#stitle').oninput = () => {
  SC.title = $('#stitle').value;
};
$('#ssave').onclick = async () => {
  const m = $('#smsg');
  m.style.color = '';
  m.textContent = 'Zapisuję…';
  try {
    const st = SC.states;
    SC = await napi('status', 'PUT', { title: SC.title, components: SC.components });
    SC.states = Object.assign({}, st, SC.states || {});
    renderStat();
    m.style.color = 'var(--acc)';
    m.textContent = 'Zapisano. Strona publiczna pokaże zmiany w ciągu minuty.';
  } catch (e) {
    m.style.color = 'var(--err)';
    m.textContent = e.message;
  }
};
