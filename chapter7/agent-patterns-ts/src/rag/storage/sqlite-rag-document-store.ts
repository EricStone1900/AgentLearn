import type Database from "better-sqlite3";
import { ragMetadataSchema, type RagChunk, type RagDocument, type RagStats } from "../schemas.js";
import type { RagDocumentStore } from "./rag-document-store.js";

interface DocumentRow {
  id: string;
  namespace: string;
  source: string;
  title: string;
  markdown: string;
  content_hash: string;
  index_fingerprint: string;
  metadata_json: string;
  created_at: string;
  updated_at: string;
}

interface ChunkRow {
  id: string;
  document_id: string;
  namespace: string;
  chunk_index: number;
  content: string;
  embedding_text: string;
  heading_path: string | null;
  start_offset: number;
  end_offset: number;
  token_count: number;
  content_hash: string;
  metadata_json: string;
}

function parseMetadata(json: string): Record<string, unknown> {
  return ragMetadataSchema.parse(JSON.parse(json));
}

function toDocument(row: DocumentRow): RagDocument {
  return {
    id: row.id,
    namespace: row.namespace,
    source: row.source,
    title: row.title,
    markdown: row.markdown,
    contentHash: row.content_hash,
    indexFingerprint: row.index_fingerprint,
    metadata: parseMetadata(row.metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toChunk(row: ChunkRow): RagChunk {
  return {
    id: row.id,
    documentId: row.document_id,
    namespace: row.namespace,
    chunkIndex: row.chunk_index,
    content: row.content,
    embeddingText: row.embedding_text,
    ...(row.heading_path ? { headingPath: row.heading_path } : {}),
    startOffset: row.start_offset,
    endOffset: row.end_offset,
    tokenCount: row.token_count,
    contentHash: row.content_hash,
    metadata: parseMetadata(row.metadata_json),
  };
}

export class SqliteRagDocumentStore implements RagDocumentStore {
  public constructor(private readonly database: Database.Database) {}

  public async initialize(): Promise<void> {
    this.database.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS rag_documents (
        id TEXT PRIMARY KEY,
        namespace TEXT NOT NULL,
        source TEXT NOT NULL,
        title TEXT NOT NULL,
        markdown TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        index_fingerprint TEXT NOT NULL DEFAULT 'legacy',
        metadata_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(namespace, source)
      );
      CREATE INDEX IF NOT EXISTS idx_rag_documents_namespace
        ON rag_documents(namespace);

      CREATE TABLE IF NOT EXISTS rag_chunks (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        namespace TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        content TEXT NOT NULL,
        embedding_text TEXT NOT NULL,
        heading_path TEXT,
        start_offset INTEGER NOT NULL,
        end_offset INTEGER NOT NULL,
        token_count INTEGER NOT NULL,
        content_hash TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        FOREIGN KEY(document_id) REFERENCES rag_documents(id) ON DELETE CASCADE,
        UNIQUE(document_id, chunk_index)
      );
      CREATE INDEX IF NOT EXISTS idx_rag_chunks_document
        ON rag_chunks(document_id, chunk_index);
      CREATE INDEX IF NOT EXISTS idx_rag_chunks_namespace
        ON rag_chunks(namespace);
    `);

    const columns = this.database
      .prepare("PRAGMA table_info(rag_documents)")
      .all() as Array<{ name: string }>;

    if (!columns.some((column) => column.name === "index_fingerprint")) {
      this.database.exec(
        "ALTER TABLE rag_documents " +
        "ADD COLUMN index_fingerprint TEXT NOT NULL DEFAULT 'legacy'",
      );
    }
  }

  public async getDocument(
    namespace: string,
    documentId: string,
  ): Promise<RagDocument | undefined> {
    const row = this.database
      .prepare("SELECT * FROM rag_documents WHERE namespace = ? AND id = ?")
      .get(namespace, documentId) as DocumentRow | undefined;
    return row ? toDocument(row) : undefined;
  }

  public async getChunksByDocument(
    namespace: string,
    documentId: string,
  ): Promise<RagChunk[]> {
    const rows = this.database
      .prepare(
        "SELECT * FROM rag_chunks " +
        "WHERE namespace = ? AND document_id = ? ORDER BY chunk_index",
      )
      .all(namespace, documentId) as ChunkRow[];
    return rows.map(toChunk);
  }

  public async getChunksByIds(
    namespace: string,
    chunkIds: string[],
  ): Promise<RagChunk[]> {
    if (chunkIds.length === 0) return [];
    const placeholders = chunkIds.map(() => "?").join(",");
    const rows = this.database
      .prepare(
        `SELECT * FROM rag_chunks WHERE namespace = ? AND id IN (${placeholders})`,
      )
      .all(namespace, ...chunkIds) as ChunkRow[];
    const byId = new Map(rows.map((row) => [row.id, toChunk(row)]));
    return chunkIds.flatMap((id) => {
      const chunk = byId.get(id);
      return chunk ? [chunk] : [];
    });
  }

  public async replaceDocument(document: RagDocument, chunks: RagChunk[]): Promise<void> {
    if (chunks.some((chunk) => chunk.documentId !== document.id)) {
      throw new Error("存在不属于当前文档的 chunk");
    }

    const replace = this.database.transaction(() => {
      const existing = this.database
        .prepare("SELECT namespace FROM rag_documents WHERE id = ?")
        .get(document.id) as { namespace: string } | undefined;

      if (existing && existing.namespace !== document.namespace) {
        throw new Error(
          `文档 ID ${document.id} 已属于 namespace ${existing.namespace}`,
        );
      }

      this.database.prepare(`
        INSERT INTO rag_documents (
          id, namespace, source, title, markdown, content_hash, index_fingerprint,
          metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          namespace = excluded.namespace,
          source = excluded.source,
          title = excluded.title,
          markdown = excluded.markdown,
          content_hash = excluded.content_hash,
          index_fingerprint = excluded.index_fingerprint,
          metadata_json = excluded.metadata_json,
          updated_at = excluded.updated_at
      `).run(
        document.id, document.namespace, document.source, document.title,
        document.markdown, document.contentHash, document.indexFingerprint,
        JSON.stringify(document.metadata), document.createdAt, document.updatedAt,
      );

      this.database.prepare("DELETE FROM rag_chunks WHERE document_id = ?").run(document.id);
      const insert = this.database.prepare(`
        INSERT INTO rag_chunks (
          id, document_id, namespace, chunk_index, content, embedding_text,
          heading_path, start_offset, end_offset, token_count, content_hash, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const chunk of chunks) {
        insert.run(
          chunk.id, chunk.documentId, chunk.namespace, chunk.chunkIndex,
          chunk.content, chunk.embeddingText, chunk.headingPath ?? null,
          chunk.startOffset, chunk.endOffset, chunk.tokenCount,
          chunk.contentHash, JSON.stringify(chunk.metadata),
        );
      }
    });
    replace();
  }

  public async deleteDocument(
    namespace: string,
    documentId: string,
  ): Promise<boolean> {
    const result = this.database
      .prepare("DELETE FROM rag_documents WHERE namespace = ? AND id = ?")
      .run(namespace, documentId);
    return result.changes > 0;
  }

  public async getStats(namespace: string): Promise<RagStats> {
    const documents = this.database
      .prepare("SELECT COUNT(*) AS count FROM rag_documents WHERE namespace = ?")
      .get(namespace) as { count: number };
    const chunks = this.database
      .prepare("SELECT COUNT(*) AS count FROM rag_chunks WHERE namespace = ?")
      .get(namespace) as { count: number };
    return { documents: documents.count, chunks: chunks.count };
  }
}
