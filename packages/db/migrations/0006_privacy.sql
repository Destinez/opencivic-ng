ALTER TABLE reference_records ALTER COLUMN image_path DROP NOT NULL;
CREATE TABLE privacy_consents (
  user_id text NOT NULL REFERENCES users(id),
  purpose text NOT NULL CHECK(purpose IN ('account_storage', 'observation_evidence')),
  granted_at timestamptz NOT NULL,
  withdrawn_at timestamptz,
  PRIMARY KEY(user_id, purpose)
);
INSERT INTO privacy_consents(user_id, purpose, granted_at) SELECT id, 'account_storage', consent_at FROM users;
CREATE TABLE file_deletions (
  path text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX case_items_reference_idx ON case_items((snapshot->'reference'->>'id'));
