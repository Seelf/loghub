"""Sesja w podpisanym ciasteczku: "nazwa|wygasa|wersja_konta" + podpis HMAC kluczem SESSION_SECRET."""

import base64
import hashlib
import hmac
import time

from config import SECRET, TTL


def b64u(b):
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def unb64u(s):
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def user_ver(u):
    # zmiana hasla albo reset 2FA uniewaznia wszystkie wczesniejsze sesje tego konta
    return hashlib.sha256((u["pw"] + "|" + (u.get("totp") or "")).encode()).hexdigest()[:16]


def make_session(name, u):
    payload = ("%s|%d|%s" % (name, int(time.time()) + TTL, user_ver(u))).encode()
    return b64u(payload) + "." + b64u(hmac.new(SECRET, payload, hashlib.sha256).digest())


def read_session(value, users):
    try:
        p, sig = value.split(".")
        payload = unb64u(p)
        if not hmac.compare_digest(hmac.new(SECRET, payload, hashlib.sha256).digest(), unb64u(sig)):
            return None
        name, exp, ver = payload.decode().split("|")
        u = users.get(name)
        if not u or int(exp) < time.time() or not hmac.compare_digest(ver, user_ver(u)):
            return None
        return name
    except Exception:
        return None
