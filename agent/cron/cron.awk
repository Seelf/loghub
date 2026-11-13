# wejscie: komunikaty crona (cron -L 15); wyjscie: jeden JSON na zakonczone uruchomienie
function esc(s) { gsub(/\\/, "\\\\", s); gsub(/"/, "\\\"", s); gsub(/[[:cntrl:]]/, " ", s); return s }
function emit(pid, cmd, user,   d, state, lvl, code, msg, unit) {
  d = (pid in t0) ? systime() - t0[pid] : -1
  if (pid in sig)     { state = "signal"; lvl = 3; code = 128 + sig[pid]; msg = "PRZERWANE sygnałem " sig[pid] }
  else if (pid in rc) { state = "fail";   lvl = 3; code = rc[pid];       msg = "BŁĄD kod " rc[pid] }
  else                { state = "ok";     lvl = 6; code = 0;             msg = "OK" }
  if (d >= 0) msg = msg " · " d " s"
  unit = (user == "root" ? "" : user ": ") substr(cmd, 1, 80)
  printf "{\"source\":\"cron\",\"unit\":\"%s\",\"level\":\"%d\",\"message\":\"%s\",\"cron_state\":\"%s\",\"exit_code\":%d,", esc(unit), lvl, esc(msg " · " cmd), state, code
  if (d >= 0) printf "\"duration_s\":%d,", d
  printf "\"cron_user\":\"%s\",\"cron_cmd\":\"%s\",\"cron_pid\":%d}\n", esc(user), esc(cmd), pid
  fflush()
  delete t0[pid]; delete rc[pid]; delete sig[pid]
}
{
  line = $0
  if (match(line, /^\([^)]*\) (CMD|END) \(\[[0-9]+\] /)) {
    head = substr(line, 1, RLENGTH); cmd = substr(line, RLENGTH + 1); sub(/\)$/, "", cmd)
    user = head; sub(/^\(/, "", user); sub(/\).*/, "", user)
    pid = head; sub(/^.*\(\[/, "", pid); sub(/\].*/, "", pid)
    if (head ~ /\) CMD \(/) t0[pid] = systime(); else emit(pid, cmd, user)
  } else if (match(line, /grandchild #[0-9]+ failed with exit status [0-9]+/)) {
    s = substr(line, RSTART, RLENGTH); pid = s; sub(/^grandchild #/, "", pid); sub(/ .*/, "", pid)
    sub(/.* /, "", s); rc[pid] = s + 0
  } else if (match(line, /grandchild #[0-9]+ terminated by signal [0-9]+/)) {
    s = substr(line, RSTART, RLENGTH); pid = s; sub(/^grandchild #/, "", pid); sub(/ .*/, "", pid)
    sub(/.* /, "", s); sig[pid] = s + 0
  }
}
