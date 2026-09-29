import type { Thumbnail, ThumbnailPut } from "./schema";

function decodeBase64(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

// The write is one conditional upsert so that a concurrent older write cannot replace a newer one.
export async function putThumbnail(
  db: D1Database,
  documentId: string,
  thumbnail: ThumbnailPut,
): Promise<void> {
  const ready = thumbnail.state === "ready";
  await db
    .prepare(
      `INSERT INTO document_thumbnails (document_id, revision, state, content_type, image, reason)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT(document_id) DO UPDATE
         SET revision = excluded.revision, state = excluded.state,
             content_type = excluded.content_type, image = excluded.image,
             reason = excluded.reason
         WHERE excluded.revision > document_thumbnails.revision`,
    )
    .bind(
      documentId,
      thumbnail.revision,
      thumbnail.state,
      ready ? thumbnail.contentType : null,
      ready ? decodeBase64(thumbnail.image) : null,
      ready ? null : thumbnail.reason,
    )
    .run();
}

type ThumbnailRow = {
  revision: number;
  state: "ready" | "failed";
  content_type: string | null;
  image: ArrayBuffer | number[] | null;
  reason: string | null;
};

export async function getThumbnail(
  db: D1Database,
  documentId: string,
): Promise<Thumbnail> {
  const row = await db
    .prepare(
      "SELECT revision, state, content_type, image, reason FROM document_thumbnails WHERE document_id = ?",
    )
    .bind(documentId)
    .first<ThumbnailRow>();
  if (row === null) return { state: "none" };
  if (row.state === "failed") {
    return { state: "failed", revision: row.revision, reason: row.reason! };
  }
  const bytes = Array.isArray(row.image)
    ? Uint8Array.from(row.image)
    : new Uint8Array(row.image!);
  return {
    state: "ready",
    revision: row.revision,
    contentType: row.content_type!,
    image: encodeBase64(bytes),
  };
}
