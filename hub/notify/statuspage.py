"""Publiczna strona statusu: lista uslug wybranych przez administratora, ich stan teraz i historia z 90 dni."""

import calendar
import json
import os
import time

from logsdb import jlist
from settings import STATUS_CFG, STATUS_DAYS, STATUS_DIR, STATUS_HIST
from store import LATEST, LOCK, ST, load_json, save_json


def status_cfg():
    c = load_json(STATUS_CFG, {})
    return {
        "title": str(c.get("title") or "Status usług"),
        "components": [x for x in c.get("components") or [] if isinstance(x, dict)],
    }


def clean_status(new):
    if not isinstance(new, dict):
        raise ValueError("zły format")
    out = {"title": str(new.get("title") or "Status usług").strip()[:80], "components": []}
    for x in (new.get("components") or [])[:60]:
        t = x.get("type")
        if t not in ("host", "docker", "unit"):
            raise ValueError("nieznany rodzaj: %s" % t)
        c = {
            "id": "".join(ch for ch in str(x.get("id") or os.urandom(4).hex()) if ch.isalnum())[:16]
            or os.urandom(4).hex(),
            "name": str(x.get("name") or "").strip()[:60],
            "group": str(x.get("group") or "").strip()[:40],
            "type": t,
            "host": str(x.get("host") or "").strip()[:100],
            "target": str(x.get("target") or "").strip()[:200],
        }
        if not c["name"]:
            raise ValueError("każda usługa musi mieć nazwę widoczną na stronie")
        if not c["host"] or (t != "host" and not c["target"]):
            raise ValueError("%s: wybierz maszynę i usługę" % c["name"])
        out["components"].append(c)
    return out


def comp_state(c, latest, now, off):
    """Stan uslugi: ok, partial (dziala z problemem), down."""
    o = latest.get(c["host"])
    try:
        fresh = (
            o and calendar.timegm(time.strptime(str(o.get("_time", ""))[:19], "%Y-%m-%dT%H:%M:%S")) >= now - off * 60
        )
    except ValueError:
        fresh = False
    if not fresh:
        return "down"
    if c["type"] == "host":
        return "ok"
    if c["type"] == "docker":
        for x in jlist(o.get("containers")):
            if x.get("n") == c["target"]:
                s, st = x.get("s", ""), x.get("st", "")
                if s == "running":
                    return "partial" if "unhealthy" in st else "ok"
                return "partial" if s == "restarting" else "down"
        return "down"
    for u in jlist(o.get("units")):
        if isinstance(u, list) and len(u) > 1 and u[0] == c["target"]:
            return "ok" if u[1] == "active" else "down" if u[1] in ("failed", "inactive") else "partial"
    return "down"


def status_tick(record=True):
    """Co minute: stan kazdej uslugi do historii dziennej i publiczny plik status.json (bez nazw maszyn)."""
    cfg, now = status_cfg(), int(time.time())
    latest, off = LATEST.get("latest"), LATEST.get("off", 3)
    if latest is None or now - LATEST.get("t", 0) > 300:
        return
    hist = load_json(STATUS_HIST, {})
    today = time.strftime("%Y-%m-%d", time.localtime(now))
    days = [time.strftime("%Y-%m-%d", time.localtime(now - i * 86400)) for i in range(STATUS_DAYS - 1, -1, -1)]
    keep, comps, states = set(days), [], {}
    for c in cfg["components"]:
        st = comp_state(c, latest, now, off)
        states[c["id"]] = st
        h = hist.setdefault(c["id"], {})
        cnt = h.setdefault(today, [0, 0, 0])
        if record:
            cnt[{"ok": 0, "partial": 1, "down": 2}[st]] += 1
        for d in [d for d in h if d not in keep]:
            del h[d]
        bars, tot, up = [], 0, 0
        for d in days:
            ok, pa, dn = (h.get(d) or [0, 0, 0])[:3]
            n = ok + pa + dn
            if not n:
                bars.append([d, "none", None])
                continue
            tot, up = tot + n, up + ok + pa
            bars.append(
                [d, "down" if dn / n >= 0.05 else "partial" if dn or pa else "ok", round((ok + pa) * 100.0 / n, 2)]
            )
        comps.append(
            {
                "name": c["name"],
                "group": c["group"],
                "state": st,
                "uptime": round(up * 100.0 / tot, 3) if tot else None,
                "days": bars,
            }
        )
    for k in [k for k in hist if k not in states]:
        del hist[k]
    save_json(STATUS_HIST, hist)
    sts = [c["state"] for c in comps]
    overall = (
        "none"
        if not sts
        else (
            "ok"
            if all(x == "ok" for x in sts)
            else "down" if all(x == "down" for x in sts) else "partial" if "down" in sts else "degraded"
        )
    )
    pub = {
        "title": cfg["title"],
        "updated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now)),
        "overall": overall,
        "components": comps,
    }
    with LOCK:
        ST["status_now"] = states
    if os.path.isdir(STATUS_DIR):
        tmp = os.path.join(STATUS_DIR, ".status.json.tmp")
        with open(tmp, "w") as f:
            json.dump(pub, f, ensure_ascii=False, separators=(",", ":"))
        os.chmod(tmp, 0o644)
        os.replace(tmp, os.path.join(STATUS_DIR, "status.json"))
