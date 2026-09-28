# Self-hosting Aperture

Run the whole product (web app, API, gateway, x402 signer and Postgres with backups) on one machine in your own network. It suits data-residency requirements, for example a UAE region such as AWS `me-central-1`.

## Requirements

- Linux with Docker 24+ and Compose v2: 4 vCPU, 8 GB RAM, 80 GB SSD.
- Three DNS names pointing at the machine: app, API and gateway, e.g. `app.aperture.internal`, `api.…`, `gw.…`.
- S3-compatible storage for backups (and media, if you use images and video).
- An email API key (Resend) for invitations and alerts.

## Install

```bash
git clone <repo> aperture && cd aperture
cp infra/prod.env.example .env          # fill it in: every secret fresh (openssl rand -base64 32)
echo "APP_HOST=app.example.com" >> .env # plus API_HOST and GATEWAY_HOST
export APERTURE_ENV_FILE=$PWD/.env
docker compose -f infra/compose.selfhost.yml --env-file .env --profile release run --rm migrate
docker compose -f infra/compose.selfhost.yml --env-file .env up -d
pnpm smoke --api https://$API_HOST --gateway https://$GATEWAY_HOST --web https://$APP_HOST
```

Caddy gets certificates from Let's Encrypt. On a private network, add `tls internal` to each site in `infra/caddy/Caddyfile.selfhost`.

The web image bakes in its API address at build time. Published images use `http://api:4000`, which matches the Compose file.

## What differs from the hosted service

- **No plan limits.** Billing is off unless you set the `STRIPE_BILLING_*` variables.
- The worker runs inside the API container (`RUN_WORKER=true`).
- The signer is a separate container on the internal network, as in production.

## Upgrades

```bash
git pull && git checkout v<new>
VERSION=v<new> docker compose -f infra/compose.selfhost.yml --env-file .env pull
VERSION=v<new> docker compose -f infra/compose.selfhost.yml --env-file .env --profile release run --rm migrate
VERSION=v<new> docker compose -f infra/compose.selfhost.yml --env-file .env up -d
```

Migrations only add; you can roll back to the previous version.

## Backups

WAL-G ships WAL continuously to `WALG_S3_PREFIX`, encrypted with `WALG_LIBSODIUM_KEY` (keep that key offline). For a nightly base backup, add the `backup` service from `infra/compose.prod.yml`, or schedule `wal-g backup-push`. Test restores monthly with `infra/scripts/restore-drill.sh .env`.

## Security notes

- Keep Postgres and the signer off public networks (the Compose file does this).
- Generate fresh KEKs. Back them up offline: without `APERTURE_KEK_V1`, stored provider secrets can't be decrypted.
- Owners, admins and finance must enable two-factor before they can make changes.
