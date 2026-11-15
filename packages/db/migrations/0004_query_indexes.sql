CREATE INDEX submissions_rollup_idx ON submissions(election_id, polling_unit_id, received_at DESC, id DESC) WHERE status = 'approved';
CREATE INDEX discrepancy_cases_election_board_idx ON discrepancy_cases(election_id, status, created_at DESC, id DESC);
CREATE INDEX reference_records_unit_idx ON reference_records(election_id, polling_unit_id, created_at DESC);
CREATE INDEX case_items_submission_idx ON case_items((snapshot->'observation'->>'id'));
UPDATE submissions SET received_at = created_at WHERE client_id IS NULL;

CREATE OR REPLACE FUNCTION freeze_published_case() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.published_at IS NOT NULL AND
    ROW(NEW.election_id, NEW.polling_unit_id, NEW.severity, NEW.summary, NEW.opened_by, NEW.confirmed_by, NEW.published_at, NEW.created_at)
    IS DISTINCT FROM ROW(OLD.election_id, OLD.polling_unit_id, OLD.severity, OLD.summary, OLD.opened_by, OLD.confirmed_by, OLD.published_at, OLD.created_at)
  THEN RAISE EXCEPTION 'published case facts are immutable'; END IF;
  RETURN NEW;
END;
$$;
