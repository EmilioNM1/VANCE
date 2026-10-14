-- Crea el rol de la aplicación (sin SUPERUSER ni BYPASSRLS) y las bases de datos.
CREATE ROLE vance LOGIN PASSWORD 'vance' NOSUPERUSER NOBYPASSRLS;
CREATE DATABASE vance OWNER vance;
CREATE DATABASE vance_test OWNER vance;
