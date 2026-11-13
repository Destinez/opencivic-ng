CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
CREATE INDEX polling_units_name_trgm_idx ON polling_units USING gin (name public.gin_trgm_ops);
CREATE INDEX polling_units_code_trgm_idx ON polling_units USING gin (code public.gin_trgm_ops);

ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('observer', 'reviewer', 'desk', 'admin'));

ALTER TABLE submissions DROP CONSTRAINT submissions_status_check;
ALTER TABLE submissions ADD CONSTRAINT submissions_status_check
  CHECK (status IN ('pending', 'in_review', 'approved', 'flagged', 'rejected', 'superseded', 'withdrawn'));
ALTER TABLE submissions
  ADD COLUMN client_id uuid,
  ADD COLUMN captured_at timestamptz,
  ADD COLUMN received_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN photo_sha256 text CHECK (photo_sha256 ~ '^[0-9a-f]{64}$'),
  ADD COLUMN photo_phash text CHECK (photo_phash ~ '^[0-9a-f]{16}$'),
  ADD COLUMN photo_bytes integer CHECK (photo_bytes BETWEEN 0 AND 2000000),
  ADD COLUMN declared_total_votes integer CHECK (declared_total_votes BETWEEN 0 AND 2000000),
  ADD COLUMN total_votes integer GENERATED ALWAYS AS (
    coalesce((party_votes->>'ADC')::integer, 0) + coalesce((party_votes->>'APC')::integer, 0) +
    coalesce((party_votes->>'APGA')::integer, 0) + coalesce((party_votes->>'LP')::integer, 0) +
    coalesce((party_votes->>'NNPP')::integer, 0) + coalesce((party_votes->>'PDP')::integer, 0) +
    coalesce((party_votes->>'SDP')::integer, 0) + coalesce((party_votes->>'YPP')::integer, 0) +
    coalesce((party_votes->>'others')::integer, 0) + rejected_ballots
  ) STORED,
  ADD COLUMN claimed_by text REFERENCES users(id),
  ADD COLUMN claimed_until timestamptz,
  ADD CONSTRAINT submissions_client_identity UNIQUE(observer_id, client_id);
CREATE INDEX submissions_unit_election_status_idx ON submissions(polling_unit_id, election_id, status);
CREATE INDEX submissions_photo_sha256_idx ON submissions(photo_sha256);

CREATE TABLE submission_reviews (
  id bigserial PRIMARY KEY,
  submission_id text NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  reviewer_id text NOT NULL REFERENCES users(id),
  decision text NOT NULL CHECK (decision IN ('approved', 'flagged', 'rejected')),
  reason_code text,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(submission_id, reviewer_id),
  CHECK (decision = 'approved' OR (length(trim(note)) >= 8 AND reason_code IS NOT NULL))
);
CREATE FUNCTION forbid_self_review() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.reviewer_id = (SELECT observer_id FROM submissions WHERE id = NEW.submission_id) THEN
    RAISE EXCEPTION 'reviewer cannot be observer';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER submission_review_independence BEFORE INSERT OR UPDATE ON submission_reviews
  FOR EACH ROW EXECUTE FUNCTION forbid_self_review();

CREATE TABLE reference_records (
  id text PRIMARY KEY,
  election_id text NOT NULL REFERENCES elections(id),
  polling_unit_id text NOT NULL REFERENCES polling_units(id),
  source text NOT NULL CHECK (source IN ('irev', 'ec8a_copy', 'sample')),
  source_url text NOT NULL,
  retrieved_at timestamptz NOT NULL,
  image_path text NOT NULL,
  image_sha256 text NOT NULL CHECK (image_sha256 ~ '^[0-9a-f]{64}$'),
  accredited_voters integer NOT NULL CHECK (accredited_voters BETWEEN 0 AND 200000),
  rejected_ballots integer NOT NULL CHECK (rejected_ballots BETWEEN 0 AND 200000),
  party_votes jsonb NOT NULL,
  declared_total_votes integer CHECK (declared_total_votes BETWEEN 0 AND 2000000),
  transcribed_by text NOT NULL REFERENCES users(id),
  verified_by text REFERENCES users(id),
  verified_at timestamptz,
  dataset text NOT NULL CHECK (dataset IN ('sample', 'imported', 'manual')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(election_id, polling_unit_id, image_sha256),
  CHECK (verified_by IS NULL OR verified_by <> transcribed_by),
  CHECK (source <> 'sample' OR dataset = 'sample')
);

CREATE TABLE discrepancy_flags (
  id text PRIMARY KEY,
  election_id text NOT NULL REFERENCES elections(id),
  polling_unit_id text NOT NULL REFERENCES polling_units(id),
  submission_id text NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  reference_id text REFERENCES reference_records(id),
  rule text NOT NULL CHECK (rule IN ('party_score_mismatch', 'accredited_mismatch', 'overvote',
    'arith_inconsistent', 'observer_conflict', 'registered_exceeded', 'duplicate_image')),
  field text NOT NULL,
  observed integer NOT NULL,
  expected integer NOT NULL,
  severity text NOT NULL CHECK (severity IN ('info', 'warn', 'critical')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT(submission_id, reference_id, rule, field)
);
CREATE INDEX discrepancy_flags_unit_idx ON discrepancy_flags(election_id, polling_unit_id);

CREATE TABLE discrepancy_cases (
  id text PRIMARY KEY,
  election_id text NOT NULL REFERENCES elections(id),
  polling_unit_id text NOT NULL REFERENCES polling_units(id),
  status text NOT NULL CHECK (status IN ('open', 'under_investigation', 'confirmed', 'published', 'explained', 'dismissed', 'retracted')),
  severity text NOT NULL CHECK (severity IN ('info', 'warn', 'critical')),
  opened_by text NOT NULL REFERENCES users(id),
  confirmed_by text REFERENCES users(id),
  published_at timestamptz,
  summary text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  retraction_requested_by text REFERENCES users(id),
  retracted_by text REFERENCES users(id),
  retraction_note text,
  CHECK (confirmed_by IS NULL OR confirmed_by <> opened_by),
  CHECK (status NOT IN ('published', 'retracted') OR (confirmed_by IS NOT NULL AND published_at IS NOT NULL)),
  CHECK (retracted_by IS NULL OR retracted_by <> retraction_requested_by)
);
CREATE UNIQUE INDEX discrepancy_case_active_unit_idx ON discrepancy_cases(election_id, polling_unit_id)
  WHERE status NOT IN ('dismissed', 'explained');
CREATE INDEX discrepancy_cases_board_idx ON discrepancy_cases(status, created_at DESC, id DESC);
CREATE TABLE case_items (
  case_id text NOT NULL REFERENCES discrepancy_cases(id),
  flag_id text NOT NULL REFERENCES discrepancy_flags(id),
  PRIMARY KEY(case_id, flag_id)
);
CREATE TABLE case_comments (
  id text PRIMARY KEY,
  case_id text NOT NULL REFERENCES discrepancy_cases(id),
  author_id text NOT NULL REFERENCES users(id),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE observer_profiles (
  user_id text PRIMARY KEY REFERENCES users(id),
  trust_level integer NOT NULL DEFAULT 0 CHECK (trust_level BETWEEN 0 AND 3),
  accreditation_ref text,
  approved_count integer NOT NULL DEFAULT 0 CHECK (approved_count >= 0),
  rejected_count integer NOT NULL DEFAULT 0 CHECK (rejected_count >= 0),
  home_state_id text REFERENCES states(id),
  frozen boolean NOT NULL DEFAULT false
);
INSERT INTO observer_profiles(user_id) SELECT id FROM users WHERE role = 'observer';

CREATE TABLE evidence_packs (
  case_id text NOT NULL REFERENCES discrepancy_cases(id),
  version integer NOT NULL CHECK (version > 0),
  manifest jsonb NOT NULL,
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(case_id, version)
);
CREATE TABLE rate_limits (
  key text NOT NULL,
  window_start timestamptz NOT NULL,
  count integer NOT NULL CHECK (count > 0),
  PRIMARY KEY(key, window_start)
);
CREATE INDEX rate_limits_window_idx ON rate_limits(window_start);

ALTER TABLE audit_events ADD COLUMN prev_hash text, ADD COLUMN hash text;
CREATE FUNCTION audit_event_payload(event audit_events) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_array(event.id::text,
    to_char(event.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    event.actor_id, event.action, event.entity_type, event.entity_id, event.metadata)::text;
$$;
CREATE FUNCTION audit_event_hash(previous text, payload text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(previous || E'\n' || payload, 'UTF8')), 'hex');
$$;
DROP TRIGGER audit_events_append_only ON audit_events;
DO $$
DECLARE event audit_events; previous text := repeat('0', 64); next_hash text;
BEGIN
  FOR event IN SELECT * FROM audit_events ORDER BY id LOOP
    next_hash := audit_event_hash(previous, audit_event_payload(event));
    UPDATE audit_events SET prev_hash = previous, hash = next_hash WHERE id = event.id;
    previous := next_hash;
  END LOOP;
END;
$$;
ALTER TABLE audit_events ALTER COLUMN prev_hash SET NOT NULL, ALTER COLUMN hash SET NOT NULL;
ALTER TABLE audit_events ADD CONSTRAINT audit_hash_format CHECK (hash ~ '^[0-9a-f]{64}$' AND prev_hash ~ '^[0-9a-f]{64}$');
CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_audit_mutation();
CREATE FUNCTION chain_audit_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous text;
BEGIN
  PERFORM pg_advisory_xact_lock(741210);
  NEW.id := nextval(pg_get_serial_sequence('audit_events', 'id'));
  SELECT hash INTO previous FROM audit_events ORDER BY id DESC LIMIT 1;
  NEW.prev_hash := coalesce(previous, repeat('0', 64));
  NEW.hash := audit_event_hash(NEW.prev_hash, audit_event_payload(NEW));
  RETURN NEW;
END;
$$;
CREATE TRIGGER audit_events_chain BEFORE INSERT ON audit_events
  FOR EACH ROW EXECUTE FUNCTION chain_audit_event();

CREATE FUNCTION protect_published_case() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.published_at IS NOT NULL AND
    (TG_OP = 'DELETE' OR NEW.status NOT IN ('published', 'retracted') OR NEW.published_at IS NULL) THEN
    RAISE EXCEPTION 'published cases must be retained';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER discrepancy_cases_retention BEFORE UPDATE OR DELETE ON discrepancy_cases
  FOR EACH ROW EXECUTE FUNCTION protect_published_case();
