# Build de produção: front compilado + API Bun servindo tudo num container só
FROM oven/bun:1 AS build
WORKDIR /app

COPY package.json turbo.json ./
COPY packages ./packages
COPY apps ./apps
RUN bun install --frozen-lockfile || bun install
RUN bun run build
# joga fora devDependencies (vite, react, typescript...) — a API roda TS direto no Bun
RUN rm -rf node_modules && (bun install --production --frozen-lockfile || bun install --production)

FROM oven/bun:1-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_PATH=/data/sentrylike.db

COPY --from=build /app ./

VOLUME /data
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD bun -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["bun", "apps/api/src/index.ts"]
