# loghub: centrala (polecenia "hub", "user", "public").
# Centrala to kilka kontenerow Dockera w $HUB_DIR: baza logow VictoriaLogs, usluga logowania (auth),
# powiadomienia (notify) i Caddy, ktory serwuje strone i przyjmuje logi od agentow.

# Kopiuje pliki centrali z repozytorium do $HUB_DIR. Uslugi czytaja je z dysku, wiec po kopiowaniu
# wystarczy restart kontenerow. Dane (baza, konta, ustawienia powiadomien) leza w innych katalogach i zostaja.
install_hub_files() {
  local src="$LOGHUB_SRC/hub"
  install -m 644 "$src/docker-compose.yml" "$HUB_DIR/docker-compose.yml"
  install -m 644 "$src/Caddyfile" "$HUB_DIR/Caddyfile"
  # strona: kopiowanie w miejsce starych plikow (katalog jest podmontowany do Caddy)
  cp -r "$src/www/." "$HUB_DIR/www/"
  install -m 644 "$src/status/index.html" "$HUB_DIR/status/index.html"
  cp -r "$src/auth/." "$HUB_DIR/auth/"
  cp -r "$src/notify/." "$HUB_DIR/notify/"
  find "$HUB_DIR/www" "$HUB_DIR/auth" "$HUB_DIR/notify" -type f -exec chmod 644 {} +
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

  mkdir -p "$HUB_DIR/data" "$HUB_DIR/www/status" "$HUB_DIR/auth" "$HUB_DIR/authdata" "$HUB_DIR/notify" "$HUB_DIR/notifydata" "$HUB_DIR/status"
  chmod 700 "$HUB_DIR/authdata" "$HUB_DIR/notifydata"
  if [ ! -f "$HUB_DIR/.env" ]; then
    printf 'INGEST_TOKEN=%s\nRETENTION=%s\nVL_TAG=latest\nPORT=%s\n' \
      "$(rand 24)" "$RETENTION" "$PORT" > "$HUB_DIR/.env"
  fi
  grep -q '^SESSION_SECRET=' "$HUB_DIR/.env" || printf 'SESSION_SECRET=%s\n' "$(rand 32)" >> "$HUB_DIR/.env"
  chmod 600 "$HUB_DIR/.env"
  # shellcheck disable=SC1091
  . "$HUB_DIR/.env"
  # adresy centrali do gotowych komend w panelu "Dodaj maszyne"
  local ts0 lan0
  ts0="$(tailscale ip -4 2>/dev/null | head -1 || true)"
  lan0="$(hostname -I 2>/dev/null | awk '{print $1}')"
  sed -i '/^HUB_LAN_URL=/d;/^HUB_TS_URL=/d;/^LOGHUB_REPO=/d' "$HUB_DIR/.env"
  printf 'HUB_LAN_URL=%s\nHUB_TS_URL=%s\nLOGHUB_REPO=%s\n' "${lan0:+http://$lan0:$PORT}" "${ts0:+http://$ts0:$PORT}" "$REPO" >> "$HUB_DIR/.env"
  chmod 600 "$HUB_DIR/.env"

  install_hub_files

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
  echo "  Status usług:  $hub_url/status/   (publicznie: Cloudflare Tunnel -> http://localhost:8082)"
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

