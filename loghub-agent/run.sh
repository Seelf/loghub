#!/bin/bash
# loghub agent jako dodatek Home Assistant: Vector czyta dziennik HAOS (Home Assistant, dodatki, system)
# i co ok. 20 s rekord stanu, a potem wysyla wszystko do centrali.
set -euo pipefail
O=/data/options.json
HUB="$(jq -r '.hub // ""' "$O" | sed 's:/*$::')"
TOKEN="$(jq -r '.token // ""' "$O")"
NAME="$(jq -r '.name // "haos"' "$O")"
if [ -z "$HUB" ] || [ -z "$TOKEN" ]; then
  echo "Ustaw w konfiguracji dodatku adres centrali (hub, np. http://192.168.0.116:8080) i token." >&2
  sleep 600; exit 1
fi
printf '%s' "$NAME" | grep -Eq '^[A-Za-z0-9._-]+$' || { echo "Nazwa zawiera niedozwolone znaki: $NAME" >&2; exit 1; }
mkdir -p /data/vector /etc/vector

cat > /etc/vector/vector.yaml <<EOF
data_dir: /data/vector
sources:
  journal:
    type: journald
    journal_directory: /var/log/journal
  status:
    type: exec
    mode: streaming
    command: ["/status.sh"]
    streaming:
      respawn_on_exit: true
transforms:
  t_journal:
    type: remap
    inputs: [journal]
    source: |
      cn = string(.CONTAINER_NAME) ?? ""
      msg = string(.message) ?? ""
      msg = replace(msg, r'\x1b\[[0-9;]*[A-Za-z]', "")
      lvl = string(.PRIORITY) ?? ""
      src = "journald"
      unit = string(._SYSTEMD_UNIT) ?? string(.SYSLOG_IDENTIFIER) ?? "kernel"
      if cn != "" {
        src = "docker"
        unit = cn
        lvl = ""
        p, e = parse_regex(msg, r'^(?:\[[^\]]*\]\s+|\S+\s+\S+\s+)?(?P<l>CRITICAL|FATAL|ERROR|WARNING|WARN|INFO|DEBUG)\b')
        if e == null {
          l = string!(p.l)
          lvl = if l == "ERROR" || l == "CRITICAL" || l == "FATAL" { "3" } else if l == "WARNING" || l == "WARN" { "4" } else if l == "INFO" { "6" } else { "7" }
        }
      }
      out = {"host": "$NAME", "source": src, "unit": unit, "level": lvl, "message": msg, "timestamp": .timestamp}
      . = out
  t_status:
    type: remap
    inputs: [status]
    source: |
      r, err = parse_json(string(.message) ?? "")
      if err != null || !is_object(r) { abort }
      o = object!(r)
      if is_array(o.containers) { o.containers = encode_json(o.containers) }
      if is_array(o.disks) { o.disks = encode_json(o.disks) }
      o.host = "$NAME"
      o.timestamp = now()
      . = o
sinks:
  hub:
    type: http
    inputs: [t_journal, t_status]
    uri: "$HUB/insert/jsonline?_stream_fields=host,source,unit&_msg_field=message&_time_field=timestamp"
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

echo "loghub agent: wysylam do $HUB jako $NAME"
exec vector --config /etc/vector/vector.yaml
