#!/usr/bin/env python3
"""loghub notify - sprawdza stan maszyn co minute i wysyla powiadomienia.

Tylko biblioteka standardowa Pythona. Czyta VictoriaLogs (rekordy agentow), trzyma liste
aktywnych alertow i historie, wysyla na kanaly: ntfy, Telegram, Discord, webhook, e-mail.

API (za forward_auth w Caddy; naglowek X-Role ustawia usluga logowania):
  GET  /api/notify/state    aktywne alerty i historia (kazdy zalogowany)
  GET  /api/notify/config   ustawienia (tylko admin)
  PUT  /api/notify/config   zapis ustawien (tylko admin)
  POST /api/notify/test     wiadomosc testowa na wszystkie wlaczone kanaly (tylko admin)

Pliki: settings.py (ustawienia), store.py (stan i pliki), logsdb.py (zapytania do bazy),
checks.py (sprawdzanie i alerty), statuspage.py (strona statusu), channels.py (wysylka), api.py (serwer HTTP).
"""

import json
import os
import sys
import threading
from http.server import ThreadingHTTPServer

from api import Handler
from checks import check_once, loop
from settings import DATA, EVERY, STATE
from store import ST, load_json


def main():
    os.makedirs(DATA, exist_ok=True)
    saved = load_json(STATE, {})
    for k in ST:
        if k in saved:
            ST[k] = saved[k]
    threading.Thread(target=loop, daemon=True).start()
    print("loghub-notify: start, sprawdzanie co %d s" % EVERY, flush=True)
    ThreadingHTTPServer(("0.0.0.0", int(os.environ.get("PORT", "9100"))), Handler).serve_forever()


if __name__ == "__main__":
    if sys.argv[1:2] == ["check"]:
        check_once()
        print(json.dumps(ST, ensure_ascii=False, indent=1))
    else:
        main()
