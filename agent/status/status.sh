#!/bin/bash
# loghub: jeden rekord JSON co ok. 20 s ze stanem i zuzyciem zasobow tej maszyny (wyjscie trafia do journald)
cpu_sample() { awk '/^cpu /{print $2+$3+$4+$7+$8+$9, $5+$6; exit}' /proc/stat; }
read -r pb pi < <(cpu_sample)
sleep 5
while :; do
  read -r b i < <(cpu_sample)
  cpu=$(awk -v b=$((b-pb)) -v i=$((i-pi)) 'BEGIN{t=b+i; printf "%.1f", (t>0 ? b*100/t : 0)}')
  pb=$b; pi=$i
  read -r mt ma < <(awk '/^MemTotal:/{t=$2} /^MemAvailable:/{a=$2} END{print t, a}' /proc/meminfo)
  mem=$(awk -v t="$mt" -v a="$ma" 'BEGIN{printf "%.1f", (t>0 ? (t-a)*100/t : 0)}')
  read -r du dt dp < <(df -Pk / | awk 'NR==2{sub(/%/,"",$5); print $3, $2, $5}')
  read -r l1 l5 _ < /proc/loadavg
  up=$(awk '{printf "%d", $1}' /proc/uptime)
  cores=$(nproc 2>/dev/null || echo 1)
  extra=""
  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    ps=$(timeout 20 docker ps -a --format '{"n":{{json .Names}},"s":{{json .State}},"st":{{json .Status}}}' 2>/dev/null | paste -sd, -)
    st=$(timeout 30 docker stats --no-stream --format '{"n":{{json .Name}},"cpu":{{json .CPUPerc}},"mem":{{json .MemUsage}},"memp":{{json .MemPerc}}}' 2>/dev/null | paste -sd, -)
    extra="$extra,\"containers\":[${ps}],\"cstats\":[${st}]"
  fi
  if command -v systemctl >/dev/null 2>&1; then
    # tylko uslugi aktywne, uruchamiane albo padniete; brak na liscie = nieaktywna bez bledu
    un=$(systemctl list-units --type=service --all --no-legend --plain --no-pager 2>/dev/null | awk '
      { i = ($1 ~ /\./) ? 1 : 2; u = $i; l = $(i+1); a = $(i+2); s = $(i+3)
        gsub(/\\/, "\\\\", u)   # nazwy jak systemd-fsck@dev-disk-by\x2duuid: ukosnik musi byc podwojony w JSON
        if (l == "loaded" && a != "inactive") printf "%s[\"%s\",\"%s\",\"%s\"]", (n++ ? "," : ""), u, a, s }')
    extra="$extra,\"units\":[${un}]"
  fi
  # wszystkie zamontowane systemy plikow (dyski, USB, udzialy sieciowe), bez wewnetrznych zbiorow Dockera i Proxmoxa
  dk=$(timeout 10 df -PkT 2>/dev/null | awk '
    function esc(x) { gsub(/\\/, "\\\\", x); gsub(/"/, "\\\"", x); return x }
    NR > 1 && $2 ~ /^(ext[234]|xfs|btrfs|zfs|vfat|exfat|ntfs|ntfs3|fuseblk|nfs|nfs4|cifs|smb3|fuse\.sshfs|f2fs)$/ && $3 > 0 {
      m = $7; for (i = 8; i <= NF; i++) m = m " " $i
      if (m ~ /^\/(var\/lib\/docker|run|snap|proc|sys|dev)(\/|$)/) next
      if ($1 ~ /subvol-[0-9]+-disk|vm-[0-9]+-disk|basevol-/) next
      if ($2 == "vfat" && $3 < 4194304) next
      k = $1 "|" $3; if (k in seen) next; seen[k] = 1
      printf "%s[\"%s\",\"%s\",\"%s\",%d,%d]", (n++ ? "," : ""), esc(m), $2, esc($1), $4, $3 }')
  extra="$extra,\"disks\":[${dk}]"
  if command -v zpool >/dev/null 2>&1; then
    zp=$(timeout 10 zpool list -Hp -o name,size,alloc,health 2>/dev/null | awk '{printf "%s[\"%s\",%s,%s,\"%s\"]", (n++ ? "," : ""), $1, $2, $3, $4}')
    extra="$extra,\"pools\":[${zp}]"
  fi
  # stan dyskow fizycznych (SMART) co 10 minut; dziala tam, gdzie jest smartctl i dostep do dyskow (host, nie LXC)
  if command -v smartctl >/dev/null 2>&1 && [ $(( $(date +%s) - ${smt:-0} )) -ge 600 ]; then
    smt=$(date +%s); sm=""
    for d in $(lsblk -dnpo NAME,TYPE 2>/dev/null | awk '$2=="disk" && $1 !~ /zd|rbd|nbd|loop/ {print $1}'); do
      out=$(timeout 25 smartctl -H -i -A "$d" 2>/dev/null)
      echo "$out" | grep -qE 'overall-health|SMART Health Status' || out=$(timeout 25 smartctl -d sat -H -i -A "$d" 2>/dev/null)
      model=$(echo "$out" | sed -n -E 's/^(Device Model|Model Number|Product):[[:space:]]*//p' | head -1 | tr -d '"\\')
      health=$(echo "$out" | sed -n -E 's/.*overall-health self-assessment test result:[[:space:]]*//p; s/^SMART Health Status:[[:space:]]*//p' | head -1 | tr -d '"\\')
      temp=$(echo "$out" | awk '/Temperature_Celsius|Airflow_Temperature_Cel/ {print $10+0; exit} /^Temperature:/ {print $2+0; exit}')
      hours=$(echo "$out" | awk '/Power_On_Hours/ {print $10+0; exit} /^Power On Hours:/ {gsub(",", "", $4); print $4+0; exit}')
      realloc=$(echo "$out" | awk '/Reallocated_Sector_Ct/ {print $10+0; exit}')
      pend=$(echo "$out" | awk '/Current_Pending_Sector/ {print $10+0; exit}')
      size=$(lsblk -dnbo SIZE "$d" 2>/dev/null | head -1)
      tran=$(lsblk -dno TRAN "$d" 2>/dev/null | head -1)
      sm="${sm:+$sm,}[\"$d\",\"$model\",${size:-0},\"$health\",${temp:-null},${hours:-null},${realloc:-null},${pend:-null},\"$tran\"]"
    done
  fi
  [ -n "${smt:-}" ] && extra="$extra,\"smart\":[${sm}]"
  # nasluchujace porty TCP i UDP z nazwa procesu
  if command -v ss >/dev/null 2>&1; then
    po=$(ss -Hlntup 2>/dev/null | awk '
      { l = $5; i = match(l, /:[0-9]+$/); if (!i) next
        port = substr(l, i + 1); a = substr(l, 1, i - 1); gsub(/^\[|\]$/, "", a); sub(/%.*/, "", a)
        pr = ""; if (match($0, /users:\(\("[^"]+"/)) pr = substr($0, RSTART + 9, RLENGTH - 10)
        k = $1 "|" a "|" port; if (k in s) next; s[k] = 1
        printf "%s[\"%s\",\"%s\",%d,\"%s\"]", (n++ ? "," : ""), $1, a, port, pr }')
    extra="$extra,\"ports\":[${po}]"
  fi
  # zapora ufw: stan i reguly ALLOW otwarte dla calego swiata (From = Anywhere)
  if command -v ufw >/dev/null 2>&1; then
    uo=$(timeout 10 ufw status 2>/dev/null)
    if echo "$uo" | grep -q '^Status: active'; then
      ur=$(echo "$uo" | awk '
        /^--/ { t = 1; next }
        t && NF {
          line = $0; gsub(/ \(v6\)/, "", line)
          if (match(line, /[ \t]+(ALLOW|LIMIT)( IN)?[ \t]+/)) {
            to = substr(line, 1, RSTART - 1); from = substr(line, RSTART + RLENGTH)
            gsub(/^[ \t]+|[ \t]+$/, "", to); gsub(/^[ \t]+|[ \t]+$/, "", from); gsub(/"/, "", to)
            if (from ~ /^Anywhere/ && to !~ / on tailscale/ && !(to in seen)) { seen[to] = 1; printf "%s\"%s\"", (n++ ? "," : ""), to }
          }
        }')
      extra="$extra,\"ufw_state\":\"active\",\"ufw\":[${ur}]"
    else
      extra="$extra,\"ufw_state\":\"inactive\",\"ufw\":[]"
    fi
  fi
  if command -v pvesh >/dev/null 2>&1; then
    g=$(timeout 20 pvesh get /cluster/resources --type vm --output-format json 2>/dev/null)
    case "$g" in \[*) extra="$extra,\"guests\":$g" ;; esac
  fi
  printf '{"source":"stat","unit":"host","level":"6","message":"CPU %s%% · RAM %s%% · dysk %s%% · obciążenie %s","cpu":%s,"mem_pct":%s,"mem_total_kb":%s,"mem_avail_kb":%s,"disk_pct":%s,"disk_used_kb":%s,"disk_total_kb":%s,"load1":%s,"load5":%s,"cores":%s,"uptime_s":%s%s}\n' \
    "$cpu" "$mem" "$dp" "$l1" "$cpu" "$mem" "${mt:-0}" "${ma:-0}" "${dp:-0}" "${du:-0}" "${dt:-0}" "$l1" "$l5" "$cores" "$up" "$extra"
  sleep 15   # razem z pomiarem (5 s) wychodzi rekord co ok. 20 s
done
