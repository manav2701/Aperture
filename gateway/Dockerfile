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

EXPOSE 4000

ENV PORT=4000

# Run database migrations then start the server
CMD bunx prisma migrate deploy --skip-generate 2>/dev/null || bunx prisma db push --skip-generate 2>/dev/null; bun run src/index.ts
