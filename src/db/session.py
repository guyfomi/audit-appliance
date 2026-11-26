"""
Session SQLAlchemy asynchrone — partagée entre l'API et le moteur.
"""
from __future__ import annotations
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncSession, AsyncEngine,
    async_sessionmaker, create_async_engine,
)
from sqlalchemy import text

from config.settings import settings

# ── Engine SQLAlchemy ─────────────────────────────────────────────────────────

_engine: AsyncEngine | None = None

def get_engine() -> AsyncEngine:
    global _engine
    if _engine is None:
        _engine = create_async_engine(
            settings.database_url,
            pool_size=settings.database_pool_size,
            max_overflow=settings.database_max_overflow,
            pool_pre_ping=True,         # détecter les connexions mortes
            pool_recycle=3600,          # recycler les connexions après 1h
            echo=False,
        )
    return _engine

# ── Session factory ───────────────────────────────────────────────────────────

AsyncSessionLocal = async_sessionmaker(
    bind=get_engine(),
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)

# ── Dépendance FastAPI ────────────────────────────────────────────────────────

async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """Dépendance FastAPI — fournit une session PostgreSQL par requête."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise

@asynccontextmanager
async def get_raw_session() -> AsyncGenerator[AsyncSession, None]:
    """Context manager pour usage hors FastAPI (middleware, workers)."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise

# ── Initialisation ────────────────────────────────────────────────────────────

async def init_db() -> None:
    """Vérifie la connexion et prépare la base de données."""
    engine = get_engine()
    async with engine.connect() as conn:
        await conn.execute(text("SELECT 1"))
    import logging
    logging.getLogger("audit.db").info({
        "component": "db",
        "message":   "PostgreSQL connection established",
    })
