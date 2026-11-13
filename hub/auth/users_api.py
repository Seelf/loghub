"""API kont dla administratora (/auth/users): lista, dodanie, zmiana roli i dostepu, nowe haslo, reset 2FA, usuniecie.
Funkcja dostaje obiekt zapytania (Handler z server.py) i sama wysyla odpowiedz."""

from accounts import Store, clean_hosts, clean_units, hash_pw, load, new_password, user_info
from config import NAME_RE


def users_api(req):
    who = req.current()
    if not who:
        return req.send(401, {"error": "auth"})
    if who[1] != "admin":
        return req.send(403, {"error": "tylko administrator"})
    path = req.path.split("?")[0].rstrip("/")
    name = path[len("/auth/users/") :].lower() if path.startswith("/auth/users/") else ""
    if req.command == "GET" and not name:
        return req.send(200, {"users": [user_info(n, u) for n, u in sorted(load().items())]})
    if req.command != "GET" and "application/json" not in req.headers.get("Content-Type", ""):
        return req.send(415, {"error": "wymagany JSON"})
    try:
        body = req.json_body() if req.command in ("POST", "PUT") else {}
        with Store() as s:
            if req.command == "POST" and not name:
                name = str(body.get("user", "")).strip().lower()
                if not NAME_RE.match(name):
                    raise ValueError("nazwa: 2-32 znaki z zestawu a-z 0-9 _ -")
                if name in s.users:
                    raise ValueError("taki użytkownik już istnieje")
                role = body.get("role", "viewer")
                if role not in ("admin", "viewer"):
                    raise ValueError("rola: admin albo viewer")
                pw = new_password()
                s.users[name] = {"pw": hash_pw(pw), "role": role}
                h = clean_hosts(body.get("hosts"))
                if h is not None:
                    s.users[name]["hosts"] = h
                    un = clean_units(body.get("units"))
                    if un:
                        s.users[name]["units"] = un
                out = dict(user_info(name, s.users[name]), password=pw)
                req.say("user-add %s by" % name, who[0])
                return req.send(200, out)
            u = s.users.get(name)
            if not u:
                return req.send(404, {"error": "nie ma takiego użytkownika"})
            admins = sum(1 for x in s.users.values() if x.get("role") == "admin")
            if req.command == "DELETE":
                if name == who[0]:
                    raise ValueError("nie można usunąć własnego konta")
                if u.get("role") == "admin" and admins < 2:
                    raise ValueError("nie można usunąć ostatniego administratora")
                del s.users[name]
                req.say("user-del %s by" % name, who[0])
                return req.send(200, {"ok": True})
            if req.command == "PUT":
                out = {}
                if "role" in body:
                    if body["role"] not in ("admin", "viewer"):
                        raise ValueError("rola: admin albo viewer")
                    if u.get("role") == "admin" and body["role"] != "admin" and admins < 2:
                        raise ValueError("musi zostać co najmniej jeden administrator")
                    u["role"] = body["role"]
                if "hosts" in body:
                    h = clean_hosts(body.get("hosts"))
                    if h is None:
                        u.pop("hosts", None)
                        u.pop("units", None)
                    else:
                        u["hosts"] = h
                if "units" in body:
                    un = clean_units(body.get("units"))
                    if un and u.get("hosts") is not None:
                        u["units"] = un
                    else:
                        u.pop("units", None)
                if body.get("new_password"):
                    out["password"] = new_password()
                    u["pw"] = hash_pw(out["password"])
                if body.get("reset_2fa"):
                    u.pop("totp", None), u.pop("pending", None), u.pop("step", None)
                req.say("user-edit %s by" % name, who[0])
                return req.send(200, dict(user_info(name, u), **out))
    except ValueError as e:
        return req.send(400, {"error": str(e)})
    req.send(405, {"error": "method"})
