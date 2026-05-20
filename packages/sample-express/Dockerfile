# Build context should be the repo root so npm workspaces resolve correctly.
# Build with: docker build -f packages/sample-express/Dockerfile .

FROM node:22-alpine AS build

WORKDIR /app

# Copy root manifest + workspace manifest for dependency install
COPY package.json package-lock.json ./
COPY packages/sample-express/package.json ./packages/sample-express/

RUN npm ci

# Copy build configs
COPY tsconfig.json ./
COPY packages/sample-express/tsconfig.json ./packages/sample-express/

# Copy source
COPY packages/sample-express/src/ ./packages/sample-express/src/

# Build
RUN npm run build -w @pe-learning-path/sample-express

# ---- runtime image ----
FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Install only production deps for the workspace
COPY package.json package-lock.json ./
COPY packages/sample-express/package.json ./packages/sample-express/
RUN npm ci --omit=dev -w @pe-learning-path/sample-express

# Copy built output
COPY --from=build /app/packages/sample-express/dist ./packages/sample-express/dist

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT}/health || exit 1

WORKDIR /app/packages/sample-express
CMD ["node", "dist/index.js"]
