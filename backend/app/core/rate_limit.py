"""Simple in-memory rate limiting for sensitive community endpoints."""

from __future__ import annotations

import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request

# key -> deque of timestamps
_buckets: dict[str, deque[float]] = defaultdict(deque)


def rate_limit(request: Request, *, key: str, limit: int, window_seconds: int = 60) -> None:
    """Raise 429 if more than `limit` hits in the window for this client+key."""
    client = request.client.host if request.client else "unknown"
    bucket_key = f"{client}:{key}"
    now = time.monotonic()
    q = _buckets[bucket_key]
    cutoff = now - window_seconds
    while q and q[0] < cutoff:
        q.popleft()
    if len(q) >= limit:
        raise HTTPException(status_code=429, detail="Too many requests — try again shortly")
    q.append(now)
