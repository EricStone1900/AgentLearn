import "dotenv/config";
import {
  createProductionMemoryManager,
  enqueueConsistencyRepairs,
  loadProductionMemoryConfig,
} from "../memory/index.js";

async function main(): Promise<void> {
  const configuredUserId = process.env.MEMORY_SCAN_USER_ID?.trim();
  const options = configuredUserId ? { userId: configuredUserId } : {};
  const infrastructure = loadProductionMemoryConfig();
  const runtime = await createProductionMemoryManager({
    userId: configuredUserId || "memory-maintenance",
    infrastructure,
  });

  try {
    const report = await runtime.consistencyScanner.scan(options);
    const queued = enqueueConsistencyRepairs(
      report,
      runtime.consistencyOutbox,
    );

    console.log(
      JSON.stringify({ mode: "enqueue", report, queued }, null, 2),
    );
  } finally {
    await runtime.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
