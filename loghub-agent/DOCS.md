# loghub agent

Wysyła do centrali loghub logi Home Assistant OS (Home Assistant, dodatki, system) oraz co ok. 20 s
stan maszyny: CPU, RAM, dysk danych i to, czy Home Assistant i dodatki działają.

## Konfiguracja

- **hub**: adres centrali w sieci lokalnej, np. `http://192.168.0.116:8080`
- **token**: token agentów z centrali (wypisuje go instalacja centrali, jest też w `/opt/loghub/.env` jako `INGEST_TOKEN`)
- **name**: nazwa maszyny w panelu; ustaw taką samą jak nazwa VM w Proxmoxie, wtedy panel pokaże ją pod hostem Proxmoxa

Dodatek ma tylko odczyt dziennika systemowego i listy dodatków. Niczego nie zmienia w Home Assistant.
