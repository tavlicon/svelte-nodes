from __future__ import annotations

import asyncio
import json
from typing import AsyncGenerator

from sse_starlette.sse import EventSourceResponse

from .jobs import JobStore, JobEvent


async def sse_event_stream(store: JobStore, job_id: str) -> AsyncGenerator[dict, None]:
    """
    SSE generator:
    - replays buffered history
    - then streams live events
    """
    history = await store.list_events_snapshot(job_id)
    for ev in history:
        yield {"event": ev.event, "data": json.dumps(ev.data)}

    q = await store.subscribe(job_id)
    try:
        while True:
            ev: JobEvent = await q.get()
            yield {"event": ev.event, "data": json.dumps(ev.data)}
    finally:
        await store.unsubscribe(job_id, q)


def sse_response(store: JobStore, job_id: str) -> EventSourceResponse:
    return EventSourceResponse(sse_event_stream(store, job_id))


async def periodic_cleanup_task(store: JobStore, *, interval_seconds: int = 60) -> None:
    while True:
        try:
            await store.cleanup_expired()
        except Exception:
            # Cleanup should never crash the server.
            pass
        await asyncio.sleep(interval_seconds)

