# loghub: wspolne ustawienia i drobne funkcje uzywane przez reszte skryptow.
# Ten plik jest wczytywany (source) przez install.sh; sam niczego nie uruchamia.

# Repozytorium na GitHubie (musi byc publiczne). Inna nazwa: LOGHUB_REPO=uzytkownik/repo
REPO="${LOGHUB_REPO:-Seelf/loghub}"
REPO_RAW="${LOGHUB_REPO_RAW:-https://raw.githubusercontent.com/$REPO/main}"

SELF=/usr/local/sbin/loghub          # polecenie "loghub" (maly skrypt uruchamiajacy kopie zrodel)
SRC_DIR=/usr/local/share/loghub      # kopia skryptow loghub na tej maszynie (install.sh, lib/, agent/, hub/)
HUB_DIR=/opt/loghub                  # centrala: docker-compose, dane, konta
CRON_LIB=/usr/local/lib/loghub       # agent: skrypty crona i pomiaru stanu

PORT="${LOGHUB_PORT:-8080}"          # prywatny: agenci + strona w sieci lokalnej i Tailscale
PUBLIC_PORT=8081                     # publiczny: tylko strona z logowaniem, tylko dla Tailscale Funnel
RETENTION="${LOGHUB_RETENTION:-730d}"

# jak VictoriaLogs ma rozumiec przysylane linie: pola strumienia, tresc i czas
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

# Kopiuje skrypty loghub do $SRC_DIR i zapisuje polecenie /usr/local/sbin/loghub.
# Potrzebne do polecen "loghub user ...", "loghub public ...", do crona (cron-scan) i do instalacji w LXC.
save_self() {
  local new="$SRC_DIR.new" old="$SRC_DIR.old"
  if [ "$(readlink -f "$LOGHUB_SRC")" != "$(readlink -f "$SRC_DIR" 2>/dev/null || true)" ]; then
    rm -rf "$new" "$old"
    mkdir -p "$new"
    cp -r "$LOGHUB_SRC/install.sh" "$LOGHUB_SRC/lib" "$LOGHUB_SRC/agent" "$LOGHUB_SRC/hub" "$new/"
    # podmiana katalogu przez zmiane nazwy: dzialajacy wlasnie skrypt czyta dalej stare pliki
    if [ -d "$SRC_DIR" ]; then mv "$SRC_DIR" "$old"; fi
    mv "$new" "$SRC_DIR"
    rm -rf "$old"
  fi
  mkdir -p "$(dirname "$SELF")"
  printf '#!/usr/bin/env bash\n# polecenie loghub: uruchamia zainstalowana kopie skryptow\nexec bash %s/install.sh "$@"\n' "$SRC_DIR" > "$SELF.new"
  chmod 755 "$SELF.new"
  mv -f "$SELF.new" "$SELF"
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
