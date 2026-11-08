# Builds the browser version of apps/mobile and serves it with nginx, which also forwards
# /api to the API. "/" makes the app call its own address, so it works on any domain or IP.
FROM node:22-bookworm-slim AS build
WORKDIR /repo
COPY packages/core packages/core
COPY apps/mobile/package.json apps/mobile/package-lock.json apps/mobile/
WORKDIR /repo/apps/mobile
RUN npm ci --no-audit --no-fund
COPY apps/mobile .
ENV EXPO_PUBLIC_API_URL=/ CI=1 EXPO_NO_TELEMETRY=1
RUN npx expo export --platform web --output-dir dist-web

# Runs as a normal user, listening on 8080.
FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/security-headers.inc /etc/nginx/conf.d/security-headers.inc
COPY --from=build /repo/apps/mobile/dist-web /usr/share/nginx/html
