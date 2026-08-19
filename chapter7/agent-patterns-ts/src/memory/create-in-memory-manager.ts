import { HashEmbeddingClient } from "./embedding.js";
import { RuleBasedKnowledgeExtractor } from "./knowledge-extractor.js";
import { MemoryManager } from "./manager.js";
import {
  createDefaultMemoryConfig,
  memoryConfigSchema,
} from "./schemas.js";
import type { MemoryConfig } from "./schemas.js";
import { InMemoryDocumentStore } from "./storage/document-store.js";
import { InMemoryGraphStore } from "./storage/graph-store.js";
import { InMemoryVectorStore } from "./storage/vector-store.js";
import { EpisodicMemory } from "./types/episodic-memory.js";
import { PerceptualMemory } from "./types/perceptual-memory.js";
import { SemanticMemory } from "./types/semantic-memory.js";
import { WorkingMemory } from "./types/working-memory.js";

export interface CreateInMemoryManagerOptions {
  userId: string;
  config?: Partial<MemoryConfig>;
  now?: () => Date;
}

export function createInMemoryMemoryManager(
  options: CreateInMemoryManagerOptions,
): MemoryManager {
  const config = memoryConfigSchema.parse({
    ...createDefaultMemoryConfig(),
    ...(options.config ?? {}),
  });
  const now = options.now ?? (() => new Date());
  const documents = new InMemoryDocumentStore();
  const vectors = new InMemoryVectorStore();
  const graph = new InMemoryGraphStore();
  const embeddings = new HashEmbeddingClient(128);
  const extractor = new RuleBasedKnowledgeExtractor();

  const working = new WorkingMemory(config, now);
  const episodic = new EpisodicMemory(documents, vectors, embeddings, now);
  const semantic = new SemanticMemory(
    documents,
    vectors,
    embeddings,
    graph,
    extractor,
  );
  const perceptual = new PerceptualMemory(documents, vectors, embeddings, now);

  return new MemoryManager(
    options.userId,
    [working, episodic, semantic, perceptual],
    config,
    now,
  );
}