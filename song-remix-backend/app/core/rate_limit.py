import math
import time
from collections import deque
from collections.abc import Callable

from app.config import settings


class SlidingWindowLimiter:
    """In-memory sliding-window counter keyed by client IP (single-process only)."""

    def __init__(self, max_events: int, window_seconds: float, clock: Callable[[], float] = time.monotonic) -> None:
        self.max_events = max_events
        self.window_seconds = window_seconds
        self._clock = clock
        self._events: dict[str, deque[float]] = {}

    def _recent(self, key: str, now: float) -> deque[float]:
        events = self._events.get(key)
        if events is None:
            return deque()
        while events and events[0] <= now - self.window_seconds:
            events.popleft()
        if not events:
            self._events.pop(key, None)
            return deque()
        return events

    def retry_after(self, key: str) -> int:
        now = self._clock()
        events = self._recent(key, now)
        if len(events) < self.max_events:
            return 0
        return max(1, math.ceil(events[0] + self.window_seconds - now))

    def hit(self, key: str) -> None:
        now = self._clock()
        self._recent(key, now)
        self._events.setdefault(key, deque()).append(now)

    def reset(self, key: str | None = None) -> None:
        if key is None:
            self._events.clear()
        else:
            self._events.pop(key, None)


login_rate_limiter = SlidingWindowLimiter(settings.LOGIN_RATE_LIMIT_ATTEMPTS, settings.LOGIN_RATE_LIMIT_WINDOW_SECONDS)
