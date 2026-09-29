CREATE TABLE threads (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  author_kind TEXT NOT NULL CHECK (author_kind IN ('human', 'agent')),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  position INTEGER NOT NULL
);
