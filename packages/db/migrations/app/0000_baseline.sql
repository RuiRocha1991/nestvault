-- The pool a transaction is scoped to. `withPool` sets `app.pool_id` with set_config(..., true);
-- every RLS policy compares `pool_id` with this function.
--
-- Outside withPool the setting is unset (NULL) or, on a reused connection, an empty string; the
-- nullif makes both mean "no pool", so the policies match no row instead of failing the uuid cast.
CREATE OR REPLACE FUNCTION app_current_pool_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.pool_id', true), '')::uuid $$;
