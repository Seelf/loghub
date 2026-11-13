"""Zapytania do bazy logow VictoriaLogs i odczyt pol z rekordow agentow."""

import json
import urllib.parse
import urllib.request

from settings import VL


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
