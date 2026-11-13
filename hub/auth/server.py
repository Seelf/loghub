"""Serwer HTTP uslugi auth dla Caddy: /auth/* (logowanie, sesja, konta), /auth/verify (forward_auth) i /select/* (logi)."""

import json
import os
import re
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from accounts import load, user_hosts, user_units
from config import COOKIE, SECRET, TTL
from login import login
from proxy import proxy
from sessions import make_session, read_session
from users_api import users_api


class Handler(BaseHTTPRequestHandler):
    server_version = "loghub-auth"
    protocol_version = "HTTP/1.1"
    timeout = 15

    def log_message(self, *_):
        pass

    def say(self, event, name=""):
        ip = self.headers.get("X-Forwarded-For", self.client_address[0]).split(",")[0].strip()
        print(
            "%s user=%s ip=%s" % (event, re.sub(r"[^\w.-]", "?", name) or "-", re.sub(r"[^\w.:-]", "?", ip)), flush=True
        )

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
                    return name, users[name].get("role", "viewer"), user_hosts(users[name]), user_units(users[name])
        return None

    def json_body(self, limit=4096):
        n = int(self.headers.get("Content-Length", "0"))
        if n > limit:
            raise ValueError("too large")
        body = json.loads(self.rfile.read(n) or b"{}")
        if not isinstance(body, dict):
            raise ValueError("bad request")
        return body

    # posrednik do bazy logow (proxy.py) i konta (users_api.py)
    def proxy(self):
        return proxy(self)

    def users_api(self):
        return users_api(self)

    def do_GET(self):
        path = self.path.split("?")[0]
        if path.startswith("/select/"):
            return self.proxy()
        if path.startswith("/auth/users"):
            return self.users_api()
        if path in ("/auth/verify", "/auth/me"):
            who = self.current()
            if who:
                hs = "*" if who[2] is None else ",".join(who[2])
                return self.send(
                    200,
                    {"user": who[0], "role": who[1], "hosts": who[2], "units": who[3]},
                    [("X-User", who[0]), ("X-Role", who[1]), ("X-Hosts", hs or "-")],
                )
            return self.send(401, {"error": "auth"})
        self.send(404, {"error": "not found"})

    def do_PUT(self):
        if self.path.startswith("/auth/users"):
            return self.users_api()
        self.send(404, {"error": "not found"})

    def do_DELETE(self):
        if self.path.startswith("/auth/users"):
            return self.users_api()
        self.send(404, {"error": "not found"})

    def do_POST(self):
        path = self.path.split("?")[0]
        if path.startswith("/select/"):
            return self.proxy()
        if path.startswith("/auth/users"):
            return self.users_api()
        try:
            body = self.json_body()
        except ValueError:
            return self.send(400, {"error": "bad request"})
        if path == "/auth/login":
            status, obj, name = login(body)
            self.say(
                "login-ok" if name else "login-enroll" if status == 200 else "login-fail status=%d" % status,
                str(body.get("user", ""))[:32],
            )
            return self.send(status, obj, [self.cookie(make_session(name, load()[name]), TTL)] if name else ())
        if path == "/auth/logout":
            return self.send(200, {"ok": True}, [self.cookie("", 0)])
        self.send(404, {"error": "not found"})


def serve():
    if len(SECRET) < 32:
        sys.exit("SESSION_SECRET musi miec co najmniej 32 znaki")
    print("loghub-auth: start, uzytkownikow: %d" % len(load()), flush=True)
    ThreadingHTTPServer(("0.0.0.0", int(os.environ.get("PORT", "9000"))), Handler).serve_forever()
