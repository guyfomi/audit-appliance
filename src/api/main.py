"""
Oracle Data Audit & Forensics Appliance
API REST — application FastAPI principale
"""
from __future__ import annotations
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from config.settings     import settings
from config.logging_cfg  import setup_logging
from db.session          import init_db
from api.auth            import auth_router
from api.middleware      import AdminAuditMiddleware, RequestLoggingMiddleware
from monitoring.metrics  import metrics_router

# Import différé des routers pour éviter les imports circulaires
from api.routers import (
    events, records, transactions,
    alerts, rules, dashboard,
    cdc, integrity, health,
    reports, users, archive,
    admin_config,
)

limiter = Limiter(key_func=get_remote_address, default_limits=["60/minute"])


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging(settings.log_level)
    await init_db()
    import logging
    logging.getLogger("audit.api").info({
        "component": "api",
        "message":   "API started",
        "version":   settings.appliance_version,
    })
    yield
    logging.getLogger("audit.api").info({"component": "api", "message": "API stopped"})


app = FastAPI(
    title="Oracle Data Audit & Forensics API",
    description="API REST de l'appliance d'audit Oracle",
    version=settings.appliance_version,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
    lifespan=lifespan,
)

# ── Rate limiting ─────────────────────────────────────────────────────────────
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# ── Middlewares ───────────────────────────────────────────────────────────────
app.add_middleware(AdminAuditMiddleware)
app.add_middleware(RequestLoggingMiddleware)
app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=["localhost", "127.0.0.1", settings.appliance_fqdn, "*"],
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        f"https://{settings.appliance_fqdn}",
        "https://localhost",
        "http://localhost:3000",   # développement
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
)

# ── Gestionnaire d'erreurs global ─────────────────────────────────────────────
@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    import logging, traceback
    logging.getLogger("audit.api").error({
        "component": "api",
        "message":   "Unhandled exception",
        "path":      str(request.url),
        "error":     str(exc),
        "traceback": traceback.format_exc()[-2000:],
    })
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})

# ── Routes ────────────────────────────────────────────────────────────────────
PREFIX = "/api/v1"

app.include_router(auth_router,          prefix=f"{PREFIX}/auth",        tags=["auth"])
app.include_router(events.router,        prefix=PREFIX,                   tags=["events"])
app.include_router(records.router,       prefix=PREFIX,                   tags=["records"])
app.include_router(transactions.router,  prefix=PREFIX,                   tags=["transactions"])
app.include_router(alerts.router,        prefix=PREFIX,                   tags=["alerts"])
app.include_router(rules.router,         prefix=PREFIX,                   tags=["rules"])
app.include_router(dashboard.router,     prefix=PREFIX,                   tags=["dashboard"])
app.include_router(cdc.router,           prefix=PREFIX,                   tags=["cdc"])
app.include_router(integrity.router,     prefix=PREFIX,                   tags=["integrity"])
app.include_router(health.router,        prefix=PREFIX,                   tags=["health"])
app.include_router(reports.router,       prefix=PREFIX,                   tags=["reports"])
app.include_router(users.router,         prefix=PREFIX,                   tags=["users"])
app.include_router(archive.router,       prefix=PREFIX,                   tags=["archive"])
app.include_router(admin_config.config_router, prefix="",                 tags=["admin"])
app.include_router(metrics_router,       prefix="",                       tags=["monitoring"])

# ── Route racine ─────────────────────────────────────────────────────────────
@app.get("/", include_in_schema=False)
async def root():
    return {"appliance": "Oracle Data Audit & Forensics", "version": settings.appliance_version}
