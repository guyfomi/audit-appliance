"""
Middlewares FastAPI :
- AdminAuditMiddleware : enregistre les opérations d'écriture admin dans admin_audit_event
- RequestLoggingMiddleware : log structuré JSON de chaque requête HTTP
"""
from __future__ import annotations
import json
import logging
import time
from typing import Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests        import Request
from starlette.responses       import Response

logger = logging.getLogger("audit.api")

WRITE_METHODS  = {"POST", "PUT", "PATCH", "DELETE"}
ADMIN_PREFIXES = (
    "/api/v1/rules",
    "/api/v1/users",
    "/api/v1/cdc/pause",
    "/api/v1/cdc/resume",
    "/api/v1/archive",
    "/api/v1/admin",
)


class AdminAuditMiddleware(BaseHTTPMiddleware):
    """
    Enregistre dans admin_audit_event toutes les opérations d'écriture
    effectuées sur les endpoints d'administration.
    L'auditeur est lui-même audité.
    """

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        response = await call_next(request)

        is_write  = request.method in WRITE_METHODS
        is_admin  = any(request.url.path.startswith(p) for p in ADMIN_PREFIXES)

        if is_write and is_admin and response.status_code < 400:
            # Extraire l'ID utilisateur depuis le state (posé par la dépendance auth)
            user_id = getattr(request.state, "user_id", None)
            client_ip = request.client.host if request.client else None

            try:
                from db.session import get_raw_session
                from sqlalchemy import text
                async with get_raw_session() as db:
                    await db.execute(text("""
                        INSERT INTO admin_audit_event
                            (user_id, action, resource_type, client_ip, details)
                        VALUES (:uid, :action, :resource, :ip, :details)
                    """), {
                        "uid":      user_id,
                        "action":   request.method,
                        "resource": request.url.path,
                        "ip":       client_ip,
                        "details":  json.dumps({
                            "path":         request.url.path,
                            "query":        str(request.url.query),
                            "status_code":  response.status_code,
                        }),
                    })
                    await db.commit()
            except Exception as exc:
                logger.warning({"component": "audit_middleware", "message": f"Admin audit failed: {exc}"})

        return response


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """
    Log structuré JSON de chaque requête HTTP.
    Exclut les health checks pour réduire le bruit.
    """

    SKIP_PATHS = {"/api/v1/health", "/metrics", "/favicon.ico"}

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        if request.url.path in self.SKIP_PATHS:
            return await call_next(request)

        t0       = time.monotonic()
        response = await call_next(request)
        duration = int((time.monotonic() - t0) * 1000)

        level = logging.WARNING if response.status_code >= 400 else logging.INFO
        logger.log(level, {
            "component":   "api",
            "method":      request.method,
            "path":        request.url.path,
            "status":      response.status_code,
            "duration_ms": duration,
            "client_ip":   request.client.host if request.client else None,
        })

        return response
