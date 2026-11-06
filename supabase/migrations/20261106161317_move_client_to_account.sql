-- Atomic relocation of a client (and all client-scoped rows) to another account.
-- Drift guard: tests/integration/move-table-coverage.test.ts asserts the table list
-- here matches api/_lib/client-move-tables.ts and the live schema.

CREATE TABLE IF NOT EXISTS client_account_moves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL,
  from_account_id uuid,
  to_account_id uuid NOT NULL,
  old_name text,
  new_name text,
  moved_by uuid,
  moved_at timestamptz NOT NULL DEFAULT now(),
  row_counts jsonb
);

ALTER TABLE public.client_account_moves ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS client_account_moves_client_id_idx
  ON client_account_moves (client_id, moved_at DESC);

CREATE OR REPLACE FUNCTION move_client_to_account(
  p_client_id uuid,
  p_target_account_id uuid,
  p_new_name text DEFAULT NULL,
  p_moved_by uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_from uuid;
  v_old_name text;
  v_final_name text;
  v_counts jsonb := '{}'::jsonb;
  v_table text;
  v_n integer;
  v_tables text[] := ARRAY[
    'service_locations', 'service_offerings', 'service_location_constraints',
    'service_location_constraint_templates', 'account_operational_constraints',
    'analysis_scenarios', 'analysis_chat_messages', 'portfolio_analyses',
    'routing_templates', 'day_schedules', 'manual_trips',
    'overnight_cluster_overrides', 'crew_vehicles', 'custom_field_definitions',
    'service_line_pricing_config', 'property_edit_history',
    'addon_cohort_assignments', 'upload_batches', 'schedule_assessments'
  ];
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_client_id::text, 0));

  SELECT account_id, name INTO v_from, v_old_name
    FROM clients WHERE id = p_client_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'client_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM accounts WHERE id = p_target_account_id) THEN
    RAISE EXCEPTION 'invalid_target_account' USING ERRCODE = 'P0002';
  END IF;

  IF v_from = p_target_account_id THEN
    RETURN jsonb_build_object(
      'moved', false,
      'from_account_id', v_from,
      'to_account_id', p_target_account_id,
      'final_name', v_old_name,
      'row_counts', '{}'::jsonb
    );
  END IF;

  v_final_name := coalesce(nullif(btrim(p_new_name), ''), v_old_name);
  IF EXISTS (
    SELECT 1 FROM clients
     WHERE account_id = p_target_account_id
       AND lower(name) = lower(v_final_name)
  ) THEN
    RAISE EXCEPTION 'name_conflict' USING ERRCODE = 'P0001', DETAIL = v_final_name;
  END IF;

  UPDATE clients
     SET account_id = p_target_account_id, name = v_final_name
   WHERE id = p_client_id;

  FOREACH v_table IN ARRAY v_tables LOOP
    EXECUTE format('UPDATE %I SET account_id = $1 WHERE client_id = $2', v_table)
      USING p_target_account_id, p_client_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_counts := v_counts || jsonb_build_object(v_table, v_n);
  END LOOP;

  INSERT INTO client_account_moves
    (client_id, from_account_id, to_account_id, old_name, new_name, moved_by, row_counts)
  VALUES
    (p_client_id, v_from, p_target_account_id, v_old_name, v_final_name, p_moved_by, v_counts);

  RETURN jsonb_build_object(
    'moved', true,
    'from_account_id', v_from,
    'to_account_id', p_target_account_id,
    'final_name', v_final_name,
    'row_counts', v_counts
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION move_client_to_account(uuid, uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION move_client_to_account(uuid, uuid, text, uuid) TO service_role;
