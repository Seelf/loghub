# AGENTS.md - loghub

Instrukcje dla agentow AI (i ludzi) pracujacych w tym repozytorium.
Najpierw zrozum projekt z README.md (opis dla uzytkownika, pelna dokumentacja), potem dzialaj wg zasad nizej.

## Co to jest

Centrala logow: VictoriaLogs (baza, 2 lata retencji), Vector (agent na kazdej obserwowanej maszynie),
wlasny panel www bez budowania (logowanie haslem + 2FA, zdarzenia, zasoby, powiadomienia,
publiczna strona statusu) i instalator uruchamiany jedna linia `curl | bash` jako root.

## Struktura

```
install.sh                 polecenie "loghub": znajduje pliki (LOGHUB_SRC / obok / pobranie z GitHuba) i wywola funkcje z lib/
proxmox.sh                 tworzy kontener LXC z centrala na Proxmoxie
lib/*.sh                   kod instalatora (Bash), source'owany przez install.sh
agent/                     pliki kopiowane na obserwowane maszyny
  vector/*.vrl             jak wpis z dziennika, pliku, TeamSpeaka i Dockera staje sie rekordem loghub
  cron/                    podglad zadan cron (awk + usługa loghub-cron)
  status/                  pomiar zasobow i stanu (usługa loghub-status)
hub/                       centrala (kopiowana do /opt/loghub)
  docker-compose.yml       uslugi: victorialogs, auth, notify, caddy
  Caddyfile                wejscia: 8080 (prywatne), 8081 (publiczne, funnel), 8082 (status, 127.0.0.1)
  www/                     panel: HTML/CSS/JS bez budowania; plik na widok, app.js start na koncu
  auth/                    logowanie, 2FA, konta, posrednik do bazy (Python)
  notify/                  powiadomienia i strona statusu (Python)
  status/                  statyczna publiczna strona statusu
loghub-agent/              dodatek Home Assistant OS (Vector w obrazie Docker)
docs/                      diagram architektury
```

## Petla weryfikacji

Przed commitem zawsze `make check` (bash -n, shellcheck -S warning, py_compile, black --check, prettier --check)
i musi byc zielone LOKALNIE przed pushem - CI po pushu uruchamia te same sprawdziany.

| Zmiana | Jak sprawdzic |
|---|---|
| `hub/www` (strona) | `make preview`, potem `http://localhost:8765/?demo` (przykladowe dane w `www/demo.js`) |
| `hub/auth`, `hub/notify` (Python) | `make check`; pelna proba: centrala z Dockerem na maszynie testowej (`install.sh hub`) |
| `lib/`, `install.sh`, `proxmox.sh` | `make check`; pelna proba: czysty kontener Debian 12 (to, co robi proxmox.sh) |
| `agent/` (VRL, cron, status) | `make check`; `vector validate` dziala dopiero na maszynie z zainstalowanym agentem |
| `loghub-agent/` (dodatek HA) | `make check`; proba w Home Assistant OS (repo dodatkowe: patrz repository.yaml) |

Formatowanie: `make format` (prettier dla `hub/www` wg `.prettierrc`, black -l 120 dla Pythona).

## Konwencje

- Komentarze w kodzie i komunikaty: polski BEZ diakrytykow (ASCII) - tak jak w istniejacych plikach.
- Commit messages: polski bez diakrytykow, mala litera, bez kropki (porownaj `git log --oneline`).
- Jeden plik = jedna rzecz; kazdy plik zaczyna sie od komentarza, co jest w srodku.
- Python: TYLKO biblioteka standardowa (kontenery alpine, brak pip). Nie dodawac zaleznosci.
- Frontend: brak budowania i brak bibliotek; zmieniony plik w `hub/www` od razu dziala po restarcie caddy.
- Bash: `set -euo pipefail`; skrypty instalacyjne dzialaja jako root przez `curl | bash`
  - przy zmianach mysl, co sie wykona na maszynach uzytkownikow.
- Piny narzedzi (Makefile, CI): prettier 3.6.2, black 26.10.1, shellcheck 0.11.0 - to one sa prawda.
- CI uruchamia shellcheck na poziomie `warning`; wyniki `info` (SC2015, SC2153, SC1003) sa znane i
  celowo nieblokujace. Nie podnosic poziomu bez najpierw porzadkowania wszystkich wyników info.
- Zmienne w `lib/*.sh` sa uzywane miedzy plikami source'owanymi razem przez install.sh, wiec
  `shellcheck disable=SC2034` na glowie tych plikow jest celowe. Nie przenosic tych disable na inne
  pliki: prawdziwie martwa zmienna do usuniecia, nie do maskowania.

## Inwarianty bezpieczenstwa (nie lamac)

- `INGEST_TOKEN` jest tylko do zapisu: w Caddyfile `/insert/*` przechodzi tylko z naglowkiem
  `Authorization: Bearer`, agent niczego nie czyta.
- Dostep kont do maszyn egzekwuje posrednik auth (`hub/auth/proxy.py`): dla kont z ograniczeniem
  usuwa parametry `extra_filters`/`extra_stream_filters` z zapytania i dokleja wlasny filtr
  (`scope_filter` w `accounts.py`), ktorego nie da sie obejsci trescia zapytania; ograniczone konta
  moga uzywac tylko `/select/logsql/`.
- Wejscie 8081 (Tailscale Funnel, jedyna sciezka publiczna) nie przyjmuje logow:
  `/insert/* /select/vmui* /delete/* /internal/*` zamykane 404.
- Port 8082 (publiczna strona statusu) serwuje tylko `/` i `status.json` (Caddy, GET/HEAD, surowy CSP);
  `status.json` (budowany w `notify/statuspage.py`) nie zawiera nazw maszyn, adresow ani logow -
  tylko nazwy uslug wybrane przez administratora.
- Port 8080 nigdy nie jest wystawiany na internet (siec lokalna i Tailscale).
- Brak sekretow w repozytorium: tokeny, hasla i SESSION_SECRET powstaja przy instalacji i zostaja
  na centrali (`/opt/loghub/.env`, `/opt/loghub/authdata/`, `/opt/loghub/notifydata/`).
  Tego rodzaju plikow sie nie commituje.
- Sesja: podpisane ciasteczko HttpOnly + SameSite=Strict, blokada po 5 zlych probach, kod 2FA jednorazowy.

## Proces

1. Najpierw `git pull`. Repo jest jednoosobowe: domyslnie pracuj na `main`, jak poproszono - w galezi.
2. Zrob zmianę i uruchom `make check`; zielone lokalnie = gotowe do pusha.
3. Commit wg konwencji, push.
4. Testow jednostkowych nie ma: weryfikacja to lint + podglad strony (`make preview`)
   + przy mozliwosci proba na czystej maszynie/kontenerze. Nie dodawac testow bez prosby.

## Czego nie robic

- Nie dodawac kroku budowania, npm ani zaleznosci Python.
- Nie commitowac plikow wygenerowanych, `.env`, tokenow ani danych z `/opt/loghub`.
- Nie wystawiac portu 8080 na internet.
- Nie "poprawiac" znanego ostrzezen info-level shellchecka i nie podnosic jego poziomu w CI
  bez uzgodnienia.
- Nie zmieniac schematu rekordow logow (polia `host`, `source`, `unit`, `message`, `timestamp` w VRL)
  bez dostosowania strony i uslugi notify w tym samym commitie.
