"""Wspolny stan uslugi (aktywne alerty, historia) i zapis plikow JSON w katalogu danych."""

import copy
import json
import os
import threading

from settings import CONFIG, DEFAULT

# ostatni odczyt stanu maszyn (z evaluate), uzywany tez przez strone statusu
LATEST = {}

LOCK = threading.Lock()
ST = {"active": {}, "history": [], "checked_at": 0, "error": "", "seen_cron": [], "ufw": {}, "status_now": {}}


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
