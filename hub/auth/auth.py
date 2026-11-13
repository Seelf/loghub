#!/usr/bin/env python3
"""loghub auth - logowanie haslem i kodem TOTP (2FA), sesja w podpisanym ciasteczku,
konta z dostepem do wybranych maszyn i posrednik do bazy logow, ktory ten dostep egzekwuje.

Tylko biblioteka standardowa Pythona. Dwa tryby:
  auth.py serve                      serwer HTTP dla Caddy (forward_auth, /auth/*, /select/*)
  auth.py user add NAZWA [--role admin|viewer] [--hosts pve,vps]
  auth.py user hosts NAZWA pve,vps|all
  auth.py user del|passwd|reset-2fa NAZWA
  auth.py user list
"""

import sys

from cli import cli
from server import serve

if __name__ == "__main__":
    if sys.argv[1:2] == ["serve"]:
        serve()
    elif sys.argv[1:2] == ["user"]:
        cli(sys.argv[2:])
    else:
        sys.exit(__doc__)
