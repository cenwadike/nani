# SPDX-License-Identifier: MIT
# Dockerfile for deploying the Nani event streaming service

FROM node:24-alpine

# Set working directory
WORKDIR /app

# Install only production dependencies
COPY package*.json ./
RUN npm install --production

# Copy compiled code only
COPY dist ./dist

# Create persistent data directory for tenant storage
RUN mkdir -p ./data

# Expose the port your Express server listens on
EXPOSE 3000

# Set environment mode
ENV NODE_ENV=production

# Start the cluster entry point
CMD ["node", "dist/cluster.js"]
