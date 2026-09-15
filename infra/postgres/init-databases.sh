#!/bin/bash
# Runs once on first container start (docker-entrypoint-initdb.d executes any
# .sh file with the container's environment available). Keeps RIO and Traccar
# logically separated: RIO's application code must never connect to the
# traccar database directly. Passwords come from the container environment
# (RIO_DB_PASSWORD / TRACCAR_DB_PASSWORD, set via env_file from repo-root .env)
# rather than being hardcoded in this script.
set -euo pipefail

: "${RIO_DB_PASSWORD:?RIO_DB_PASSWORD must be set}"
: "${TRACCAR_DB_PASSWORD:?TRACCAR_DB_PASSWORD must be set}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<-EOSQL
    CREATE DATABASE rio;
    CREATE DATABASE traccar;

    CREATE USER rio WITH PASSWORD '${RIO_DB_PASSWORD}';
    GRANT ALL PRIVILEGES ON DATABASE rio TO rio;

    CREATE USER traccar WITH PASSWORD '${TRACCAR_DB_PASSWORD}';
    GRANT ALL PRIVILEGES ON DATABASE traccar TO traccar;
EOSQL

# Postgres 15+ no longer grants CREATE on the "public" schema to non-owners
# by default, so each app role also needs an explicit grant inside its own
# database (DATABASE-level ALL PRIVILEGES above does not cover this).
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname rio <<-EOSQL
    GRANT ALL ON SCHEMA public TO rio;
EOSQL

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname traccar <<-EOSQL
    GRANT ALL ON SCHEMA public TO traccar;
EOSQL
