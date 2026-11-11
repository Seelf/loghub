ARG BUILD_FROM
FROM ${BUILD_FROM}
# journalctl (zrodlo journald w Vectorze), jq i curl dla skryptu stanu
RUN apt-get update \
 && apt-get install -y --no-install-recommends systemd jq curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY run.sh status.sh /
RUN chmod 755 /run.sh /status.sh
ENTRYPOINT ["/run.sh"]
