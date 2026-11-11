#!/usr/bin/env python3
"""loghub auth - logowanie haslem i kodem TOTP (2FA), sesja w podpisanym ciasteczku.

Tylko biblioteka standardowa Pythona. Dwa tryby:
  auth.py serve                      serwer HTTP dla Caddy (forward_auth + /auth/*)
  auth.py user add NAZWA [--role admin|viewer]
  auth.py user del|passwd|reset-2fa NAZWA
  auth.py user list
"""
import base64
import fcntl
import hashlib
import hmac
import json
import os
import re
import secrets
import struct
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import quote

DATA = os.environ.get("LOGHUB_DATA", "/data")
USERS = os.path.join(DATA, "users.json")
SECRET = os.environ.get("SESSION_SECRET", "").encode()
TTL = int(os.environ.get("SESSION_TTL", str(7 * 24 * 3600)))
COOKIE = "loghub"
ISSUER = "loghub"
NAME_RE = re.compile(r"^[a-z0-9_-]{2,32}$")
MAX_FAILS = 5  # tyle nieudanych prob z rzedu wolno bez blokady

# ---------------------------------------------------------------- uzytkownicy


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


DUMMY = hash_pw(secrets.token_hex(8))  # dla nieistniejacych kont, zeby czas odpowiedzi byl ten sam

# ----------------------------------------------------------------------- TOTP


def totp_at(secret_b32, step):
    key = base64.b32decode(secret_b32)
    mac = hmac.new(key, struct.pack(">Q", step), hashlib.sha1).digest()
    off = mac[-1] & 15
    return "%06d" % ((struct.unpack(">I", mac[off:off + 4])[0] & 0x7FFFFFFF) % 1000000)


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


# --------------------------------------------------------------------- sesje


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


# --------------------------------------------------------------------- HTTP


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
        return 200, {"user": name, "role": u.get("role", "viewer")}, name

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
    return 200, {"user": name, "role": u.get("role", "viewer")}, name


class Handler(BaseHTTPRequestHandler):
    server_version = "loghub-auth"
    protocol_version = "HTTP/1.1"
    timeout = 15

    def log_message(self, *_):
        pass

    def say(self, event, name=""):
        ip = self.headers.get("X-Forwarded-For", self.client_address[0]).split(",")[0].strip()
        print("%s user=%s ip=%s" % (event, re.sub(r"[^\w.-]", "?", name) or "-", re.sub(r"[^\w.:-]", "?", ip)), flush=True)

    def send(self, status, obj, headers=()):
        data = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        for k, v in headers:
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def cookie(self, value, age):
        secure = "; Secure" if self.headers.get("X-Forwarded-Proto") == "https" else ""
        return ("Set-Cookie", "%s=%s; Path=/; HttpOnly; SameSite=Strict; Max-Age=%d%s" % (COOKIE, value, age, secure))

    def current(self):
        for part in self.headers.get("Cookie", "").split(";"):
            k, _, v = part.strip().partition("=")
            if k == COOKIE:
                users = load()
                name = read_session(v, users)
                if name:
                    return name, users[name].get("role", "viewer")
        return None

    def do_GET(self):
        path = self.path.split("?")[0]
        if path in ("/auth/verify", "/auth/me"):
            who = self.current()
            if who:
                return self.send(200, {"user": who[0], "role": who[1]}, [("X-User", who[0]), ("X-Role", who[1])])
            return self.send(401, {"error": "auth"})
        self.send(404, {"error": "not found"})

    def do_POST(self):
        path = self.path.split("?")[0]
        try:
            n = int(self.headers.get("Content-Length", "0"))
            if n > 4096:
                return self.send(413, {"error": "too large"})
            body = json.loads(self.rfile.read(n) or b"{}")
            if not isinstance(body, dict):
                raise ValueError
        except ValueError:
            return self.send(400, {"error": "bad request"})
        if path == "/auth/login":
            status, obj, name = login(body)
            self.say("login-ok" if name else "login-enroll" if status == 200 else "login-fail status=%d" % status,
                     str(body.get("user", ""))[:32])
            return self.send(status, obj, [self.cookie(make_session(name, load()[name]), TTL)] if name else ())
        if path == "/auth/logout":
            return self.send(200, {"ok": True}, [self.cookie("", 0)])
        self.send(404, {"error": "not found"})


def serve():
    if len(SECRET) < 32:
        sys.exit("SESSION_SECRET musi miec co najmniej 32 znaki")
    print("loghub-auth: start, uzytkownikow: %d" % len(load()), flush=True)
    ThreadingHTTPServer(("0.0.0.0", int(os.environ.get("PORT", "9000"))), Handler).serve_forever()


# ---------------------------------------------------------------------- CLI


def new_password():
    return "-".join(secrets.token_hex(3) for _ in range(3))


def cli(args):
    action = args[0] if args else "list"
    name = args[1].lower() if len(args) > 1 else ""
    role = args[args.index("--role") + 1] if "--role" in args[:-1] else "viewer"
    if action == "list":
        for n, u in sorted(load().items()):
            print("%-20s %-7s 2FA: %s" % (n, u.get("role", "viewer"), "tak" if u.get("totp") else "ustawi przy pierwszym logowaniu"))
        return
    if not NAME_RE.match(name):
        sys.exit("nazwa: 2-32 znaki z zestawu a-z 0-9 _ -")
    if role not in ("admin", "viewer"):
        sys.exit("rola: admin albo viewer")
    with Store() as s:
        u = s.users.get(name)
        if action == "add":
            if u:
                sys.exit("taki uzytkownik juz istnieje (uzyj: user passwd %s)" % name)
            pw = new_password()
            s.users[name] = {"pw": hash_pw(pw), "role": role}
            print("Login: %s\nHaslo: %s\nRola:  %s\n2FA ustawi sie przy pierwszym logowaniu." % (name, pw, role))
        elif not u:
            sys.exit("nie ma takiego uzytkownika")
        elif action == "del":
            if u.get("role") == "admin" and sum(1 for x in s.users.values() if x.get("role") == "admin") < 2:
                sys.exit("nie mozna usunac ostatniego administratora")
            del s.users[name]
            print("Usunieto: %s" % name)
        elif action == "passwd":
            pw = new_password()
            u["pw"] = hash_pw(pw)
            print("Login: %s\nNowe haslo: %s\nDotychczasowe sesje tego konta wygasly." % (name, pw))
        elif action == "reset-2fa":
            u.pop("totp", None), u.pop("pending", None), u.pop("step", None)
            print("%s ustawi 2FA od nowa przy najblizszym logowaniu. Dotychczasowe sesje wygasly." % name)
        else:
            sys.exit("uzycie: user add|del|passwd|reset-2fa NAZWA [--role admin|viewer] | user list")


if __name__ == "__main__":
    if sys.argv[1:2] == ["serve"]:
        serve()
    elif sys.argv[1:2] == ["user"]:
        cli(sys.argv[2:])
    else:
        sys.exit(__doc__)
