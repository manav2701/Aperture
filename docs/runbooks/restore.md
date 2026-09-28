# Restore from backup (O4)

Backups are WAL-G:

- WAL is archived continuously, about once a minute (`archive_timeout=60`);
- a base backup is pushed nightly by the `backup` service;
- 30 full backups are kept;
- everything is encrypted client-side with `WALG_LIBSODIUM_KEY`.

**Keep that key offline.** Without it the backups are unreadable.

## Monthly drill (and after any backup change)

```bash
infra/scripts/restore-drill.sh /srv/aperture/.env
```

It restores the latest backup into a scratch container, replays WAL, then runs `pnpm --filter @aperture/cli verify-db`, which checks every org's ledger counters and audit hash chain. It prints the timings. Record them in `docs/performance.md`. A failed drill is an incident.

## Real restore

1. Stop writers: `docker compose -f infra/compose.prod.yml stop api gateway worker signer`.
2. Move the old data volume aside rather than deleting it: `docker volume create aperture_postgres-data-restore`. Keep the old volume until you're sure.
3. Fetch into the new volume:
   ```bash
   docker run --rm --env-file /srv/aperture/.env -v aperture_postgres-data-restore:/var/lib/postgresql/data \
     --entrypoint sh aperture-postgres-walg -c 'wal-g backup-fetch /var/lib/postgresql/data LATEST && touch /var/lib/postgresql/data/recovery.signal'
   ```
   For point-in-time, also add `recovery_target_time = '2026-10-01 09:59:00+00'` to `postgresql.auto.conf`.
4. Point the `postgres` service at the restored volume, start it, and wait for `pg_is_in_recovery() = false`.
5. Run `verify-db`, then start the services and run `pnpm smoke`.
6. Card holds and x402 payments from after the restore point are rebuilt from the providers:
   - `cards.reconcile` replays the last 7 days of Stripe;
   - `x402.watch` re-reads each budget account from its cursor.

   Run both jobs by hand once, then check the ledger drift alerts.
