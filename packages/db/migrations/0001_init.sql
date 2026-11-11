CREATE TABLE IF NOT EXISTS states (
  id text PRIMARY KEY,
  name text NOT NULL,
  code text NOT NULL,
  dataset text NOT NULL CHECK (dataset IN ('sample', 'imported')),
  latitude double precision,
  longitude double precision
);

CREATE TABLE IF NOT EXISTS lgas (
  id text PRIMARY KEY,
  state_id text NOT NULL REFERENCES states (id),
  name text NOT NULL,
  code text NOT NULL,
  dataset text NOT NULL CHECK (dataset IN ('sample', 'imported')),
  latitude double precision,
  longitude double precision
);

CREATE TABLE IF NOT EXISTS wards (
  id text PRIMARY KEY,
  lga_id text NOT NULL REFERENCES lgas (id),
  name text NOT NULL,
  code text NOT NULL,
  dataset text NOT NULL CHECK (dataset IN ('sample', 'imported')),
  latitude double precision,
  longitude double precision
);

CREATE TABLE IF NOT EXISTS polling_units (
  id text PRIMARY KEY,
  ward_id text NOT NULL REFERENCES wards (id),
  name text NOT NULL,
  code text NOT NULL UNIQUE,
  address text NOT NULL,
  dataset text NOT NULL CHECK (dataset IN ('sample', 'imported')),
  coordinate_kind text NOT NULL CHECK (coordinate_kind IN ('sample-approximate', 'imported', 'missing')),
  latitude double precision,
  longitude double precision,
  registered_voters integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS elections (
  id text PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  kind text NOT NULL,
  summary text NOT NULL,
  fictional boolean NOT NULL,
  accepts_submissions boolean NOT NULL,
  held_on date,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS election_dates (
  id text PRIMARY KEY,
  election_id text NOT NULL REFERENCES elections (id) ON DELETE CASCADE,
  label text NOT NULL,
  occurs_on date,
  detail text NOT NULL,
  unverified boolean NOT NULL,
  sources jsonb NOT NULL,
  sort_order integer NOT NULL
);

CREATE TABLE IF NOT EXISTS guidance_blocks (
  id text PRIMARY KEY,
  election_id text NOT NULL REFERENCES elections (id) ON DELETE CASCADE,
  topic text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  bullets jsonb NOT NULL,
  unverified boolean NOT NULL,
  sources jsonb NOT NULL,
  sort_order integer NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('observer', 'reviewer', 'admin')),
  consent_at timestamptz NOT NULL,
  age_confirmed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS submissions (
  id text PRIMARY KEY,
  election_id text NOT NULL REFERENCES elections (id),
  polling_unit_id text NOT NULL REFERENCES polling_units (id),
  observer_id text REFERENCES users (id) ON DELETE SET NULL,
  accredited_voters integer NOT NULL,
  rejected_ballots integer NOT NULL,
  party_votes jsonb NOT NULL,
  consistency_warnings jsonb NOT NULL,
  photo_path text,
  photo_placeholder boolean NOT NULL DEFAULT false,
  status text NOT NULL CHECK (status IN ('pending', 'approved', 'flagged')),
  decision_note text,
  decided_by text REFERENCES users (id) ON DELETE SET NULL,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_events (
  id bigserial PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_id text,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS lgas_state_id_idx ON lgas (state_id);
CREATE INDEX IF NOT EXISTS wards_lga_id_idx ON wards (lga_id);
CREATE INDEX IF NOT EXISTS polling_units_ward_id_idx ON polling_units (ward_id);
CREATE INDEX IF NOT EXISTS submissions_election_status_idx ON submissions (election_id, status);
CREATE INDEX IF NOT EXISTS submissions_polling_unit_idx ON submissions (polling_unit_id);
CREATE INDEX IF NOT EXISTS audit_events_entity_idx ON audit_events (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions (user_id);

CREATE OR REPLACE FUNCTION forbid_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END;
$$;

DROP TRIGGER IF EXISTS audit_events_append_only ON audit_events;
CREATE TRIGGER audit_events_append_only
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW
  EXECUTE FUNCTION forbid_audit_mutation();
