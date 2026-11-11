// loghub - modul testowy: udaje API VictoriaLogs przykladowymi danymi.
// Wlacza sie przez dopisanie ?demo do adresu strony. Nie dotyka prawdziwych logow ani kont.
(() => {
  const H = 3600e3, OFFLINE = 'backup';
  // [host, zrodlo, jednostka, linii na godzine, [[poziom syslog lub null, tresc], ...]]
  const U = [
    ['pve', 'journald', 'pvedaemon.service', 14, [
      [6, '<root@pam> starting task UPID:pve:{h}:{h}:vzdump:{ct}:root@pam:'],
      [6, 'INFO: Finished Backup of VM {ct} (00:0{d}:{s})'],
      [6, '<root@pam> end task UPID:pve:{h}:{h}:vzstart:{ct}:root@pam: OK'],
      [4, "VM {ct} qmp command failed - VM {ct} qmp command 'guest-ping' failed - got timeout"],
      [3, 'command \'vzdump {ct} --mode snapshot\' failed: exit code 255']]],
    ['pve', 'journald', 'pveproxy.service', 20, [
      [6, 'worker {n} started'], [6, 'worker {n} finished'], [6, 'successful auth for user \'root@pam\''],
      [4, 'proxy detected vanished client connection']]],
    ['pve', 'journald', 'sshd.service', 6, [
      [6, 'Accepted publickey for root from 100.84.{d}.{n2} port {p} ssh2: ED25519 SHA256:{h}{h}'],
      [6, 'pam_unix(sshd:session): session opened for user root(uid=0) by (uid=0)'],
      [6, 'pam_unix(sshd:session): session closed for user root']]],
    ['pve', 'journald', 'kernel', 9, [
      [6, 'vmbr0: port {d}(veth{ct}i0) entered forwarding state'],
      [6, 'usb 2-1: new SuperSpeed USB device number {d} using xhci_hcd'],
      [4, 'EXT4-fs (sdb1): warning: mounting fs with errors, running e2fsck is recommended'],
      [3, 'blk_update_request: I/O error, dev sdc, sector {n}{n} op 0x0:(READ)']]],
    ['pve', 'journald', 'tailscaled.service', 5, [
      [6, 'magicsock: endpoints changed: 83.{n2}.{n2}.{n2}:41641 (stun), 192.168.1.10:41641 (local)'],
      [6, 'health(warnable=no-derp-connection): ok']]],
    ['pve', 'file', '/var/log/apt/history.log', 0.2, [
      [null, 'Start-Date: 2026-11-10  0{d}:1{d}:0{d}'], [null, 'Upgrade: pve-manager:amd64 (9.0.{d}, 9.0.1{d})'], [null, 'End-Date: 2026-11-10  0{d}:2{d}:4{d}']]],

    ['vps', 'journald', 'sshd.service', 60, [
      [6, 'Failed password for root from {ip} port {p} ssh2'],
      [6, 'Invalid user {u} from {ip} port {p}'],
      [6, 'Connection closed by authenticating user root {ip} port {p} [preauth]'],
      [6, 'Accepted publickey for admin from 100.84.{d}.{n2} port {p} ssh2: ED25519 SHA256:{h}{h}'],
      [3, 'error: maximum authentication attempts exceeded for root from {ip} port {p} ssh2 [preauth]']]],
    ['vps', 'journald', 'kernel', 40, [
      [4, '[UFW BLOCK] IN=eth0 OUT= SRC={ip} DST=203.0.113.7 LEN=40 TTL=24{d} PROTO=TCP SPT={p} DPT=23 SYN'],
      [4, '[UFW BLOCK] IN=eth0 OUT= SRC={ip} DST=203.0.113.7 LEN=44 TTL=5{d} PROTO=TCP SPT={p} DPT=3389 SYN']]],
    ['vps', 'journald', 'teamspeak.service', 10, [
      [6, '|INFO    |VirtualServerBase|1  |client connected \'{u}\'(id:{n2}) from {ip}:{p}'],
      [6, '|INFO    |VirtualServerBase|1  |client disconnected \'{u}\'(id:{n2}) reason \'reasonmsg=leaving\''],
      [4, '|WARNING |VirtualServerBase|1  |client \'{u}\'(id:{n2}) was kicked: idle time exceeded']]],
    ['vps', 'journald', 'mariadb.service', 3, [
      [6, '[Note] InnoDB: Buffer pool(s) load completed'],
      [4, '[Warning] Aborted connection {n} to db: \'unconnected\' user: \'unauthenticated\' host: \'localhost\' (This connection closed normally without authentication)']]],
    ['vps', 'journald', 'tailscaled.service', 4, [
      [6, 'wgengine: Reconfig: configuring userspace WireGuard config (with {d}/{d} peers)'],
      [6, 'health(warnable=no-derp-connection): ok']]],
    ['vps', 'file', '/opt/ts3/logs/ts3server_0.log', 5, [
      [null, '|INFO    |Query         |   |query from 1 {ip}:{p} issued: login with account "serveradmin"(serveradmin)'],
      [null, '|INFO    |ServerLibPriv |   |Server Version: 3.13.7 [Build: 1655727713]'],
      [null, '|WARNING |Query         |   |query from 1 {ip}:{p} failed: invalid loginname or password']]],

    ['media', 'docker', 'jellyfin', 25, [
      [null, '[INF] Emby.Server.Implementations.Session.SessionManager: Playback started reported by app Jellyfin Web. Stopped at {n} ms'],
      [null, '[INF] Jellyfin.Api.Helpers.TranscodingJobHelper: ffmpeg -i file:"/media/filmy/film-{n2}.mkv" -codec:v:0 h264 -preset veryfast'],
      [null, '[WRN] MediaBrowser.Providers.Manager.ProviderManager: No metadata found for series id {n}'],
      [null, '[ERR] Jellyfin.Server.Middleware.ExceptionMiddleware: Error processing request. URL GET /Videos/{h}/stream. System.IO.IOException: Broken pipe']]],
    ['media', 'docker', 'bazarr', 5, [
      [null, '|INFO    |root|Throttling provider nr {d} for 10 minutes, because of: HTTPError 403 Forbidden'],
      [null, 'Syncing subtitles for film-{n2}.mkv\n  11%|██▏                 | 800/7403 [01:35<14:07,  7.80it/s]\n  12%|██▍                 | 900/7403 [01:48<14:07,  7.67it/s]\n  14%|██▊                 | 1000/7403 [01:58<12:45,  8.37it/s]'],
      [null, '|WARNING |root|No subtitles found for film-{n2}.mkv in languages: pl']]],
    ['media', 'docker', 'sonarr', 12, [
      [null, '[Info] RssSyncService: RSS Sync Completed. Reports found: {n2}, Reports grabbed: {d}'],
      [null, '[Info] DownloadDecisionMaker: Processing {n2} releases'],
      [null, '[Warn] HttpClient: HTTP Error - Res: GET http://prowlarr:9696/1/api: 503.ServiceUnavailable (0 bytes)']]],
    ['media', 'docker', 'radarr', 10, [
      [null, '[Info] RefreshMovieService: Updating info for film {n2}'],
      [null, '[Info] DiskScanService: Scanning disk for film {n2}'],
      [null, '[Error] DownloadedMovieImportService: Import failed, path does not exist or is not accessible by Radarr: /downloads/complete/{h}']]],
    ['media', 'docker', 'prowlarr', 6, [
      [null, '[Info] IndexerStatusCheck: {d} indexers checked'], [null, '[Warn] Torznab: Indexer nr {d} responded with 429 TooManyRequests, backing off']]],
    ['media', 'docker', 'qbittorrent', 15, [
      [null, '(N) {t} - Added new torrent. Torrent: "plik-{n2}"'], [null, '(N) {t} - Torrent download finished. Torrent: "plik-{n2}"'],
      [null, '(W) {t} - Detected external IP. IP: "100.84.{d}.{n2}"']]],
    ['media', 'journald', 'docker.service', 2, [
      [6, 'time="{t}" level=info msg="ignoring event" container={h}{h} module=libcontainerd'],
      [4, 'time="{t}" level=warning msg="Health check for container {h}{h} error: timeout"']]],

    ['loghub', 'docker', 'loghub-victorialogs-1', 4, [
      [null, '{t} info VictoriaLogs/app/vlstorage/main.go:{n2} flushed {n} log rows to disk'],
      [null, '{t} info VictoriaLogs/lib/logstorage/datadb.go:{n2} merged {d} small parts in 0.0{d}s']]],
    ['loghub', 'docker', 'loghub-caddy-1', 8, [
      [null, '{"level":"info","msg":"handled request","uri":"/insert/jsonline","status":200,"duration":0.00{d}}'],
      [null, '{"level":"warn","msg":"handled request","uri":"/insert/jsonline","status":401,"remote_ip":"{ip}"}']]],

    // zadania cron: [host, 'cron', polecenie, uruchomien na godzine, [[poziom, stan, kod]], {harmonogram, plik, uzytkownik}]
    ['vps', 'cron', '/usr/local/bin/sync-backup.sh --all', 1, [[6, 'ok', 0], [6, 'ok', 0], [6, 'ok', 0], [3, 'fail', 23]], { s: '0 * * * *', f: '/etc/cron.d/backup', u: 'root' }],
    ['vps', 'cron', 'certbot renew --quiet', 1 / 12, [[3, 'fail', 1]], { s: '17 */12 * * *', f: '/etc/cron.d/certbot', u: 'root' }],
    ['pve', 'cron', 'cd / && run-parts --report /etc/cron.hourly', 1, [[6, 'ok', 0]], { s: '17 * * * *', f: '/etc/crontab', u: 'root' }],
    ['pve', 'cron', '/usr/local/bin/zfs-snapshot.sh rpool/data', 4, [[6, 'ok', 0]], { s: '*/15 * * * *', f: '/etc/cron.d/zfs-snapshot', u: 'root' }],
    ['media', 'cron', '/opt/scripts/cleanup-downloads.sh', 1 / 24, [[6, 'ok', 0], [6, 'ok', 0], [3, 'signal', 143]], { s: '30 4 * * *', f: '/var/spool/cron/crontabs/root', u: 'root' }],

    [OFFLINE, 'journald', 'smartd.service', 2, [
      [2, 'Device: /dev/sdb [SAT], 8 Currently unreadable (pending) sectors'],
      [6, 'Device: /dev/sda [SAT], SMART Usage Attribute: 194 Temperature_Celsius changed from 3{d} to 3{d}']]],
    [OFFLINE, 'journald', 'cron.service', 3, [
      [6, '(root) CMD (/usr/local/bin/backup.sh)'], [3, '(root) MAIL (mailed 1 byte of output; but got status 0x004b, #012)']]],
  ];

  const USERS = ['admin', 'oracle', 'ubuntu', 'test', 'postgres', 'pi', 'kamil', 'ola', 'gracz7'];
  const r = n => Math.floor(Math.random() * n);
  const hex = () => r(0xffffff).toString(16).padStart(6, '0');
  const fill = (s, t) => s.replace(/\{(\w+)\}/g, (_, k) => ({
    n: 1000 + r(90000), n2: 1 + r(250), d: r(10), s: 10 + r(50), p: 1024 + r(60000), ct: 100 + r(12),
    h: hex(), u: USERS[r(USERS.length)], ip: [45 + r(170), r(256), r(256), 1 + r(254)].join('.'),
    t: new Date(t).toISOString().slice(0, 19) + 'Z',
  })[k] ?? '{' + k + '}');
  const stream = u => '{host="' + u[0] + '",source="' + u[1] + '",unit="' + u[2] + '"}';
  const idle = u => u[0] === OFFLINE || u[3] < 1;
  const noise = (a, b) => { const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return x - Math.floor(x); };
  // zadanie zdefiniowane, ale jeszcze ani razu nie uruchomione
  const NEVER = { host: 'vps', unit: '/usr/local/bin/on-boot.sh', s: '@reboot', f: '/etc/cron.d/boot', u: 'root' };

  // uruchomienie crona w danym okienku czasu: zawsze to samo, zeby historia nie zmieniala sie przy odswiezaniu
  function cronRun(u, slot) {
    const ui = U.indexOf(u), n = noise(ui + 3, slot), T = u[4], per = H / u[3];
    let i = 0, acc = 0;
    for (; i < T.length - 1; i++) { acc += prob(i, T.length); if (n < acc) break; }
    const [lv, state, code] = T[i], dur = state === 'ok' ? 2 + Math.floor(noise(slot, ui + 11) * 40) : 1 + Math.floor(noise(slot, ui + 5) * 6);
    const label = state === 'ok' ? 'OK' : state === 'signal' ? 'PRZERWANE sygnałem ' + (code - 128) : 'BŁĄD kod ' + code;
    return { _time: new Date(slot * per + dur * 1e3).toISOString(), _stream: stream(u), _msg: label + ' · ' + dur + ' s · ' + u[2], host: u[0], source: 'cron', unit: u[2],
      level: String(lv), cron_state: state, exit_code: String(code), duration_s: String(dur), cron_user: u[5].u, cron_cmd: u[2] };
  }

  // ten sam podzial na poziomy co na stronie
  function cls(lv, m) {
    if (lv != null) return lv <= 3 ? 'e' : lv === 4 ? 'w' : '';
    const t = m.match(/(?:^|[\[|"=(])\s*(err|error|fatal|crit|critical|panic|wrn|warn|warning|inf|info|notice|dbg|debug)\b/i);
    if (t) return /^(err|fat|cri|pan)/i.test(t[1]) ? 'e' : /^w/i.test(t[1]) ? 'w' : '';
    return /\b(error|fatal|panic|fail(ed|ure)?|critical)\b/i.test(m) ? 'e' : /\bwarn(ing)?\b/i.test(m) ? 'w' : '';
  }
  // szablony z poczatku listy losuja sie czesciej: prawdopodobienstwo szablonu i z n
  const prob = (i, n) => Math.pow((i + 1) / n, 1 / 1.8) - Math.pow(i / n, 1 / 1.8);

  function line(u, t) {
    const m = u[4][Math.min(u[4].length - 1, Math.floor(Math.pow(Math.random(), 1.8) * u[4].length))];
    const o = { _time: new Date(t).toISOString(), _stream: stream(u), _msg: fill(m[1], t), host: u[0], source: u[1], unit: u[2] };
    if (m[0] != null) o.level = String(m[0]);
    return o;
  }

  function parse(q) {
    const sel = {}, b = q.match(/^\{([^}]*)\}/);
    if (b) for (const m of b[1].matchAll(/(\w+)="((?:[^"\\]|\\.)*)"/g)) sel[m[1]] = JSON.parse('"' + m[2] + '"');
    const w = q.match(/~("(?:[^"\\]|\\.)*")/), t = q.match(/_time:(\d+)([mhd])/);
    const re = w ? new RegExp(JSON.parse(w[1]).replace(/^\(\?i\)/, ''), 'i') : null;
    const wantE = q.includes('i(error)'), wantW = q.includes('i(warn)');
    return {
      match: u => (!sel.host || sel.host === u[0]) && (!sel.source || sel.source === u[1]) && (!sel.unit || sel.unit === u[2]),
      pass: (lv, m) => (!re || re.test(m)) && (!(wantE || wantW) || (c => (c === 'e' && wantE) || (c === 'w' && wantW))(cls(lv, m))),
      ms: t ? t[1] * { m: 60e3, h: H, d: 24 * H }[t[2]] : H,
    };
  }
  const passes = (p, o) => p.pass(o.level == null ? null : +o.level, o._msg);

  function history(q, limit) {
    const p = parse(q), now = Date.now(), out = [];
    for (const u of U.filter(p.match)) {
      if (u[1] === 'cron') {
        const per = H / u[3];
        for (let slot = Math.floor(now / per), k = 0; slot * per > now - p.ms && k < 300; slot--, k++) { const o = cronRun(u, slot); if (Date.parse(o._time) <= now) out.push(o); }
        continue;
      }
      const end = u[0] === OFFLINE ? now - 48 * H : now, span = Math.min(p.ms - (now - end), 400 / u[3] * H);
      if (span <= 0) continue;
      for (let i = Math.ceil(u[3] * span / H); i > 0; i--) out.push(line(u, end - Math.random() * span));
    }
    return out.filter(o => passes(p, o)).sort((a, b) => a._time < b._time ? 1 : -1).slice(0, limit);
  }

  // liczniki w czasie: stale miedzy odswiezeniami (szum liczony z numeru zrodla i kubelka)
  function hits(body) {
    const p = parse(body.get('query') || '*'), fields = body.getAll('field'), now = Date.now();
    const step = parseFloat(body.get('step')) * 1e3, start = Date.parse(body.get('start')), end = Date.parse(body.get('end'));
    const groups = new Map();
    U.forEach((u, ui) => {
      if (!p.match(u)) return;
      const frac = u[4].reduce((a, m, i) => a + (p.pass(m[0], m[1]) ? prob(i, u[4].length) : 0), 0);
      const f = {}; for (const k of fields) f[k] = { host: u[0], source: u[1], unit: u[2] }[k];
      const g = groups.get(JSON.stringify(f)) || groups.set(JSON.stringify(f), { fields: f, m: new Map() }).get(JSON.stringify(f));
      for (let ts = Math.floor(start / step) * step; ts < end; ts += step) {
        if (u[0] === OFFLINE && ts > now - 48 * H) continue;
        const b = Math.round(ts / step), day = .55 + .45 * Math.sin((new Date(ts).getHours() - 9) / 24 * 2 * Math.PI);
        const x = u[3] * step / H * frac * day * (.5 + noise(ui + 1, b)) * Math.min(1, (now - ts) / step);
        const v = Math.floor(x) + (noise(b, ui + 7) < x % 1 ? 1 : 0);
        if (v) g.m.set(ts, (g.m.get(ts) || 0) + v);
      }
    });
    return { hits: [...groups.values()].map(g => {
      const ts = [...g.m.keys()].sort((a, b) => a - b);
      return { fields: g.fields, timestamps: ts.map(t => new Date(t).toISOString()), values: ts.map(t => g.m.get(t)), total: ts.reduce((a, t) => a + g.m.get(t), 0) };
    }) };
  }

  const ndjson = a => a.map(o => JSON.stringify(o)).join('\n') + '\n';

  // ---------------------------------------------------------- stan i zasoby
  // [host, rdzenie, RAM GB, dysk GB, bazowe CPU %, bazowe RAM %, dysk %]
  const HOSTS = [['pve', 4, 16, 240, 14, 62, 41], ['vps', 2, 4, 80, 9, 71, 58], ['media', 4, 6, 512, 22, 48, 91], ['loghub', 2, 2, 16, 4, 38, 22]];
  const EXTRA_CT = { media: [{ n: 'tdarr', s: 'exited', st: 'Exited (137) 3 hours ago' }, { n: 'homepage', s: 'exited', st: 'Exited (0) 2 days ago' }, { n: 'seerr', s: 'running', st: 'Up 5 hours (unhealthy)' }] };
  const FAILED = { vps: ['fail2ban.service'] };
  const GUESTS = [[100, 'homeassistant', 'qemu', 'running', 2, 4], [101, 'media', 'lxc', 'running', 4, 6], [102, 'adguard', 'lxc', 'running', 1, 0.5],
    [105, 'backup', 'lxc', 'stopped', 1, 1], [110, 'loghub', 'lxc', 'running', 2, 2], [111, 'nginxproxymanager', 'lxc', 'running', 1, 1]];
  const wave = (h, t, base, amp) => Math.max(0.3, Math.min(99, base + amp * Math.sin((new Date(t).getHours() - 8) / 24 * 2 * Math.PI) + (noise(h, Math.floor(t / 6e4)) - 0.5) * amp));

  function statRec(hi, t) {
    const [host, cores, ram, disk, cpu0, mem0, dsk] = HOSTS[hi], cpu = wave(hi + 1, t, cpu0, cpu0 * 0.6), mem = wave(hi + 9, t, mem0, 4);
    const o = { _time: new Date(t).toISOString(), _stream: '{host="' + host + '",source="stat",unit="host"}', host, source: 'stat', unit: 'host', level: '6',
      cpu: cpu.toFixed(1), mem_pct: mem.toFixed(1), mem_total_kb: String(ram * 1048576), mem_avail_kb: String(Math.round(ram * 1048576 * (1 - mem / 100))),
      disk_pct: String(dsk), disk_total_kb: String(disk * 1048576), disk_used_kb: String(Math.round(disk * 1048576 * dsk / 100)), load1: (cpu / 100 * cores).toFixed(2), cores: String(cores) };
    o._msg = 'CPU ' + o.cpu + '% · RAM ' + o.mem_pct + '% · dysk ' + dsk + '% · obciążenie ' + o.load1;
    const cts = U.filter(u => u[0] === host && u[1] === 'docker').map(u => ({ n: u[2], s: 'running', st: 'Up 2 days' })).concat(EXTRA_CT[host] || []);
    if (cts.length) {
      o.containers = JSON.stringify(cts);
      o.cstats = JSON.stringify(cts.filter(c => c.s === 'running').map((c, i) => {
        const cp = Math.max(0.01, noise(i + 31, Math.floor(t / 6e4)) * (c.n === 'jellyfin' ? 60 : c.n === 'qbittorrent' ? 25 : 4)), mb = 40 + Math.round(noise(i + 5, 1) * 700);
        return { n: c.n, cpu: cp.toFixed(2) + '%', mem: mb + 'MiB / ' + ram + 'GiB', memp: (mb / ram / 10.24).toFixed(2) + '%' };
      }));
    }
    const GB = 1048576, dk = [['/', 'ext4', host === 'pve' ? '/dev/mapper/pve-root' : '/dev/sda1', Math.round(disk * GB * dsk / 100), disk * GB]];
    if (host === 'pve') dk.push(['/mnt/nas_share', 'ext4', '/dev/sdb1', Math.round(1863 * GB * 0.45), 1863 * GB], ['/mnt/data', 'ext4', '/dev/sdc1', Math.round(1863 * GB * 0.83), 1863 * GB]);
    if (host === 'media') dk.push(['/mnt/data', 'ext4', '/dev/sdc1', Math.round(1863 * GB * 0.83), 1863 * GB]);
    o.disks = JSON.stringify(dk);
    if (host === 'pve') {
      o.smart = JSON.stringify([['/dev/nvme0n1', 'Samsung SSD 980 500GB', 500107862016, 'PASSED', 41, 12345, null, null, 'nvme'],
        ['/dev/sdb', 'WDC WD20EZRZ-00Z5HB0', 2000398934016, 'PASSED', 37, 48213, 0, 8, 'usb'], ['/dev/sdc', 'ST2000DM008-2FR102', 2000398934016, 'PASSED', 39, 21004, 0, 0, 'usb']]);
      o.pools = '[]';
    }
    const PORTS = { pve: [['tcp', '0.0.0.0', 22, 'sshd'], ['tcp', '0.0.0.0', 8006, 'pveproxy'], ['tcp', '0.0.0.0', 3128, 'spiceproxy'], ['tcp', '127.0.0.1', 85, 'pvedaemon'], ['tcp', '127.0.0.1', 25, 'master'], ['udp', '0.0.0.0', 41641, 'tailscaled'], ['tcp', '100.75.36.54', 8443, 'tailscaled']],
      vps: [['tcp', '0.0.0.0', 22, 'sshd'], ['tcp', '0.0.0.0', 10011, 'ts3server'], ['tcp', '0.0.0.0', 30033, 'ts3server'], ['udp', '0.0.0.0', 9987, 'ts3server'], ['tcp', '127.0.0.1', 3306, 'mariadbd'], ['udp', '0.0.0.0', 41641, 'tailscaled']],
      media: [['tcp', '0.0.0.0', 22, 'sshd'], ['tcp', '*', 8096, 'docker-proxy'], ['tcp', '*', 8989, 'docker-proxy'], ['tcp', '*', 7878, 'docker-proxy'], ['tcp', '*', 9696, 'docker-proxy'], ['tcp', '*', 8080, 'docker-proxy'], ['tcp', '192.168.0.120', 6767, 'docker-proxy']],
      loghub: [['tcp', '0.0.0.0', 8080, 'docker-proxy'], ['tcp', '127.0.0.1', 8081, 'docker-proxy'], ['tcp', '0.0.0.0', 22, 'sshd']] };
    o.ports = JSON.stringify(PORTS[host] || []);
    if (host === 'vps') { o.ufw_state = 'active'; o.ufw = JSON.stringify(['22/tcp', '10011', '30033/tcp', '9987/udp']); }
    if (host === 'media') { o.ufw_state = 'inactive'; o.ufw = '[]'; }
    const units = U.filter(u => u[0] === host && u[1] === 'journald' && /\.service$/.test(u[2])).map(u => [u[2], 'active', 'running']);
    for (const f of FAILED[host] || []) units.push([f, 'failed', 'failed']);
    o.units = JSON.stringify(units);
    if (host === 'pve') o.guests = JSON.stringify(GUESTS.map(([vmid, name, type, status, maxcpu, gbm], i) => ({
      id: type + '/' + vmid, vmid, name, type, status, maxcpu, maxmem: gbm * 1073741824, mem: status === 'running' ? Math.round(gbm * 1073741824 * (0.3 + noise(i, 2) * 0.5)) : 0,
      cpu: status === 'running' ? noise(i + 3, Math.floor(t / 6e4)) * 0.35 : 0, maxdisk: 32 * 1073741824, disk: Math.round(32 * 1073741824 * (0.2 + noise(i, 9) * 0.6)) })));
    return o;
  }
  function statHistory() {
    const step = 30 * 6e4, end = Math.floor(Date.now() / step) * step, out = [];
    HOSTS.forEach((x, hi) => { for (let k = 0; k < 48; k++) { const t = end - k * step, o = statRec(hi, t); out.push({ host: x[0], _time: new Date(t).toISOString(), cpu: o.cpu, mem: o.mem_pct }); } });
    return out;
  }
  let user = { user: 'admin', role: 'admin', hosts: null };
  const ACCOUNTS = { admin: { user: 'admin', role: 'admin', hosts: null, totp: true }, ola: { user: 'ola', role: 'viewer', hosts: ['media', 'pve'], totp: true }, kamil: { user: 'kamil', role: 'viewer', hosts: ['vps'], totp: false } };
  let NCFG = { rules: { host_offline: { on: true, minutes: 3 }, service_down: { on: true }, cron_failed: { on: true }, disk: { on: true, pct: 90 },
    cpu: { on: true, pct: 90, minutes: 10 }, mem: { on: true, pct: 90, minutes: 10 }, errors: { on: false, count: 50, minutes: 5 }, disk_health: { on: true }, ports: { on: true } },
    notify_resolved: true, repeat_hours: 0, channels: [{ id: 'demo1', type: 'ntfy', on: true, name: 'telefon', url: 'https://ntfy.sh/moj-loghub', token: '' }] };

  window.loghubDemo = {
    async api(path, body, signal) {
      const q = String(body.get('query') || '');
      if (path === 'hits') return new Response(JSON.stringify(hits(body)));
      if (path === 'query') {
        if (q.includes('source="stat"')) {
          if (q.includes('| stats')) return new Response(ndjson(statHistory()));
          return new Response(ndjson(HOSTS.map((x, hi) => statRec(hi, Date.now() - 20e3))));
        }
        if (q.includes('"crondef"')) {
          const defs = U.filter(u => u[1] === 'cron').map(u => ({ host: u[0], unit: u[2], s: u[5].s, f: u[5].f, u: u[5].u })).concat(NEVER);
          return new Response(ndjson(defs.map(x => ({ _time: new Date(Date.now() - 3 * H).toISOString(), host: x.host, source: 'crondef', unit: x.unit, cron_sched: x.s, cron_file: x.f, cron_user: x.u, cron_cmd: x.unit, cron_scan: '1' }))));
        }
        if (q.includes('| stats'))
          return new Response(ndjson(U.filter(u => !idle(u)).map(u => ({ host: u[0], source: u[1], unit: u[2], c: '1' }))));
        await new Promise(ok => setTimeout(ok, 120));
        return new Response(ndjson(history(q, +body.get('limit') || 1000)));
      }
      if (path === 'tail') {
        const p = parse(q), pool = U.filter(u => p.match(u) && u[0] !== OFFLINE && u[1] !== 'cron'), enc = new TextEncoder();
        let timer;
        return new Response(new ReadableStream({
          start(c) {
            const stop = () => { clearInterval(timer); try { c.close() } catch {} };
            if (signal) signal.addEventListener('abort', stop);
            timer = setInterval(() => {
              // kazde zrodlo pisze z wlasna czestotliwoscia, przyspieszona, zeby bylo co ogladac
              const rows = pool.filter(u => Math.random() < Math.min(.4, u[3] / 120)).map(u => line(u, Date.now())).filter(o => passes(p, o));
              if (rows.length) c.enqueue(enc.encode(ndjson(rows)));
            }, 900);
          },
          cancel() { clearInterval(timer) },
        }));
      }
      return new Response('nieznana sciezka', { status: 404 });
    },
    // konta na niby
    async users(path, method, body) {
      if (!path && (!method || method === 'GET')) return { users: Object.values(ACCOUNTS) };
      if (!path && method === 'POST') {
        if (!/^[a-z0-9_-]{2,32}$/.test(body.user || '')) throw new Error('nazwa: 2-32 znaki z zestawu a-z 0-9 _ -');
        if (ACCOUNTS[body.user]) throw new Error('taki użytkownik już istnieje');
        ACCOUNTS[body.user] = { user: body.user, role: body.role, hosts: body.role === 'admin' || body.hosts === 'all' ? null : body.hosts, totp: false };
        return Object.assign({ password: 'a1b2c3-d4e5f6-0789ab' }, ACCOUNTS[body.user]);
      }
      const u = ACCOUNTS[path]; if (!u) throw new Error('nie ma takiego użytkownika');
      if (method === 'DELETE') { if (path === user.user) throw new Error('nie można usunąć własnego konta'); delete ACCOUNTS[path]; return { ok: true }; }
      if ('role' in body) u.role = body.role;
      if ('hosts' in body) u.hosts = u.role === 'admin' || body.hosts === 'all' ? null : body.hosts;
      if (body.reset_2fa) u.totp = false;
      return Object.assign({}, u, body.new_password ? { password: 'f0e1d2-c3b4a5-968778' } : {});
    },
    // powiadomienia na niby: przykladowe alerty, ustawienia trzymane w pamieci strony
    async notify(path, method, body) {
      const now = Math.floor(Date.now() / 1000), m = 60;
      if (path === 'state') return {
        checked_at: now - 25, error: '', channels: NCFG.channels.filter(c => c.on !== false).length,
        active: [
          { key: 'ct:media:tdarr', kind: 'service_down', host: 'media', unit: 'tdarr', title: 'media: kontener tdarr padł', detail: 'padł: Exited (137) 3 hours ago', sev: 'error', since: now - 182 * m },
          { key: 'unit:vps:fail2ban.service', kind: 'service_down', host: 'vps', unit: 'fail2ban.service', title: 'vps: usługa fail2ban.service padła', detail: 'systemd: failed', sev: 'error', since: now - 47 * m },
          { key: 'offline:backup', kind: 'host_offline', host: 'backup', unit: '', title: 'backup: brak kontaktu z agentem', detail: 'Brak pomiarów od ponad 3 min.', sev: 'error', since: now - 2880 * m },
          { key: 'disk:media:/', kind: 'disk', host: 'media', unit: '', title: 'media: dysk / zajęty w 91%', detail: '466 z 512 GB (/dev/sda1). Próg: 90%.', sev: 'warn', since: now - 600 * m },
          { key: 'sect:pve:/dev/sdb', kind: 'disk_health', host: 'pve', unit: '', title: 'pve: dysk /dev/sdb ma uszkodzone sektory', detail: 'WDC WD20EZRZ-00Z5HB0: przeniesione 0, oczekujące 8', sev: 'warn', since: now - 1440 * m },
          { key: 'ct:media:seerr', kind: 'service_down', host: 'media', unit: 'seerr', title: 'media: kontener seerr nie przechodzi kontroli zdrowia', detail: 'nie przechodzi kontroli zdrowia', sev: 'error', since: now - 300 * m }],
        history: [
          { kind: 'cron_failed', host: 'vps', unit: 'certbot renew --quiet', title: 'vps: zadanie cron zakończone błędem (kod 1)', detail: 'certbot renew --quiet', sev: 'error', since: now - 540 * m, until: now - 540 * m },
          { kind: 'ports', host: 'vps', unit: '', title: 'vps: ufw otworzył na świat port 30033/tcp', detail: 'Zmiana nastąpiła między 11.11 08:42 a 11.11 08:43.', sev: 'warn', since: now - 120 * m, until: now - 120 * m },
          { kind: 'cpu', host: 'media', unit: '', title: 'media: CPU 94% (średnio 10 min)', detail: 'Próg: 90%.', sev: 'warn', since: now - 260 * m, until: now - 228 * m },
          { kind: 'service_down', host: 'pve', unit: 'pveproxy.service', title: 'pve: usługa pveproxy.service padła', detail: 'systemd: failed', sev: 'error', since: now - 1500 * m, until: now - 1496 * m }],
      };
      if (path === 'config' && method === 'PUT') { NCFG = JSON.parse(JSON.stringify(body)); return JSON.parse(JSON.stringify(NCFG)); }
      if (path === 'config') return JSON.parse(JSON.stringify(NCFG));
      if (path === 'test') return { results: NCFG.channels.filter(c => c.on !== false).map(c => ({ channel: c.name || c.type, ok: true })) };
      throw new Error('nieznana ścieżka');
    },
    // logowanie na niby: przyjmuje dowolne dane; uzytkownik "nowy" pokazuje pierwsze logowanie z 2FA
    async auth(path, body) {
      if (path === 'me') return { status: user ? 200 : 401, data: user || {} };
      if (path === 'logout') { user = null; return { status: 200, data: {} }; }
      const name = String(body.user || '').trim().toLowerCase() || 'demo';
      if (name === 'nowy' && !String(body.code || '').trim())
        return { status: 200, data: { enroll: { secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP', uri: 'otpauth://totp/loghub:nowy?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=loghub' } } };
      user = { user: name, role: name === 'admin' || name === 'demo' ? 'admin' : 'viewer', hosts: name === 'admin' || name === 'demo' ? null : ['vps'] };
      return { status: 200, data: user };
    },
  };
})();
