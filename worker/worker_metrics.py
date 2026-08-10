"""Host telemetry for the DeenClipped worker.

Reads CPU, memory, disk and load straight from /proc and the cgroup files that
Docker exposes. Deliberately dependency-free (no psutil) so the container image
does not change shape — the rebuild is just picking up new source.

Every reader is defensive: if a file is missing or has an unexpected shape on a
given kernel, that metric comes back as None rather than raising, because a
monitoring endpoint must never be the thing that takes the worker down.
"""
from __future__ import annotations

import os
import shutil
import time
from pathlib import Path
from typing import Any

_CPU_SNAPSHOT: tuple[float, float] | None = None


def _read(path: str) -> str | None:
    try:
        return Path(path).read_text().strip()
    except (OSError, ValueError):
        return None


def _read_int(path: str) -> int | None:
    raw = _read(path)
    if raw is None:
        return None
    try:
        return int(raw.split()[0])
    except (ValueError, IndexError):
        return None


def cpu_count() -> int:
    """Cores actually usable by this container, honouring a cgroup CPU quota."""
    # cgroup v2
    raw = _read("/sys/fs/cgroup/cpu.max")
    if raw and raw != "max":
        try:
            quota_s, period_s = raw.split()[:2]
            if quota_s != "max":
                quota, period = int(quota_s), int(period_s)
                if quota > 0 and period > 0:
                    return max(1, round(quota / period))
        except (ValueError, IndexError):
            pass
    # cgroup v1
    quota = _read_int("/sys/fs/cgroup/cpu/cpu.cfs_quota_us")
    period = _read_int("/sys/fs/cgroup/cpu/cpu.cfs_period_us")
    if quota and period and quota > 0 and period > 0:
        return max(1, round(quota / period))
    return os.cpu_count() or 1


def _total_cpu_seconds() -> float | None:
    """Cumulative busy CPU seconds across all cores, from /proc/stat."""
    raw = _read("/proc/stat")
    if not raw:
        return None
    for line in raw.splitlines():
        if not line.startswith("cpu "):
            continue
        try:
            fields = [int(value) for value in line.split()[1:]]
        except ValueError:
            return None
        if len(fields) < 4:
            return None
        idle = fields[3] + (fields[4] if len(fields) > 4 else 0)
        total = sum(fields)
        ticks = os.sysconf("SC_CLK_TCK") or 100
        return (total - idle) / ticks
    return None


def cpu_percent() -> float | None:
    """
    Busy CPU across the sampling window, as a percentage of all cores.

    The first call after start-up has no previous sample to compare against and
    returns None; every later call measures the interval since the last one.
    """
    global _CPU_SNAPSHOT
    busy = _total_cpu_seconds()
    now = time.monotonic()
    if busy is None:
        return None
    previous = _CPU_SNAPSHOT
    _CPU_SNAPSHOT = (busy, now)
    if previous is None:
        return None
    busy_delta = busy - previous[0]
    wall_delta = now - previous[1]
    if wall_delta <= 0 or busy_delta < 0:
        return None
    cores = cpu_count() or 1
    return round(min(100.0, max(0.0, busy_delta / (wall_delta * cores) * 100)), 1)


def memory() -> dict[str, Any]:
    """Container memory if a cgroup limit is set, otherwise host memory."""
    used = _read_int("/sys/fs/cgroup/memory.current")
    limit_raw = _read("/sys/fs/cgroup/memory.max")
    limit: int | None = None
    if limit_raw and limit_raw != "max":
        try:
            limit = int(limit_raw)
        except ValueError:
            limit = None
    if used is None:
        used = _read_int("/sys/fs/cgroup/memory/memory.usage_in_bytes")
    if limit is None:
        v1 = _read_int("/sys/fs/cgroup/memory/memory.limit_in_bytes")
        # cgroup v1 reports a sentinel near 2^63 when no limit is set.
        if v1 and v1 < (1 << 62):
            limit = v1

    total = limit
    available: int | None = None
    raw = _read("/proc/meminfo")
    if raw:
        info: dict[str, int] = {}
        for line in raw.splitlines():
            parts = line.split(":")
            if len(parts) != 2:
                continue
            try:
                info[parts[0].strip()] = int(parts[1].split()[0]) * 1024
            except (ValueError, IndexError):
                continue
        host_total = info.get("MemTotal")
        host_available = info.get("MemAvailable")
        if total is None:
            total = host_total
            available = host_available
            if used is None and host_total and host_available:
                used = host_total - host_available

    if available is None and total is not None and used is not None:
        available = max(0, total - used)

    percent = None
    if total and used is not None and total > 0:
        percent = round(min(100.0, used / total * 100), 1)

    return {"usedBytes": used, "totalBytes": total, "availableBytes": available, "percent": percent}


def disk(path: str) -> dict[str, Any]:
    try:
        usage = shutil.disk_usage(path)
    except OSError:
        return {"totalBytes": None, "usedBytes": None, "freeBytes": None, "percent": None}
    percent = round(usage.used / usage.total * 100, 1) if usage.total else None
    return {"totalBytes": usage.total, "usedBytes": usage.used, "freeBytes": usage.free, "percent": percent}


def load_average() -> dict[str, float] | None:
    try:
        one, five, fifteen = os.getloadavg()
    except (OSError, AttributeError):
        return None
    return {"1m": round(one, 2), "5m": round(five, 2), "15m": round(fifteen, 2)}


def uptime_seconds() -> float | None:
    raw = _read("/proc/uptime")
    if not raw:
        return None
    try:
        return round(float(raw.split()[0]), 1)
    except (ValueError, IndexError):
        return None


def snapshot(
    temp_dir: str,
    queue_depth: int = 0,
    running: int = 0,
    max_concurrent: int = 1,
    heavy_running: int = 0,
    max_heavy: int = 1,
) -> dict[str, Any]:
    """Everything the admin console needs about this box, in one payload."""
    return {
        "at": int(time.time() * 1000),
        "cpu": {"percent": cpu_percent(), "cores": cpu_count(), "loadAverage": load_average()},
        "memory": memory(),
        "disk": disk(temp_dir),
        "queue": {
            "depth": queue_depth,
            "running": running,
            "maxConcurrent": max_concurrent,
            "heavyRunning": heavy_running,
            "maxHeavy": max_heavy,
        },
        "uptimeSeconds": uptime_seconds(),
    }
