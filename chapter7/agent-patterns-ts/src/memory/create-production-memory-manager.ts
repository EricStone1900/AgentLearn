import Database from "better-sqlite3";
import { QdrantClient } from "@qdrant/js-client-rest";
import neo4j, { type Driver } from "neo4j-driver";
import OpenAI from "openai";
import { MemoryConsistencyScanner } from "./consistency/memory-consistency-scanner.js";
import { MemoryOutboxWorker } from "./consistency/memory-outbox-worker.js";
import { SqliteMemoryOutbox } from "./consistency/sqlite-memory-outbox.js";
import { RuleBasedKnowledgeExtractor } from "./knowledge-extractor.js";
import { MemoryManager } from "./manager.js";
import { OpenAiCompatibleEmbeddingClient } from "./openai-compatible-embedding.js";
import type { ProductionMemoryConfig } from "./production-memory-config.js";
import { createDefaultMemoryConfig, memoryConfigSchema } from "./schemas.js";
import type { MemoryConfig } from "./schemas.js";
import { Neo4jGraphStore } from "./storage/neo4j-graph-store.js";
import { QdrantVectorStore } from "./storage/qdrant-vector-store.js";
import { SqliteDocumentStore } from "./storage/sqlite-document-store.js";
import { EpisodicMemory } from "./types/episodic-memory.js";
import { PerceptualMemory } from "./types/perceptual-memory.js";
import { SemanticMemory } from "./types/semantic-memory.js";
import { WorkingMemory } from "./types/working-memory.js";

export interface CreateProductionMemoryManagerOptions {
  userId: string;
  infrastructure: ProductionMemoryConfig;
  config?: Partial<MemoryConfig>;
  now?: () => Date;
}

export interface ProductionMemoryRuntime {
  manager: MemoryManager;
  consistencyScanner: MemoryConsistencyScanner;
  consistencyOutbox: SqliteMemoryOutbox;
  outboxWorker: MemoryOutboxWorker;
  close(): Promise<void>;
}
export async function createProductionMemoryManager(
  options: CreateProductionMemoryManagerOptions,
): Promise<ProductionMemoryRuntime> {
  const memoryConfig = memoryConfigSchema.parse({
    ...createDefaultMemoryConfig(),
    ...(options.config ?? {}),
  });
  const now = options.now ?? (() => new Date());

  const sqlite = new Database(options.infrastructure.MEMORY_SQLITE_PATH);
  let neo4jDriver: Driver | undefined;

  try {
    const documents = new SqliteDocumentStore(sqlite);
    const consistencyOutbox = new SqliteMemoryOutbox(sqlite, now);

    /*
     * OpenAI SDK 在这里只是 OpenAI-compatible 协议客户端。
     * 请求目标完全由 EMBEDDING_BASE_URL 决定。
     */
    const embeddingApi = new OpenAI({
      apiKey: options.infrastructure.EMBEDDING_API_KEY,
      baseURL: options.infrastructure.EMBEDDING_BASE_URL,
    });
    const embeddings = new OpenAiCompatibleEmbeddingClient({
      client: embeddingApi,
      model: options.infrastructure.EMBEDDING_MODEL,
      dimension: options.infrastructure.EMBEDDING_DIMENSION,
      sendDimensions: options.infrastructure.EMBEDDING_SEND_DIMENSIONS,
    });

    const qdrant = new QdrantClient({
      url: options.infrastructure.QDRANT_URL,
      ...(options.infrastructure.QDRANT_API_KEY
        ? { apiKey: options.infrastructure.QDRANT_API_KEY }
        : {}),
    });
    const vectors = new QdrantVectorStore({
      client: qdrant,
      collectionName: options.infrastructure.QDRANT_COLLECTION,
      dimension: embeddings.dimension,
    });
    await vectors.initialize();

    neo4jDriver = neo4j.driver(
      options.infrastructure.NEO4J_URI,
      neo4j.auth.basic(
        options.infrastructure.NEO4J_USERNAME,
        options.infrastructure.NEO4J_PASSWORD,
      ),
    );
    await neo4jDriver.verifyConnectivity();

    const graph = new Neo4jGraphStore({
      driver: neo4jDriver,
      database: options.infrastructure.NEO4J_DATABASE,
    });
    await graph.initialize();
    const extractor = new RuleBasedKnowledgeExtractor();

    const consistencyScanner = new MemoryConsistencyScanner(
      documents,
      vectors,
      graph,
      embeddings,
    );
    const outboxWorker = new MemoryOutboxWorker(
      consistencyOutbox,
      documents,
      vectors,
      graph,
      embeddings,
      options.infrastructure.MEMORY_OUTBOX_MAX_ATTEMPTS,
    );

    const manager = new MemoryManager(
      options.userId,
      [
        new WorkingMemory(memoryConfig, now),
        new EpisodicMemory(documents, vectors, embeddings, now),
        new SemanticMemory(documents, vectors, embeddings, graph, extractor),
        new PerceptualMemory(documents, vectors, embeddings, now),
      ],
      memoryConfig,
      now,
    );

    const driver = neo4jDriver;

    return {
      manager,
      consistencyScanner,
      consistencyOutbox,
      outboxWorker,
      async close(): Promise<void> {
        try {
          await driver.close();
        } finally {
          sqlite.close();
        }
      },
    };
  } catch (error: unknown) {
    try {
      if (neo4jDriver) await neo4jDriver.close();
    } finally {
      sqlite.close();
    }
    throw error;
  }
}
