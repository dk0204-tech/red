# PRALAYA Archive Terminal — Red Zone CTF 1
# Self-contained: zero npm dependencies at runtime.
FROM node:24-alpine

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0

WORKDIR /app

COPY package.json ./
COPY src ./src
COPY public ./public
COPY data ./data

USER node
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O - http://127.0.0.1:8080/healthz || exit 1

CMD ["node", "src/server.js"]
