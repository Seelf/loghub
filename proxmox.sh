#!/usr/bin/env bash
# loghub na Proxmoxie: tworzy kontener LXC z centrala (Docker w srodku) i ja uruchamia.
#
# Na hoscie Proxmox, jako root:
#   curl -fsSL https://raw.githubusercontent.com/Seelf/loghub/main/proxmox.sh | bash
# albo z rozpakowanego katalogu (bez GitHuba):
#   bash proxmox.sh
#
# Ustawienia (zmienne srodowiskowe, wszystkie opcjonalne):
#   CTID=120            numer kontenera (domyslnie pierwszy wolny)
#   CT_NAME=loghub      nazwa kontenera
#   STORAGE=local-lvm   magazyn na dysk kontenera (domyslnie pierwszy, ktory obsluguje kontenery)
#   DISK=16             rozmiar dysku w GB (logi z 100 dni)
#   MEMORY=2048 CORES=2 BRIDGE=vmbr0
#   IP=192.168.1.50/24 GW=192.168.1.1   staly adres (domyslnie DHCP)
#   TS_AUTHKEY=tskey-auth-...           klucz Tailscale, zeby nie klikac linku logowania
#   AGENT=0                             nie instaluj agenta na hoscie i w kontenerach (domyslnie skrypt pyta)
#   LOGHUB_REPO=uzytkownik/repo         inne repozytorium niz Seelf/loghub
#
# Calosc jest w funkcji main() wywolanej na koncu, zeby "curl | bash" nie zjadl skryptu.

set -euo pipefail

REPO="${LOGHUB_REPO:-Seelf/loghub}"
RAW="https://raw.githubusercontent.com/$REPO/main"
CT_NAME="${CT_NAME:-loghub}"
DISK="${DISK:-16}"
MEMORY="${MEMORY:-2048}"
CORES="${CORES:-2}"
BRIDGE="${BRIDGE:-vmbr0}"

say()  { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m  %s\n' "$*" >&2; }
die()  { printf '\033[1;31mBLAD:\033[0m %s\n' "$*" >&2; exit 1; }

# pierwszy aktywny magazyn obslugujacy dany rodzaj tresci (rootdir, vztmpl)
storage_for() { pvesm status --content "$1" 2>/dev/null | awk 'NR>1 && $3=="active" {print $1; exit}'; }

main() {
  [ "$(id -u)" -eq 0 ] || die "uruchom jako root na hoscie Proxmox"
  command -v pct >/dev/null 2>&1 || die "to nie jest host Proxmox (brak polecenia pct)"

  local src="${BASH_SOURCE[0]:-}" dir="" ctid storage tstore tmpl net i ip token answer
  # uruchomione z rozpakowanego katalogu: pliki ida do kontenera stad, nie z GitHuba
  if [ -n "$src" ] && [ -f "$(dirname "$src")/install.sh" ] && [ -f "$(dirname "$src")/lib/common.sh" ]; then
    dir="$(cd "$(dirname "$src")" && pwd)"
  fi

  if pct list 2>/dev/null | awk 'NR>1 {print $NF}' | grep -qx "$CT_NAME"; then
    die "kontener o nazwie $CT_NAME juz istnieje (inna nazwa: CT_NAME=..., albo usun stary: pct destroy ID)"
  fi

  ctid="${CTID:-$(pvesh get /cluster/nextid)}"
  storage="${STORAGE:-$(storage_for rootdir)}"
  tstore="$(storage_for vztmpl)"
  [ -n "$storage" ] || die "nie znalazlem magazynu na kontenery; podaj STORAGE=nazwa"
  [ -n "$tstore" ] || die "nie znalazlem magazynu na szablony (vztmpl)"

  say "Szablon Debian 12"
  pveam update >/dev/null 2>&1 || warn "nie udalo sie odswiezyc listy szablonow"
  tmpl="$(pveam available --section system 2>/dev/null | awk '$2 ~ /^debian-12-standard/ {print $2}' | sort -V | tail -1)"
  [ -n "$tmpl" ] || die "brak szablonu debian-12-standard na liscie pveam"
  if ! pveam list "$tstore" 2>/dev/null | grep -q "$tmpl"; then
    pveam download "$tstore" "$tmpl"
  fi

  net="name=eth0,bridge=$BRIDGE,ip=${IP:-dhcp}"
  if [ -n "${GW:-}" ]; then net="$net,gw=$GW"; fi

  say "Tworze kontener $ctid ($CT_NAME) na magazynie $storage"
  # nesting i keyctl: potrzebne, zeby Docker dzialal w nieuprzywilejowanym kontenerze
  pct create "$ctid" "$tstore:vztmpl/$tmpl" \
    --hostname "$CT_NAME" --cores "$CORES" --memory "$MEMORY" --swap 512 \
    --rootfs "$storage:$DISK" --net0 "$net" \
    --unprivileged 1 --features nesting=1,keyctl=1 --onboot 1

  # Tailscale potrzebuje urzadzenia /dev/net/tun w kontenerze
  if ! pct set "$ctid" --dev0 /dev/net/tun 2>/dev/null; then
    # starszy Proxmox bez opcji --dev0
    printf '%s\n' 'lxc.cgroup2.devices.allow: c 10:200 rwm' \
      'lxc.mount.entry: /dev/net/tun dev/net/tun none bind,create=file' >> "/etc/pve/lxc/$ctid.conf"
  fi

  pct start "$ctid"
  say "Czekam na siec w kontenerze"
  for i in $(seq 1 30); do
    if pct exec "$ctid" -- getent hosts deb.debian.org >/dev/null 2>&1; then break; fi
    if [ "$i" -eq 30 ]; then die "kontener nie ma dostepu do internetu (sprawdz BRIDGE=$BRIDGE i DHCP)"; fi
    sleep 2
  done

  say "Instaluje centrale w kontenerze (Docker, Tailscale, VictoriaLogs, strona)"
  if [ -n "$dir" ]; then
    pct exec "$ctid" -- mkdir -p /opt/loghub-src
    tar -C "$dir" -cf - install.sh lib agent hub | pct exec "$ctid" -- tar -C /opt/loghub-src -xf -
    pct exec "$ctid" -- env TS_AUTHKEY="${TS_AUTHKEY:-}" LOGHUB_REPO="$REPO" bash /opt/loghub-src/install.sh hub </dev/null
  else
    pct exec "$ctid" -- bash -c "apt-get update -qq && apt-get install -y -qq curl ca-certificates >/dev/null" </dev/null
    pct exec "$ctid" -- env TS_AUTHKEY="${TS_AUTHKEY:-}" LOGHUB_REPO="$REPO" \
      bash -c "curl -fsSL '$RAW/install.sh' | bash -s -- hub" </dev/null
  fi

  ip="$(pct exec "$ctid" -- hostname -I 2>/dev/null | awk '{print $1}')"
  token="$(pct exec "$ctid" -- sed -n 's/^INGEST_TOKEN=//p' /opt/loghub/.env 2>/dev/null)"
  [ -n "$ip" ] && [ -n "$token" ] || die "centrala nie wystartowala poprawnie; sprawdz: pct exec $ctid -- docker ps"
  if [ -z "${IP:-}" ]; then
    warn "Kontener ma adres $ip z DHCP. Zarezerwuj go w routerze, bo agenci w sieci lokalnej wysylaja logi na ten adres."
  fi

  echo
  say "Agent na tym hoscie i we wszystkich dzialajacych kontenerach LXC"
  echo "  Zbiera journald, pliki z /var/log, logi Dockera i wyniki zadan cron; wysyla je do http://$ip:8080."
  answer="t"
  if [ "${AGENT:-ask}" = 0 ]; then
    answer="n"
  elif [ "${AGENT:-ask}" = ask ] && { : > /dev/tty; } 2>/dev/null; then
    printf '  Zainstalowac teraz? [T/n] ' > /dev/tty
    read -r answer < /dev/tty || answer="t"
  fi
  case "$answer" in
    n|N|nie) echo "  Pominiete. Pozniej: loghub agent --hub http://$ip:8080 --token $token --no-tailscale" ;;
    *)
      if [ -n "$dir" ]; then
        bash "$dir/install.sh" agent --hub "http://$ip:8080" --token "$token" --no-tailscale </dev/null
      else
        curl -fsSL "$RAW/install.sh" | LOGHUB_REPO="$REPO" bash -s -- agent --hub "http://$ip:8080" --token "$token" --no-tailscale
      fi
      ;;
  esac

  echo
  say "Gotowe. Kontener $ctid ($CT_NAME), strona: http://$ip:8080"
  echo "  Haslo administratora jest wyzej, w ramce \"Konto administratora\"."
  echo "  Uzytkownicy:          pct exec $ctid -- loghub user add NAZWA"
  echo "  Strona na swiat:      pct exec $ctid -- loghub public on"
  echo "  Maszyny poza domem:   komenda \"Instalacja agenta\" wypisana wyzej (z adresem Tailscale centrali)"
}

main "$@"
