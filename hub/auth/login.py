"""Logowanie haslem i kodem 2FA (z pierwszym podpieciem aplikacji z kodami) i blokada po serii nieudanych prob."""

import base64
import secrets
import threading
import time

from accounts import DUMMY, Store, check_pw, load, user_info
from config import MAX_FAILS
from totp import enroll_info, totp_match

# ------------------------------------------------- ochrona przed zgadywaniem

FAILS = {}  # nazwa -> [liczba porazek z rzedu, zablokowane do]
FAILS_LOCK = threading.Lock()


def locked_for(name):
    with FAILS_LOCK:
        f = FAILS.get(name)
        return max(0, int(f[1] - time.time())) if f else 0


def note_fail(name):
    with FAILS_LOCK:
        if len(FAILS) > 5000:
            FAILS.clear()
        f = FAILS.setdefault(name, [0, 0])
        f[0] += 1
        if f[0] >= MAX_FAILS:
            f[1] = time.time() + min(900, 30 * 2 ** (f[0] - MAX_FAILS))


def note_ok(name):
    with FAILS_LOCK:
        FAILS.pop(name, None)


# -------------------------------------------------------------- logowanie


def login(body):
    """Zwraca (status, odpowiedz, nazwa_do_sesji_lub_None)."""
    name = str(body.get("user", "")).strip().lower()[:64]
    pw = str(body.get("pass", ""))[:256]
    code = str(body.get("code", ""))[:16]
    wait = locked_for(name)
    if wait:
        return 429, {"error": "locked", "retry": wait}, None

    u = load().get(name)
    if not check_pw(pw, u["pw"] if u else DUMMY) or not u:
        note_fail(name)
        return 401, {"error": "bad"}, None

    if u.get("totp"):
        with Store() as s:
            u = s.users.get(name)
            step = totp_match(u["totp"], code, u.get("step", 0)) if u and u.get("totp") else None
            if step:
                u["step"] = step
        if not step:
            note_fail(name)
            return 401, {"error": "bad"}, None
        note_ok(name)
        return 200, user_info(name, u), name

    # pierwsze logowanie: haslo sie zgadza, trzeba jeszcze podpiac aplikacje z kodami
    with Store() as s:
        u = s.users[name]
        if not u.get("pending"):
            u["pending"] = base64.b32encode(secrets.token_bytes(20)).decode()
        info = enroll_info(name, u["pending"])
        if not code.strip():
            return 200, {"enroll": info}, None
        step = totp_match(u["pending"], code)
        if not step:
            note_fail(name)
            return 401, {"error": "code", "enroll": info}, None
        u["totp"], u["step"] = u.pop("pending"), step
    note_ok(name)
    return 200, user_info(name, u), name
