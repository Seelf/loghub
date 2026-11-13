# CLAUDE.md

Przed praca w tym repozytorium przeczytaj [AGENTS.md](AGENTS.md): struktura, konwencje,
inwarianty bezpieczenstwa i petla weryfikacji.

Szybkim skrotem:

- `make check` przed kazdym commitem - musi byc zielone lokalnie przed pushem
- `make preview` -> `http://localhost:8765/?demo` (podglad strony na przykladowych danych)
- `make format` (prettier dla `hub/www`, black dla `hub/auth` i `hub/notify`)
- Python: tylko biblioteka standardowa; frontend: bez budowania i bez bibliotek
- Komentarze w kodzie i commity: polski bez diakrytykow (ASCII), mała litera, bez kropki
- Brak sekretow w repo; port 8080 nigdy na internet; inwarianty z AGENTS.md nie lamac
