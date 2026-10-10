# =====================================================================
# CTF 5 — THE LAST GATEKEEPER: SPLIT SEAL — integrated deployment
#
# Single Linux container: the Node integration server spawns the
# unmodified gatekeeper ELF natively, once per connection. No QEMU and
# no challenge VM are involved on Linux hosts.
#
#   docker compose up --build        # web8083 + raw nc listener 31337
# =====================================================================
FROM node:22-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

# production dependencies only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# frontend + server + challenge runtime (gatekeeper ELF)
COPY frontend ./frontend
COPY server ./server
COPY challenge/CHALLENGE.md challenge/CHALLENGE.md
COPY challenge/gatekeeper ./challenge/gatekeeper
RUN chmod 755 /app/challenge/gatekeeper \
 && mkdir -p /app/server/data \
 && chown -R node:node /app

USER node
EXPOSE 8083 31337

# simple process health (backend readiness is reported by /api/status)
HEALTHCHECK --interval=30s --timeout=4s --start-period=12s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8083/api/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/server.js"]
