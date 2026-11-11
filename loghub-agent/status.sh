#!/bin/bash
# loghub (dodatek HA): jeden rekord JSON co ok. 20 s - CPU, RAM, dysk danych HAOS, stan Home Assistant i dodatkow
cpu_sample() { awk '/^cpu /{print $2+$3+$4+$7+$8+$9, $5+$6; exit}' /proc/stat; }
API=http://supervisor
AUTH="Authorization: Bearer ${SUPERVISOR_TOKEN:-}"
read -r pb pi < <(cpu_sample)
sleep 5
while :; do
  read -r b i < <(cpu_sample)
  cpu=$(awk -v b=$((b-pb)) -v i=$((i-pi)) 'BEGIN{t=b+i; printf "%.1f", (t>0 ? b*100/t : 0)}')
  pb=$b; pi=$i
  read -r mt ma < <(awk '/^MemTotal:/{t=$2} /^MemAvailable:/{a=$2} END{print t+0, a+0}' /proc/meminfo)
  mem=$(awk -v t="$mt" -v a="$ma" 'BEGIN{printf "%.1f", (t>0 ? (t-a)*100/t : 0)}')
  read -r fs du dt dp < <(df -PkT /data | awk 'NR==2{sub(/%/,"",$6); print $2, $4, $3, $6}')
  read -r l1 l5 _ < /proc/loadavg
  up=$(awk '{printf "%d", $1}' /proc/uptime)
  cores=$(nproc 2>/dev/null || echo 1)
  # Home Assistant (kontener homeassistant) i dodatki (kontenery addon_<slug>) jako lista kontenerow
  if curl -fsS -m 5 -H "$AUTH" "$API/core/api/" >/dev/null 2>&1; then
    core='{"n":"homeassistant","s":"running","st":"Up"}'
  else
    core='{"n":"homeassistant","s":"exited","st":"Exited (1) - Home Assistant nie odpowiada"}'
  fi
  addons=$(curl -fsS -m 10 -H "$AUTH" "$API/addons" 2>/dev/null | jq -c '[.data.addons[]? | {
      n: ("addon_" + .slug),
      s: (if .state == "started" or .state == "startup" then "running" else "exited" end),
      st: (if .state == "started" then "Up" elif .state == "startup" then "Up (starting)" elif .state == "error" then "Exited (1) - błąd" else "Exited (0)" end)}]' 2>/dev/null)
  [ -n "$addons" ] || addons='[]'
  jq -cn \
    --argjson cpu "$cpu" --argjson mem "$mem" --argjson mt "${mt:-0}" --argjson ma "${ma:-0}" \
    --argjson dp "${dp:-0}" --argjson du "${du:-0}" --argjson dt "${dt:-0}" --arg fs "${fs:-ext4}" \
    --argjson l1 "${l1:-0}" --argjson l5 "${l5:-0}" --argjson cores "$cores" --argjson up "$up" \
    --argjson core "$core" --argjson addons "$addons" \
    '{source:"stat", unit:"host", level:"6",
      message:("CPU \($cpu)% · RAM \($mem)% · dysk \($dp)% · obciążenie \($l1)"),
      cpu:$cpu, mem_pct:$mem, mem_total_kb:$mt, mem_avail_kb:$ma, disk_pct:$dp, disk_used_kb:$du, disk_total_kb:$dt,
      load1:$l1, load5:$l5, cores:$cores, uptime_s:$up,
      containers:([$core] + $addons), disks:[["/data", $fs, "dane HAOS", $du, $dt]]}' \
    || echo '{"source":"stat","unit":"host","level":"6","message":"blad skryptu stanu"}'
  sleep 15
done
