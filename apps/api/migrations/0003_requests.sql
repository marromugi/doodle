CREATE TABLE pages (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL,
  name TEXT NOT NULL,
  skeleton_document_id TEXT NOT NULL,
  adopted_proposal_document_id TEXT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE requests (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL,
  snapshot_document_id TEXT NOT NULL,
  feedback TEXT NOT NULL,
  previous_request_id TEXT NULL,
  state TEXT NOT NULL CHECK (state IN ('requested', 'inProgress', 'awaitingChoice', 'completed', 'aborted')),
  agent_id TEXT NULL,
  delivered INTEGER NOT NULL DEFAULT 0,
  adopted_proposal_document_id TEXT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE request_references (
  request_id TEXT NOT NULL,
  proposal_document_id TEXT NOT NULL,
  position INTEGER NOT NULL
);
