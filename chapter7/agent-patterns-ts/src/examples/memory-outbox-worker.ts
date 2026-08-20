import "dotenv/config";
import {
  createProductionMemoryManager,
  loadProductionMemoryConfig,
} from "../memory/index.js";

async function main(): Promise<void> {
  const infrastructure = loadProductionMemoryConfig();
  const runtime = await createProductionMemoryManager({
    userId: "memory-maintenance",
    infrastructure,
  });

  try {
    runtime.consistencyOutbox.recoverInterrupted(
      infrastructure.MEMORY_OUTBOX_MAX_ATTEMPTS,
    );

    const result = await runtime.outboxWorker.runUntilEmpty();
    const deadLetterCount =
      runtime.consistencyOutbox.countByStatus("DEAD_LETTER");
    console.log(
      JSON.stringify(
        { mode: "outbox-worker", result, deadLetterCount },
        null,
        2,
      ),
    );

    if (result.failed > 0 || deadLetterCount > 0) {
      process.exitCode = 1;
    }
  } finally {
    await runtime.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
