"""Ustawienia uslugi notify: sciezki plikow, domyslne reguly alertow i pola kanalow powiadomien."""

import os

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
        "disk_health": {"on": True},
        "ports": {"on": True},  # nowy port otwarty na swiat w ufw
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

# publiczna strona statusu: lista uslug wybranych przez administratora i ich historia z 90 dni
STATUS_CFG = os.path.join(DATA, "status.json")
STATUS_HIST = os.path.join(DATA, "status-hist.json")
STATUS_DIR = os.environ.get("STATUS_DIR", "/status")
STATUS_DAYS = 90
