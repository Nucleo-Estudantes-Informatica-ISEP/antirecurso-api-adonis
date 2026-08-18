FROM node:24-alpine AS builder

WORKDIR /app
ENV NODE_ENV=development

COPY package*.json ./
RUN npm ci --include=dev

COPY . .
RUN npm run build

FROM node:24-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3333
ENV LOG_LEVEL=info
ENV TZ=UTC

COPY --from=builder --chown=node:node /app/build ./
COPY --chown=node:node docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN npm ci --omit=dev \
  && npm cache clean --force \
  && chmod +x /usr/local/bin/docker-entrypoint.sh

USER node

EXPOSE 3333

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e 'fetch("http://127.0.0.1:" + (process.env.PORT || 3333) + "/").then((res) => process.exit(res.ok ? 0 : 1)).catch(() => process.exit(1))'

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "bin/server.js"]
