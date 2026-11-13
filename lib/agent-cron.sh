# loghub: podglad zadan cron na agencie.
# Debianowy cron z opcja "-L 15" zapisuje start, koniec i kod wyjscia kazdego zadania.
# Usluga loghub-cron (agent/cron/cron-watch.sh) sklada te wpisy w jeden rekord na uruchomienie (JSON do journald),
# a co jakis czas wypisuje tez liste wszystkich zadan (polecenie "loghub cron-scan").

# Kopiuje skrypty z agent/cron do $CRON_LIB i usluge systemd.
write_cron_files() {
  local src="$LOGHUB_SRC/agent/cron"
  mkdir -p "$CRON_LIB"
  install -m 644 "$src/cron.awk" "$CRON_LIB/cron.awk"
  install -m 644 "$src/scan.awk" "$CRON_LIB/scan.awk"
  install -m 755 "$src/cron-watch.sh" "$CRON_LIB/cron-watch.sh"
  install -m 644 "$src/loghub-cron.service" /etc/systemd/system/loghub-cron.service
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
