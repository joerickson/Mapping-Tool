-- Phase 4f — cycle edit history (undo/redo stack).
--
-- Per-cycle ordered log of edits with both forward and reverse payloads.
-- Cmd+Z reverses the most recent active edit by replaying its
-- reverse_payload; Cmd+Shift+Z reapplies a previously-undone edit by
-- replaying forward_payload. New edits invalidate the redo branch.

CREATE TABLE IF NOT EXISTS public.cycle_edit_history (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_instance_id        UUID NOT NULL REFERENCES public.cycle_instances(id) ON DELETE CASCADE,
  edit_index               INT NOT NULL,
  edit_type                TEXT NOT NULL CHECK (edit_type IN (
    'move_visit', 'move_trip', 'reassign_cluster',
    'add_visit', 'remove_visit', 'lock_visit', 'unlock_visit',
    'lock_day', 'unlock_day', 'mark_complete', 'mark_cancelled',
    'bulk_operation'
  )),
  forward_payload          JSONB NOT NULL,
  reverse_payload          JSONB NOT NULL,
  propagated_to_template   BOOLEAN NOT NULL DEFAULT FALSE,
  template_change_payload  JSONB,
  is_active                BOOLEAN NOT NULL DEFAULT TRUE,
  undone_at                TIMESTAMPTZ,
  edited_by                TEXT,
  edited_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  description              TEXT
);

CREATE INDEX IF NOT EXISTS ceh_cycle_idx
  ON public.cycle_edit_history(cycle_instance_id, edit_index DESC);

CREATE INDEX IF NOT EXISTS ceh_active_idx
  ON public.cycle_edit_history(cycle_instance_id, is_active)
  WHERE is_active = TRUE;
