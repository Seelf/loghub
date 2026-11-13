"""Kody jednorazowe TOTP (2FA, jak w Google Authenticator / Aegis): 6 cyfr, nowe co 30 s."""

import base64
import hashlib
import hmac
import re
import struct
import time
from urllib.parse import quote

from config import ISSUER


def totp_at(secret_b32, step):
    key = base64.b32decode(secret_b32)
    mac = hmac.new(key, struct.pack(">Q", step), hashlib.sha1).digest()
    off = mac[-1] & 15
    return "%06d" % ((struct.unpack(">I", mac[off : off + 4])[0] & 0x7FFFFFFF) % 1000000)


def totp_match(secret_b32, code, last_step=0, now=None):
    """Zwraca numer okna 30 s, w ktorym kod pasuje (tolerancja +-1 okno), albo None.
    Okno juz raz uzyte (<= last_step) nie przechodzi: ten sam kod nie zadziala dwa razy."""
    code = re.sub(r"\s", "", code or "")
    if not re.fullmatch(r"\d{6}", code):
        return None
    cur = int((now or time.time()) // 30)
    for step in (cur, cur - 1, cur + 1):
        if step > last_step and hmac.compare_digest(totp_at(secret_b32, step), code):
            return step
    return None


def enroll_info(name, secret_b32):
    uri = "otpauth://totp/%s:%s?secret=%s&issuer=%s&digits=6&period=30" % (ISSUER, quote(name), secret_b32, ISSUER)
    return {"secret": secret_b32, "uri": uri}
