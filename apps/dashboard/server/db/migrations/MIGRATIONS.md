# Migrations

## Guidance for hand-edited migrations

Drizzle-kit's auto-generated migrations are usually safe: single-statement schema
changes that PG can apply quickly on small tables. But some changes need hand-editing
to run safely against a non-empty production table:

- **Adding a NOT NULL column to a large table**: use a three-step dance
  (nullable add → backfill → SET NOT NULL + FK). See `0011_fancy_garia.sql`
  as a reference.

- **Any multi-step migration**: start the file with `SET LOCK_TIMEOUT '5s';` so a
  blocked statement returns an error instead of waiting indefinitely. Follow with a
  `SET statement_timeout` if the migration includes a large UPDATE or ALTER that
  would otherwise stall.

- **Data backfills on large tables**: consider splitting into a separate migration
  with only DML. That way a failed backfill can be retried without touching DDL.

- **DROP COLUMN / DROP TABLE on in-use data**: never auto-generate. Hand-write
  the migration, ensure the column is no longer referenced by code for at least
  one release, and consider using `ALTER TABLE ... DROP COLUMN ... CASCADE` only
  when you're sure of the dependency graph.

Review the generated SQL before pushing. drizzle-kit emits idempotent SQL for
most shape changes, but custom logic does not survive regeneration — it's on
you to preserve hand edits.
