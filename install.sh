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
#
# Ten plik tylko znajduje reszte skryptow i uruchamia wybrane polecenie. Kod jest w katalogu lib/:
#   lib/common.sh        ustawienia i drobne funkcje (komunikaty, apt, Tailscale, polecenie "loghub")
#   lib/hub.sh           centrala: hub, user, public
#   lib/agent.sh         agent: agent, uninstall-agent
#   lib/agent-vector.sh  konfiguracja Vectora (programy VRL leza w agent/vector/)
#   lib/agent-cron.sh    podglad zadan cron (skrypty w agent/cron/)
#   lib/agent-status.sh  pomiar zasobow i stanu uslug (skrypt w agent/status/)
#   lib/proxmox.sh       instalacja agenta w kontenerach LXC i maszynach VM
#
# Calosc jest w funkcjach wywolanych na koncu pliku, zeby polecenia
# czytajace stdin nie zjadly skryptu przy uruchomieniu przez "curl | bash".

set -euo pipefail

# Skad wziac reszte plikow loghub:
#  1) LOGHUB_SRC=/katalog (np. kopia repozytorium),
#  2) katalog obok tego pliku (git clone albo zainstalowana kopia /usr/local/share/loghub),
#  3) przy "curl | bash": archiwum repozytorium z GitHuba, z konkretnego commita
#     (adres z sha nie jest trzymany w cache GitHuba, wiec zaraz po pushu nie przyjdzie stara wersja).
find_source() {
  local here="${BASH_SOURCE[0]:-}" dir=""
  if [ -n "${LOGHUB_SRC:-}" ]; then
    [ -f "$LOGHUB_SRC/lib/common.sh" ] || { echo "BLAD: w LOGHUB_SRC=$LOGHUB_SRC nie ma lib/common.sh" >&2; exit 1; }
    return 0
  fi
  if [ -n "$here" ] && [ -f "$here" ]; then
    dir="$(dirname "$(readlink -f "$here")")"
    if [ -f "$dir/lib/common.sh" ]; then LOGHUB_SRC="$dir"; return 0; fi
  fi
  download_source
}

download_source() {
  local repo="${LOGHUB_REPO:-Seelf/loghub}" ref="${LOGHUB_REF:-}"
  command -v curl >/dev/null 2>&1 || { echo "BLAD: potrzebny curl (apt-get install curl)" >&2; exit 1; }
  if [ -z "$ref" ]; then
    ref="$(curl -fsSL -m 10 "https://api.github.com/repos/$repo/commits/main" 2>/dev/null | sed -n 's/^  "sha": "\([0-9a-f]\{40\}\)".*/\1/p' | head -1 || true)"
  fi
  [ -n "$ref" ] || ref=main
  LOGHUB_SRC="$(mktemp -d /tmp/loghub-src.XXXXXX)"
  trap 'rm -rf "$LOGHUB_SRC"' EXIT
  printf '\033[1;32m==>\033[0m %s\n' "Pobieram loghub: $repo@${ref:0:12}"
  curl -fsSL "https://codeload.github.com/$repo/tar.gz/$ref" | tar xz -C "$LOGHUB_SRC" --strip-components=1 \
    || { echo "BLAD: nie udalo sie pobrac https://codeload.github.com/$repo/tar.gz/$ref" >&2; exit 1; }
  [ -f "$LOGHUB_SRC/lib/common.sh" ] || { echo "BLAD: pobrane archiwum nie zawiera lib/common.sh" >&2; exit 1; }
}

load_libs() {
  local f
  for f in common hub agent agent-vector agent-cron agent-status proxmox; do
    # shellcheck source=/dev/null
    . "$LOGHUB_SRC/lib/$f.sh"
  done
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
    *) sed -n '2,16p' "$LOGHUB_SRC/install.sh" 2>/dev/null | sed 's/^# \{0,1\}//'
       die "uzycie: loghub hub | agent --hub URL --token T | user ... | public on|off|status | uninstall-agent" ;;
  esac
}

# Jedno polecenie na koncu: bash przeczyta caly plik, zanim cokolwiek zacznie czytac stdin.
run() { find_source; load_libs; main "$@"; }
run "$@"
