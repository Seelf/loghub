#!/usr/bin/env python3
"""loghub notify - sprawdza stan maszyn co minute i wysyla powiadomienia.

Tylko biblioteka standardowa Pythona. Czyta VictoriaLogs (rekordy agentow), trzyma liste
aktywnych alertow i historie, wysyla na kanaly: ntfy, Telegram, Discord, webhook, e-mail.

API (za forward_auth w Caddy; naglowek X-Role ustawia usluga logowania):
  GET  /api/notify/state    aktywne alerty i historia (kazdy zalogowany)
  GET  /api/notify/config   ustawienia (tylko admin)
  PUT  /api/notify/config   zapis ustawien (tylko admin)
  POST /api/notify/test     wiadomosc testowa na wszystkie wlaczone kanaly (tylko admin)
"""
import copy
import json
import os
import smtplib
import ssl
import sys
import threading
import time
import urllib.parse
import urllib.request
from email.message import EmailMessage
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DATA = os.environ.get("LOGHUB_DATA", "/data")
VL = os.environ.get("VL_URL", "http://victorialogs:9428").rstrip("/")
PUBLIC_URL = os.environ.get("PUBLIC_URL", "")
CONFIG = os.path.join(DATA, "notify.json")
STATE = os.path.join(DATA, "alerts.json")
EVERY = int(os.environ.get("CHECK_EVERY", "60"))
EXCL = "NOT source:=stat NOT source:=crondef NOT source:=cron"
ERR = '(level:<=3 OR (level:"" (i(error) OR i(err) OR i(fatal) OR i(panic) OR i(failed) OR i(critical))))'
SECRET_KEYS = ("token", "bot_token", "password")
MASK = "••••••"

DEFAULT = {
    "rules": {
        "host_offline": {"on": True, "minutes": 3},
        "service_down": {"on": True},
        "cron_failed": {"on": True},
        "disk": {"on": True, "pct": 90},
        "cpu": {"on": True, "pct": 90, "minutes": 10},
        "mem": {"on": True, "pct": 90, "minutes": 10},
        "errors": {"on": False, "count": 50, "minutes": 5},
    },
    "notify_resolved": True,
    "repeat_hours": 0,
    "channels": [],
}
CHANNEL_FIELDS = {
    "ntfy": ["url", "token"],
    "telegram": ["bot_token", "chat_id"],
    "discord": ["url"],
    "webhook": ["url"],
    "email": ["host", "port", "user", "password", "from", "to", "tls"],
}

LOCK = threading.Lock()
ST = {"active": {}, "history": [], "checked_at": 0, "error": "", "seen_cron": []}

# ------------------------------------------------------------------ pliki


def load_json(path, default):
    try:
        with open(path) as f:
            return json.load(f)
    except (FileNotFoundError, ValueError):
        return copy.deepcopy(default)


def save_json(path, obj):
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(obj, f, indent=1, ensure_ascii=False)
    os.chmod(tmp, 0o600)
    os.replace(tmp, path)


def config():
    c = load_json(CONFIG, DEFAULT)
    out = copy.deepcopy(DEFAULT)
    out.update({k: v for k, v in c.items() if k in DEFAULT and k != "rules"})
    for k, v in (c.get("rules") or {}).items():
        if k in out["rules"] and isinstance(v, dict):
            out["rules"][k].update(v)
    return out


# --------------------------------------------------------------- zapytania


def query(q, limit=None):
    data = {"query": q}
    if limit:
        data["limit"] = str(limit)
    req = urllib.request.Request(VL + "/select/logsql/query", data=urllib.parse.urlencode(data).encode())
    with urllib.request.urlopen(req, timeout=30) as r:
        rows = []
        for line in r.read().decode("utf-8", "replace").splitlines():
            line = line.strip()
            if line:
                try:
                    rows.append(json.loads(line))
                except ValueError:
                    pass
        return rows


def fnum(x):
    try:
        return float(str(x).replace(",", "."))
    except (TypeError, ValueError):
        return None


def jlist(x):
    if isinstance(x, list):
        return x
    try:
        v = json.loads(x or "[]")
        return v if isinstance(v, list) else []
    except (TypeError, ValueError):
        return []


def container_problem(c):
    s, st = c.get("s", ""), c.get("st", "")
    if s == "running" and "unhealthy" in st:
        return "nie przechodzi kontroli zdrowia"
    if s == "restarting":
        return "ciągle się restartuje"
    if s == "exited" and not st.startswith("Exited (0)"):
        return "padł: " + st
    return None


# ------------------------------------------------------------ sprawdzanie


def evaluate(cfg):
    """Zwraca (stany: klucz -> alert, zdarzenia: lista alertow jednorazowych)."""
    R, now = cfg["rules"], time.time()
    firing, events = {}, []

    def fire(key, kind, host, unit, title, detail, sev="error"):
        firing[key] = {"key": key, "kind": kind, "host": host, "unit": unit, "title": title, "detail": detail, "sev": sev}

    off = max(1, int(R["host_offline"].get("minutes", 3)))
    known = {o.get("host") for o in query('{source="stat"} _time:24h | stats by (host) count() c') if o.get("host")}
    latest = {}
    for o in query('{source="stat"} _time:%dm' % max(off, 5), 2000):
        h, t = o.get("host"), o.get("_time", "")
        if h and t > latest.get(h, {}).get("_time", ""):
            latest[h] = o

    if R["host_offline"]["on"]:
        cut = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(now - off * 60))
        for h in sorted(known):
            if h not in latest or latest[h].get("_time", "") < cut:
                fire("offline:" + h, "host_offline", h, "", h + ": brak kontaktu z agentem", "Brak pomiarów od ponad %d min." % off)

    for h, o in latest.items():
        if R["service_down"]["on"]:
            for c in jlist(o.get("containers")):
                p = container_problem(c)
                if p:
                    fire("ct:%s:%s" % (h, c.get("n")), "service_down", h, c.get("n", ""), "%s: kontener %s %s" % (h, c.get("n"), p.split(":")[0]), p)
            for u in jlist(o.get("units")):
                if isinstance(u, list) and len(u) > 1 and u[1] == "failed":
                    fire("unit:%s:%s" % (h, u[0]), "service_down", h, u[0], "%s: usługa %s padła" % (h, u[0]), "systemd: failed")
        if R["disk"]["on"]:
            d = fnum(o.get("disk_pct"))
            if d is not None and d >= R["disk"]["pct"]:
                fire("disk:" + h, "disk", h, "", "%s: dysk zajęty w %d%%" % (h, d), "Próg: %s%%." % R["disk"]["pct"], "warn")

    win = max(int(R["cpu"].get("minutes", 10)), int(R["mem"].get("minutes", 10)), 1)
    if R["cpu"]["on"] or R["mem"]["on"]:
        for o in query('{source="stat"} _time:%dm | stats by (host) avg(cpu) cpu, avg(mem_pct) mem' % win):
            h, cpu, mem = o.get("host"), fnum(o.get("cpu")), fnum(o.get("mem"))
            if not h or h not in latest:
                continue
            if R["cpu"]["on"] and cpu is not None and cpu >= R["cpu"]["pct"]:
                fire("cpu:" + h, "cpu", h, "", "%s: CPU %d%% (średnio %d min)" % (h, cpu, win), "Próg: %s%%." % R["cpu"]["pct"], "warn")
            if R["mem"]["on"] and mem is not None and mem >= R["mem"]["pct"]:
                fire("mem:" + h, "mem", h, "", "%s: RAM %d%% (średnio %d min)" % (h, mem, win), "Próg: %s%%." % R["mem"]["pct"], "warn")

    if R["errors"]["on"]:
        m = max(1, int(R["errors"].get("minutes", 5)))
        for o in query("%s %s _time:%dm | stats by (host, unit) count() c" % (EXCL, ERR, m)):
            c = fnum(o.get("c")) or 0
            if c >= R["errors"]["count"]:
                fire("err:%s:%s" % (o.get("host"), o.get("unit")), "errors", o.get("host", ""), o.get("unit", ""),
                     "%s: %d błędów w %s w ciągu %d min" % (o.get("host"), c, o.get("unit"), m), "Próg: %s." % R["errors"]["count"], "warn")

    if R["cron_failed"]["on"]:
        for o in query('{source="cron"} NOT cron_state:=ok _time:%ds' % (EVERY * 3), 200):
            k = "%s|%s|%s" % (o.get("host"), o.get("unit"), o.get("_time"))
            events.append({"key": "cron:" + k, "kind": "cron_failed", "host": o.get("host", ""), "unit": o.get("unit", ""),
                           "title": "%s: zadanie cron zakończone błędem (kod %s)" % (o.get("host"), o.get("exit_code", "?")),
                           "detail": o.get("cron_cmd") or o.get("unit", ""), "sev": "error", "at": o.get("_time", "")})
    return firing, events


def check_once():
    cfg = config()
    now = int(time.time())
    try:
        firing, events = evaluate(cfg)
        err = ""
    except Exception as e:  # baza chwilowo niedostepna: nie zmieniaj stanu alertow
        print("blad sprawdzania: %s" % e, flush=True)
        with LOCK:
            ST["error"] = "Nie udało się odczytać bazy logów: %s" % e
            ST["checked_at"] = now
        return
    send = []
    with LOCK:
        act = ST["active"]
        for k, a in firing.items():
            if k not in act:
                a.update(since=now, last_sent=now)
                act[k] = a
                send.append(("problem", a))
            else:
                act[k].update(title=a["title"], detail=a["detail"])
                rep = cfg.get("repeat_hours") or 0
                if rep and now - act[k].get("last_sent", now) >= rep * 3600:
                    act[k]["last_sent"] = now
                    send.append(("repeat", act[k]))
        for k in [k for k in act if k not in firing]:
            a = act.pop(k)
            a["until"] = now
            ST["history"].insert(0, a)
            if cfg.get("notify_resolved", True):
                send.append(("resolved", a))
        seen = set(ST["seen_cron"])
        for ev in events:
            if ev["key"] in seen:
                continue
            seen.add(ev["key"])
            ST["seen_cron"].append(ev["key"])
            ev.update(since=now, until=now)
            ST["history"].insert(0, ev)
            send.append(("event", ev))
        ST["seen_cron"] = ST["seen_cron"][-500:]
        ST["history"] = ST["history"][:300]
        ST["checked_at"], ST["error"] = now, err
        save_json(STATE, ST)
    for what, a in send:
        deliver(cfg, what, a)


# --------------------------------------------------------------- wysylka


def text_for(what, a):
    head = {"problem": "PROBLEM", "repeat": "NADAL PROBLEM", "resolved": "OK", "event": "BŁĄD", "test": "TEST"}[what]
    lines = ["[%s] %s" % (head, a["title"])]
    if a.get("detail"):
        lines.append(a["detail"])
    if what == "resolved" and a.get("since"):
        lines.append("Trwało %d min." % max(1, (a.get("until", time.time()) - a["since"]) // 60))
    if PUBLIC_URL:
        lines.append(PUBLIC_URL)
    return head, "\n".join(lines)


def post(url, body, headers, timeout=15):
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status


def send_channel(ch, what, a):
    head, text = text_for(what, a)
    t = ch.get("type")
    if t == "ntfy":
        h = {"Title": "loghub: " + head.replace("Ł", "L").replace("Ą", "A"), "Tags": "white_check_mark" if what == "resolved" else "warning",
             "Priority": "default" if what in ("resolved", "test") else "high", "Content-Type": "text/plain; charset=utf-8"}
        if ch.get("token"):
            h["Authorization"] = "Bearer " + ch["token"]
        post(ch["url"], text.encode(), h)
    elif t == "telegram":
        post("https://api.telegram.org/bot%s/sendMessage" % ch["bot_token"],
             json.dumps({"chat_id": ch["chat_id"], "text": text, "disable_web_page_preview": True}).encode(), {"Content-Type": "application/json"})
    elif t == "discord":
        post(ch["url"], json.dumps({"content": text[:1900]}).encode(), {"Content-Type": "application/json"})
    elif t == "webhook":
        post(ch["url"], json.dumps({"event": what, "alert": a, "text": text}, ensure_ascii=False).encode(), {"Content-Type": "application/json"})
    elif t == "email":
        m = EmailMessage()
        m["Subject"], m["From"], m["To"] = "loghub: " + text.splitlines()[0], ch.get("from") or ch.get("user"), ch["to"]
        m.set_content(text)
        port = int(ch.get("port") or 587)
        if port == 465:
            s = smtplib.SMTP_SSL(ch["host"], port, timeout=20, context=ssl.create_default_context())
        else:
            s = smtplib.SMTP(ch["host"], port, timeout=20)
            if str(ch.get("tls", "1")) not in ("0", "false", ""):
                s.starttls(context=ssl.create_default_context())
        with s:
            if ch.get("user"):
                s.login(ch["user"], ch.get("password", ""))
            s.send_message(m)
    else:
        raise ValueError("nieznany kanał: %s" % t)


def deliver(cfg, what, a):
    res = []
    for ch in cfg.get("channels", []):
        if not ch.get("on", True):
            continue
        name = ch.get("name") or ch.get("type")
        try:
            send_channel(ch, what, a)
            res.append({"channel": name, "ok": True})
        except Exception as e:
            print("wysylka %s nieudana: %s" % (name, e), flush=True)
            res.append({"channel": name, "ok": False, "error": str(e)[:200]})
    return res


def loop():
    time.sleep(20)
    while True:
        t0 = time.time()
        check_once()
        time.sleep(max(5, EVERY - (time.time() - t0)))


# --------------------------------------------------------------------- API


def masked(cfg):
    c = copy.deepcopy(cfg)
    for ch in c["channels"]:
        for k in SECRET_KEYS:
            if ch.get(k):
                ch[k] = MASK
    return c


def clean_config(new, old):
    """Sprawdza ustawienia z formularza; zamaskowane sekrety zostawia bez zmian."""
    if not isinstance(new, dict):
        raise ValueError("zły format")
    out = copy.deepcopy(DEFAULT)
    for k, v in (new.get("rules") or {}).items():
        if k not in out["rules"] or not isinstance(v, dict):
            continue
        for f in out["rules"][k]:
            if f in v:
                out["rules"][k][f] = bool(v[f]) if f == "on" else max(1, min(100000, int(v[f])))
    out["notify_resolved"] = bool(new.get("notify_resolved", True))
    out["repeat_hours"] = max(0, min(168, int(new.get("repeat_hours") or 0)))
    olds = {c.get("id"): c for c in old.get("channels", [])}
    for ch in (new.get("channels") or [])[:20]:
        t = ch.get("type")
        if t not in CHANNEL_FIELDS:
            raise ValueError("nieznany rodzaj kanału: %s" % t)
        c = {"id": str(ch.get("id") or os.urandom(4).hex())[:16], "type": t, "on": bool(ch.get("on", True)), "name": str(ch.get("name") or "")[:40]}
        prev = olds.get(c["id"], {})
        for f in CHANNEL_FIELDS[t]:
            v = str(ch.get(f) or "").strip()[:500]
            c[f] = prev.get(f, "") if v == MASK else v
        for f in {"ntfy": ["url"], "telegram": ["bot_token", "chat_id"], "discord": ["url"], "webhook": ["url"], "email": ["host", "to"]}[t]:
            if not c[f]:
                raise ValueError("kanał %s: brak pola %s" % (c["name"] or t, f))
        if "url" in c and c["url"] and not c["url"].startswith(("https://", "http://")):
            raise ValueError("adres musi zaczynać się od https:// albo http://")
        out["channels"].append(c)
    return out


class Handler(BaseHTTPRequestHandler):
    server_version = "loghub-notify"
    protocol_version = "HTTP/1.1"
    timeout = 30

    def log_message(self, *_):
        pass

    def send(self, status, obj):
        data = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def admin(self):
        return self.headers.get("X-Role") == "admin"

    def body(self):
        n = int(self.headers.get("Content-Length", "0"))
        if n > 65536:
            raise ValueError("za duże")
        return json.loads(self.rfile.read(n) or b"{}")

    def do_GET(self):
        p = self.path.split("?")[0]
        if p == "/api/notify/state":
            with LOCK:
                act = sorted(ST["active"].values(), key=lambda a: (a.get("sev") != "error", -a.get("since", 0)))
                return self.send(200, {"active": act, "history": ST["history"][:100], "checked_at": ST["checked_at"], "error": ST["error"],
                                       "channels": sum(1 for c in config()["channels"] if c.get("on", True))})
        if p == "/api/notify/config":
            if not self.admin():
                return self.send(403, {"error": "tylko administrator"})
            return self.send(200, masked(config()))
        self.send(404, {"error": "not found"})

    def do_PUT(self):
        if self.path.split("?")[0] != "/api/notify/config":
            return self.send(404, {"error": "not found"})
        if not self.admin():
            return self.send(403, {"error": "tylko administrator"})
        try:
            cfg = clean_config(self.body(), config())
        except (ValueError, TypeError) as e:
            return self.send(400, {"error": str(e)})
        save_json(CONFIG, cfg)
        print("ustawienia powiadomien zmienione przez %s" % self.headers.get("X-User", "?"), flush=True)
        self.send(200, masked(cfg))

    def do_POST(self):
        if self.path.split("?")[0] != "/api/notify/test":
            return self.send(404, {"error": "not found"})
        if not self.admin():
            return self.send(403, {"error": "tylko administrator"})
        a = {"title": "wiadomość testowa z loghub", "detail": "Jeśli to widzisz, kanał działa.", "host": "", "unit": ""}
        res = deliver(config(), "test", a)
        self.send(200, {"results": res})


def main():
    os.makedirs(DATA, exist_ok=True)
    saved = load_json(STATE, {})
    for k in ST:
        if k in saved:
            ST[k] = saved[k]
    threading.Thread(target=loop, daemon=True).start()
    print("loghub-notify: start, sprawdzanie co %d s" % EVERY, flush=True)
    ThreadingHTTPServer(("0.0.0.0", int(os.environ.get("PORT", "9100"))), Handler).serve_forever()


if __name__ == "__main__":
    if sys.argv[1:2] == ["check"]:
        check_once()
        print(json.dumps(ST, ensure_ascii=False, indent=1))
    else:
        main()
