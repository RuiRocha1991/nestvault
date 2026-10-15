-- Second layer of the insert-only guarantee (the first is the REVOKE in 0004). A later GRANT ALL,
-- ALTER DEFAULT PRIVILEGES or a new role that inherits the privilege cannot rewrite history: these
-- triggers fire for every role, the table owner included. SECURITY INVOKER with a fixed
-- search_path, so nothing here can be redirected through the caller's settings.
CREATE OR REPLACE FUNCTION audit_log_reject_rewrite() RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is insert-only';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_log_reject_row_rewrite ON "audit_log";
--> statement-breakpoint
CREATE TRIGGER audit_log_reject_row_rewrite
  BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION audit_log_reject_rewrite();
--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_log_reject_truncate ON "audit_log";
--> statement-breakpoint
CREATE TRIGGER audit_log_reject_truncate
  BEFORE TRUNCATE ON "audit_log"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_reject_rewrite();
