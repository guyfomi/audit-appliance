"""
Tests de charge — Oracle Data Audit & Forensics Appliance
Génère des événements CDC synthétiques et mesure les performances.

Usage:
    python3 tests/load/run_all.py [--host http://localhost:8000] [--token <jwt>]
"""
from __future__ import annotations
import argparse
import asyncio
import json
import random
import statistics
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, UTC
from typing import Optional

import httpx


@dataclass
class BenchmarkResult:
    test_name:         str
    duration_s:        float
    events_sent:       int
    events_per_second: float
    success_rate:      float
    latency_p50_ms:    float
    latency_p95_ms:    float
    latency_p99_ms:    float
    latency_max_ms:    float
    errors:            int
    error_types:       dict[str, int] = field(default_factory=dict)


TABLES    = ["CUSTOMER", "ACCOUNT", "LOAN", "TRANSACTION", "COLLATERAL"]
OPS       = ["INSERT", "UPDATE", "UPDATE", "UPDATE", "DELETE"]
DB_USERS  = ["APPUSER", "BATCHJOB", "ADMIN01", "REPORTING"]
MODULES   = ["CORE_BANKING", "BATCH", "ADMIN", "REPORTING"]
IPS       = ["10.10.20.15", "10.10.20.16", "10.10.1.5", "10.10.10.2"]


def make_cdc_event() -> dict:
    table = random.choice(TABLES)
    op    = random.choice(OPS)
    return {
        "event_id":        str(uuid.uuid4()),
        "source_adapter":  "benchmark",
        "source_position": str(random.randint(100_000_000, 999_999_999)),
        "database":        "COREBANK",
        "schema":          "BANK",
        "table":           table,
        "operation":       op,
        "transaction_id":  f"{random.randint(1,20)}.{random.randint(1,100)}.{random.randint(100000,999999)}",
        "scn":             random.randint(100_000_000, 999_999_999),
        "commit_scn":      random.randint(100_000_000, 999_999_999),
        "event_time":      datetime.now(UTC).isoformat(),
        "commit_time":     datetime.now(UTC).isoformat(),
        "primary_key":     {f"{table}_ID": str(random.randint(1, 10_000_000))},
        "before":          {"STATUS": "ACTIVE", "CREDIT_LIMIT": random.randint(100_000, 10_000_000)},
        "after":           {"STATUS": "ACTIVE", "CREDIT_LIMIT": random.randint(100_000, 10_000_000)},
        "db_user":         random.choice(DB_USERS),
        "client_identifier": f"USER{random.randint(1,9999):04d}",
        "module":          random.choice(MODULES),
        "client_ip":       random.choice(IPS),
        "hostname":        f"APP{random.randint(1,10):02d}",
    }


class AuditBenchmark:

    def __init__(self, base_url: str, token: str, batch_size: int = 50) -> None:
        self._url    = base_url
        self._token  = token
        self._batch  = batch_size

    async def run(
        self,
        test_name:  str,
        target_eps: int,
        duration_s: int,
    ) -> BenchmarkResult:
        latencies:  list[float] = []
        errors:     dict[str, int] = {}
        total_sent  = 0
        total_ok    = 0
        t_start     = time.monotonic()
        deadline    = t_start + duration_s
        interval    = self._batch / target_eps

        async with httpx.AsyncClient(
            base_url=self._url,
            headers={"Authorization": f"Bearer {self._token}"},
            timeout=30.0,
        ) as client:
            while time.monotonic() < deadline:
                batch = [make_cdc_event() for _ in range(self._batch)]
                t0 = time.monotonic()
                try:
                    resp = await client.post(
                        "/internal/inject-events",
                        json={"events": batch},
                    )
                    lat_ms = (time.monotonic() - t0) * 1000
                    latencies.append(lat_ms)
                    if resp.status_code == 200:
                        total_ok += self._batch
                    else:
                        key = str(resp.status_code)
                        errors[key] = errors.get(key, 0) + 1
                except httpx.RequestError as exc:
                    key = type(exc).__name__
                    errors[key] = errors.get(key, 0) + 1
                    latencies.append(30_000.0)

                total_sent += self._batch
                elapsed = time.monotonic() - t0
                sleep   = max(0.0, interval - elapsed)
                if sleep > 0:
                    await asyncio.sleep(sleep)

        duration = time.monotonic() - t_start
        latencies.sort()

        def pct(p: float) -> float:
            if not latencies:
                return 0.0
            idx = max(0, int(len(latencies) * p / 100) - 1)
            return round(latencies[idx], 1)

        return BenchmarkResult(
            test_name         = test_name,
            duration_s        = round(duration, 1),
            events_sent       = total_sent,
            events_per_second = round(total_sent / duration, 1),
            success_rate      = round(total_ok / max(total_sent, 1) * 100, 2),
            latency_p50_ms    = pct(50),
            latency_p95_ms    = pct(95),
            latency_p99_ms    = pct(99),
            latency_max_ms    = round(max(latencies, default=0), 1),
            errors            = sum(errors.values()),
            error_types       = errors,
        )


def print_result(r: BenchmarkResult) -> None:
    status = "✓" if r.success_rate >= 99.0 else "✗"
    print(f"\n  {status} {r.test_name}")
    print(f"    EPS cible → réel : {r.events_per_second}")
    print(f"    Succès           : {r.success_rate}%")
    print(f"    Latence P50/P95/P99/max : "
          f"{r.latency_p50_ms}/{r.latency_p95_ms}/{r.latency_p99_ms}/{r.latency_max_ms} ms")
    if r.errors:
        print(f"    Erreurs : {r.errors} — {r.error_types}")


SCENARIOS = [
    {"name": "baseline_1k_eps",   "target_eps": 1_000,  "duration_s": 60},
    {"name": "medium_5k_eps",     "target_eps": 5_000,  "duration_s": 60},
    {"name": "high_10k_eps",      "target_eps": 10_000, "duration_s": 60},
    {"name": "burst_50k_eps",     "target_eps": 50_000, "duration_s": 30},
    {"name": "sustained_1k_1h",   "target_eps": 1_000,  "duration_s": 3600},
]


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host",     default="http://localhost:8000")
    parser.add_argument("--token",    default="")
    parser.add_argument("--scenario", default="all",
                        help="all | baseline | medium | high | burst | sustained")
    args = parser.parse_args()

    if not args.token:
        import getpass
        print("Token JWT requis pour l'authentification.")
        args.token = getpass.getpass("Token: ")

    bench   = AuditBenchmark(base_url=args.host, token=args.token)
    results = []

    scenarios = SCENARIOS if args.scenario == "all" else \
                [s for s in SCENARIOS if args.scenario in s["name"]]

    print(f"\n{'═'*60}")
    print("  Oracle Data Audit — Tests de charge")
    print(f"  Hôte : {args.host}")
    print(f"  Scénarios : {len(scenarios)}")
    print(f"{'═'*60}")

    for scenario in scenarios:
        print(f"\n  Démarrage : {scenario['name']}")
        print(f"  Cible : {scenario['target_eps']} eps pendant {scenario['duration_s']}s")
        result = await bench.run(**scenario)
        results.append(result)
        print_result(result)

    # Résumé global
    print(f"\n{'═'*60}")
    print("  Résumé")
    print(f"{'═'*60}")
    passed = [r for r in results if r.success_rate >= 99.0]
    failed = [r for r in results if r.success_rate <  99.0]
    print(f"  ✓ Réussis : {len(passed)}/{len(results)}")
    if failed:
        print(f"  ✗ Échecs  : {[r.test_name for r in failed]}")

    # Export JSON
    output_file = f"benchmark_results_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    with open(output_file, "w") as f:
        json.dump([{
            "test_name":         r.test_name,
            "duration_s":        r.duration_s,
            "events_per_second": r.events_per_second,
            "success_rate":      r.success_rate,
            "latency_p50_ms":    r.latency_p50_ms,
            "latency_p95_ms":    r.latency_p95_ms,
            "latency_p99_ms":    r.latency_p99_ms,
            "latency_max_ms":    r.latency_max_ms,
            "errors":            r.errors,
        } for r in results], f, indent=2)
    print(f"\n  Résultats exportés : {output_file}")


if __name__ == "__main__":
    asyncio.run(main())
