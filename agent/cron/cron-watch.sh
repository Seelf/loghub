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
