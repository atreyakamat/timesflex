# TimeFlex web app + API in one image. The API serves the built web app on port 3001.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @timesflex/api --workspace @timesflex/web --include-workspace-root
COPY apps/web apps/web
RUN npm run build -w @timesflex/web

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
RUN npm ci --omit=dev --workspace @timesflex/api && npm cache clean --force
COPY apps/api/src apps/api/src
COPY --from=build /app/apps/web/dist apps/web/dist
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:3001/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "apps/api/src/index.js"]
