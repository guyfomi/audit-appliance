"""Oracle Data Audit & Forensics — REST API main module."""
from fastapi import FastAPI

app = FastAPI(
    title="Oracle Data Audit & Forensics API",
    description="REST API for Oracle Data Audit and Forensics",
    version="1.0.0",
)