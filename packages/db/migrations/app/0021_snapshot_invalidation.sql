-- NES-69: a stored net worth snapshot must never outlive the data it was computed from. Any write to
-- a table that feeds the net worth deletes the pool's snapshots from the earliest date the statement
-- touched (all of them when the table has no date to go by). The history is rebuilt by the next
-- snapshots.daily run, which stores the month ends that are missing; until then the overview
-- computes them. The function runs as the caller, so RLS applies: it can only delete the rows of
-- the pool in context, and it does nothing outside withPool.
CREATE OR REPLACE FUNCTION app_invalidate_snapshots() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  date_column text;
  touched bigint := 0;
  earliest date;
  touched_old bigint := 0;
  touched_new bigint := 0;
  earliest_old date;
  earliest_new date;
BEGIN
  IF app_current_pool_id() IS NULL THEN
    RETURN NULL;
  END IF;
  IF TG_NARGS > 0 THEN
    date_column := TG_ARGV[0];
  END IF;

  IF TG_OP IN ('DELETE', 'UPDATE') THEN
    IF date_column IS NULL THEN
      SELECT count(*) INTO touched_old FROM old_rows;
    ELSE
      EXECUTE format('SELECT count(*), min(%I) FROM old_rows', date_column)
        INTO touched_old, earliest_old;
    END IF;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    IF date_column IS NULL THEN
      SELECT count(*) INTO touched_new FROM new_rows;
    ELSE
      EXECUTE format('SELECT count(*), min(%I) FROM new_rows', date_column)
        INTO touched_new, earliest_new;
    END IF;
  END IF;

  touched := touched_old + touched_new;
  IF touched = 0 THEN
    RETURN NULL;
  END IF;
  earliest := least(earliest_old, earliest_new);

  -- earliest is null when the table has no date or a row had none: then every snapshot goes.
  DELETE FROM net_worth_snapshots
  WHERE pool_id = app_current_pool_id()
    AND (earliest IS NULL OR date >= earliest);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
DO $$
DECLARE
  spec text;
  table_name text;
  date_column text;
  arg text;
BEGIN
  -- 'table' or 'table:date_column'
  FOREACH spec IN ARRAY ARRAY[
    'transactions:date',
    'investment_ops:date',
    'portfolio_cash_moves:date',
    'asset_prices:date',
    'interest_entries:date',
    'loan_events:date',
    'loan_installments:due_date',
    'property_valuations:date',
    'property_cost_payments:due_date',
    'accounts',
    'deposits',
    'savings_products',
    'pool_settings',
    'assets',
    'portfolios',
    'loans',
    'loan_installment_amounts',
    'properties',
    'property_holders',
    'property_costs',
    'works_projects',
    'works_payments'
  ] LOOP
    table_name := split_part(spec, ':', 1);
    date_column := nullif(split_part(spec, ':', 2), '');
    arg := CASE WHEN date_column IS NULL THEN '' ELSE quote_literal(date_column) END;
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT ON %I REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION app_invalidate_snapshots(%s)',
      table_name || '_snapshots_ins', table_name, arg);
    EXECUTE format(
      'CREATE TRIGGER %I AFTER UPDATE ON %I REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION app_invalidate_snapshots(%s)',
      table_name || '_snapshots_upd', table_name, arg);
    EXECUTE format(
      'CREATE TRIGGER %I AFTER DELETE ON %I REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION app_invalidate_snapshots(%s)',
      table_name || '_snapshots_del', table_name, arg);
  END LOOP;
END;
$$;
