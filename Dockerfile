# ============= DEPENDENCIES STAGE (CACHED) =============
FROM node:24-alpine AS deps

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nani -u 1001

WORKDIR /app

# Make npm resilient
RUN npm config set fetch-retries 5 && \
    npm config set fetch-retry-mintimeout 20000 && \
    npm config set fetch-timeout 180000 && \
    npm config set prefer-offline true

COPY package*.json ./

# Install ALL dependencies (including typescript!)
RUN npm i --legacy-peer-deps --no-audit


# ============= BUILD STAGE =============
FROM node:24-alpine AS builder
WORKDIR /app

# Reuse node_modules from deps (has typescript!)
COPY --from=deps /app/node_modules ./node_modules
COPY package*.json tsconfig.json ./
COPY src ./src
COPY public ./public
COPY swagger.yaml ./swagger.yaml

# Now tsc is available → build succeeds
RUN npm run build


# ============= PRODUCTION DEPENDENCIES =============
FROM node:24-alpine AS prod-deps
WORKDIR /app

COPY package*.json ./
# Install only prod deps (typescript removed → smaller image)
RUN npm i --legacy-peer-deps --no-audit --omit=dev && \
    npm cache clean --force


# ============= FINAL RUNTIME IMAGE =============
FROM node:24-alpine

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nani -u 1001

WORKDIR /app

# Copy only production node_modules
COPY --from=prod-deps /app/node_modules ./node_modules

# Copy built app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/swagger.yaml ./swagger.yaml
COPY --from=builder /app/public ./public

# Create volumes as root, then give to nani
RUN mkdir -p /app/data /app/logs && \
    chown -R nani:nodejs /app/data /app/logs

USER nani

EXPOSE 3000
ENV NODE_ENV=production
ENV PORT=3000

# CMD ["node", "dist/cluster.js"]
CMD ["node", "dist/server.js"]
