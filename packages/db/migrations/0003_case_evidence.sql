ALTER TABLE case_items ADD COLUMN snapshot jsonb NOT NULL DEFAULT '{}';

CREATE FUNCTION protect_case_items() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_id text; published timestamptz;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.case_id <> OLD.case_id OR NEW.flag_id <> OLD.flag_id) THEN
    RAISE EXCEPTION 'case evidence identity is immutable';
  END IF;
  target_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.case_id ELSE NEW.case_id END;
  SELECT published_at INTO published FROM discrepancy_cases WHERE id = target_id FOR UPDATE;
  IF published IS NOT NULL THEN RAISE EXCEPTION 'published evidence is immutable'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER case_items_publication BEFORE INSERT OR UPDATE OR DELETE ON case_items
  FOR EACH ROW EXECUTE FUNCTION protect_case_items();

CREATE FUNCTION freeze_published_case() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.published_at IS NOT NULL AND
    ROW(NEW.election_id, NEW.polling_unit_id, NEW.severity, NEW.summary, NEW.opened_by, NEW.confirmed_by, NEW.published_at)
    IS DISTINCT FROM ROW(OLD.election_id, OLD.polling_unit_id, OLD.severity, OLD.summary, OLD.opened_by, OLD.confirmed_by, OLD.published_at)
  THEN RAISE EXCEPTION 'published case facts are immutable'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER discrepancy_cases_facts BEFORE UPDATE ON discrepancy_cases
  FOR EACH ROW EXECUTE FUNCTION freeze_published_case();
