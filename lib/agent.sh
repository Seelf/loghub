# loghub: agent (polecenia "agent" i "uninstall-agent").
# Agent to Vector, ktory zbiera logi tej maszyny i wysyla je do centrali, plus dwie male uslugi:
# loghub-cron (wyniki zadan cron, lib/agent-cron.sh) i loghub-status (zasoby i stan uslug, lib/agent-status.sh).
# Konfiguracje Vectora sklada lib/agent-vector.sh, a na Proxmoxie lib/proxmox.sh instaluje agenta dalej w LXC i VM.

# Vector z oficjalnego repozytorium apt; uzytkownik "vector" dostaje grupy z dostepem do dziennika, logow i Dockera.
install_vector() {
  if ! have vector; then
    say "Instaluje Vector"
    bash -c "$(curl -fsSL https://setup.vector.dev)" </dev/null
    apt-get install -y -qq vector >/dev/null
  fi
  local g
  for g in systemd-journal adm docker; do
    if getent group "$g" >/dev/null; then usermod -aG "$g" vector; fi
  done
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

  install_vector

  setup_cron
  setup_status
  TS3_DIRS="$(find_ts3_dirs)"
  TS3_PARSE=1
  [ -n "$TS3_DIRS" ] && say "Logi TeamSpeak 3: $(echo "$TS3_DIRS" | paste -sd' ' -)"
  grant_log_access
  setup_vector_access
  write_vector_config
  # dodatki nie moga zablokowac zbierania zwyklych logow: przy bledzie wylaczamy je po kolei
  if [ -n "$TS3_DIRS" ] && ! vector validate --no-environment /etc/vector/vector.yaml >/dev/null 2>&1; then
    warn "$NAME: konfiguracja z rozbiorem logow TeamSpeak nie przeszla walidacji - zbieram je bez rozbioru"
    TS3_PARSE=0
    write_vector_config
  fi
  if [ "$JSON_VRL" = 1 ] && ! vector validate --no-environment /etc/vector/vector.yaml >/dev/null 2>&1; then
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
  fan_out_vm
}

cmd_uninstall_agent() {
  need_root
  systemctl disable --now vector >/dev/null 2>&1 || true
  apt-get remove -y -qq vector >/dev/null 2>&1 || true
  rm -rf /etc/vector/vector.yaml /var/lib/vector /etc/systemd/system/vector.service.d/loghub.conf
  systemctl disable --now loghub-cron loghub-status >/dev/null 2>&1 || true
  rm -rf /etc/systemd/system/loghub-cron.service /etc/systemd/system/loghub-status.service "$CRON_LIB"
  if [ -f /etc/default/cron ] && grep -q '^# loghub$' /etc/default/cron; then
    sed -i '/^# loghub$/,+1d' /etc/default/cron
    systemctl restart cron >/dev/null 2>&1 || true
  fi
  say "Agent usuniety (Tailscale zostaje)."
}
