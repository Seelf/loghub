# loghub: polecenia dla rozwoju (weryfikacja, formatowanie, podglad strony).
#
#   make check    - weryfikacja przed commitem: bash -n, shellcheck, py_compile, black, prettier
#   make format   - formatowanie: prettier (hub/www) i black (hub/auth, hub/notify)
#   make preview  - strona na przykladowych danych: http://localhost:8765/?demo
#
# Piny narzedzi sa tu prawda (CI je uzywa); lokalnie miec te same wersje:
#   prettier 3.6.2, black 26.10.1, shellcheck 0.11.0

SHELL := /bin/bash
PY := python3
PRETTIER := npx --yes prettier@3.6.2

# Lista skryptow powolki - jedna lista, uzywana w check (lokalnie i w CI przez make check).
SHELL_SCRIPTS := \
  install.sh proxmox.sh \
  lib/common.sh lib/hub.sh lib/agent.sh lib/agent-vector.sh lib/agent-cron.sh lib/agent-status.sh lib/proxmox.sh \
  agent/cron/cron-watch.sh agent/status/status.sh \
  loghub-agent/run.sh loghub-agent/status.sh

check: ## weryfikacja przed commitem (musi byc zielona lokalnie)
	@command -v shellcheck >/dev/null 2>&1 || { echo "BLAD: brak shellcheck (brew install shellcheck / apt-get install shellcheck)"; exit 1; }
	@command -v npx >/dev/null 2>&1 || { echo "BLAD: brak node/npm (potrzebny do prettier)"; exit 1; }
	@$(PY) -c 'import black' >/dev/null 2>&1 || { echo "BLAD: brak black (pip install black)"; exit 1; }
	@for f in $(SHELL_SCRIPTS); do bash -n "$$f" || { echo "BLAD: bash -n $$f"; exit 1; }; done
	shellcheck -S warning $(SHELL_SCRIPTS)
	$(PY) -m py_compile hub/auth/*.py hub/notify/*.py
	$(PY) -m black --check -l 120 hub/auth hub/notify
	$(PRETTIER) --check hub/www

format: ## formatowanie (prettier + black)
	$(PRETTIER) --write hub/www
	$(PY) -m black -l 120 hub/auth hub/notify

preview: ## podglad strony na przykladowych danych: http://localhost:8765/?demo
	cd hub/www && $(PY) -m http.server 8765

.PHONY: check format preview
