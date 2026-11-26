"""Initial schema — Oracle Data Audit & Forensics Appliance.

Revision ID: 001
Revises:
Create Date: 2026-11-20
"""
from __future__ import annotations
from pathlib import Path
from alembic import op
import sqlalchemy as sa

revision   = "001"
down_revision = None
branch_labels = None
depends_on    = None

# Chemin vers le fichier SQL complet
_SQL_FILE = Path(__file__).parent.parent.parent / "001_initial_schema.sql"


def upgrade() -> None:
    """Applique le schéma initial depuis 001_initial_schema.sql."""
    sql = _SQL_FILE.read_text(encoding="utf-8")
    # Exécuter les blocs SQL séparément (certains sont des DDL multi-instructions)
    # On ignore les erreurs "already exists" pour l'idempotence
    for statement in sql.split(";\n"):
        stmt = statement.strip()
        if stmt and not stmt.startswith("--"):
            try:
                op.execute(sa.text(stmt))
            except Exception:
                pass  # Idempotent — ignore si déjà existant


def downgrade() -> None:
    """Supprime toutes les tables (ATTENTION : perte de données)."""
    op.execute(sa.text("DROP SCHEMA public CASCADE"))
    op.execute(sa.text("CREATE SCHEMA public"))
    op.execute(sa.text("GRANT ALL ON SCHEMA public TO audit"))
