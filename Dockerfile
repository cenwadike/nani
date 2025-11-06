# ============= DEPENDENCIES STAGE (CACHED) =============
FROM node:24-alpine AS deps
WORKDIR /app

# Configure npm once for all stages
RUN npm config set fetch-retries 3 && \
    npm config set fetch-retry-mintimeout 20000 && \
    npm config set fetch-timeout 180000

# Copy package files (triggers cache invalidation only when deps change)
COPY package*.json ./

# Install ALL dependencies once (dev + prod)
RUN npm ci --no-audit

# ============= BUILD STAGE =============
FROM node:24-alpine AS builder
WORKDIR /app

# Copy dependencies from cache
COPY --from=deps /app/node_modules ./node_modules
COPY package*.json tsconfig.json ./

# Copy source and build
COPY src ./src
COPY public ./public
COPY swagger.yaml ./

RUN npm run build

# ============= PRODUCTION DEPENDENCIES =============
FROM node:24-alpine AS prod-deps
WORKDIR /app

RUN npm config set fetch-retries 3 && \
    npm config set fetch-timeout 180000

COPY package*.json ./
RUN npm ci --production --no-audit && npm cache clean --force

# ============= FINAL RUNTIME IMAGE =============
FROM node:24-alpine

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nani -u 1001

WORKDIR /app

# Copy only what's needed
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/swagger.yaml ./swagger.yaml
COPY --from=builder /app/public ./public

RUN mkdir -p ./src/data ./src/logs && \
    chown -R nani:nodejs ./src/data ./src/logs

USER nani
EXPOSE 3000
ENV NODE_ENV=production

CMD ["sh", "-c", "test -f dist/src/cluster.js && node dist/src/cluster.js || node dist/cluster.js"]
