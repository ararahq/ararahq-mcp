# --- Stage 1: Build ---
FROM node:22-slim AS builder

WORKDIR /app

# libsecret-1-dev: keytar precisa pra compilar/rodar (linux keychain).
# node-gyp + python: pro postinstall do keytar conseguir compilar binding nativo.
RUN apt-get update && \
    apt-get install -y --no-install-recommends libsecret-1-dev python3 build-essential && \
    rm -rf /var/lib/apt/lists/*

# Install dependencies. Sem `prepare: tsc` no package.json (removido); postinstall
# de pacotes nativos como keytar precisa rodar normalmente.
COPY package*.json ./
RUN npm ci

# Copy source and config
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src

# Build TypeScript
RUN npm run build

# --- Stage 2: Runtime ---
FROM node:22-slim AS runtime

WORKDIR /app

# Set production environment
ENV NODE_ENV=production

# libsecret-1-0 runtime (sem -dev): keytar carrega libsecret.so em runtime.
RUN apt-get update && \
    apt-get install -y --no-install-recommends libsecret-1-0 && \
    rm -rf /var/lib/apt/lists/*

# Copy only necessary files from builder
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/build ./build

# Install production dependencies only (keytar precisa postinstall pro binding nativo)
RUN npm ci --omit=dev && npm cache clean --force

RUN useradd --create-home --uid 10001 mcp && chown -R mcp:mcp /app
USER mcp

# Standard MCP port (dedicated for Arara MCP)
EXPOSE 3333

ENTRYPOINT ["node", "build/index.js"]
