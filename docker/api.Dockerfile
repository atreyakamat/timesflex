FROM node:22-bookworm-slim
WORKDIR /repo
# npm workspaces: the lockfile lives at the root and expects every workspace's manifest.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
RUN npm ci -w @timesflex/api --omit=dev --no-audit --no-fund
COPY apps/api/src apps/api/src
WORKDIR /repo/apps/api
ENV NODE_ENV=production
USER node
EXPOSE 3001
CMD ["node", "src/index.js"]
