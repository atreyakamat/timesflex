# Runs logic, API (file store and PostgreSQL, with a coverage floor) and solver tests.
FROM node:22-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
RUN npm ci --no-audit --no-fund
COPY apps/api apps/api
COPY apps/web apps/web
COPY packages/core packages/core
COPY plugins plugins
COPY services/solver services/solver
RUN python3 -m venv /venv && /venv/bin/pip install --no-cache-dir -c services/solver/constraints.txt ./services/solver pytest
COPY docker/run-tests.sh /run-tests.sh
CMD ["sh", "/run-tests.sh"]
