# Performance notes (measured 27 Oct 2026, simulated backend)

Sandbox test: real API code, in-memory Redis with ~25 ms latency, 2 CPU cores shared with the load generator.

| Scenario | Result |
|---|---|
| 60 s service sim: 25 tables, 2 tablets, 57 orders | 0 errors. Place order p95 72 ms, guest status poll p95 37 ms, kitchen poll p95 152 ms, bump p95 69 ms |
| Burst: 200 simultaneous orders | 0 errors, p95 603 ms (Redis round trips dominate; one Node process here, Vercel scales out) |
| Guest status polls, 500 concurrent | 0 errors, p50 137 ms, p95 1.6 s (test machine saturated; ~1,000 req/s) |
| One IP sending 100 orders | 88 rejected with 429 (limit 12 per minute) |
| Full kitchen feed at ~460 open tickets | ~159 KB, p95 86 ms; real service has 20–60 open tickets |
| Page weight | index.html 141 KB raw, 42 KB gzip, 36 KB brotli |
| Phone (4x CPU slowdown) | first dish visible about 1.8 s, one 0.9 s long task during first render |

## Free-tier budget (Upstash 500K commands/month, 10 GB bandwidth)
Estimate for ~100 orders/day over 12 h with ONE kitchen tablet: about 470K commands/month. A second tablet adds roughly 250K.
Polling is deliberately slow when idle: tablet 3 s while orders are moving, 8 s after 2 quiet minutes, 15 s after 10;
guests poll every 10 s, only while the page is visible and the order isn't served; the menu is edge-cached for 20 s.
Over the limit, Upstash can bill per command, or you can stop polling when closed.
