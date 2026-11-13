# wypisuje zadania z jednego pliku crontab jako JSON; sys=1: format systemowy (z kolumna uzytkownika)
function esc(s) { gsub(/\\/, "\\\\", s); gsub(/"/, "\\\"", s); gsub(/[[:cntrl:]]/, " ", s); return s }
function word(   w) { if (!match(line, /^[^ \t]+[ \t]+/)) return ""; w = substr(line, 1, RLENGTH); line = substr(line, RLENGTH + 1); sub(/[ \t]+$/, "", w); return w }
/^[ \t]*(#|$)/ { next }
/^[ \t]*[A-Za-z_][A-Za-z0-9_]*[ \t]*=/ { next }
{
  line = $0; sub(/^[ \t]+/, "", line); sub(/[ \t]+$/, "", line)
  n = (line ~ /^@/) ? 1 : 5; sched = ""
  for (i = 1; i <= n; i++) { w = word(); if (w == "") next; sched = sched (i > 1 ? " " : "") w }
  if (sys) { user = word(); if (user == "") next } else user = owner
  if (line == "") next
  unit = (user == "root" ? "" : user ": ") substr(line, 1, 80)
  printf "{\"source\":\"crondef\",\"unit\":\"%s\",\"level\":\"6\",\"message\":\"harmonogram %s · %s · %s\",\"cron_sched\":\"%s\",\"cron_user\":\"%s\",\"cron_cmd\":\"%s\",\"cron_file\":\"%s\",\"cron_scan\":%d}\n", esc(unit), esc(sched), esc(user), esc(file), esc(sched), esc(user), esc(line), esc(file), scan
}
