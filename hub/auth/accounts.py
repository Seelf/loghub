"""Konta: plik users.json, hasla (scrypt) i zakres dostepu (cale maszyny albo pojedyncze zrodla logow)."""

import base64
import fcntl
import hashlib
import hmac
import json
import os
import secrets

from config import DATA, HOST_RE, USERS


class Store:
    """users.json z blokada pliku: serwer i polecenia CLI moga pisac rownolegle."""

    def __enter__(self):
        os.makedirs(DATA, exist_ok=True)
        self.lock = open(os.path.join(DATA, ".lock"), "w")
        fcntl.flock(self.lock, fcntl.LOCK_EX)
        self.users = load()
        return self

    def __exit__(self, exc_type, *_):
        if exc_type is None:
            tmp = USERS + ".tmp"
            with open(tmp, "w") as f:
                json.dump(self.users, f, indent=1)
            os.chmod(tmp, 0o600)
            os.replace(tmp, USERS)
        fcntl.flock(self.lock, fcntl.LOCK_UN)
        self.lock.close()


def load():
    try:
        with open(USERS) as f:
            return json.load(f)
    except FileNotFoundError:
        return {}


def hash_pw(pw, salt=None):
    salt = salt or secrets.token_bytes(16)
    h = hashlib.scrypt(pw.encode(), salt=salt, n=2**14, r=8, p=1, dklen=32)
    return "scrypt$" + base64.b64encode(salt).decode() + "$" + base64.b64encode(h).decode()


def check_pw(pw, stored):
    try:
        _, salt, _ = stored.split("$")
        return hmac.compare_digest(hash_pw(pw, base64.b64decode(salt)), stored)
    except (ValueError, TypeError):
        return False


# haslo do porownania dla nieistniejacych kont, zeby czas odpowiedzi byl ten sam
DUMMY = hash_pw(secrets.token_hex(8))


def user_hosts(u):
    """None = wszystkie maszyny; lista = tylko te (administrator widzi zawsze wszystko)."""
    if u.get("role") == "admin":
        return None
    h = u.get("hosts")
    return h if isinstance(h, list) else None


def clean_hosts(v):
    if v in (None, "", "all", "*") or v == ["*"]:
        return None
    items = v.split(",") if isinstance(v, str) else list(v)
    out = sorted({str(x).strip() for x in items if str(x).strip()})
    for x in out:
        if not HOST_RE.match(x):
            raise ValueError("niedozwolona nazwa maszyny: %s" % x)
    return out


def user_units(u):
    """Pojedyncze zrodla logow [maszyna, rodzaj, zrodlo] widoczne poza calymi maszynami (np. tylko TeamSpeak z VPS)."""
    if u.get("role") == "admin" or user_hosts(u) is None:
        return []
    return [x for x in u.get("units") or [] if isinstance(x, list) and len(x) == 3]


def clean_units(v):
    out = set()
    for x in v or []:
        if not isinstance(x, (list, tuple)) or len(x) != 3:
            raise ValueError("zły format źródła")
        h, src, unit = (str(y).strip() for y in x)
        if not HOST_RE.match(h):
            raise ValueError("niedozwolona nazwa maszyny: %s" % h)
        for y in (src, unit):
            if not y or len(y) > 200 or any(ord(ch) < 32 for ch in y):
                raise ValueError("niedozwolona nazwa źródła: %r" % y)
        out.add((h, src, unit))
    if len(out) > 500:
        raise ValueError("za dużo wybranych źródeł")
    return [list(x) for x in sorted(out)]


def scope_filter(hosts, units):
    """Filtr LogsQL doklejany do kazdego zapytania konta z ograniczonym dostepem: cale maszyny albo pojedyncze strumienie."""
    q = lambda x: json.dumps(x, ensure_ascii=False)
    parts = ["{host=%s}" % q(h) for h in hosts]
    parts += ["{host=%s,source=%s,unit=%s}" % (q(h), q(src), q(unit)) for h, src, unit in units if h not in hosts]
    return "(" + " or ".join(parts or ['{host="-brak-dostepu-"}']) + ")"


def user_info(name, u):
    return {
        "user": name,
        "role": u.get("role", "viewer"),
        "hosts": user_hosts(u),
        "units": user_units(u),
        "totp": bool(u.get("totp")),
    }


def new_password():
    return "-".join(secrets.token_hex(3) for _ in range(3))
