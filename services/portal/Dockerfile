# SVC-INF-03 - no npm dependencies, only Node's standard library.
FROM node:22-alpine
ENV NODE_ENV=production PORT=8042
WORKDIR /app
COPY . .
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8042
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8042/healthz >/dev/null || exit 1
CMD ["node", "server.js"]
