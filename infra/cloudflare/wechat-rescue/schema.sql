CREATE TABLE IF NOT EXISTS device_status (
  device_id TEXT PRIMARY KEY,
  connection_state TEXT NOT NULL,
  observed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS device_heartbeat (
  device_id TEXT PRIMARY KEY CHECK (device_id = 'work-mac-joey'),
  connection_state TEXT NOT NULL CHECK (connection_state IN ('online','offline','disconnected','login_required','unknown')),
  observed_at TEXT,
  received_at TEXT NOT NULL,
  recovered_at TEXT
);
