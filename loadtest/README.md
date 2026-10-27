# Load test

Runs the real `api/*.js` handlers over HTTP with an in-memory Redis that adds Upstash-like latency (default 20 ms; set `LAT=40`).

    LAT=25 node loadtest/server.js &      # API on :9930
    node loadtest/burst.js                # bursts, rate limiter, polling, kitchen feed size, bumps, 60 s service sim

Results depend on your machine and on the simulated Redis latency, not on real Vercel/Upstash.
Look at p95 and error counts, and at "Redis commands" (the free Upstash plan allows 500K per month).
