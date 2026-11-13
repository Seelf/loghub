# shellcheck shell=bash
# loghub: pomiar stanu i zasobow na agencie.
# Co ok. 20 s (agent/status/status.sh): CPU, RAM, dysk, obciazenie; stan kontenerow Dockera,
# uslug systemd i (na Proxmoxie) gosci LXC/VM. Wynik idzie jako JSON do journald, a stamtad przez Vectora do centrali.
# shellcheck disable=SC2034  # zmienne sa uzywane w innych plikach lib/ (wczytywane razem przez install.sh)

# Kopiuje skrypt pomiaru do $CRON_LIB i usluge systemd.
write_status_files() {
  mkdir -p "$CRON_LIB"
  install -m 755 "$LOGHUB_SRC/agent/status/status.sh" "$CRON_LIB/status.sh"
  install -m 644 "$LOGHUB_SRC/agent/status/loghub-status.service" /etc/systemd/system/loghub-status.service
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
