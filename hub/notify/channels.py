"""Wysylka powiadomien: ntfy, Telegram, Discord, webhook, e-mail.

Kazdy kanal moze dostawac tylko wybrane typy alertow (pole 'types'; puste = wszystkie),
wiadomosc testowa idzie na wszystkie wlaczone kanaly."""

import json
import smtplib
import ssl
import time
import urllib.parse
import urllib.request
from email.message import EmailMessage

from settings import PUBLIC_URL


def text_for(what, a):
    head = {"problem": "PROBLEM", "repeat": "NADAL PROBLEM", "resolved": "OK", "event": "BŁĄD", "test": "TEST"}[what]
    lines = ["[%s] %s" % (head, a["title"])]
    if a.get("detail"):
        lines.append(a["detail"])
    if what == "resolved" and a.get("since"):
        lines.append("Trwało %d min." % max(1, (a.get("until", time.time()) - a["since"]) // 60))
    if PUBLIC_URL:
        lines.append(PUBLIC_URL)
    return head, "\n".join(lines)


def post(url, body, headers, timeout=15):
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status


def send_channel(ch, what, a):
    head, text = text_for(what, a)
    t = ch.get("type")
    if t == "ntfy":
        h = {
            "Title": "loghub: " + head.replace("Ł", "L").replace("Ą", "A"),
            "Tags": "white_check_mark" if what == "resolved" else "warning",
            "Priority": "default" if what in ("resolved", "test") else "high",
            "Content-Type": "text/plain; charset=utf-8",
        }
        if ch.get("token"):
            h["Authorization"] = "Bearer " + ch["token"]
        post(ch["url"], text.encode(), h)
    elif t == "telegram":
        post(
            "https://api.telegram.org/bot%s/sendMessage" % ch["bot_token"],
            json.dumps({"chat_id": ch["chat_id"], "text": text, "disable_web_page_preview": True}).encode(),
            {"Content-Type": "application/json"},
        )
    elif t == "discord":
        post(ch["url"], json.dumps({"content": text[:1900]}).encode(), {"Content-Type": "application/json"})
    elif t == "webhook":
        post(
            ch["url"],
            json.dumps({"event": what, "alert": a, "text": text}, ensure_ascii=False).encode(),
            {"Content-Type": "application/json"},
        )
    elif t == "email":
        m = EmailMessage()
        m["Subject"], m["From"], m["To"] = "loghub: " + text.splitlines()[0], ch.get("from") or ch.get("user"), ch["to"]
        m.set_content(text)
        port = int(ch.get("port") or 587)
        if port == 465:
            s = smtplib.SMTP_SSL(ch["host"], port, timeout=20, context=ssl.create_default_context())
        else:
            s = smtplib.SMTP(ch["host"], port, timeout=20)
            if str(ch.get("tls", "1")) not in ("0", "false", ""):
                s.starttls(context=ssl.create_default_context())
        with s:
            if ch.get("user"):
                s.login(ch["user"], ch.get("password", ""))
            s.send_message(m)
    else:
        raise ValueError("nieznany kanał: %s" % t)


def channel_allows(ch, what, a):
    """Czy kanal dostaje dany alert: puste 'types' = wszystko; wiadomosc testowa idzie na wszystkie wlaczone."""
    kinds = ch.get("types") or []
    return what == "test" or not kinds or a.get("kind") in kinds


def deliver(cfg, what, a):
    res = []
    for ch in cfg.get("channels", []):
        if not ch.get("on", True) or not channel_allows(ch, what, a):
            continue
        name = ch.get("name") or ch.get("type")
        try:
            send_channel(ch, what, a)
            res.append({"channel": name, "ok": True})
        except Exception as e:
            print("wysylka %s nieudana: %s" % (name, e), flush=True)
            res.append({"channel": name, "ok": False, "error": str(e)[:200]})
    return res
