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

CMD ["bun", "run", "src/index.ts"]
