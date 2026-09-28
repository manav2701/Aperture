# Postgres with WAL-G for continuous archiving and point-in-time recovery (plan/phases/phase-10 §10.2).
# WAL-G reads WALG_S3_PREFIX, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_ENDPOINT, AWS_REGION,
# AWS_S3_FORCE_PATH_STYLE and WALG_LIBSODIUM_KEY (client-side encryption) from the environment.
FROM postgres:18-bookworm

ARG WALG_VERSION=v3.0.9
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && curl -fsSL -o /tmp/wal-g.tar.gz \
     "https://github.com/wal-g/wal-g/releases/download/${WALG_VERSION}/wal-g-pg-22.04-amd64.tar.gz" \
  && tar -xzf /tmp/wal-g.tar.gz -C /usr/local/bin \
  && mv /usr/local/bin/wal-g-pg-22.04-amd64 /usr/local/bin/wal-g \
  && chmod +x /usr/local/bin/wal-g \
  && rm /tmp/wal-g.tar.gz \
  && apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
