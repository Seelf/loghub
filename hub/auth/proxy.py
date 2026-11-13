"""Posrednik do bazy logow VictoriaLogs (adresy /select/*) dla zalogowanych."""

import http.client
from urllib.parse import parse_qsl, urlencode, urlsplit

from accounts import scope_filter
from config import VL


def proxy(req):
    """Przekazuje zapytanie do VictoriaLogs. Dla konta z ograniczonym dostepem dokleja filtr maszyn
    (extra_stream_filters), ktorego nie da sie obejsc tresca zapytania; sam strumien odpowiedzi idzie dalej na zywo."""
    who = req.current()
    if not who:
        return req.send(401, {"error": "auth"})
    parts = urlsplit(req.path)
    hosts = who[2]
    n = int(req.headers.get("Content-Length", "0") or 0)
    if n > 1048576:
        return req.send(413, {"error": "too large"})
    raw = req.rfile.read(n) if n else b""
    headers = {"Accept-Encoding": "identity"}
    if hosts is None:
        method, url, body = req.command, parts.path + ("?" + parts.query if parts.query else ""), raw or None
        if req.headers.get("Content-Type"):
            headers["Content-Type"] = req.headers["Content-Type"]
    else:
        if not parts.path.startswith("/select/logsql/"):
            return req.send(403, {"error": "brak dostępu do tego widoku"})
        form = parse_qsl(parts.query, keep_blank_values=True) + parse_qsl(
            raw.decode("utf-8", "replace"), keep_blank_values=True
        )
        form = [(k, v) for k, v in form if k not in ("extra_filters", "extra_stream_filters")]
        # extra_filters przyjmuje dowolny filtr LogsQL; baza laczy go z zapytaniem przez AND
        form.append(("extra_filters", scope_filter(hosts, who[3])))
        method, url, body = "POST", parts.path, urlencode(form).encode()
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    conn = http.client.HTTPConnection(VL.hostname, VL.port or 80, timeout=3600)
    try:
        conn.request(method, url, body=body, headers=headers)
        r = conn.getresponse()
        req.send_response(r.status)
        for k, v in r.getheaders():
            if k.lower() in ("content-type", "cache-control", "vl-request-duration-seconds"):
                req.send_header(k, v)
        req.send_header("Transfer-Encoding", "chunked")
        req.end_headers()
        while True:
            chunk = r.read1(65536)
            if not chunk:
                break
            req.wfile.write(b"%x\r\n%s\r\n" % (len(chunk), chunk))
            req.wfile.flush()
        req.wfile.write(b"0\r\n\r\n")
    except (BrokenPipeError, ConnectionResetError):
        pass
    except OSError as e:
        try:
            req.send(502, {"error": "baza logów niedostępna: %s" % e})
        except OSError:
            pass
    finally:
        conn.close()
    req.close_connection = True
