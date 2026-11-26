"""
Canaux d'alerte — implémentent AlertChannel (Protocol).
Chaque canal reçoit une Alert et l'envoie vers sa destination.
"""
from __future__ import annotations
import json
import logging
from dataclasses import dataclass
from typing import TYPE_CHECKING

import httpx

if TYPE_CHECKING:
    from engine.alerting import Alert

logger = logging.getLogger("audit.alerting")


# ── Email ─────────────────────────────────────────────────────────────────────

class EmailChannel:
    """Envoi d'alertes par email via SMTP."""

    def __init__(self, settings) -> None:
        self._settings = settings

    async def send(self, alert: "Alert") -> None:
        try:
            import aiosmtplib
            from email.mime.text import MIMEText
            from email.mime.multipart import MIMEMultipart

            msg = MIMEMultipart("alternative")
            msg["Subject"] = f"[{alert.severity.value}] {alert.title}"
            msg["From"]    = self._settings.alert_email_from
            msg["To"]      = self._settings.alert_email_to

            # Corps texte
            text_body = f"""
Niveau de risque : {alert.severity.value}
Table            : {alert.event.table_name}
Heure            : {alert.event.event_time}
Utilisateur      : {alert.event.db_username or 'N/A'}
IP Client        : {alert.event.client_ip or 'N/A'}
Raison           : {alert.description}

Score de risque  : {alert.event.risk_score}/100

Consulter l'événement dans l'interface d'audit.
"""
            msg.attach(MIMEText(text_body, "plain", "utf-8"))

            await aiosmtplib.send(
                msg,
                hostname=self._settings.smtp_host,
                port=self._settings.smtp_port,
                username=self._settings.smtp_user or None,
                password=self._settings.smtp_password or None,
                use_tls=self._settings.smtp_tls,
            )
            logger.info({
                "component": "alerting",
                "channel":   "email",
                "message":   f"Alert email sent: {alert.title}",
            })
        except Exception as exc:
            logger.error({
                "component": "alerting",
                "channel":   "email",
                "message":   f"Email send failed: {exc}",
            })


# ── Webhook générique (Teams, Slack, ntfy…) ───────────────────────────────────

class WebhookChannel:
    """
    Envoi d'alertes via webhook HTTP.
    Supporte Microsoft Teams (Adaptive Cards), Slack (attachments) et ntfy.
    """

    def __init__(self, url: str) -> None:
        self._url = url

    async def send(self, alert: "Alert") -> None:
        if not self._url:
            return
        try:
            payload = self._build_payload(alert)
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.post(self._url, json=payload)
                resp.raise_for_status()
            logger.info({
                "component": "alerting",
                "channel":   "webhook",
                "message":   f"Alert sent to webhook: {alert.title}",
            })
        except Exception as exc:
            logger.error({
                "component": "alerting",
                "channel":   "webhook",
                "message":   f"Webhook failed: {exc}",
            })

    def _build_payload(self, alert: "Alert") -> dict:
        # Détecter le type de webhook
        if "teams.microsoft.com" in self._url or "office.com" in self._url:
            return self._teams_payload(alert)
        if "hooks.slack.com" in self._url:
            return self._slack_payload(alert)
        # Format générique / ntfy
        return self._generic_payload(alert)

    def _teams_payload(self, alert: "Alert") -> dict:
        color_map = {
            "CRITICAL": "attention",
            "HIGH":     "warning",
            "MEDIUM":   "accent",
            "LOW":      "good",
        }
        return {
            "type":        "message",
            "attachments": [{
                "contentType": "application/vnd.microsoft.card.adaptive",
                "content": {
                    "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
                    "type":    "AdaptiveCard",
                    "version": "1.3",
                    "body": [
                        {
                            "type":   "TextBlock",
                            "text":   f"🚨 Audit Alert — {alert.severity.value}",
                            "weight": "Bolder",
                            "size":   "Medium",
                            "color":  color_map.get(alert.severity.value, "accent"),
                        },
                        {
                            "type": "FactSet",
                            "facts": [
                                {"title": "Titre",       "value": alert.title},
                                {"title": "Table",       "value": alert.event.table_name},
                                {"title": "Utilisateur", "value": alert.event.db_username or "N/A"},
                                {"title": "IP",          "value": alert.event.client_ip or "N/A"},
                                {"title": "Score",       "value": f"{alert.event.risk_score}/100"},
                                {"title": "Heure",       "value": str(alert.event.event_time)},
                            ],
                        },
                        {
                            "type": "TextBlock",
                            "text": alert.description or "",
                            "wrap": True,
                            "color": "Warning",
                        },
                    ],
                },
            }],
        }

    def _slack_payload(self, alert: "Alert") -> dict:
        emoji_map = {"CRITICAL": "🔴", "HIGH": "🟠", "MEDIUM": "🟡", "LOW": "🟢"}
        return {
            "text": f"{emoji_map.get(alert.severity.value, '⚠️')} *{alert.title}*",
            "attachments": [{
                "color":    "#FF0000" if alert.severity.value == "CRITICAL" else "#FF8C00",
                "fields": [
                    {"title": "Sévérité",    "value": alert.severity.value, "short": True},
                    {"title": "Table",       "value": alert.event.table_name, "short": True},
                    {"title": "Utilisateur", "value": alert.event.db_username or "N/A", "short": True},
                    {"title": "Score",       "value": f"{alert.event.risk_score}/100", "short": True},
                ],
                "footer":   "Oracle Data Audit Appliance",
                "ts":       int(alert.event.event_time.timestamp()),
            }],
        }

    def _generic_payload(self, alert: "Alert") -> dict:
        return {
            "severity":   alert.severity.value,
            "title":      alert.title,
            "description": alert.description,
            "table":      alert.event.table_name,
            "event_time": str(alert.event.event_time),
            "risk_score": alert.event.risk_score,
            "db_user":    alert.event.db_username,
            "client_ip":  alert.event.client_ip,
        }


# ── Syslog / SIEM ─────────────────────────────────────────────────────────────

class SyslogChannel:
    """Envoi d'alertes vers un SIEM via Syslog UDP/TCP."""

    def __init__(self, host: str, port: int = 514) -> None:
        self._host = host
        self._port = port

    async def send(self, alert: "Alert") -> None:
        try:
            import socket
            message = json.dumps({
                "facility":  "audit_appliance",
                "severity":  alert.severity.value,
                "title":     alert.title,
                "table":     alert.event.table_name,
                "user":      alert.event.db_username,
                "ip":        alert.event.client_ip,
                "risk_score": alert.event.risk_score,
                "event_time": str(alert.event.event_time),
            })
            # Syslog RFC 5424 (priorité 14 = user.info)
            syslog_msg = f"<14>1 {alert.event.event_time} audit-appliance audit - - - {message}"
            loop = __import__("asyncio").get_event_loop()
            await loop.run_in_executor(
                None,
                lambda: _udp_send(self._host, self._port, syslog_msg.encode()),
            )
        except Exception as exc:
            logger.error({"component": "alerting", "channel": "syslog", "message": str(exc)})


def _udp_send(host: str, port: int, data: bytes) -> None:
    import socket
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        s.sendto(data, (host, port))
