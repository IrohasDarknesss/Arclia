#!/usr/bin/env bash
set -euo pipefail

DB_NAME="${1:-arclia}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Creating database '${DB_NAME}' if it does not exist..."
psql -h 127.0.0.1 -p 5432 -d postgres -tc "SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}'" | grep -q 1 || \
  psql -h 127.0.0.1 -p 5432 -d postgres -c "CREATE DATABASE ${DB_NAME};"

echo "Applying initial schema and seed data to '${DB_NAME}'..."
psql -h 127.0.0.1 -p 5432 -d "${DB_NAME}" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
psql -h 127.0.0.1 -p 5432 -d "${DB_NAME}" -v ON_ERROR_STOP=1 -f "${SCRIPT_DIR}/migrations/20261027000001_initial_schema.sql"
psql -h 127.0.0.1 -p 5432 -d "${DB_NAME}" -v ON_ERROR_STOP=1 -f "${SCRIPT_DIR}/seed.sql"

echo "Local database '${DB_NAME}' is ready!"
