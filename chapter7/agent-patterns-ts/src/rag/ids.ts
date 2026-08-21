import { createHash } from "node:crypto";

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function deterministicUuid(value: string): string {
  const bytes = createHash("sha256").update(value, "utf8").digest().subarray(0, 16);

  // 设置 UUID version=5 和 RFC 4122 variant 位。
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

export function createDocumentId(namespace: string, source: string): string {
  return deterministicUuid(`rag-document:${namespace}:${source}`);
}

export function createChunkId(
  documentId: string,
  chunkIndex: number,
  contentHash: string,
): string {
  return deterministicUuid(
    `rag-chunk:${documentId}:${chunkIndex}:${contentHash}`,
  );
}

export interface RagIndexFingerprintInput {
  collectionName: string;
  embeddingBaseUrl: string;
  embeddingModel: string;
  embeddingDimension: number;
  chunkTokens: number;
  overlapTokens: number;
  preprocessingVersion: string;
}

export function createRagIndexFingerprint(
  input: RagIndexFingerprintInput,
): string {
  return sha256(JSON.stringify([
    input.collectionName,
    input.embeddingBaseUrl,
    input.embeddingModel,
    input.embeddingDimension,
    input.chunkTokens,
    input.overlapTokens,
    input.preprocessingVersion,
  ]));
}
