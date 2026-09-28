# Deploy and roll back

## Release

1. Merge to `main` with CI green.
2. Tag: `git tag v1.2.3 && git push origin v1.2.3`.
3. GitHub → Actions → Release. The images build, then the **production** environment waits for a reviewer's approval.
4. After approval the workflow SSHes to the server and does the following:
   - checks out the tag;
   - pulls the images;
   - runs `migrate` once (`RUN_MIGRATIONS=true MIGRATE_ONLY=true`);
   - runs `docker compose up -d`;
   - runs `pnpm smoke`.
5. Watch the 5xx and latency panels for 15 minutes.

The gateway drains in-flight streams for up to 60 s on stop, so no settlement is lost (O2).

## Roll back

Migrations only ever add; nothing is dropped in the same release that stops using it. So rolling back means running the previous images:

```bash
ssh deploy@<server>
cd /srv/aperture/repo && git checkout v1.2.2
VERSION=v1.2.2 docker compose -f infra/compose.prod.yml --env-file /srv/aperture/.env up -d
pnpm smoke --api https://api.<domain> --gateway https://gw.<domain>
```

If a migration itself is the problem, restore to the moment before the release instead ([restore.md](restore.md), point-in-time).
