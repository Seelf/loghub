"""Ustawienia uslugi auth (ze zmiennych srodowiskowych z docker-compose.yml)."""

import os
import re
from urllib.parse import urlsplit

DATA = os.environ.get("LOGHUB_DATA", "/data")
USERS = os.path.join(DATA, "users.json")
SECRET = os.environ.get("SESSION_SECRET", "").encode()
TTL = int(os.environ.get("SESSION_TTL", str(7 * 24 * 3600)))
COOKIE = "loghub"
ISSUER = "loghub"
NAME_RE = re.compile(r"^[a-z0-9_-]{2,32}$")
MAX_FAILS = 5  # tyle nieudanych prob z rzedu wolno bez blokady
VL = urlsplit(os.environ.get("VL_URL", "http://victorialogs:9428"))
HOST_RE = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
