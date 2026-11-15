CREATE TABLE submission_signals (
  submission_id text PRIMARY KEY REFERENCES submissions(id) ON DELETE CASCADE,
  observer_id text NOT NULL REFERENCES users(id),
  polling_unit_id text NOT NULL REFERENCES polling_units(id) ON DELETE CASCADE,
  ip_hash text NOT NULL CHECK(ip_hash ~ '^[a-f0-9]{64}$'),
  device_hash text CHECK(device_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX submission_signals_ip_idx ON submission_signals(ip_hash, created_at);
CREATE INDEX submission_signals_device_idx ON submission_signals(device_hash, created_at) WHERE device_hash IS NOT NULL;
INSERT INTO observer_profiles(user_id) SELECT id FROM users WHERE role = 'observer' ON CONFLICT DO NOTHING;
