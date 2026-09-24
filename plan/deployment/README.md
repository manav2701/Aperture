# Deployment

Designed for a bootstrapped start: one server you control, Docker Compose, managed only where it's free. The same images later run on bigger infrastructure or inside a customer's cloud.

## Environments

| Environment | Where | Data | External services | Who uses it |
|---|---|---|---|---|
| **local** | Your machine, `docker compose -f infra/compose.dev.yml up` | Seeded fake data | Fake upstreams, Stripe sandbox via `stripe listen`, local Solana validator | You while developing |
| **staging** | Your server, separate compose project and database | Test orgs | Real provider sandboxes / low-limit keys, Stripe sandbox, Solana **devnet** | "Try it yourself" checks; pilot demos |
| **production** | Your server (or a second one), from Phase 10 | Real customers | Live keys, Stripe live (customer-owned), Solana mainnet | Customers |

Staging is deployed from **Phase 3** onward so every later phase can be tried live.

## Topology (single server)

```
Internet ──► Cloudflare (DNS, TLS, WAF, caching of static assets)
                │
                ▼
          ┌──────────── server ─────────────────────────────────────────┐
          │ Caddy (TLS origin certs, reverse proxy, HTTP/2, compression) │
          │   app.<domain>  → web:3000                                   │
          │   api.<domain>  → api:4000       (+ /webhooks/*)             │
          │   gw.<domain>   → gateway:4100   (streaming, no buffering)   │
          │                                                              │
          │ web · api · gateway · worker · signer (internal network only) │
          │ postgres:17 (volume, not exposed) · minio (or Cloudflare R2)  │
          │ backup sidecar (WAL-G → object storage)                      │
          └──────────────────────────────────────────────────────────────┘
```

Server sizing: 4 vCPU / 8 GB RAM / 160 GB SSD handles staging + production for the first customers. If you use your own server, those are the minimums; Ubuntu 24.04 LTS recommended.

## Files (created in Phases 1, 3, 10)

```
infra/
├── compose.dev.yml          postgres, minio, fake-upstream, solana-test-validator
├── compose.staging.yml
├── compose.prod.yml
├── Caddyfile
├── backup/                  WAL-G config, restore script
└── scripts/
    ├── deploy.sh            pull images → run migrations → rolling restart → health check
    ├── rollback.sh          redeploy previous image tag
    └── restore-drill.sh     restore latest backup into a scratch DB and run checks
apps/*/Dockerfile            multi-stage, non-root user, distroless or node:24-slim runtime
```

## CI/CD (GitHub Actions)

1. **PR**: install (frozen lockfile) → typecheck → lint → unit/property → integration (Testcontainers) → e2e smoke (compose) → Semgrep, gitleaks, audit → build images (not pushed).
2. **Merge to `main`**: build and push images to GitHub Container Registry tagged with the commit SHA → deploy to **staging** automatically → run post-deploy smoke (`tools/try/smoke.sh`).
3. **Release** (git tag `v*`): promote the same SHA-tagged images to **production** after manual approval (GitHub environment protection).
4. Deploy mechanism: the workflow SSHes with a deploy-only key, runs `infra/scripts/deploy.sh <sha>`:
   - `docker compose pull`
   - run migrations as a one-off container (`drizzle-kit migrate`); abort on failure
   - restart services one at a time (`gateway` and `api` run two replicas behind Caddy from Phase 10 for zero-downtime)
   - wait for `/readyz`; if any fail within 60 s → `rollback.sh`
5. Migrations are **expand/contract**: add columns/tables first, deploy code that uses both, remove old ones in a later release. Never a destructive migration in the same release as the code change.

## Secrets

- Stored as `infra/secrets/{staging,prod}.env.sops` encrypted with **SOPS + age** in the repo; the age private key lives only on the server and in your password manager.
- CI never sees production secrets; it only triggers the deploy script on the server.
- Required secrets (grows per phase): `DATABASE_URL`, `BETTER_AUTH_SECRET`, `APERTURE_KEK_v1`, `APERTURE_KEY_PEPPER`, `SIGNER_KEK_v1`, `S3_*`, `SENTRY_DSN`, `SMTP_*` (or Resend key), `SLACK_*`, `STRIPE_*` (for Aperture's own billing), `SOLANA_RPC_URL(S)`.

## Backups and recovery

- WAL-G continuous archiving + nightly base backups to object storage (Backblaze B2 or Cloudflare R2), encrypted; 30-day retention; point-in-time recovery.
- Object storage (media, exports) versioned with a 30-day lifecycle.
- **RPO** 5 minutes, **RTO** 2 hours for the first year.
- Monthly restore drill (`restore-drill.sh`) — a backup that has never been restored doesn't count.

## Monitoring and alerting

| What | Tool | Alert |
|---|---|---|
| Uptime of app/api/gateway | Better Stack or Uptime Kuma (free) | 2 failed checks |
| Errors | Sentry (free tier) | new issue, spike |
| Traces/metrics/logs | OpenTelemetry → Grafana Cloud free tier (or self-hosted Grafana + Loki + Tempo later) | card webhook p99 > 800 ms; gateway p99 overhead > 60 ms; connector lag > 10 min; open holds older than TTL; ledger drift ≠ 0; signer refusals spike |
| Disk / CPU / memory | node-exporter → Grafana | > 80% |
| Backups | WAL-G status check | last base backup > 26 h |
| TLS | Caddy auto-renew + expiry check | < 14 days |

Runbooks in `docs/runbooks/` for each alert (what it means, how to check, how to fix).

## Latency notes

- Stripe's real-time authorization webhook has a 2-second budget. A European or Middle-East server adds roughly 80–200 ms of network time to Stripe's US-based infrastructure — acceptable against a 400 ms target, but measure it in Phase 8 and move the webhook service to a US region if a customer's card program is US-based and latency is tight.
- The gateway should run close to the customer's users and to the upstream providers; for GCC customers a European or UAE region is fine.

## Data residency and self-hosting

Government-linked and regulated GCC customers may require data to stay in the UAE. Offer:
1. **Self-hosted bundle**: the same `compose.prod.yml` + images + a setup guide, deployable on the customer's infrastructure in the UAE (AWS `me-central-1`, Azure UAE North, Oracle Dubai, or local providers). Aperture ships updates as signed images.
2. **Hosted in-country** later if demand justifies a UAE region.

## Cost (monthly, first customers)

| Item | Cost (approx., verify current prices) |
|---|---|
| Server (4 vCPU / 8 GB), or your own | USD 15–40 |
| Backups (object storage, < 100 GB) | USD 1–5 |
| Cloudflare, Sentry, Grafana Cloud, uptime monitor (free tiers) | USD 0 |
| Email (transactional, e.g. Resend/Postmark free tier) | USD 0–15 |
| Solana RPC (Helius/QuickNode free tiers; paid when on mainnet volume) | USD 0–50 |
| Domain (you have one) | — |
| **Total** | **≈ USD 20–110** |

## Scaling path (when needed, not before)

1. Separate the database onto its own server or a managed Postgres (UAE region if required).
2. Two or more gateway/api replicas behind Caddy or a load balancer.
3. Move hot budget counters to Redis/Valkey with Postgres as the journal, if reserve contention on single budgets becomes a bottleneck (measure first — INV-1 must still hold).
4. Kubernetes only when there are multiple regions or customers with dedicated deployments.
