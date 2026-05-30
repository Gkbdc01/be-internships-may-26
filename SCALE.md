# Scale Plan (fill this)
- Data model/indexes:
- Idempotency across instances:
- Rate limiting across instances:
- Observability (logs/metrics/alerts):
- Failure modes (DB down / partial outages / retries):
- 10k RPS design sketch (infra & cost ballpark):


# Scale Plan

**- Data model/indexes:**
To support 10k RPS, the database must transition from SQLite to a robust RDBMS like PostgreSQL.
* **Table:** `signals (id, user_id, type, payload, idempotency_key, created_at)`
* **Indexes:** * `UNIQUE(idempotency_key)`: Critical for enforcing atomic idempotency and preventing check-then-insert race conditions at the database level.
  * `INDEX(user_id, created_at DESC)`: Required to optimize the `GET /v1/signals` query.
  * `INDEX(created_at)`: Useful for background TTL/cron jobs to archive or drop old signals.

**- Idempotency across instances:**
Relying purely on database unique constraints at 10k RPS can create severe write-contention and lock overhead. 
* **Solution:** Introduce Redis as a first-line idempotency store.
* **Flow:** Incoming requests attempt a `SET idempotency_key payload NX EX 86400` (Set if Not eXists with a 24-hour TTL). 
* If successful, proceed to insert into the DB. If it fails (key exists), fetch and return the cached resource, entirely bypassing the database.

**- Rate limiting across instances:**
The in-memory Token Bucket `Map` will fail when the application is scaled horizontally across multiple Node.js processes or containers.
* **Solution:** Migrate the Token Bucket state to a centralized **Redis Cluster**.
* **Atomicity:** Use a Redis Lua script to perform the "read tokens, calculate refill, decrement, and save" logic. Because Redis is single-threaded, Lua scripts execute atomically in a single network round trip, eliminating concurrency races.

**- Observability (logs/metrics/alerts):**
* **Logs:** Fastify’s default `pino` logger provides structured JSON logs. Inject correlation IDs (Trace IDs) into every request and ship them to a centralized log aggregator (e.g., Datadog, ELK).
* **Metrics:** Expose a `/metrics` endpoint for Prometheus to scrape. Track critical RED metrics (Rate, Errors, Duration): `http_request_duration_seconds`, rate limit rejections (429s), and DB connection pool saturation.
* **Alerts:** Set up PagerDuty alerts for sustained spikes in 5xx errors, P99 latency > 200ms, or DB CPU utilization > 80%.

**- Failure modes (DB down / partial outages / retries):**
* **Transient DB Failures:** Handled via exponential backoff with jitter on the application side to prevent thundering herds on recovery.
* **Prolonged DB Down:** Implement a **Circuit Breaker** pattern (e.g., using `opossum`). If the DB fails repeatedly, the circuit opens, immediately returning `503 Service Unavailable` to shed load and give the DB time to recover.
* **Redis Outage (Partial):** Gracefully degrade rate limiting to a local in-memory fallback (allowing temporary overages) rather than failing completely. 

**- 10k RPS design sketch (infra & cost ballpark):**
* **Compute:** AWS ECS (Fargate) or EKS. Node.js processes are single-threaded, so we scale horizontally. ~30-40 lightweight containers to handle the JSON parsing and I/O orchestration overhead.
* **Load Balancing:** AWS Application Load Balancer (ALB) to distribute incoming HTTP requests evenly across containers.
* **Caching:** Amazon ElastiCache (Redis) for distributed rate limiting and idempotency caching.
* **Database:** Amazon Aurora PostgreSQL (Primary for writes, Read-Replica for the `GET` endpoint). 
* **Connection Pooling:** Use **PgBouncer** sidecars to multiplex thousands of Node.js client connections onto a small number of actual Postgres connections to prevent memory exhaustion.
* **Cost Ballpark:** ~$2,500 - $4,000 / month (Compute: ~$800, Aurora: ~$1,500+, ElastiCache: ~$300, ALB/Data Transfer: ~$500+).