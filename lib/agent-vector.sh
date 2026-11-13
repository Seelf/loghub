# loghub: konfiguracja Vectora, ktory na kazdej maszynie zbiera logi i wysyla je do centrali.
#
# Zrodla: dziennik systemd, pliki z /var/log (i z --logs), logi TeamSpeak 3, kontenery Dockera.
# Kazde zrodlo ma swoj program VRL w agent/vector/*.vrl, ktory zamienia wpis na rekord loghub:
#   {"host", "source", "unit", "level", "message", "timestamp"}
# W plikach .vrl napis @HOST@ zastepuje nazwa tej maszyny.

VRL_DIR() { echo "$LOGHUB_SRC/agent/vector"; }

# Vector dziala jako uzytkownik "vector". Zdolnosc CAP_DAC_READ_SEARCH pozwala mu czytac kazdy plik logu
# (np. tylko dla roota: letsencrypt, dbconfig-common, katalog domowy TeamSpeaka), ale niczego nie zapisuje ani nie zmienia.
setup_vector_access() {
  mkdir -p /etc/systemd/system/vector.service.d
  install -m 644 "$(VRL_DIR)/vector-access.conf" /etc/systemd/system/vector.service.d/loghub.conf
  systemctl daemon-reload
}

# Aktywne katalogi z logami TeamSpeak 3 (pliki zmieniane w ostatnich 30 dniach; stare kopie pomijamy).
find_ts3_dirs() {
  { find /opt /srv /home /root /usr/local /var/lib -xdev -maxdepth 6 -type f -name 'ts3server_*.log' -mtime -30 -printf '%h\n' 2>/dev/null || true; } | sort -u
}

# Vector dziala jako uzytkownik "vector"; katalogi z logami spoza /var/log (np. TeamSpeak w /home/ts3) trzeba mu udostepnic do odczytu.
grant_log_access() {
  local dirs="$TS3_DIRS" d p
  local IFS=','
  for p in $EXTRA_LOGS; do [ -n "$p" ] && dirs="$dirs"$'\n'"$(dirname "$p")"; done
  unset IFS
  dirs="$(printf '%s\n' "$dirs" | sed '/^$/d' | sort -u)"
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

# Wypisuje program VRL z pliku z wcieciem dla YAML i nazwa maszyny w miejscu @HOST@.
# Linie komentarza z poczatku wiersza (#) zostaja tylko w pliku .vrl, do konfiguracji nie trafiaja.
vrl() {
  sed -e '/^#/d' -e "s/@HOST@/$NAME/g" -e 's/^/      /' "$(VRL_DIR)/$1"
}

# Wypisuje jedna transformacje "remap": nazwa, zrodlo wejsciowe i program VRL.
remap() {
  local name="$1" input="$2"
  shift 2
  printf '  %s:\n    type: remap\n    inputs: [%s]\n    source: |\n' "$name" "$input"
  local f
  for f in "$@"; do vrl "$f"; done
}

# Zrodla logow (sekcja "sources").
vector_sources() {
  local p d
  if have journalctl; then
    printf '  journal:\n    type: journald\n'
  fi
  printf '  files:\n    type: file\n    read_from: end\n    include:\n      - /var/log/**/*.log\n'
  local IFS=','
  for p in $EXTRA_LOGS; do
    [ -n "$p" ] && echo "      - \"$p\""
  done
  unset IFS
  printf '    exclude:\n      - /var/log/journal/**\n'
  # TeamSpeak 3: osobne zrodlo czytane od poczatku biezacych plikow (do 2 lat wstecz), z czasem z linii logu
  if [ -n "$TS3_DIRS" ]; then
    printf '  ts3:\n    type: file\n    read_from: beginning\n    ignore_older_secs: 63072000\n    include:\n'
    while read -r d; do echo "      - \"$d/ts3server_*.log\""; done <<< "$TS3_DIRS"
  fi
  if [ -S /var/run/docker.sock ]; then
    printf '  docker:\n    type: docker_logs\n'
  fi
}

# Wysylka do centrali (sekcja "sinks"); bufor na dysku trzyma logi, gdy centrala nie odpowiada.
vector_sink() {
  local inputs="$1"
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
}

# Sklada /etc/vector/vector.yaml. Uzywa zmiennych: NAME, HUB, TOKEN, EXTRA_LOGS, TS3_DIRS,
# JSON_VRL (1 = rozbior rekordow crona i stanu) i TS3_PARSE (1 = rozbior linii TeamSpeaka).
write_vector_config() {
  local cfg=/etc/vector/vector.yaml inputs=""
  mkdir -p /etc/vector /var/lib/vector
  {
    echo "# wygenerowane przez loghub - nie edytuj recznie, uruchom skrypt ponownie"
    echo "data_dir: /var/lib/vector"
    echo "sources:"
    vector_sources

    echo "transforms:"
    if have journalctl; then
      inputs="t_journal"
      if [ "$JSON_VRL" = 1 ]; then
        remap t_journal journal journal.vrl journal-json.vrl
      else
        remap t_journal journal journal.vrl
      fi
      echo "      . = out"
    fi
    if [ -n "$TS3_DIRS" ]; then
      inputs="${inputs:+$inputs, }t_ts3"
      if [ "$TS3_PARSE" = 1 ]; then remap t_ts3 ts3 ts3.vrl; else remap t_ts3 ts3 ts3-plain.vrl; fi
    fi
    inputs="${inputs:+$inputs, }t_files"
    remap t_files files files.vrl
    if [ -S /var/run/docker.sock ]; then
      inputs="$inputs, t_docker"
      remap t_docker docker docker.vrl
    fi

    vector_sink "$inputs"
  } > "$cfg"
  chown root:vector "$cfg" 2>/dev/null || true
  chmod 640 "$cfg"
}
