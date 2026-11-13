"""API dla strony (za forward_auth w Caddy; rola i dostep przychodza w naglowkach X-Role, X-Hosts, X-User)."""

import copy
import json
import os
from http.server import BaseHTTPRequestHandler

from channels import deliver
from settings import CHANNEL_FIELDS, CONFIG, DEFAULT, MASK, SECRET_KEYS, STATUS_CFG
from statuspage import clean_status, status_cfg, status_tick
from store import LOCK, ST, config, save_json


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
        c = {
            "id": str(ch.get("id") or os.urandom(4).hex())[:16],
            "type": t,
            "on": bool(ch.get("on", True)),
            "name": str(ch.get("name") or "")[:40],
        }
        prev = olds.get(c["id"], {})
        for f in CHANNEL_FIELDS[t]:
            v = str(ch.get(f) or "").strip()[:500]
            c[f] = prev.get(f, "") if v == MASK else v
        # typy alertow, ktore ten kanal dostaje; pusta lista = wszystkie (kompatybilne ze starymi instalacjami)
        # walidacja wobec kanonicznej listy typow (klucze rules w settings.py), nie wobec ustawien uzytkownika
        ts = ch.get("types")
        c["types"] = list(dict.fromkeys(k for k in (ts if isinstance(ts, list) else []) if k in DEFAULT["rules"]))
        for f in {
            "ntfy": ["url"],
            "telegram": ["bot_token", "chat_id"],
            "discord": ["url"],
            "webhook": ["url"],
            "email": ["host", "to"],
        }[t]:
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
            hs = self.headers.get("X-Hosts", "*")
            ok = (lambda a: True) if hs == "*" else (lambda a, allow=set(hs.split(",")): a.get("host") in allow)
            with LOCK:
                act = sorted(
                    [a for a in ST["active"].values() if ok(a)],
                    key=lambda a: (a.get("sev") != "error", -a.get("since", 0)),
                )
                return self.send(
                    200,
                    {
                        "active": act,
                        "history": [a for a in ST["history"] if ok(a)][:100],
                        "checked_at": ST["checked_at"],
                        "error": ST["error"],
                        "channels": sum(1 for c in config()["channels"] if c.get("on", True)),
                    },
                )
        if p == "/api/notify/config":
            if not self.admin():
                return self.send(403, {"error": "tylko administrator"})
            return self.send(200, masked(config()))
        if p == "/api/notify/install":
            if not self.admin():
                return self.send(403, {"error": "tylko administrator"})
            return self.send(
                200,
                {
                    "token": os.environ.get("INGEST_TOKEN", ""),
                    "lan": os.environ.get("HUB_LAN_URL", ""),
                    "ts": os.environ.get("HUB_TS_URL", ""),
                    "repo": os.environ.get("LOGHUB_REPO", "Seelf/loghub"),
                },
            )
        if p == "/api/notify/status":
            if not self.admin():
                return self.send(403, {"error": "tylko administrator"})
            with LOCK:
                now_st = dict(ST.get("status_now") or {})
            c = status_cfg()
            c["states"] = now_st
            return self.send(200, c)
        self.send(404, {"error": "not found"})

    def do_PUT(self):
        if self.path.split("?")[0] == "/api/notify/status":
            if not self.admin():
                return self.send(403, {"error": "tylko administrator"})
            try:
                c = clean_status(self.body())
            except (ValueError, TypeError) as e:
                return self.send(400, {"error": str(e)})
            save_json(STATUS_CFG, c)
            print("strona statusu zmieniona przez %s" % self.headers.get("X-User", "?"), flush=True)
            try:
                status_tick(record=False)
            except Exception as e:
                print("blad strony statusu: %s" % e, flush=True)
            return self.send(200, c)
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
