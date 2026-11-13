# loghub: na Proxmoxie agent instaluje sie tez w kazdym dzialajacym kontenerze LXC i w maszynach wirtualnych.
# Wylacza to opcja --no-lxc (dotyczy obu).

# Kontenery LXC: kopia skryptow loghub trafia do kontenera (pct push) i tam uruchamia sie instalacja agenta.
fan_out_lxc() {
  have pct || return 0
  [ "$DO_LXC" = 1 ] || return 0
  local id pack=/tmp/loghub-src.tgz
  tar czf "$pack" -C "$(dirname "$SRC_DIR")" "$(basename "$SRC_DIR")"
  for id in $(pct list 2>/dev/null | awk 'NR>1 && $2=="running" {print $1}'); do
    say "LXC $id"
    if ! pct exec "$id" -- sh -c 'command -v apt-get' >/dev/null 2>&1 </dev/null; then
      warn "LXC $id: brak apt (np. Alpine) - pomijam"
      continue
    fi
    pct push "$id" "$pack" "$pack" </dev/null >/dev/null
    pct exec "$id" -- sh -c "rm -rf /tmp/loghub-src && mkdir /tmp/loghub-src && tar xzf $pack -C /tmp/loghub-src && rm -f $pack" </dev/null
    pct exec "$id" -- bash /tmp/loghub-src/loghub/install.sh agent --hub "$HUB_LAN" --token "$TOKEN" \
      --no-lxc --no-tailscale $( [ "$DO_CRON" = 1 ] || echo --no-cron ) $( [ "$DO_STATUS" = 1 ] || echo --no-status ) </dev/null || warn "LXC $id: instalacja nieudana"
    pct exec "$id" -- rm -rf /tmp/loghub-src </dev/null || true
  done
  rm -f "$pack"
  local stopped
  stopped="$(pct list 2>/dev/null | awk 'NR>1 && $2!="running" {printf "%s ", $1}')"
  [ -n "$stopped" ] && warn "Zatrzymane LXC pominiete: $stopped(uruchom skrypt ponownie po ich starcie)"
  return 0
}

# Maszyny wirtualne: instalacja przez qemu-guest-agent (qm guest exec), bez SSH.
# Home Assistant OS nie ma powloki - tam dziala dodatek "loghub agent" (katalog loghub-agent w repo).
fan_out_vm() {
  have qm || return 0
  [ "$DO_LXC" = 1 ] || return 0
  local id name os out flags=""
  [ "$DO_CRON" = 1 ] || flags="$flags --no-cron"
  [ "$DO_STATUS" = 1 ] || flags="$flags --no-status"
  for id in $(qm list 2>/dev/null | awk 'NR>1 && $3=="running" {print $1}'); do
    name="$(qm config "$id" 2>/dev/null | awk -F': ' '$1=="name"{print $2}')"
    if ! timeout 15 qm agent "$id" ping >/dev/null 2>&1 </dev/null; then
      warn "VM $id ($name): brak qemu-guest-agent. Wlacz go (Opcje VM -> QEMU Guest Agent, w srodku: apt install qemu-guest-agent) albo uruchom w VM:"
      echo "    curl -fsSL $REPO_RAW/install.sh | sudo bash -s -- agent --hub $HUB_LAN --token $TOKEN --name $name --no-tailscale"
      continue
    fi
    os="$(timeout 15 qm guest cmd "$id" get-osinfo 2>/dev/null </dev/null | tr -d '\n')"
    if printf '%s' "$os" | grep -qiE '"id" *: *"(haos|hassos)"|Home Assistant'; then
      say "VM $id ($name): Home Assistant OS - tu zainstaluj dodatek loghub agent:"
      echo "    Ustawienia -> Dodatki -> Sklep -> menu (trzy kropki) -> Repozytoria -> dodaj https://github.com/$REPO"
      echo "    potem zainstaluj 'loghub agent' i ustaw: hub $HUB_LAN, token $TOKEN, name $name"
      continue
    fi
    out="$(timeout 30 qm guest exec "$id" --timeout 20 -- sh -c 'command -v apt-get' 2>/dev/null </dev/null || true)"
    if ! printf '%s' "$out" | grep -qE '"exitcode" *: *0'; then
      warn "VM $id ($name): system bez apt - pomijam (uruchom agenta recznie, jesli to Linux)"
      continue
    fi
    say "VM $id ($name)"
    out="$(timeout 1000 qm guest exec "$id" --timeout 900 -- bash -c "command -v curl >/dev/null || { apt-get update -qq && apt-get install -y -qq curl ca-certificates; }; curl -fsSL '$REPO_RAW/install.sh' | bash -s -- agent --hub '$HUB_LAN' --token '$TOKEN' --name '$name' --no-lxc --no-tailscale$flags" 2>&1 </dev/null || true)"
    if printf '%s' "$out" | grep -qE '"exitcode" *: *0'; then
      say "VM $id ($name): agent zainstalowany"
    else
      warn "VM $id ($name): instalacja nieudana. Koncowka wyniku:"
      printf '%s\n' "$out" | tail -c 800 | sed 's/^/    /'
    fi
  done
  local stopped
  stopped="$(qm list 2>/dev/null | awk 'NR>1 && $3!="running" {printf "%s(%s) ", $1, $2}')"
  [ -n "$stopped" ] && warn "Zatrzymane VM pominiete: $stopped"
  return 0
}
