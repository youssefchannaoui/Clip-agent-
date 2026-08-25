"""What this machine can actually do, measured rather than assumed.

Every hardware setting used to be a fixed default -- device cpu, compute type
int8, model small, four ffmpeg threads, one job at a time. Buying a bigger
server changed nothing, because nothing read the machine; you had to know to
edit five environment variables, and the one that mattered most (a 2.5G model on
a 3.7G box) was wrong in the opposite direction and cost 42 OOM kills.

Two rules here:

  * An explicit environment variable always wins. Operators need an override
    that a heuristic cannot argue with.
  * Otherwise ask the machine, and ask it the way the process actually sees it.
    Inside a container os.cpu_count() and the host's RAM are both lies -- the
    cgroup quota is the truth, and reading the wrong one is how you size a
    worker for 3.7G when it may only have 2G.
"""
from __future__ import annotations

import math
import os
from pathlib import Path
from typing import Any

# Headroom for everything that is not a job. Which number applies depends on
# what the memory figure describes: a cgroup limit already excludes the OS and
# the scoring model, so reserving for them again there would double-count and
# hold concurrency at one on a machine that could carry four.
_RESERVED_HOST_GB = 2.0
_RESERVED_CGROUP_GB = 0.5
# Measured shape of one job: roughly two cores busy between Whisper and ffmpeg,
# and about a gigabyte and a half resident at peak.
_CORES_PER_JOB = 2
_GB_PER_JOB = 1.5


def _cgroup_cpu_quota() -> float | None:
    """Cores this process may use, from the cgroup, or None if unlimited."""
    v2 = Path("/sys/fs/cgroup/cpu.max")
    if v2.is_file():
        try:
            quota, period = v2.read_text().split()
            if quota != "max":
                return float(quota) / float(period)
        except (ValueError, OSError):
            pass
    quota_file = Path("/sys/fs/cgroup/cpu/cpu.cfs_quota_us")
    period_file = Path("/sys/fs/cgroup/cpu/cpu.cfs_period_us")
    if quota_file.is_file() and period_file.is_file():
        try:
            quota = int(quota_file.read_text().strip())
            period = int(period_file.read_text().strip())
            if quota > 0 and period > 0:
                return quota / period
        except (ValueError, OSError):
            pass
    return None


def cpu_cores() -> int:
    """Cores available to this process, never fewer than one."""
    quota = _cgroup_cpu_quota()
    detected = os.cpu_count() or 1
    if quota:
        # floor, because half a core cannot run half a job.
        detected = min(detected, max(1, int(math.floor(quota))))
    return max(1, detected)


_CGROUP_MEMORY_PATHS = (
    "/sys/fs/cgroup/memory.max",                    # cgroup v2
    "/sys/fs/cgroup/memory/memory.limit_in_bytes",  # cgroup v1
)


def _cgroup_memory_limit_gb(paths: tuple[str, ...] = _CGROUP_MEMORY_PATHS) -> float | None:
    for path in paths:
        f = Path(path)
        if not f.is_file():
            continue
        try:
            raw = f.read_text().strip()
        except OSError:
            continue
        if raw in ("max", ""):
            continue
        try:
            value = int(raw)
        except ValueError:
            continue
        # Unlimited is expressed as a number near 2**63 rather than "max" on
        # cgroup v1, which would otherwise read as several exabytes of RAM.
        if value <= 0 or value > (1 << 60):
            continue
        return value / (1024 ** 3)
    return None


def memory_budget() -> tuple[float, float]:
    """RAM available to this process, and the headroom to keep clear of.

    Returns (gb, reserved_gb). The reserve depends on where the figure came
    from -- see the constants above.
    """
    limit = _cgroup_memory_limit_gb()
    total = None
    try:
        total = (os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES")) / (1024 ** 3)
    except (ValueError, OSError, AttributeError):
        total = None

    if limit and limit > 0 and (not total or limit < total):
        return limit, _RESERVED_CGROUP_GB
    if total and total > 0:
        return total, _RESERVED_HOST_GB
    return 2.0, _RESERVED_CGROUP_GB


def memory_gb() -> float:
    """RAM available to this process in GB, cgroup limit included."""
    return memory_budget()[0]


def gpu_count() -> int:
    """CUDA devices CTranslate2 can actually use.

    Asked of CTranslate2 rather than nvidia-smi: a driver can be present while
    the build in this image has no CUDA support, and that difference is the
    whole question.
    """
    try:
        import ctranslate2  # noqa: PLC0415 - optional, and import cost is real
        return int(ctranslate2.get_cuda_device_count())
    except Exception:  # noqa: BLE001 - any failure means "no usable GPU"
        return 0


def _env(name: str) -> str:
    return str(os.getenv(name, "") or "").strip()


def whisper_model_for(has_gpu: bool, ram_gb: float) -> str:
    """The largest model this machine can hold without swapping.

    Accuracy is worth real money here -- the scoring, the captions and the ayah
    matching all read this text -- so take the biggest that fits rather than the
    smallest that works.
    """
    if has_gpu:
        return "large-v3"
    if ram_gb >= 12:
        return "medium"
    if ram_gb >= 6:
        return "small"
    return "base"


def plan() -> dict[str, Any]:
    """The whole hardware decision, in one place, with every source recorded."""
    cores = cpu_cores()
    ram, reserved = memory_budget()
    gpus = gpu_count()
    has_gpu = gpus > 0

    device = _env("WHISPER_DEVICE") or ("cuda" if has_gpu else "cpu")
    # int8 on a GPU throws away most of what the GPU is for; float16 is the
    # pairing CTranslate2 wants there. On CPU int8 is both faster and smaller.
    compute_type = _env("WHISPER_COMPUTE_TYPE") or ("float16" if device == "cuda" else "int8")
    model = _env("WHISPER_MODEL") or whisper_model_for(has_gpu, ram)

    env_concurrency = _env("WORKER_MAX_CONCURRENT_JOBS")
    if env_concurrency:
        concurrency = max(1, int(env_concurrency))
    else:
        by_cpu = cores // _CORES_PER_JOB
        by_ram = int((ram - reserved) // _GB_PER_JOB)
        concurrency = max(1, min(by_cpu, by_ram))
        # A GPU serialises on its own memory, so more parallel jobs there buys
        # contention rather than throughput.
        if has_gpu:
            concurrency = max(1, min(concurrency, 2))

    env_threads = _env("FFMPEG_THREADS")
    # Split the cores between the jobs that will be running, so two jobs cannot
    # each believe they own the machine. Four threads on two cores was ffmpeg
    # contending with itself and with Whisper.
    threads = max(1, int(env_threads)) if env_threads else max(1, cores // concurrency)

    return {
        "cores": cores,
        "memoryGb": round(ram, 2),
        "reservedGb": reserved,
        "gpus": gpus,
        "device": device,
        "computeType": compute_type,
        "model": model,
        "maxConcurrentJobs": concurrency,
        "ffmpegThreads": threads,
    }


if __name__ == "__main__":  # pragma: no cover - diagnostic entry point
    import json
    print(json.dumps(plan(), indent=2))
