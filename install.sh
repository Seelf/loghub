#!/usr/bin/env bash
# loghub - centralne logi: VictoriaLogs + Vector + Tailscale
#
# Centrala (raz, na maszynie z Dockerem lub pod Dockera):
#   curl -fsSL https://raw.githubusercontent.com/Seelf/loghub/main/install.sh | sudo bash -s -- hub
#   (na Proxmoxie wygodniej: proxmox.sh, ktory sam tworzy kontener LXC z centrala)
#
# Agent (na kazdej obserwowanej maszynie; komende z tokenem wypisuje centrala):
#   curl -fsSL .../install.sh | sudo bash -s -- agent --hub http://ADRES:8080 --token TOKEN
#   opcje: --name NAZWA  --logs "/sciezka/*.log,..."  --no-cron  --no-status  --no-lxc  --no-tailscale
#
# Uzytkownicy strony (na centrali; haslo + kod 2FA z aplikacji):
#   loghub user add NAZWA [--role admin|viewer] [--hosts pve,vps] | user hosts NAZWA pve,vps|all
#   loghub user del|passwd|reset-2fa NAZWA | user list   (albo w przegladarce: Uzytkownicy)
#
# Dostep z internetu (na centrali, przez Tailscale Funnel):
#   loghub public on | off | status
#
# Calosc jest w funkcji main() wywolanej na koncu pliku, zeby polecenia
# czytajace stdin nie zjadly skryptu przy uruchomieniu przez "curl | bash".

set -euo pipefail

# Repozytorium na GitHubie (musi byc publiczne). Inna nazwa: LOGHUB_REPO=uzytkownik/repo
REPO="${LOGHUB_REPO:-Seelf/loghub}"
REPO_RAW="${LOGHUB_REPO_RAW:-https://raw.githubusercontent.com/$REPO/main}"
SELF=/usr/local/sbin/loghub
HUB_DIR=/opt/loghub
PORT="${LOGHUB_PORT:-8080}"          # prywatny: agenci + strona w sieci lokalnej i Tailscale
PUBLIC_PORT=8081                     # publiczny: tylko strona z logowaniem, tylko dla Tailscale Funnel
RETENTION="${LOGHUB_RETENTION:-100d}"
STREAM_ARGS='_stream_fields=host,source,unit&_msg_field=message&_time_field=timestamp'

say()  { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m  %s\n' "$*" >&2; }
die()  { printf '\033[1;31mBLAD:\033[0m %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }
rand() { od -An -tx1 -N "$1" /dev/urandom | tr -d ' \n'; }

need_root() { [ "$(id -u)" -eq 0 ] || die "uruchom jako root (sudo)"; }

in_lxc() { [ "$(systemd-detect-virt -c 2>/dev/null || true)" = "lxc" ]; }

apt_base() {
  have apt-get || die "obslugiwane sa tylko systemy z apt (Debian, Ubuntu, Proxmox)"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq curl ca-certificates gnupg >/dev/null
}

# Zapisuje ten skrypt jako /usr/local/sbin/loghub (potrzebne do LXC i polecenia "user").
save_self() {
  local src="${BASH_SOURCE[0]:-}"
  mkdir -p "$(dirname "$SELF")"
  # zapis przez plik tymczasowy i mv: nie psuje skryptu, ktory wlasnie dziala
  if [ -n "$src" ] && [ -f "$src" ]; then
    [ "$(readlink -f "$src")" = "$SELF" ] || { cp "$src" "$SELF.new" && chmod 755 "$SELF.new" && mv -f "$SELF.new" "$SELF"; }
  else
    curl -fsSL "$REPO_RAW/install.sh" -o "$SELF.new" && chmod 755 "$SELF.new" && mv -f "$SELF.new" "$SELF"
  fi
  # /usr/local/bin jest w PATH takze przy "pct exec" i bez sudo
  ln -sf "$SELF" /usr/local/bin/loghub
}

setup_tailscale() {
  [ "$USE_TS" = 1 ] || return 0
  if [ ! -c /dev/net/tun ]; then
    warn "brak /dev/net/tun - pomijam Tailscale."
    warn "W kontenerze LXC dopisz na hoscie do /etc/pve/lxc/<ID>.conf i zrestartuj kontener:"
    warn "  lxc.cgroup2.devices.allow: c 10:200 rwm"
    warn "  lxc.mount.entry: /dev/net/tun dev/net/tun none bind,create=file"
    return 0
  fi
  if ! have tailscale; then
    say "Instaluje Tailscale"
    curl -fsSL https://tailscale.com/install.sh | sh
  fi
  systemctl enable --now tailscaled >/dev/null 2>&1 || true
  if ! tailscale status >/dev/null 2>&1; then
    say "Lacze z Tailscale (bez TS_AUTHKEY pojawi sie link do zalogowania)"
    if [ -n "${TS_AUTHKEY:-}" ]; then
      tailscale up --authkey="$TS_AUTHKEY"
    else
      tailscale up
    fi
  fi
}

# ---------------------------------------------------------------- centrala

write_hub_files() {
  cat > "$HUB_DIR/docker-compose.yml" <<'EOF'
services:
  victorialogs:
    image: victoriametrics/victoria-logs:${VL_TAG:-latest}
    command:
      - -storageDataPath=/vlogs
      - -retentionPeriod=${RETENTION:-100d}
    volumes:
      - ./data:/vlogs
    restart: unless-stopped

  auth:
    image: python:3.13-alpine
    command: ["python", "/app/auth.py", "serve"]
    environment:
      - SESSION_SECRET=${SESSION_SECRET}
      - LOGHUB_DATA=/data
      - VL_URL=http://victorialogs:9428
    volumes:
      - ./auth:/app:ro
      - ./authdata:/data
    restart: unless-stopped

  notify:
    image: python:3.13-alpine
    command: ["python", "/app/notify.py"]
    environment:
      - LOGHUB_DATA=/data
      - VL_URL=http://victorialogs:9428
      - PUBLIC_URL=${PUBLIC_URL:-}
    volumes:
      - ./notify:/app:ro
      - ./notifydata:/data
      - /etc/localtime:/etc/localtime:ro
    depends_on:
      - victorialogs
    restart: unless-stopped

  caddy:
    image: caddy:2-alpine
    ports:
      - "${PORT:-8080}:8080"
      - "127.0.0.1:8081:8081"
    environment:
      - INGEST_TOKEN=${INGEST_TOKEN}
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - ./www:/srv:ro
    depends_on:
      - victorialogs
      - auth
      - notify
    restart: unless-stopped
EOF

  cat > "$HUB_DIR/Caddyfile" <<'EOF'
{
	admin off
	auto_https off
}

# Wspolna czesc obu wejsc: logowanie, odczyt logow po zalogowaniu, sama strona.
(app) {
	# logowanie, 2FA, sesje
	reverse_proxy /auth/* auth:9000 {
		header_up X-Forwarded-Proto {args[0]}
	}

	# ludzie: tylko odczyt, przez usluge logowania, ktora sprawdza sesje
	# i doklada filtr maszyn dla kont z ograniczonym dostepem
	handle /select/* {
		reverse_proxy auth:9000 {
			flush_interval -1
		}
	}

	# powiadomienia: podglad dla zalogowanych, ustawienia tylko dla administratora
	handle /api/notify/* {
		route {
			request_header -X-User
			request_header -X-Role
			request_header -X-Hosts
			forward_auth auth:9000 {
				uri /auth/verify
				copy_headers X-User X-Role X-Hosts
			}
			reverse_proxy notify:9100
		}
	}

	# sama strona (bez danych) pokazuje formularz logowania
	header {
		X-Frame-Options DENY
		X-Content-Type-Options nosniff
		Referrer-Policy no-referrer
		Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'"
	}
	encode gzip
	root * /srv
	file_server
}

# Wejscie prywatne (siec lokalna i Tailscale): agenci wysylaja logi, ludzie ogladaja strone.
:8080 {
	@ingest_ok {
		path /insert/*
		header Authorization "Bearer {$INGEST_TOKEN}"
	}
	route {
		reverse_proxy @ingest_ok victorialogs:9428
		respond /insert/* 401
		import app http
	}
}

# Wejscie publiczne (tylko przez Tailscale Funnel, zawsze HTTPS): sama strona z logowaniem.
# Nie ma tu przyjmowania logow ani panelu zapytan zaawansowanych.
:8081 {
	@closed path /insert/* /select/vmui* /delete/* /internal/*
	route {
		respond @closed 404
		import app https
	}
}
EOF
}

fetch_hub_files() {
  local src="${BASH_SOURCE[0]:-}" dir="" f
  [ -n "$src" ] && [ -f "$src" ] && dir="$(dirname "$(readlink -f "$src")")/hub"
  for f in www/index.html www/demo.js auth/auth.py notify/notify.py; do
    if [ -n "$dir" ] && [ -f "$dir/$f" ]; then
      install -m 644 "$dir/$f" "$HUB_DIR/$f"
    else
      curl -fsSL "$REPO_RAW/hub/$f" -o "$HUB_DIR/$f"
    fi
  done
}

# Konta trzyma usluga auth (hasla jako scrypt, sekrety 2FA) w $HUB_DIR/authdata/users.json.
auth_cli() { (cd "$HUB_DIR" && docker compose exec -T auth python /app/auth.py user "$@" </dev/null); }

cmd_hub() {
  need_root
  apt_base
  save_self
  if ! have docker; then
    say "Instaluje Dockera"
    curl -fsSL https://get.docker.com | sh
  fi
  docker compose version >/dev/null 2>&1 || die "brak wtyczki 'docker compose'"
  USE_TS="${USE_TS:-1}"
  setup_tailscale

  mkdir -p "$HUB_DIR/data" "$HUB_DIR/www" "$HUB_DIR/auth" "$HUB_DIR/authdata" "$HUB_DIR/notify" "$HUB_DIR/notifydata"
  chmod 700 "$HUB_DIR/authdata" "$HUB_DIR/notifydata"
  if [ ! -f "$HUB_DIR/.env" ]; then
    printf 'INGEST_TOKEN=%s\nRETENTION=%s\nVL_TAG=latest\nPORT=%s\n' \
      "$(rand 24)" "$RETENTION" "$PORT" > "$HUB_DIR/.env"
  fi
  grep -q '^SESSION_SECRET=' "$HUB_DIR/.env" || printf 'SESSION_SECRET=%s\n' "$(rand 32)" >> "$HUB_DIR/.env"
  chmod 600 "$HUB_DIR/.env"
  # shellcheck disable=SC1091
  . "$HUB_DIR/.env"

  write_hub_files
  fetch_hub_files

  say "Uruchamiam centrale"
  (cd "$HUB_DIR" && docker compose pull -q </dev/null && docker compose up -d --remove-orphans </dev/null)
  # pliki uslug sa montowane z dysku: restart, zeby zaladowaly nowa wersje
  (cd "$HUB_DIR" && docker compose restart auth notify caddy </dev/null >/dev/null 2>&1) || true

  local admin_out="" i
  if [ ! -s "$HUB_DIR/authdata/users.json" ]; then
    for i in 1 2 3 4 5 6 7 8 9 10; do
      admin_out="$(auth_cli add admin --role admin 2>/dev/null)" && break
      sleep 2
    done
    [ -n "$admin_out" ] || warn "nie udalo sie zalozyc konta admin; sprobuj recznie: loghub user add admin --role admin"
  fi

  local ts_ip lan_ip hub_url
  ts_ip="$(tailscale ip -4 2>/dev/null || true)"
  lan_ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  hub_url="http://${ts_ip:-$lan_ip}:$PORT"

  echo
  say "Centrala dziala."
  echo "  Strona:        $hub_url"
  [ -n "$ts_ip" ] && echo "  W sieci LAN:   http://$lan_ip:$PORT"
  if [ -n "$admin_out" ]; then
    echo "  Konto administratora (zapisz haslo, nie pokaze sie ponownie):"
    printf '%s\n' "$admin_out" | sed 's/^/    /'
  fi
  echo "  Podglad demo:  $hub_url/?demo   (przykladowe dane, bez agentow)"
  echo "  Uzytkownicy:   loghub user add NAZWA [--role admin|viewer]"
  echo "  Publicznie:    loghub public on   (sama strona z logowaniem 2FA, HTTPS przez Tailscale Funnel)"
  echo
  echo "Instalacja agenta na kazdej maszynie:"
  echo "  curl -fsSL $REPO_RAW/install.sh | sudo bash -s -- agent \\"
  echo "    --hub $hub_url --hub-lan http://$lan_ip:$PORT --token $INGEST_TOKEN"
}

cmd_user() {
  need_root
  [ -d "$HUB_DIR" ] || die "to nie jest centrala (brak $HUB_DIR)"
  auth_cli "$@"
}

# Wystawia strone na swiat przez Tailscale Funnel (HTTPS, bez otwierania portow na routerze).
cmd_public() {
  need_root
  [ -d "$HUB_DIR" ] || die "to nie jest centrala (brak $HUB_DIR)"
  have tailscale || die "brak Tailscale na tej maszynie"
  # shellcheck disable=SC1091
  . "$HUB_DIR/.env"
  case "${1:-status}" in
    on)
      [ -s "$HUB_DIR/authdata/users.json" ] || die "najpierw zaloz konto: loghub user add admin --role admin"
      # Funnel wymaga wlaczonego HTTPS i Funnel w panelu Tailscale; polecenie samo poda link, jesli czegos brakuje.
      tailscale funnel --bg "$PUBLIC_PORT"
      tailscale funnel status
      warn "Strona jest teraz dostepna z internetu (adres powyzej). Chroni ja logowanie haslem i kodem 2FA."
      warn "Przyjmowanie logow od agentow i panel zapytan zostaja tylko w sieci lokalnej i Tailscale."
      ;;
    off) tailscale funnel reset; say "Strona jest znowu dostepna tylko w Tailscale i sieci lokalnej." ;;
    status) tailscale funnel status ;;
    *) die "uzycie: loghub public on|off|status" ;;
  esac
}

# ------------------------------------------------------------------ agent

# Vector dziala jako uzytkownik "vector"; katalogi z logami spoza /var/log (np. TeamSpeak w /home/ts3) trzeba mu udostepnic do odczytu.
grant_log_access() {
  local dirs="" d p
  dirs="$(find /opt /srv /home /root /usr/local -maxdepth 6 -type f -name 'ts3server_*.log' -printf '%h\n' 2>/dev/null | sort -u)"
  local IFS=','
  for p in $EXTRA_LOGS; do [ -n "$p" ] && dirs="$dirs"$'\n'"$(dirname "$p")"; done
  unset IFS
  dirs="$(printf '%s\n' "$dirs" | grep -v '^$' | sort -u)"
  [ -n "$dirs" ] || return 0
  getent passwd vector >/dev/null || return 0
  have setfacl || apt-get install -y -qq acl >/dev/null 2>&1 || { warn "brak setfacl - Vector moze nie miec dostepu do: $dirs"; return 0; }
  while read -r d; do
    [ -d "$d" ] || continue
    # wejscie do katalogow nadrzednych i odczyt logow (takze nowych plikow)
    p="$d"; while [ "$p" != "/" ]; do setfacl -m u:vector:x "$p" 2>/dev/null || true; p="$(dirname "$p")"; done
    setfacl -R -m u:vector:rX "$d" 2>/dev/null && setfacl -d -m u:vector:rX "$d" 2>/dev/null || warn "nie udalo sie nadac dostepu do $d"
  done <<< "$dirs"
}

write_vector_config() {
  local cfg=/etc/vector/vector.yaml inputs=""
  mkdir -p /etc/vector /var/lib/vector
  {
    echo "# wygenerowane przez loghub - nie edytuj recznie, uruchom skrypt ponownie"
    echo "data_dir: /var/lib/vector"
    echo "sources:"
    if have journalctl; then
      echo "  journal:"
      echo "    type: journald"
    fi
    echo "  files:"
    echo "    type: file"
    echo "    read_from: end"
    echo "    include:"
    echo "      - /var/log/**/*.log"
    # logi znanych programow poza /var/log (TeamSpeak 3)
    find /opt /srv /home /root /usr/local -maxdepth 6 -type f -name 'ts3server_*.log' -printf '%h\n' 2>/dev/null | sort -u | while read -r d; do
      echo "      - \"$d/*.log\""
    done
    local IFS=','
    for p in $EXTRA_LOGS; do
      [ -n "$p" ] && echo "      - \"$p\""
    done
    unset IFS
    echo "    exclude:"
    echo "      - /var/log/journal/**"
    if [ -S /var/run/docker.sock ]; then
      echo "  docker:"
      echo "    type: docker_logs"
    fi
    echo "transforms:"
    if have journalctl; then
      inputs="t_journal"
      cat <<EOF
  t_journal:
    type: remap
    inputs: [journal]
    source: |
      unit = string(._SYSTEMD_UNIT) ?? string(.SYSLOG_IDENTIFIER) ?? "kernel"
      level = string(.PRIORITY) ?? ""
      msg = string(.message) ?? ""
      out = {"host": "$NAME", "source": "journald", "unit": unit, "level": level, "message": msg, "timestamp": .timestamp}
EOF
      # rekordy uslug loghub-cron i loghub-status (JSON) staja sie zrodlami "cron", "crondef" i "stat"
      if [ "$JSON_VRL" = 1 ]; then cat <<EOF
      ident = string(.SYSLOG_IDENTIFIER) ?? ""
      if ident == "loghub-cron" || ident == "loghub-status" {
        run, err = parse_json(msg)
        if err == null && is_object(run) {
          r = object!(run)
          if is_array(r.containers) { r.containers = encode_json(r.containers) }
          if is_array(r.cstats) { r.cstats = encode_json(r.cstats) }
          if is_array(r.units) { r.units = encode_json(r.units) }
          if is_array(r.guests) { r.guests = encode_json(r.guests) }
          if is_array(r.disks) { r.disks = encode_json(r.disks) }
          if is_array(r.pools) { r.pools = encode_json(r.pools) }
          if is_array(r.smart) { r.smart = encode_json(r.smart) }
          if is_array(r.ports) { r.ports = encode_json(r.ports) }
          if is_array(r.ufw) { r.ufw = encode_json(r.ufw) }
          out = merge(out, r)
          out.host = "$NAME"
        }
      }
EOF
      fi
      echo "      . = out"
    fi
    inputs="${inputs:+$inputs, }t_files"
    cat <<EOF
  t_files:
    type: remap
    inputs: [files]
    source: |
      unit = string(.file) ?? "file"
      . = {"host": "$NAME", "source": "file", "unit": unit, "message": string(.message) ?? "", "timestamp": .timestamp}
EOF
    if [ -S /var/run/docker.sock ]; then
      inputs="$inputs, t_docker"
      cat <<EOF
  t_docker:
    type: remap
    inputs: [docker]
    source: |
      unit = string(.container_name) ?? "container"
      . = {"host": "$NAME", "source": "docker", "unit": unit, "message": string(.message) ?? "", "timestamp": .timestamp}
EOF
    fi
    cat <<EOF
sinks:
  hub:
    type: http
    inputs: [$inputs]
    uri: "$HUB/insert/jsonline?$STREAM_ARGS"
    method: post
    compression: gzip
    encoding:
      codec: json
    framing:
      method: newline_delimited
    auth:
      strategy: bearer
      token: "$TOKEN"
    healthcheck:
      enabled: false
    buffer:
      type: disk
      max_size: 268435488
EOF
  } > "$cfg"
  chown root:vector "$cfg" 2>/dev/null || true
  chmod 640 "$cfg"
}

# ------------------------------------------------------------------- cron
# Debianowy cron z opcja "-L 15" zapisuje start, koniec i kod wyjscia kazdego zadania.
# Usluga loghub-cron sklada te wpisy w jeden rekord na uruchomienie (JSON do journald).

CRON_LIB=/usr/local/lib/loghub

write_cron_files() {
  mkdir -p "$CRON_LIB"
  cat > "$CRON_LIB/cron.awk" <<'EOF'
# wejscie: komunikaty crona (cron -L 15); wyjscie: jeden JSON na zakonczone uruchomienie
function esc(s) { gsub(/\\/, "\\\\", s); gsub(/"/, "\\\"", s); gsub(/[[:cntrl:]]/, " ", s); return s }
function emit(pid, cmd, user,   d, state, lvl, code, msg, unit) {
  d = (pid in t0) ? systime() - t0[pid] : -1
  if (pid in sig)     { state = "signal"; lvl = 3; code = 128 + sig[pid]; msg = "PRZERWANE sygnałem " sig[pid] }
  else if (pid in rc) { state = "fail";   lvl = 3; code = rc[pid];       msg = "BŁĄD kod " rc[pid] }
  else                { state = "ok";     lvl = 6; code = 0;             msg = "OK" }
  if (d >= 0) msg = msg " · " d " s"
  unit = (user == "root" ? "" : user ": ") substr(cmd, 1, 80)
  printf "{\"source\":\"cron\",\"unit\":\"%s\",\"level\":\"%d\",\"message\":\"%s\",\"cron_state\":\"%s\",\"exit_code\":%d,", esc(unit), lvl, esc(msg " · " cmd), state, code
  if (d >= 0) printf "\"duration_s\":%d,", d
  printf "\"cron_user\":\"%s\",\"cron_cmd\":\"%s\",\"cron_pid\":%d}\n", esc(user), esc(cmd), pid
  fflush()
  delete t0[pid]; delete rc[pid]; delete sig[pid]
}
{
  line = $0
  if (match(line, /^\([^)]*\) (CMD|END) \(\[[0-9]+\] /)) {
    head = substr(line, 1, RLENGTH); cmd = substr(line, RLENGTH + 1); sub(/\)$/, "", cmd)
    user = head; sub(/^\(/, "", user); sub(/\).*/, "", user)
    pid = head; sub(/^.*\(\[/, "", pid); sub(/\].*/, "", pid)
    if (head ~ /\) CMD \(/) t0[pid] = systime(); else emit(pid, cmd, user)
  } else if (match(line, /grandchild #[0-9]+ failed with exit status [0-9]+/)) {
    s = substr(line, RSTART, RLENGTH); pid = s; sub(/^grandchild #/, "", pid); sub(/ .*/, "", pid)
    sub(/.* /, "", s); rc[pid] = s + 0
  } else if (match(line, /grandchild #[0-9]+ terminated by signal [0-9]+/)) {
    s = substr(line, RSTART, RLENGTH); pid = s; sub(/^grandchild #/, "", pid); sub(/ .*/, "", pid)
    sub(/.* /, "", s); sig[pid] = s + 0
  }
}
EOF

  cat > "$CRON_LIB/scan.awk" <<'EOF'
# wypisuje zadania z jednego pliku crontab jako JSON; sys=1: format systemowy (z kolumna uzytkownika)
function esc(s) { gsub(/\\/, "\\\\", s); gsub(/"/, "\\\"", s); gsub(/[[:cntrl:]]/, " ", s); return s }
function word(   w) { if (!match(line, /^[^ \t]+[ \t]+/)) return ""; w = substr(line, 1, RLENGTH); line = substr(line, RLENGTH + 1); sub(/[ \t]+$/, "", w); return w }
/^[ \t]*(#|$)/ { next }
/^[ \t]*[A-Za-z_][A-Za-z0-9_]*[ \t]*=/ { next }
{
  line = $0; sub(/^[ \t]+/, "", line); sub(/[ \t]+$/, "", line)
  n = (line ~ /^@/) ? 1 : 5; sched = ""
  for (i = 1; i <= n; i++) { w = word(); if (w == "") next; sched = sched (i > 1 ? " " : "") w }
  if (sys) { user = word(); if (user == "") next } else user = owner
  if (line == "") next
  unit = (user == "root" ? "" : user ": ") substr(line, 1, 80)
  printf "{\"source\":\"crondef\",\"unit\":\"%s\",\"level\":\"6\",\"message\":\"harmonogram %s · %s · %s\",\"cron_sched\":\"%s\",\"cron_user\":\"%s\",\"cron_cmd\":\"%s\",\"cron_file\":\"%s\",\"cron_scan\":%d}\n", esc(unit), esc(sched), esc(user), esc(file), esc(sched), esc(user), esc(line), esc(file), scan
}
EOF

  cat > "$CRON_LIB/cron-watch.sh" <<'EOF'
#!/bin/sh
# Lista zadan: sprawdzana co 10 minut, wysylana po zmianie i raz na tydzien.
( last=""; n=0
  while :; do
    cur="$(/usr/local/sbin/loghub cron-scan 2>/dev/null | sed 's/"cron_scan":[0-9]*/"cron_scan":0/')"
    if [ -n "$cur" ] && { [ "$cur" != "$last" ] || [ "$n" -ge 1008 ]; }; then
      printf '%s\n' "$cur" | sed "s/\"cron_scan\":0/\"cron_scan\":$(date +%s)/"
      last="$cur"; n=0
    fi
    n=$((n + 1)); sleep 600
  done ) &
# Wyniki uruchomien: cron zapisuje start, koniec i kod wyjscia, awk sklada je w jeden rekord.
# mawk (domyslny awk w Debianie) czyta potok blokami; bez tej opcji wyniki przychodzilyby z opoznieniem
if awk -W version 2>&1 | grep -qi mawk; then set -- -W interactive; else set --; fi
journalctl -f -n 0 -t CRON -o cat | awk "$@" -f /usr/local/lib/loghub/cron.awk
EOF
  chmod 755 "$CRON_LIB/cron-watch.sh"

  cat > /etc/systemd/system/loghub-cron.service <<'EOF'
[Unit]
Description=loghub: wyniki i lista zadan cron
After=systemd-journald.service cron.service

[Service]
ExecStart=/usr/local/lib/loghub/cron-watch.sh
SyslogIdentifier=loghub-cron
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
}

# Wypisuje wszystkie zadania cron tej maszyny (JSON, po jednym w linii).
cmd_cron_scan() {
  local f now
  now="$(date +%s)"
  for f in /etc/crontab /etc/cron.d/*; do
    [ -f "$f" ] || continue
    case "$(basename "$f")" in *[!A-Za-z0-9_-]*) continue ;; esac
    awk -v sys=1 -v file="$f" -v scan="$now" -f "$CRON_LIB/scan.awk" "$f"
  done
  for f in /var/spool/cron/crontabs/*; do
    [ -f "$f" ] || continue
    awk -v sys=0 -v owner="$(basename "$f")" -v file="$f" -v scan="$now" -f "$CRON_LIB/scan.awk" "$f"
  done
}

setup_cron() {
  [ "$DO_CRON" = 1 ] || return 0
  # Kod wyjscia zapisuje tylko cron z Debiana, Ubuntu i Proxmoxa (wersje 3.0pl1-*); cronie i busybox tego nie umieja.
  if ! have journalctl || ! dpkg-query -W -f='${Version}' cron 2>/dev/null | grep -q '^3\.0pl1'; then
    if have crond || have cron; then warn "$NAME: ten cron nie zapisuje kodow wyjscia - pomijam podglad zadan cron"; fi
    return 0
  fi
  say "Wlaczam podglad zadan cron"
  local cur new
  touch /etc/default/cron
  sed -i '/^# loghub$/,+1d' /etc/default/cron
  cur="$(sed -n 's/^EXTRA_OPTS=//p' /etc/default/cron | tail -1 | tr -d "\"'" | sed -E 's/-L *[0-9]+//; s/^ +| +$//g')"
  new="${cur:+$cur }-L 15"
  printf '# loghub\nEXTRA_OPTS="%s"\n' "$new" >> /etc/default/cron
  # systemd czyta /etc/default/cron przy starcie uslugi; trwajace zadania nie sa przerywane
  systemctl restart cron >/dev/null 2>&1 || warn "nie udalo sie zrestartowac crona"
  write_cron_files
  systemctl daemon-reload
  systemctl enable loghub-cron >/dev/null 2>&1 || true
  systemctl restart loghub-cron
  JSON_VRL=1
}

# ----------------------------------------------------------- stan i zasoby
# Co ok. 20 s: CPU, RAM, dysk, obciazenie; stan kontenerow Dockera, uslug systemd i (na Proxmoxie) gosci LXC/VM.

write_status_files() {
  mkdir -p "$CRON_LIB"
  cat > "$CRON_LIB/status.sh" <<'EOF'
#!/bin/bash
# loghub: jeden rekord JSON co ok. 20 s ze stanem i zuzyciem zasobow tej maszyny (wyjscie trafia do journald)
cpu_sample() { awk '/^cpu /{print $2+$3+$4+$7+$8+$9, $5+$6; exit}' /proc/stat; }
read -r pb pi < <(cpu_sample)
sleep 5
while :; do
  read -r b i < <(cpu_sample)
  cpu=$(awk -v b=$((b-pb)) -v i=$((i-pi)) 'BEGIN{t=b+i; printf "%.1f", (t>0 ? b*100/t : 0)}')
  pb=$b; pi=$i
  read -r mt ma < <(awk '/^MemTotal:/{t=$2} /^MemAvailable:/{a=$2} END{print t, a}' /proc/meminfo)
  mem=$(awk -v t="$mt" -v a="$ma" 'BEGIN{printf "%.1f", (t>0 ? (t-a)*100/t : 0)}')
  read -r du dt dp < <(df -Pk / | awk 'NR==2{sub(/%/,"",$5); print $3, $2, $5}')
  read -r l1 l5 _ < /proc/loadavg
  up=$(awk '{printf "%d", $1}' /proc/uptime)
  cores=$(nproc 2>/dev/null || echo 1)
  extra=""
  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    ps=$(timeout 20 docker ps -a --format '{"n":{{json .Names}},"s":{{json .State}},"st":{{json .Status}}}' 2>/dev/null | paste -sd, -)
    st=$(timeout 30 docker stats --no-stream --format '{"n":{{json .Name}},"cpu":{{json .CPUPerc}},"mem":{{json .MemUsage}},"memp":{{json .MemPerc}}}' 2>/dev/null | paste -sd, -)
    extra="$extra,\"containers\":[${ps}],\"cstats\":[${st}]"
  fi
  if command -v systemctl >/dev/null 2>&1; then
    # tylko uslugi aktywne, uruchamiane albo padniete; brak na liscie = nieaktywna bez bledu
    un=$(systemctl list-units --type=service --all --no-legend --plain --no-pager 2>/dev/null | awk '
      { i = ($1 ~ /\./) ? 1 : 2; u = $i; l = $(i+1); a = $(i+2); s = $(i+3)
        gsub(/\\/, "\\\\", u)   # nazwy jak systemd-fsck@dev-disk-by\x2duuid: ukosnik musi byc podwojony w JSON
        if (l == "loaded" && a != "inactive") printf "%s[\"%s\",\"%s\",\"%s\"]", (n++ ? "," : ""), u, a, s }')
    extra="$extra,\"units\":[${un}]"
  fi
  # wszystkie zamontowane systemy plikow (dyski, USB, udzialy sieciowe), bez wewnetrznych zbiorow Dockera i Proxmoxa
  dk=$(timeout 10 df -PkT 2>/dev/null | awk '
    function esc(x) { gsub(/\\/, "\\\\", x); gsub(/"/, "\\\"", x); return x }
    NR > 1 && $2 ~ /^(ext[234]|xfs|btrfs|zfs|vfat|exfat|ntfs|ntfs3|fuseblk|nfs|nfs4|cifs|smb3|fuse\.sshfs|f2fs)$/ && $3 > 0 {
      m = $7; for (i = 8; i <= NF; i++) m = m " " $i
      if (m ~ /^\/(var\/lib\/docker|run|snap|proc|sys|dev)(\/|$)/) next
      if ($1 ~ /subvol-[0-9]+-disk|vm-[0-9]+-disk|basevol-/) next
      if ($2 == "vfat" && $3 < 4194304) next
      k = $1 "|" $3; if (k in seen) next; seen[k] = 1
      printf "%s[\"%s\",\"%s\",\"%s\",%d,%d]", (n++ ? "," : ""), esc(m), $2, esc($1), $4, $3 }')
  extra="$extra,\"disks\":[${dk}]"
  if command -v zpool >/dev/null 2>&1; then
    zp=$(timeout 10 zpool list -Hp -o name,size,alloc,health 2>/dev/null | awk '{printf "%s[\"%s\",%s,%s,\"%s\"]", (n++ ? "," : ""), $1, $2, $3, $4}')
    extra="$extra,\"pools\":[${zp}]"
  fi
  # stan dyskow fizycznych (SMART) co 10 minut; dziala tam, gdzie jest smartctl i dostep do dyskow (host, nie LXC)
  if command -v smartctl >/dev/null 2>&1 && [ $(( $(date +%s) - ${smt:-0} )) -ge 600 ]; then
    smt=$(date +%s); sm=""
    for d in $(lsblk -dnpo NAME,TYPE 2>/dev/null | awk '$2=="disk" && $1 !~ /zd|rbd|nbd|loop/ {print $1}'); do
      out=$(timeout 25 smartctl -H -i -A "$d" 2>/dev/null)
      echo "$out" | grep -qE 'overall-health|SMART Health Status' || out=$(timeout 25 smartctl -d sat -H -i -A "$d" 2>/dev/null)
      model=$(echo "$out" | sed -n -E 's/^(Device Model|Model Number|Product):[[:space:]]*//p' | head -1 | tr -d '"\\')
      health=$(echo "$out" | sed -n -E 's/.*overall-health self-assessment test result:[[:space:]]*//p; s/^SMART Health Status:[[:space:]]*//p' | head -1 | tr -d '"\\')
      temp=$(echo "$out" | awk '/Temperature_Celsius|Airflow_Temperature_Cel/ {print $10+0; exit} /^Temperature:/ {print $2+0; exit}')
      hours=$(echo "$out" | awk '/Power_On_Hours/ {print $10+0; exit} /^Power On Hours:/ {gsub(",", "", $4); print $4+0; exit}')
      realloc=$(echo "$out" | awk '/Reallocated_Sector_Ct/ {print $10+0; exit}')
      pend=$(echo "$out" | awk '/Current_Pending_Sector/ {print $10+0; exit}')
      size=$(lsblk -dnbo SIZE "$d" 2>/dev/null | head -1)
      tran=$(lsblk -dno TRAN "$d" 2>/dev/null | head -1)
      sm="${sm:+$sm,}[\"$d\",\"$model\",${size:-0},\"$health\",${temp:-null},${hours:-null},${realloc:-null},${pend:-null},\"$tran\"]"
    done
  fi
  [ -n "${smt:-}" ] && extra="$extra,\"smart\":[${sm}]"
  # nasluchujace porty TCP i UDP z nazwa procesu
  if command -v ss >/dev/null 2>&1; then
    po=$(ss -Hlntup 2>/dev/null | awk '
      { l = $5; i = match(l, /:[0-9]+$/); if (!i) next
        port = substr(l, i + 1); a = substr(l, 1, i - 1); gsub(/^\[|\]$/, "", a); sub(/%.*/, "", a)
        pr = ""; if (match($0, /users:\(\("[^"]+"/)) pr = substr($0, RSTART + 9, RLENGTH - 10)
        k = $1 "|" a "|" port; if (k in s) next; s[k] = 1
        printf "%s[\"%s\",\"%s\",%d,\"%s\"]", (n++ ? "," : ""), $1, a, port, pr }')
    extra="$extra,\"ports\":[${po}]"
  fi
  # zapora ufw: stan i reguly ALLOW otwarte dla calego swiata (From = Anywhere)
  if command -v ufw >/dev/null 2>&1; then
    uo=$(timeout 10 ufw status 2>/dev/null)
    if echo "$uo" | grep -q '^Status: active'; then
      ur=$(echo "$uo" | awk '
        /^--/ { t = 1; next }
        t && NF {
          line = $0; gsub(/ \(v6\)/, "", line)
          if (match(line, /[ \t]+(ALLOW|LIMIT)( IN)?[ \t]+/)) {
            to = substr(line, 1, RSTART - 1); from = substr(line, RSTART + RLENGTH)
            gsub(/^[ \t]+|[ \t]+$/, "", to); gsub(/^[ \t]+|[ \t]+$/, "", from); gsub(/"/, "", to)
            if (from ~ /^Anywhere/ && to !~ / on tailscale/ && !(to in seen)) { seen[to] = 1; printf "%s\"%s\"", (n++ ? "," : ""), to }
          }
        }')
      extra="$extra,\"ufw_state\":\"active\",\"ufw\":[${ur}]"
    else
      extra="$extra,\"ufw_state\":\"inactive\",\"ufw\":[]"
    fi
  fi
  if command -v pvesh >/dev/null 2>&1; then
    g=$(timeout 20 pvesh get /cluster/resources --type vm --output-format json 2>/dev/null)
    case "$g" in \[*) extra="$extra,\"guests\":$g" ;; esac
  fi
  printf '{"source":"stat","unit":"host","level":"6","message":"CPU %s%% · RAM %s%% · dysk %s%% · obciążenie %s","cpu":%s,"mem_pct":%s,"mem_total_kb":%s,"mem_avail_kb":%s,"disk_pct":%s,"disk_used_kb":%s,"disk_total_kb":%s,"load1":%s,"load5":%s,"cores":%s,"uptime_s":%s%s}\n' \
    "$cpu" "$mem" "$dp" "$l1" "$cpu" "$mem" "${mt:-0}" "${ma:-0}" "${dp:-0}" "${du:-0}" "${dt:-0}" "$l1" "$l5" "$cores" "$up" "$extra"
  sleep 15   # razem z pomiarem (5 s) wychodzi rekord co ok. 20 s
done
EOF
  chmod 755 "$CRON_LIB/status.sh"

  cat > /etc/systemd/system/loghub-status.service <<'EOF'
[Unit]
Description=loghub: stan uslug i zuzycie zasobow
After=systemd-journald.service docker.service

[Service]
ExecStart=/usr/local/lib/loghub/status.sh
SyslogIdentifier=loghub-status
Restart=always
RestartSec=10
Nice=10

[Install]
WantedBy=multi-user.target
EOF
}

setup_status() {
  [ "$DO_STATUS" = 1 ] || return 0
  have journalctl && have systemctl || return 0
  say "Wlaczam pomiar zasobow i stanu uslug"
  # stan dyskow (SMART) tylko na fizycznych maszynach; w LXC i VM nie ma dostepu do dyskow
  if [ "$(systemd-detect-virt 2>/dev/null || true)" = "none" ] && ! have smartctl; then
    apt-get install -y -qq smartmontools >/dev/null 2>&1 || warn "nie udalo sie zainstalowac smartmontools (stan dyskow nie bedzie widoczny)"
  fi
  write_status_files
  systemctl daemon-reload
  systemctl enable loghub-status >/dev/null 2>&1 || true
  systemctl restart loghub-status
  JSON_VRL=1
}

fan_out_lxc() {
  have pct || return 0
  [ "$DO_LXC" = 1 ] || return 0
  local id
  for id in $(pct list 2>/dev/null | awk 'NR>1 && $2=="running" {print $1}'); do
    say "LXC $id"
    if ! pct exec "$id" -- sh -c 'command -v apt-get' >/dev/null 2>&1 </dev/null; then
      warn "LXC $id: brak apt (np. Alpine) - pomijam"
      continue
    fi
    pct exec "$id" -- mkdir -p "$(dirname "$SELF")" </dev/null
    pct push "$id" "$SELF" "$SELF" --perms 755 </dev/null >/dev/null
    pct exec "$id" -- "$SELF" agent --hub "$HUB_LAN" --token "$TOKEN" \
      --no-lxc --no-tailscale $( [ "$DO_CRON" = 1 ] || echo --no-cron ) $( [ "$DO_STATUS" = 1 ] || echo --no-status ) </dev/null || warn "LXC $id: instalacja nieudana"
  done
  local stopped vms
  stopped="$(pct list 2>/dev/null | awk 'NR>1 && $2!="running" {printf "%s ", $1}')"
  [ -n "$stopped" ] && warn "Zatrzymane LXC pominiete: $stopped(uruchom skrypt ponownie po ich starcie)"
  vms="$(qm list 2>/dev/null | awk 'NR>1 && $3=="running" {printf "%s(%s) ", $1, $2}')"
  [ -n "$vms" ] && warn "VM-ki wymagaja uruchomienia tej samej komendy w srodku: $vms"
  return 0
}

cmd_agent() {
  HUB="" HUB_LAN="" TOKEN="" NAME="$(hostname)" EXTRA_LOGS="" DO_LXC=1 USE_TS=1 DO_CRON=1 DO_STATUS=1 JSON_VRL=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --hub) HUB="${2%/}"; shift 2 ;;
      --hub-lan) HUB_LAN="${2%/}"; shift 2 ;;
      --token) TOKEN="$2"; shift 2 ;;
      --name) NAME="$2"; shift 2 ;;
      --logs) EXTRA_LOGS="$2"; shift 2 ;;
      --no-lxc) DO_LXC=0; shift ;;
      --no-tailscale) USE_TS=0; shift ;;
      --no-cron) DO_CRON=0; shift ;;
      --no-status) DO_STATUS=0; shift ;;
      *) die "nieznana opcja: $1" ;;
    esac
  done
  [ -n "$HUB" ] || die "podaj --hub http://ADRES:PORT"
  [ -n "$TOKEN" ] || die "podaj --token (wypisuje go centrala)"
  [ -n "$HUB_LAN" ] || HUB_LAN="$HUB"
  printf '%s' "$NAME" | grep -Eq '^[A-Za-z0-9._-]+$' || die "nazwa hosta zawiera niedozwolone znaki: $NAME"

  need_root
  apt_base
  save_self
  if in_lxc; then USE_TS=0; fi
  setup_tailscale

  if ! have vector; then
    say "Instaluje Vector"
    bash -c "$(curl -fsSL https://setup.vector.dev)" </dev/null
    apt-get install -y -qq vector >/dev/null
  fi
  local g
  for g in systemd-journal adm docker; do
    if getent group "$g" >/dev/null; then usermod -aG "$g" vector; fi
  done

  setup_cron
  setup_status
  grant_log_access
  write_vector_config
  if [ "$JSON_VRL" = 1 ] && ! vector validate --no-environment /etc/vector/vector.yaml >/dev/null 2>&1; then
    # czesc dla crona i zasobow nie moze zablokowac zbierania zwyklych logow
    warn "$NAME: konfiguracja z cronem i zasobami nie przeszla walidacji - instaluje bez niej"
    JSON_VRL=0
    write_vector_config
  fi
  vector validate --no-environment /etc/vector/vector.yaml >/dev/null \
    || die "konfiguracja Vectora nie przeszla walidacji: vector validate /etc/vector/vector.yaml"
  systemctl enable vector >/dev/null 2>&1 || true
  systemctl restart vector

  if curl -fsS -m 8 -o /dev/null -X POST \
      -H "Authorization: Bearer $TOKEN" \
      --data "{\"message\":\"loghub: agent zainstalowany\",\"host\":\"$NAME\",\"source\":\"loghub\",\"unit\":\"install\"}" \
      "$HUB/insert/jsonline?_stream_fields=host,source,unit&_msg_field=message"; then
    say "$NAME: agent dziala, centrala odpowiada"
  else
    warn "$NAME: agent zainstalowany, ale centrala $HUB nie odpowiada (logi czekaja w buforze na dysku)"
  fi

  fan_out_lxc
}

cmd_uninstall_agent() {
  need_root
  systemctl disable --now vector >/dev/null 2>&1 || true
  apt-get remove -y -qq vector >/dev/null 2>&1 || true
  rm -rf /etc/vector/vector.yaml /var/lib/vector
  systemctl disable --now loghub-cron loghub-status >/dev/null 2>&1 || true
  rm -rf /etc/systemd/system/loghub-cron.service /etc/systemd/system/loghub-status.service "$CRON_LIB"
  if [ -f /etc/default/cron ] && grep -q '^# loghub$' /etc/default/cron; then
    sed -i '/^# loghub$/,+1d' /etc/default/cron
    systemctl restart cron >/dev/null 2>&1 || true
  fi
  say "Agent usuniety (Tailscale zostaje)."
}

main() {
  local cmd="${1:-}"
  [ $# -gt 0 ] && shift
  case "$cmd" in
    hub) cmd_hub "$@" ;;
    agent) cmd_agent "$@" ;;
    user) cmd_user "$@" ;;
    public) cmd_public "$@" ;;
    uninstall-agent) cmd_uninstall_agent "$@" ;;
    cron-scan) cmd_cron_scan ;;
    *) sed -n '2,16p' "${BASH_SOURCE[0]:-/dev/null}" 2>/dev/null | sed 's/^# \{0,1\}//'
       die "uzycie: loghub hub | agent --hub URL --token T | user ... | public on|off|status | uninstall-agent" ;;
  esac
}

main "$@"
