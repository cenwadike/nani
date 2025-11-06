# ============= DEPENDENCIES STAGE (CACHED) =============
FROM node:24-alpine AS deps
WORKDIR /app

# Make npm resilient to network flakes
RUN npm config set fetch-retries 5 && \
    npm config set fetch-retry-mintimeout 20000 && \
    npm config set fetch-timeout 180000 && \
    npm config set prefer-offline true

# Copy only package files first (maximizes cache)
COPY package*.json ./

# Install ALL deps (dev + prod) — works even without package-lock.json
RUN npm i --legacy-peer-deps --no-audit --prefer-offline || \
    npm i --legacy-peer-deps --no-audit


# ============= BUILD STAGE =============
FROM node:24-alpine AS builder
WORKDIR /app

# Reuse installed node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY package*.json tsconfig.json ./

# Copy source code
COPY src ./src
COPY public ./public
COPY swagger.yaml ./

# Build the app
RUN npm run build


# ============= PRODUCTION DEPENDENCIES =============
FROM node:24-alpine AS prod-deps
WORKDIR /app

RUN npm config set fetch-retries 5 && \
    npm config set fetch-timeout 180000 && \
    npm config set prefer-offline true

COPY package*.json ./

# Install ONLY production deps — no lockfile needed
RUN npm i --legacy-peer-deps --no-audit --omit=dev --prefer-offline || \
    npm i --legacy-peer-deps --no-audit --omit=dev && \
    npm cache clean --force


# ============= FINAL RUNTIME IMAGE =============
FROM node:24-alpine

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nani -u 1001

WORKDIR /app

# Copy only production node_modules
COPY --from=prod-deps /app/node_modules ./node_modules

# Copy built app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/swagger.yaml ./swagger.yaml
COPY --from=builder /app/public ./public

# Create persistent directories and fix permissions
RUN mkdir -p ./src/data ./src/logs && \
    chown -R nani:nodejs ./src/data ./src/logs

# Switch to non-root user
USER nani

EXPOSE 3000
ENV NODE_ENV=production
ENV PORT=3000

# Smart entrypoint: works whether you use cluster or not
CMD ["sh", "-c", "test -f dist/src/cluster.js && node dist/src/cluster.js || node dist/cluster.js"]
