CREATE TABLE document_summaries (
  document_id TEXT PRIMARY KEY,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL
);

CREATE TABLE document_thumbnails (
  document_id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('ready', 'failed')),
  content_type TEXT NULL,
  image BLOB NULL,
  reason TEXT NULL
);
