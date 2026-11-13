// Dodawanie maszyn: gotowe polecenia instalacji agenta.
let INS = null;
async function loadAdd() {
  if (!INS) {
    try {
      INS = await napi('install');
    } catch (e) {
      $('#amsg').textContent = 'Nie udało się pobrać danych centrali: ' + e.message;
      return;
    }
  }
  renderAdd();
}
function renderAdd() {
  if (!INS) return;
  const raw = 'https://raw.githubusercontent.com/' + INS.repo + '/main/install.sh',
    nm = $('#aname')
      .value.trim()
      .replace(/[^A-Za-z0-9._-]/g, '');
  const N = nm ? ' --name ' + nm : '',
    S = $('#asudo').checked ? 'sudo ' : '',
    lan = INS.lan || 'http://IP-CENTRALI:8080',
    sh = 'curl -fsSL ' + raw + ' | ' + S + 'bash -s --';
  $('#amsg').textContent = INS.lan
    ? ''
    : 'Centrala nie podała swojego adresu w sieci lokalnej. Zaktualizuj ją (loghub hub) albo wpisz adres ręcznie zamiast IP-CENTRALI.';
  $('#avps').hidden = !INS.ts;
  const C = {
    lan: sh + ' agent --hub ' + lan + ' --token ' + INS.token + ' --no-tailscale' + N,
    vps: INS.ts ? sh + ' agent --hub ' + INS.ts + ' --hub-lan ' + lan + ' --token ' + INS.token + N : '',
    pve:
      'curl -fsSL ' +
      raw +
      ' | bash -s -- agent --hub ' +
      lan +
      ' --token ' +
      INS.token +
      ' --no-tailscale' +
      N,
    gavm: S + 'apt-get install -y qemu-guest-agent && ' + S + 'systemctl start qemu-guest-agent',
    gahost: 'qm set ID --agent enabled=1 && qm shutdown ID && qm start ID',
    gachk: 'qm agent ID ping && echo "guest agent odpowiada"',
    harepo: 'https://github.com/' + INS.repo,
    hahub: lan,
    hatok: INS.token,
    haname: nm || 'haos',
    del: sh + ' uninstall-agent',
  };
  for (const box of document.querySelectorAll('#addv .cmd')) {
    const t = C[box.dataset.k] || '';
    box.textContent = '';
    const c = el('code', '', t),
      b = el('button', '', 'Kopiuj');
    b.onclick = () => copyText(t, b);
    box.append(c, b);
  }
}
async function copyText(t, b) {
  let ok = false;
  try {
    if (navigator.clipboard && isSecureContext) {
      await navigator.clipboard.writeText(t);
      ok = true;
    }
  } catch {}
  if (!ok) {
    const ta = el('textarea');
    ta.value = t;
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.append(ta);
    ta.select();
    try {
      ok = document.execCommand('copy');
    } catch {}
    ta.remove();
  }
  const o = b.textContent;
  b.textContent = ok ? 'Skopiowano' : 'Zaznacz ręcznie';
  setTimeout(() => {
    b.textContent = o;
  }, 1600);
}
$('#aname').oninput = renderAdd;
$('#asudo').onchange = renderAdd;
