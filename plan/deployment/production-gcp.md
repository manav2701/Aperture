# Production on Google Cloud

This replaces the "one Hetzner server" route in `plan/phases/phase-10-*` and section E of
`plan/your-checklist.md`. It moves everything that runs today on Render, Neon, Vercel and
Supabase into one Google Cloud project, paid for by the $300 / 90-day credit, and keeps the
bill after the credit ends at about **$70 a month**.

Status on 4 Oct 2026: written. Nothing is created in Google Cloud yet. Part 6 lists the code
and infra I still need to build before the move.

---

## 1. What runs where

```
                 Cloudflare DNS (free, proxy off for Cloud Run hosts)
                         │
   app.<domain> ─────────┼──► Cloud Run "web"      Next.js, scales to zero
   api.<domain> ─────────┼──► Cloud Run "api"      min 1 instance
   gw.<domain>  ─────────┘──► Cloud Run "gateway"  min 1 instance
                                     │  Direct VPC egress (private network "aperture")
                                     ▼
              Cloud Run "signer"  ingress = internal only, no public URL
              Compute Engine e2-micro "worker"  (always-free VM, runs the worker container)
              Cloud SQL Postgres 17 "aperture-db"  private IP only, backups + point-in-time recovery
              Cloud Storage  "…-media" (images and video)
              Secret Manager (every secret, each service sees only its own)
              Artifact Registry (container images)
              Cloud Logging + Monitoring (logs, uptime checks, alerts to your phone)
```

**Why this shape:**

- **Cloud Run for anything that answers requests.** No server to patch, TLS and domains
  included, deploys are one command, and rollback is one click.
- **The worker on a VM.** The worker runs timers inside the process
  (`packages/jobs/src/scheduler.ts`), so it needs a CPU that never sleeps. On Cloud Run that
  costs about $50 a month; the e2-micro VM is in Google's always-free tier.
- **Cloud SQL instead of Postgres you run yourself.** The ledger is the one thing you cannot
  lose. Google handles backups, point-in-time recovery and patching, so WAL-G and the
  backup bucket are no longer needed.
- **The signer has no public address at all.** Only the API and gateway can reach it, over
  the private network. That is the GCP version of compose's `internal` network (X11).

**Region: `us-central1` (Iowa).**

- It is the cheapest region, and it is where the always-free e2-micro lives.
- It sits next to OpenRouter, OpenAI and Anthropic, which are in the US. Most gateway
  latency is the provider, not you.
- **When a customer requires GCC data residency,** move Cloud SQL and the services to
  `me-central2` (Dammam) or `me-central1` (Doha). The steps are the same; only the
  `--region` changes. Google has no UAE region. If a contract names the UAE, that is
  AWS `me-central-1`, a separate decision.

---

## 2. Cost

Prices are list prices for `us-central1` in Sept/Oct 2026. Check the
[pricing calculator](https://cloud.google.com/products/calculator) before you commit.

| Item | Size | Per month |
|---|---|---|
| Cloud SQL Postgres | `db-g1-small` (1.7 GB, shared core), 10 GB SSD, 7-day backups + PITR | ~$30 |
| Cloud Run `api` | 1 vCPU / 512 MiB, min 1 (idle-rate) | ~$10 |
| Cloud Run `gateway` | 1 vCPU / 512 MiB, min 1 (idle-rate) | ~$10 |
| Cloud Run `web` | 1 vCPU / 1 GiB, min 0 (min 1 later if cold starts annoy) | $0–10 |
| Cloud Run `signer` | 1 vCPU / 256 MiB, min 0 | ~$0 on devnet |
| Worker VM | e2-micro + 10 GB disk | $0 (always free) |
| Secret Manager | ~25 secrets | ~$1.50 |
| Artifact Registry | ~2 GB of images | ~$0.20 |
| Cloud Storage | media, a few GB | < $1 |
| Logging / Monitoring / uptime checks | under the free allowance | $0 |
| Network egress | small at pilot volume | ~$1–3 |
| **Total** | | **~$60–75** |

- **Over the 90 days** that is about $200 of the $300. The rest is headroom for a
  traffic spike or a second Cloud SQL instance during the restore drill.
- **After the credit ends:** about $70 a month.
- **Your old bills go away:** Render, Neon, Supabase, and Vercel Pro. Vercel's free
  Hobby plan does not allow commercial use, so you would have needed Pro at $20 a month.

**Things the $300 credit cannot pay for (Google's trial rules):**

- **The Gemini API from AI Studio.** That is our `GEMINI_API_KEY`, so it keeps billing
  separately on its own small allowance.
- GPUs, Marketplace products, and quota increases.

**What happens on day 90:**

- Resources stop unless you have clicked **"Upgrade to a paid account."**
- You get a 30-day grace period.
- **Upgrade in week 1.** It does not cost anything extra, and the remaining credit still
  applies. Then a forgotten date cannot take production down.

**Set a budget alert on day 1:** Billing → Budgets & alerts, with alerts at $50, $100 and
$200 of actual spend, and email to you.

---

## 3. The Google Cloud APIs to enable

Create one project, e.g. `aperture-prod`, then run this once in Cloud Shell:

```sh
gcloud services enable \
  run.googleapis.com \
  sqladmin.googleapis.com \
  compute.googleapis.com \
  servicenetworking.googleapis.com \
  vpcaccess.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  storage.googleapis.com \
  iam.googleapis.com \
  iamcredentials.googleapis.com \
  sts.googleapis.com \
  cloudresourcemanager.googleapis.com \
  logging.googleapis.com \
  monitoring.googleapis.com
```

| API | What it is for |
|---|---|
| Cloud Run | web, api, gateway, signer, and the migration job |
| Cloud SQL Admin | the Postgres instance |
| Compute Engine | the VPC network and the worker VM |
| Service Networking | private IP between the VPC and Cloud SQL |
| Serverless VPC Access | lets Cloud Run use the private network (we use Direct VPC egress, which needs the API on) |
| Artifact Registry | container images |
| Secret Manager | secrets |
| Cloud Storage | media bucket |
| IAM, IAM Credentials, Security Token Service | GitHub Actions deploys without a JSON key (Workload Identity Federation) |
| Resource Manager | project-level IAM from scripts |
| Logging, Monitoring | logs, uptime checks, alerts (usually already on) |

**Not needed:**

- **Cloud Scheduler.** The worker has its own scheduler.
- **Cloud Build.** Images are built in GitHub Actions.
- **Cloud KMS.** The KEKs live in Secret Manager. Moving them to KMS is a later
  hardening step.
- **Vertex AI.** Our Google connector uses the AI Studio key. Vertex support would be new
  code; do it only if you want Gemini spend on GCP credits.

---

## 4. Services outside Google Cloud

| Service | What you do | Cost |
|---|---|---|
| **Domain** (D2) | Buy it (Cloudflare Registrar is at-cost). | ~$10/yr |
| **Cloudflare** | DNS only. For the Cloud Run hosts, keep the proxy **off** (grey cloud) so Google can issue the certificates. | free |
| **Resend** | Verify the domain (SPF, DKIM, DMARC records in Cloudflare). Until then, email only reaches you; this is why the production invite test could not email anyone. Set `EMAIL_FROM=Aperture <noreply@yourdomain>`. | free to 3k/mo |
| **Google OAuth** | In the same GCP project: APIs & Services → OAuth consent screen (External, publish it), then Credentials → OAuth client (Web). Redirect URI: `https://api.<domain>/api/auth/callback/google`. | free |
| **Stripe** | Billing for Aperture itself (products Team and Business, webhook `https://api.<domain>/webhooks/stripe-billing`, Customer Portal). Issuing only after decision D5. | per transaction |
| **OpenRouter / Gemini** | Keep your keys; the $1 test cap still applies. | usage |
| **Helius** | One RPC key for devnet and later mainnet (`SIGNER_RPC_*`). | free tier |
| **x402 facilitators** | CDP keys stay on your laptop for the spike. Production uses the facilitator URLs only, with no secret, unless we pick CDP. | free on devnet |
| **Slack app** (optional) | For interactive approvals. Redirect and interactivity URLs on `api.<domain>`. | free |
| **GitHub** | A `production` environment with you as required reviewer, plus the variables in step 9. | free |

**No longer needed:** Render, Neon, Supabase S3, Vercel, Backblaze B2, Better Stack and
Grafana Cloud. Cloud Monitoring does uptime and alerts; Cloud SQL does backups.

---

## 5. Step by step (what you click or run)

All commands run in **Cloud Shell**, the terminal button in the console, so nothing is
installed on your laptop. Set these once:

```sh
PROJECT=aperture-prod REGION=us-central1
gcloud config set project $PROJECT
```

1. **Project and billing.** Create the project, attach the trial billing account,
   upgrade to paid (see §2), and set the budget alerts. Enable the APIs from §3.

2. **Network:**
   ```sh
   gcloud compute networks create aperture --subnet-mode=custom
   gcloud compute networks subnets create aperture-run --network=aperture --region=$REGION --range=10.10.0.0/24
   gcloud compute addresses create google-services --global --purpose=VPC_PEERING --prefix-length=20 --network=aperture
   gcloud services vpc-peerings connect --service=servicenetworking.googleapis.com --ranges=google-services --network=aperture
   ```

3. **Cloud SQL:**
   ```sh
   gcloud sql instances create aperture-db --database-version=POSTGRES_17 --tier=db-g1-small \
     --region=$REGION --network=aperture --no-assign-ip --storage-type=SSD --storage-size=10 \
     --storage-auto-increase --backup-start-time=02:00 --enable-point-in-time-recovery \
     --retained-backups-count=7 --deletion-protection
   gcloud sql databases create aperture --instance=aperture-db
   ```
   - Create the users `aperture_owner` (runs migrations) and `aperture_app` (non-owner,
     subject to RLS), with the same grants as on Neon.
   - I will give you the exact SQL in `infra/gcp/roles.sql` (Part 6, G2).

4. **Secrets:**
   - For each secret in the table in step 7, run
     `printf '%s' 'VALUE' | gcloud secrets create NAME --data-file=-`.
   - **Generate fresh production values.** Never reuse staging's.
   - Store `APERTURE_KEK_V1`, `SIGNER_KEK_V1` and `BETTER_AUTH_SECRET` **offline** in your
     password manager too. Losing a KEK loses every encrypted connection secret.

5. **Media bucket:**
   ```sh
   gcloud storage buckets create gs://$PROJECT-media --location=$REGION --uniform-bucket-level-access --public-access-prevention
   ```
   - Then go to Cloud Storage → Settings → Interoperability, create an HMAC key for a
     service account `media@…`, and grant that account `roles/storage.objectAdmin` on this
     bucket only.
   - The S3 settings become:
     - `MEDIA_S3_ENDPOINT=https://storage.googleapis.com`
     - `MEDIA_S3_REGION=auto`
     - the bucket name
     - the HMAC id and secret.

6. **Images:**
   ```sh
   gcloud artifacts repositories create aperture --repository-format=docker --location=$REGION
   ```

7. **Service accounts and their secrets.** Each service runs as its own account and can
   read only its own secrets:

   | Service | Account | Secrets it reads |
   |---|---|---|
   | api | `run-api@` | `DATABASE_URL`, `BETTER_AUTH_SECRET`, `APERTURE_KEY_PEPPER`, `APERTURE_KEK_V1`, `RESEND_API_KEY`, `GOOGLE_CLIENT_ID/SECRET`, `MEDIA_S3_*`, `SIGNER_SHARED_SECRET`, `STRIPE_*`, `SLACK_*`, `METRICS_TOKEN` |
   | gateway | `run-gateway@` | `DATABASE_URL`, `APERTURE_KEY_PEPPER`, `APERTURE_KEK_V1`, `SIGNER_SHARED_SECRET`, `MEDIA_S3_*`, `METRICS_TOKEN` |
   | signer | `run-signer@` | `DATABASE_URL`, `SIGNER_KEK_V1`, `SIGNER_SHARED_SECRET`, `SIGNER_RPC_DEVNET`, `SIGNER_RPC_MAINNET` |
   | worker VM | `vm-worker@` | `DATABASE_URL`, `APERTURE_KEK_V1`, `RESEND_API_KEY`, `MEDIA_S3_*`, `NOTARY_SECRET_KEY` |
   | migrate job | `run-migrate@` | `DATABASE_MIGRATION_URL` |
   | web | `run-web@` | none (plain env: `API_INTERNAL_URL`, `MEDIA_ORIGIN`) |

   - `SIGNER_KEK_V1` is readable by the signer only. Today on Render it sits in the API's
     environment because the signer is embedded there.
   - The `DATABASE_URL` value uses Cloud SQL's private IP:
     `postgres://aperture_app:<pw>@10.x.x.x:5432/aperture`

8. **Move the data off Neon (one evening, about 30 minutes of downtime):**
   - Put the app in maintenance by scaling Render to 0.
   - `pg_dump --no-owner --no-acl -Fc` from Neon.
   - `pg_restore` into Cloud SQL as `aperture_owner`, through a temporary Cloud SQL Auth
     Proxy in Cloud Shell.
   - Run the grants script.
   - Verify with `pnpm --filter @aperture/cli verify-db` (ledger counters and audit chains
     intact), the same check as the restore drill.
   - **Or start production empty.** You have no paying customers yet, so this is simpler
     and cleaner. Staging data, including my test org "E2E Test Co", stays behind on Neon.

9. **GitHub → Google, with no key file.** Create a Workload Identity pool for
   `manav2701/Aperture` and a `deployer@` account with these roles:
   - Artifact Registry Writer
   - Cloud Run Admin
   - Service Account User on the run accounts

   Add these GitHub variables:
   - `GCP_PROJECT`
   - `GCP_REGION`
   - `GCP_WIF_PROVIDER`
   - `GCP_DEPLOYER_SA`
   - `PROD_API_URL`
   - `PROD_GATEWAY_URL`
   - `PROD_WEB_URL`

   I will write the exact commands in `infra/gcp/README.md` (G3).

10. **First deploy.** Tag `v1.0.0`. The release workflow then:
    - builds and pushes the images;
    - runs the `migrate` Cloud Run job;
    - deploys signer, api, gateway and web;
    - creates or updates the worker VM;
    - runs the smoke checks.

    You approve the `production` step in GitHub.

11. **Domains:**
    - Run `gcloud beta run domain-mappings create --service=web --domain=app.<domain> --region=$REGION`,
      and the same for `api` and `gw`.
    - Add the DNS records it prints in Cloudflare, with the proxy off.
    - Certificates arrive in 15–60 minutes.

12. **Point everything at the new URLs:**
    - Google OAuth redirect.
    - Stripe webhook.
    - Slack URLs.
    - `WEB_ORIGIN`, `API_PUBLIC_URL` and `GATEWAY_PUBLIC_URL`.
    - Resend's verified domain.

13. **Monitoring:**
    - Uptime checks on `https://api.<domain>/readyz` and `https://gw.<domain>/readyz`
      every minute.
    - Alert policies on:
      - an uptime failure;
      - a Cloud SQL CPU above 80% for 10 minutes;
      - a 5xx rate above 2% for 5 minutes;
      - the log-based metric `"job failed"` from the worker.
    - Notify by email, and by the Google Cloud mobile app as a push.

14. **Restore drill.**
    - Clone the Cloud SQL instance to a point in time 1 hour ago.
    - Run `pnpm --filter @aperture/cli verify-db` against the clone; it must pass.
    - Delete the clone.

    Do this once before launch, then monthly (G4).

15. **Switch off the old stack:** Render, Neon (after a final dump stored offline), Supabase
    and Vercel.

---

## 6. What I still have to build before step 10

| # | Work | Why |
|---|---|---|
| G1 | Media storage: set `requestChecksumCalculation: 'WHEN_REQUIRED'` on the S3 client and run the media test against a real GCS bucket | The current AWS SDK adds checksum headers that Google's S3-compatible API can reject; Supabase accepted them. |
| G2 | `infra/gcp/`: Cloud Run service definitions (CPU, memory, min/max instances, VPC egress, secrets), the worker VM startup script (Container-Optimized OS pulling the worker image), `roles.sql`, and a `setup.sh` that does steps 2–7 from variables | So the setup is a script you run, not 60 commands typed by hand. |
| G3 | `release.yml` for GCP: Workload Identity login, push to Artifact Registry, migrate job, deploy in order (signer → api → gateway → web → worker), smoke checks, then traffic to the new revision | It replaces the SSH-to-server deploy. |
| G4 | Cloud SQL restore drill script: clone → verify → delete | It replaces the WAL-G drill. |
| G5 | Database pool sizes per service | `db-g1-small` allows about 50 connections. Max instances × pool size must stay under that: api 3×8, gateway 3×8, worker 4, signer 2. |
| G6 | Signer auth: Cloud Run IAM (ID token) on top of the shared secret | It gives defence in depth now that the signer is a separate service. |
| G7 | `infra/gcp/monitoring.sh` | Uptime checks and alert policies as code (step 13). |
| G8 | Update `plan/your-checklist.md` §E and `infra/prod.env.example` | Hetzner / B2 / Better Stack replaced by this plan; `compose.prod.yml` stays for self-hosting. |

These are about two days of work. Every piece is tested against real GCP inside the free
credit, using a throwaway `aperture-staging` project first and deleting it afterwards.

---

## 7. Order of work

| When | What |
|---|---|
| Day 1 (you) | Steps 1–2. Buy the domain. Start Resend domain verification (DNS takes time). |
| Days 1–2 (me) | G1–G7, tested in a scratch GCP project. |
| Day 3 (you, with my commands) | Steps 3–7 and 9. |
| Day 3 | Step 10: the first deploy to `*.run.app` URLs. I repeat the full browser click-through against them. |
| Day 4 | Steps 11–14: domains, monitoring, restore drill. |
| Day 5 | Step 8 (or start empty), step 15. Production is on GCP. |

---

## 8. Production test on the current stack (4 Oct 2026)

Before planning the move, I tested the live app (Vercel + Render + Neon) through a real
browser, the way a new customer would. I used a throwaway account and the org "E2E Test Co".

**Worked:**

- **Accounts and security:**
  - sign-up, sign-in, and onboarding with org creation;
  - turning on two-factor, then signing in with a code;
  - all 19 pages load with no errors.
- **Setup:**
  - creating a team, a budget and an agent;
  - connecting OpenRouter, which found your existing key;
  - setting up the gateway;
  - creating a gateway key.
- **Spending through the gateway:**
  - a workspace chat answered and was charged to the budget;
  - an agent call through `/gw/v1/chat/completions` was recorded on the Spend page;
  - an approval-threshold policy blocked the next call with `aperture_approval_required`;
  - the owner was correctly refused permission to approve their own agent's request
    (separation of duties).
- **Other features:**
  - issuing a mandate;
  - connecting Solana devnet with the treasury;
  - saving the privacy retention setting;
  - the audit log (13 records, chain verified intact);
  - a revoked key stopped working (401).
- **Spend:** the whole test cost **$0.000007** of OpenRouter credit.

**Fixed and pushed:**

| Commit | Fix |
|---|---|
| `f9836da` | **Inviting a member gave a 500** when the email could not be sent (Resend's test sender only mails you), although the invitation was saved. Now it succeeds and shows a link to copy and send. Also: the password field stayed filled after turning on two-factor, and the "New key" button wrapped onto two lines. |
| `df67c08` | **Disconnecting OpenRouter left Aperture's gateway key alive at OpenRouter with no spend limit.** Disconnecting, or setting up the gateway again, now disables it at the provider. I disabled the one the test left behind. Also: a CSP violation from an inline style on the mandates list. |
| `072e9e5` | The stablecoin price job failed with `Pyth answered 401` in your Render log. It now uses CoinGecko. |

**Not tested, and why:**

- **Image and video generation:** costs real money per call.
- **Cards:** needs Stripe Issuing (decision D5).
- **Creating an x402 budget account:** needs a browser wallet to sign; covered by the
  devnet spike instead.
- **Paid billing checkout:** Stripe Billing is not set up yet.
- **Accepting an invitation as a second person:** no second inbox.
