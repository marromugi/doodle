import type { Clock } from "./files";
import type {
  AddCommentInput,
  AddThreadInput,
  Comment,
  Failure,
  Thread,
  ThreadFilter,
} from "./schema";

type ThreadRow = { id: string; document_id: string; node_id: string };

type CommentRow = {
  id: string;
  thread_id: string;
  author_kind: Comment["authorKind"];
  body: string;
  created_at: string;
};

function toComment(row: CommentRow): Comment {
  return {
    id: row.id,
    authorKind: row.author_kind,
    body: row.body,
    createdAt: row.created_at,
  };
}

function toThread(row: ThreadRow, comments: Comment[]): Thread {
  return {
    id: row.id,
    document: row.document_id,
    node: row.node_id,
    awaitingReply: comments.at(-1)?.authorKind === "agent",
    comments,
  };
}

export async function addThread(
  db: D1Database,
  input: AddThreadInput,
  clock: Clock = () => new Date(),
): Promise<Thread> {
  const threadId = `thr_${crypto.randomUUID()}`;
  const commentId = `cmt_${crypto.randomUUID()}`;
  const createdAt = clock().toISOString();

  // The thread and its first comment are written together or not at all.
  await db.batch([
    db
      .prepare(
        "INSERT INTO threads (id, document_id, node_id, created_at) VALUES (?, ?, ?, ?)",
      )
      .bind(threadId, input.document, input.node, createdAt),
    db
      .prepare(
        `INSERT INTO comments (id, thread_id, author_kind, body, created_at, position)
         VALUES (?, ?, ?, ?, ?, 0)`,
      )
      .bind(commentId, threadId, input.authorKind, input.body, createdAt),
  ]);

  return toThread(
    { id: threadId, document_id: input.document, node_id: input.node },
    [
      {
        id: commentId,
        authorKind: input.authorKind,
        body: input.body,
        createdAt,
      },
    ],
  );
}

export type AddCommentResult =
  { ok: true; comment: Comment } | Failure<"not_found">;

export async function addComment(
  db: D1Database,
  threadId: string,
  input: AddCommentInput,
  clock: Clock = () => new Date(),
): Promise<AddCommentResult> {
  const id = `cmt_${crypto.randomUUID()}`;
  const createdAt = clock().toISOString();

  // The position is taken inside the insert, so replies keep the order written
  // even when their timestamps are equal.
  const result = await db
    .prepare(
      `INSERT INTO comments (id, thread_id, author_kind, body, created_at, position)
       SELECT ?1, ?2, ?3, ?4, ?5,
         (SELECT COALESCE(MAX(position), -1) + 1 FROM comments WHERE thread_id = ?2)
       WHERE EXISTS (SELECT 1 FROM threads WHERE id = ?2)`,
    )
    .bind(id, threadId, input.authorKind, input.body, createdAt)
    .run();

  if (result.meta.changes === 0) {
    return {
      ok: false,
      code: "not_found",
      message: `Thread ${threadId} does not exist.`,
    };
  }
  return {
    ok: true,
    comment: { id, authorKind: input.authorKind, body: input.body, createdAt },
  };
}

// A thread awaits a reply while its last comment is the agent's.
const MATCHES = `(?1 IS NULL OR t.document_id = ?1)
  AND (?2 = 0 OR (
    SELECT c.author_kind FROM comments c
    WHERE c.thread_id = t.id ORDER BY c.position DESC LIMIT 1) = 'agent')`;

export async function listThreads(
  db: D1Database,
  filter: ThreadFilter,
): Promise<Thread[]> {
  const bindings = [filter.document ?? null, filter.awaitingReply ? 1 : 0];
  const threads = await db
    .prepare(
      `SELECT t.id, t.document_id, t.node_id FROM threads t
       WHERE ${MATCHES} ORDER BY t.created_at, t.rowid`,
    )
    .bind(...bindings)
    .all<ThreadRow>();
  const comments = await db
    .prepare(
      `SELECT c.id, c.thread_id, c.author_kind, c.body, c.created_at
       FROM comments c JOIN threads t ON t.id = c.thread_id
       WHERE ${MATCHES} ORDER BY c.position`,
    )
    .bind(...bindings)
    .all<CommentRow>();

  const byThread = new Map<string, Comment[]>();
  for (const row of comments.results) {
    const list = byThread.get(row.thread_id) ?? [];
    list.push(toComment(row));
    byThread.set(row.thread_id, list);
  }
  return threads.results.map((row) =>
    toThread(row, byThread.get(row.id) ?? []),
  );
}
