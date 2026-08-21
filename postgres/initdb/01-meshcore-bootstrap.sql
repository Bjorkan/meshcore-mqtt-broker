-- Run by the official PostgreSQL image only when its data directory is empty.
-- This bootstrap is intentionally separate from the broker's embedded Turso store.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'meshcore_owner') THEN
    CREATE ROLE meshcore_owner;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'meshcore_broker') THEN
    CREATE ROLE meshcore_broker;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'meshcore_reader') THEN
    CREATE ROLE meshcore_reader;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'meshcore_http') THEN
    CREATE ROLE meshcore_http;
  END IF;
END
$$;

ALTER ROLE meshcore_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE meshcore_broker LOGIN NOINHERIT NOSUPERUSER CREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD NULL;
ALTER ROLE meshcore_reader NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
-- Authentication for this placeholder must be configured outside this file.
ALTER ROLE meshcore_http LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD NULL;
GRANT meshcore_owner TO meshcore_broker;
GRANT pg_signal_backend TO meshcore_broker;

SELECT 'CREATE DATABASE meshcore OWNER meshcore_owner'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'meshcore')
\gexec

\connect meshcore

REVOKE ALL ON DATABASE meshcore FROM PUBLIC;
GRANT CONNECT ON DATABASE meshcore TO meshcore_owner, meshcore_broker, meshcore_reader, meshcore_http;

-- These extensions must be available in the selected PostgreSQL/Timescale image.
-- Creating them in meshcore verifies the prerequisites before any broker data exists.
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Do not use the shared default schema for MeshCore or expose it through PUBLIC.
REVOKE ALL ON SCHEMA public FROM PUBLIC;

-- The complete, versioned broker schema is static and must be owned by the
-- no-login owner role. The runtime role only validates it and performs DML.
SET ROLE meshcore_owner;
\ir 02-meshcore-schema.sql.inc
RESET ROLE;

REVOKE ALL ON SCHEMA meshcore_private FROM PUBLIC;
REVOKE ALL ON SCHEMA meshcore_public FROM PUBLIC;

REVOKE ALL ON ALL TABLES IN SCHEMA meshcore_private FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA meshcore_private FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA meshcore_public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA meshcore_public FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA meshcore_private FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA meshcore_public FROM PUBLIC;

GRANT USAGE ON SCHEMA meshcore_private, meshcore_public TO meshcore_broker;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA meshcore_private, meshcore_public TO meshcore_broker;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA meshcore_private, meshcore_public TO meshcore_broker;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA meshcore_private, meshcore_public TO meshcore_broker;

GRANT USAGE ON SCHEMA meshcore_public TO meshcore_reader, meshcore_http;
GRANT SELECT ON ALL TABLES IN SCHEMA meshcore_public TO meshcore_reader, meshcore_http;

ALTER DEFAULT PRIVILEGES FOR ROLE meshcore_owner IN SCHEMA meshcore_private REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE meshcore_owner IN SCHEMA meshcore_private REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE meshcore_owner IN SCHEMA meshcore_private REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE meshcore_owner IN SCHEMA meshcore_private GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO meshcore_broker;
ALTER DEFAULT PRIVILEGES FOR ROLE meshcore_owner IN SCHEMA meshcore_private GRANT USAGE, SELECT ON SEQUENCES TO meshcore_broker;
ALTER DEFAULT PRIVILEGES FOR ROLE meshcore_owner IN SCHEMA meshcore_private GRANT EXECUTE ON FUNCTIONS TO meshcore_broker;

ALTER DEFAULT PRIVILEGES FOR ROLE meshcore_owner IN SCHEMA meshcore_public REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE meshcore_owner IN SCHEMA meshcore_public REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE meshcore_owner IN SCHEMA meshcore_public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE meshcore_owner IN SCHEMA meshcore_public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO meshcore_broker;
ALTER DEFAULT PRIVILEGES FOR ROLE meshcore_owner IN SCHEMA meshcore_public GRANT USAGE, SELECT ON SEQUENCES TO meshcore_broker;
ALTER DEFAULT PRIVILEGES FOR ROLE meshcore_owner IN SCHEMA meshcore_public GRANT EXECUTE ON FUNCTIONS TO meshcore_broker;
ALTER DEFAULT PRIVILEGES FOR ROLE meshcore_owner IN SCHEMA meshcore_public GRANT SELECT ON TABLES TO meshcore_reader, meshcore_http;
