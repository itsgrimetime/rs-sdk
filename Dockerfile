FROM oven/bun:debian

RUN apt update \
  && apt install -y --no-install-recommends default-jdk git ca-certificates bash sqlite3 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/server

# Copy vendored repositories
COPY content /opt/server/content
COPY webclient /opt/server/webclient
COPY javaclient /opt/server/javaclient
COPY engine /opt/server/engine
COPY gateway /opt/server/gateway

WORKDIR /opt/server/engine

# Install dependencies
RUN bun install

# Copy default env
RUN cp .env.example .env

# Patch web/index.ts to bind to 0.0.0.0 for fly.io compatibility
RUN sed -i 's/port: Environment.WEB_PORT,/port: Environment.WEB_PORT, hostname: "0.0.0.0",/' src/web/index.ts

# Pre-build the game data
RUN bun run build

# Install gateway dependencies
WORKDIR /opt/server/gateway
RUN bun install

# Patch gateway.ts to bind to 0.0.0.0 for fly.io compatibility
RUN sed -i 's/port: GATEWAY_PORT,/port: GATEWAY_PORT, hostname: "0.0.0.0",/' gateway.ts

WORKDIR /opt/server

EXPOSE 8080/tcp
EXPOSE 43594/tcp
EXPOSE 7780/tcp

# Entrypoint script to ensure persistent data is on the volume
COPY --chmod=755 <<'EOF' /opt/server/entrypoint.sh
#!/bin/bash
set -e

# === DATABASE ===
# Symlink db.sqlite to persistent volume
if [ ! -L /opt/server/engine/db.sqlite ]; then
    rm -f /opt/server/engine/db.sqlite
    ln -s /opt/server/data/db.sqlite /opt/server/engine/db.sqlite
fi

# Run migrations (idempotent - only applies pending migrations)
echo "Running database migrations..."
cd /opt/server/engine && bun run sqlite:migrate

# === PLAYER SAVES ===
# Create players directory on volume if it doesn't exist
mkdir -p /opt/server/data/players

# If there are existing player saves in ephemeral storage, move them to volume
if [ -d /opt/server/engine/data/players ] && [ ! -L /opt/server/engine/data/players ]; then
    # Copy any existing saves to volume (won't overwrite existing)
    cp -rn /opt/server/engine/data/players/* /opt/server/data/players/ 2>/dev/null || true
    rm -rf /opt/server/engine/data/players
fi

# Create symlink for player saves
mkdir -p /opt/server/engine/data
if [ ! -L /opt/server/engine/data/players ]; then
    rm -rf /opt/server/engine/data/players
    ln -s /opt/server/data/players /opt/server/engine/data/players
fi

# === START GATEWAY SERVICE ===
echo "Starting gateway service on port 7780..."
cd /opt/server/gateway && bun run gateway.ts &

# === START GAME SERVER ===
cd /opt/server/engine
exec bun run src/app.ts
EOF

CMD ["/opt/server/entrypoint.sh"]
