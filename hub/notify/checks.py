"""Sprawdzanie stanu maszyn co minute: ktore alerty sie pojawily, ktore minely, co wyslac."""

import calendar
import time

from channels import deliver
from logsdb import container_problem, fnum, jlist, query
from settings import ERR, EVERY, EXCL, STATE
from statuspage import status_tick
from store import LATEST, LOCK, ST, config, save_json


def evaluate(cfg):
    """Zwraca (stany: klucz -> alert, zdarzenia: lista alertow jednorazowych)."""
    R, now = cfg["rules"], time.time()
    firing, events = {}, []

    def fire(key, kind, host, unit, title, detail, sev="error"):
        firing[key] = {
            "key": key,
            "kind": kind,
            "host": host,
            "unit": unit,
            "title": title,
            "detail": detail,
            "sev": sev,
        }

    off = max(1, int(R["host_offline"].get("minutes", 3)))
    known = {o.get("host") for o in query('{source="stat"} _time:24h | stats by (host) count() c') if o.get("host")}
    latest = {}
    for o in query('{source="stat"} _time:%dm' % max(off, 5), 2000):
        h, t = o.get("host"), o.get("_time", "")
        if h and t > latest.get(h, {}).get("_time", ""):
            latest[h] = o
    LATEST.clear()
    LATEST.update(latest=latest, t=now, off=off)

    if R["host_offline"]["on"]:
        cut = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(now - off * 60))
        for h in sorted(known):
            if h not in latest or latest[h].get("_time", "") < cut:
                fire(
                    "offline:" + h,
                    "host_offline",
                    h,
                    "",
                    h + ": brak kontaktu z agentem",
                    "Brak pomiarów od ponad %d min." % off,
                )

    for h, o in latest.items():
        if R["service_down"]["on"]:
            for c in jlist(o.get("containers")):
                p = container_problem(c)
                if p:
                    fire(
                        "ct:%s:%s" % (h, c.get("n")),
                        "service_down",
                        h,
                        c.get("n", ""),
                        "%s: kontener %s %s" % (h, c.get("n"), p.split(":")[0]),
                        p,
                    )
            for u in jlist(o.get("units")):
                if isinstance(u, list) and len(u) > 1 and u[1] == "failed":
                    fire(
                        "unit:%s:%s" % (h, u[0]),
                        "service_down",
                        h,
                        u[0],
                        "%s: usługa %s padła" % (h, u[0]),
                        "systemd: failed",
                    )
        if R["disk"]["on"]:
            disks = [d for d in jlist(o.get("disks")) if isinstance(d, list) and len(d) >= 5 and d[4]]
            if not disks and fnum(o.get("disk_pct")) is not None:
                disks = [["/", "", "", fnum(o.get("disk_pct")), 100]]
            for d in disks:
                pct = d[3] * 100.0 / d[4]
                if pct >= R["disk"]["pct"]:
                    fire(
                        "disk:%s:%s" % (h, d[0]),
                        "disk",
                        h,
                        "",
                        "%s: dysk %s zajęty w %d%%" % (h, d[0], pct),
                        "%.0f z %.0f GB (%s). Próg: %s%%."
                        % (d[3] / 1048576, d[4] / 1048576, d[2] or d[1], R["disk"]["pct"]),
                        "warn",
                    )
        if R["disk_health"]["on"]:
            for x in jlist(o.get("smart")):
                if not isinstance(x, list) or len(x) < 8:
                    continue
                dev, model, health = x[0], x[1] or x[0], str(x[3] or "")
                if health and health.upper() not in ("PASSED", "OK"):
                    fire(
                        "smart:%s:%s" % (h, dev),
                        "disk_health",
                        h,
                        "",
                        "%s: dysk %s zgłasza awarię (SMART: %s)" % (h, dev, health),
                        model,
                    )
                elif (x[6] or 0) > 0 or (x[7] or 0) > 0:
                    fire(
                        "sect:%s:%s" % (h, dev),
                        "disk_health",
                        h,
                        "",
                        "%s: dysk %s ma uszkodzone sektory" % (h, dev),
                        "%s: przeniesione %s, oczekujące %s" % (model, x[6] or 0, x[7] or 0),
                        "warn",
                    )
            for x in jlist(o.get("pools")):
                if isinstance(x, list) and len(x) >= 4 and x[3] != "ONLINE":
                    fire(
                        "pool:%s:%s" % (h, x[0]),
                        "disk_health",
                        h,
                        "",
                        "%s: pula ZFS %s w stanie %s" % (h, x[0], x[3]),
                        "zpool status %s" % x[0],
                    )

    win = max(int(R["cpu"].get("minutes", 10)), int(R["mem"].get("minutes", 10)), 1)
    if R["cpu"]["on"] or R["mem"]["on"]:
        for o in query('{source="stat"} _time:%dm | stats by (host) avg(cpu) cpu, avg(mem_pct) mem' % win):
            h, cpu, mem = o.get("host"), fnum(o.get("cpu")), fnum(o.get("mem"))
            if not h or h not in latest:
                continue
            if R["cpu"]["on"] and cpu is not None and cpu >= R["cpu"]["pct"]:
                fire(
                    "cpu:" + h,
                    "cpu",
                    h,
                    "",
                    "%s: CPU %d%% (średnio %d min)" % (h, cpu, win),
                    "Próg: %s%%." % R["cpu"]["pct"],
                    "warn",
                )
            if R["mem"]["on"] and mem is not None and mem >= R["mem"]["pct"]:
                fire(
                    "mem:" + h,
                    "mem",
                    h,
                    "",
                    "%s: RAM %d%% (średnio %d min)" % (h, mem, win),
                    "Próg: %s%%." % R["mem"]["pct"],
                    "warn",
                )

    if R["errors"]["on"]:
        m = max(1, int(R["errors"].get("minutes", 5)))
        for o in query("%s %s _time:%dm | stats by (host, unit) count() c" % (EXCL, ERR, m)):
            c = fnum(o.get("c")) or 0
            if c >= R["errors"]["count"]:
                fire(
                    "err:%s:%s" % (o.get("host"), o.get("unit")),
                    "errors",
                    o.get("host", ""),
                    o.get("unit", ""),
                    "%s: %d błędów w %s w ciągu %d min" % (o.get("host"), c, o.get("unit"), m),
                    "Próg: %s." % R["errors"]["count"],
                    "warn",
                )

    if R["ports"]["on"]:
        # jedno powiadomienie, gdy ufw zacznie wpuszczac nowy port z calego swiata (albo gdy ufw zostanie wylaczony)
        with LOCK:
            prev = ST.setdefault("ufw", {})
            for h, o in latest.items():
                if "ufw_state" not in o:
                    continue
                cur = {
                    "state": o.get("ufw_state"),
                    "rules": sorted(str(x) for x in jlist(o.get("ufw"))),
                    "t": o.get("_time", ""),
                }
                old = prev.get(h)
                prev[h] = cur
                if not old:
                    continue
                win = "Zmiana nastąpiła między %s a %s." % (local_time(old.get("t")), local_time(cur["t"]))
                if old.get("state") == "active" and cur["state"] != "active":
                    events.append(
                        {
                            "key": "ufw-off:%s:%s" % (h, cur["t"]),
                            "kind": "ports",
                            "host": h,
                            "unit": "",
                            "title": "%s: zapora ufw została wyłączona - wszystkie porty są otwarte na świat" % h,
                            "detail": win,
                            "sev": "error",
                        }
                    )
                    continue
                if cur["state"] != "active":
                    continue
                added = [r for r in cur["rules"] if r not in old.get("rules", [])]
                if added:
                    events.append(
                        {
                            "key": "ufw+:%s:%s" % (h, cur["t"]),
                            "kind": "ports",
                            "host": h,
                            "unit": "",
                            "title": "%s: ufw otworzył na świat %s %s"
                            % (h, "port" if len(added) == 1 else "porty", ", ".join(added)),
                            "detail": win,
                            "sev": "warn",
                        }
                    )

    if R["cron_failed"]["on"]:
        for o in query('{source="cron"} NOT cron_state:=ok _time:%ds' % (EVERY * 3), 200):
            k = "%s|%s|%s" % (o.get("host"), o.get("unit"), o.get("_time"))
            events.append(
                {
                    "key": "cron:" + k,
                    "kind": "cron_failed",
                    "host": o.get("host", ""),
                    "unit": o.get("unit", ""),
                    "title": "%s: zadanie cron zakończone błędem (kod %s)" % (o.get("host"), o.get("exit_code", "?")),
                    "detail": o.get("cron_cmd") or o.get("unit", ""),
                    "sev": "error",
                    "at": o.get("_time", ""),
                }
            )
    return firing, events


def local_time(iso):
    """Czas z rekordu (UTC) jako lokalna godzina, np. 10:42."""
    try:
        return time.strftime(
            "%d.%m %H:%M", time.localtime(calendar.timegm(time.strptime(str(iso)[:19], "%Y-%m-%dT%H:%M:%S")))
        )
    except (ValueError, TypeError):
        return "?"


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
    try:
        status_tick()
    except Exception as e:  # strona statusu nie moze blokowac powiadomien
        print("blad strony statusu: %s" % e, flush=True)
    for what, a in send:
        deliver(cfg, what, a)


def loop():
    time.sleep(20)
    while True:
        t0 = time.time()
        check_once()
        time.sleep(max(5, EVERY - (time.time() - t0)))
