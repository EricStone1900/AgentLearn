import Database from "better-sqlite3";
import { QdrantClient } from "@qdrant/js-client-rest";
import OpenAI from "openai";
import type { LlmClient } from "../core/types.js";
import { OpenAiCompatibleEmbeddingClient } from "../memory/openai-compatible-embedding.js";
import { LocalDocumentLoader } from "./document-loader.js";
import { RagIngestionPipeline } from "./ingestion-pipeline.js";
import { MarkdownSplitter } from "./markdown-splitter.js";
import type { ProductionRagConfig } from "./production-rag-config.js";
import { RagRetriever } from "./retriever.js";
import { RagService } from "./rag-service.js";
import { QdrantRagVectorStore } from "./storage/qdrant-rag-vector-store.js";
import { SqliteRagDocumentStore } from "./storage/sqlite-rag-document-store.js";

export interface ProductionRagRuntime {
  service: RagService;
  close(): Promise<void>;
}

export async function createProductionRag(
  config: ProductionRagConfig,
  llm: LlmClient,
): Promise<ProductionRagRuntime> {
  const database = new Database(config.RAG_SQLITE_PATH);
  try {
    const documents = new SqliteRagDocumentStore(database);
    await documents.initialize();
    const embeddingApi = new OpenAI({
      apiKey: config.EMBEDDING_API_KEY,
      baseURL: config.EMBEDDING_BASE_URL,
    });
    const embeddings = new OpenAiCompatibleEmbeddingClient({
      client: embeddingApi,
      model: config.EMBEDDING_MODEL,
      dimension: config.EMBEDDING_DIMENSION,
      sendDimensions: config.EMBEDDING_SEND_DIMENSIONS,
    });
    const qdrant = new QdrantClient({
      url: config.QDRANT_URL,
      ...(config.QDRANT_API_KEY ? { apiKey: config.QDRANT_API_KEY } : {}),
    });
    const vectors = new QdrantRagVectorStore({
      client: qdrant,
      collectionName: config.RAG_QDRANT_COLLECTION,
      dimension: embeddings.dimension,
    });
    await vectors.initialize();
    const loader = await LocalDocumentLoader.create(config.RAG_KNOWLEDGE_ROOT);
    const splitter = new MarkdownSplitter({
      chunkTokens: config.RAG_CHUNK_TOKENS,
      overlapTokens: config.RAG_CHUNK_OVERLAP_TOKENS,
    });
    const ingestion = new RagIngestionPipeline(
      loader, splitter, documents, vectors, embeddings,
    );
    const retriever = new RagRetriever(documents, vectors, embeddings, llm);
    return {
      service: new RagService(ingestion, retriever, documents, llm),
      async close(): Promise<void> {
        database.close();
      },
    };
  } catch (error: unknown) {
    database.close();
    throw error;
  }
}