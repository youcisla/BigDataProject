-- Gold schema. Run automatically by postgres image on first boot.
-- See sql/gold_schema.sql for full DDL.

CREATE SCHEMA IF NOT EXISTS gold;

-- Tables are created by sql/gold_schema.sql at pipeline init time.
-- This file just ensures the schema exists so the Python connector works.

GRANT ALL ON SCHEMA gold TO gold;
