#!/bin/sh
# The whole suite. Stops at the first failing group, so a green result means all of it passed.
set -eu
cd /repo

echo "=== Logic: unit tests"
npm test -w @timesflex/core

echo "=== Web export tests"
npm test -w @timesflex/web

cd apps/api
echo "=== API on real PostgreSQL: integration and white-box tests, with a coverage floor"
node --test --test-concurrency=1 --experimental-test-coverage --test-coverage-include='src/**' --test-coverage-exclude='src/index.js' --test-coverage-lines=85 --test-coverage-branches=78 --test-coverage-functions=85 test/*.test.js

echo "=== The same permission tests on the file store"
env -u TEST_DATABASE_URL node --test test/roles.test.js test/platform.test.js test/notices.test.js test/attendance.test.js test/biometric.test.js
cd /repo

echo "=== Fingerprint connector"
node --test plugins/biometric-bridge/test/adapters.test.mjs

echo "=== Solver tests"
cd services/solver
/venv/bin/python -m pytest -q
echo "=== ALL PASSED"
