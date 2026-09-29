CREATE TABLE workspaces (
  id TEXT PRIMARY KEY
);

INSERT INTO workspaces (id) VALUES ('personal');

CREATE TABLE files (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('designSystem', 'app')),
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  reference_design_system_id TEXT NULL,
  reference_release_id TEXT NULL
);

CREATE TABLE releases (
  id TEXT PRIMARY KEY,
  design_system_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  message TEXT NULL,
  draft_revision INTEGER NOT NULL,
  content TEXT NOT NULL
);

CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('skeleton', 'proposal', 'snapshot', 'dsDraft')),
  page_id TEXT NULL,
  request_id TEXT NULL,
  release_id TEXT NULL
);
