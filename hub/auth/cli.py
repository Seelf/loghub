"""Polecenia "loghub user ..." (uruchamiane w kontenerze: python /app/auth.py user ...)."""

import sys

from accounts import Store, clean_hosts, hash_pw, load, new_password, user_hosts, user_units
from config import NAME_RE


def cli(args):
    action = args[0] if args else "list"
    name = args[1].lower() if len(args) > 1 else ""
    role = args[args.index("--role") + 1] if "--role" in args[:-1] else "viewer"
    hosts_arg = args[args.index("--hosts") + 1] if "--hosts" in args[:-1] else None
    if action == "list":
        for n, u in sorted(load().items()):
            h = user_hosts(u)
            un = user_units(u)
            print(
                "%-20s %-7s 2FA: %-4s maszyny: %s%s"
                % (
                    n,
                    u.get("role", "viewer"),
                    "tak" if u.get("totp") else "nie",
                    "wszystkie" if h is None else (", ".join(h) or "zadna"),
                    ("; zrodla: " + ", ".join("%s/%s" % (x[0], x[2]) for x in un)) if un else "",
                )
            )
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
            h = clean_hosts(hosts_arg)
            if h is not None:
                s.users[name]["hosts"] = h
            print(
                "Login: %s\nHaslo: %s\nRola:  %s\nMaszyny: %s\n2FA ustawi sie przy pierwszym logowaniu."
                % (name, pw, role, "wszystkie" if h is None or role == "admin" else ", ".join(h))
            )
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
        elif action == "hosts":
            h = clean_hosts(args[2] if len(args) > 2 else "all")
            if h is None:
                u.pop("hosts", None)
            else:
                u["hosts"] = h
            print("%s widzi teraz: %s" % (name, "wszystkie maszyny" if h is None else ", ".join(h)))
        elif action == "reset-2fa":
            u.pop("totp", None), u.pop("pending", None), u.pop("step", None)
            print("%s ustawi 2FA od nowa przy najblizszym logowaniu. Dotychczasowe sesje wygasly." % name)
        else:
            sys.exit(
                "uzycie: user add NAZWA [--role admin|viewer] [--hosts a,b] | user hosts NAZWA a,b|all | user del|passwd|reset-2fa NAZWA | user list"
            )
