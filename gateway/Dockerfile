FROM oven/bun:1 AS base

WORKDIR /app

# Copy package files
COPY package.json ./

# Install dependencies
RUN bun install

# Copy source
COPY . .

# Generate Prisma client
RUN bunx prisma generate

# Push schema to database at build time (Railway provides DATABASE_URL at build)
# If this fails, the server will still start with in-memory fallback
RUN bunx prisma db push --accept-data-loss --skip-generate 2>/dev/null || echo "DB push deferred to runtime"

EXPOSE 4000

ENV PORT=4000

CMD ["bun", "run", "src/index.ts"]
