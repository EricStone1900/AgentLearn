import "dotenv/config";
import {
  createProductionMemoryManager,
  loadProductionMemoryConfig,
} from "../memory/index.js";

async function main(): Promise<void> {
  const configuredUserId = process.env.MEMORY_SCAN_USER_ID?.trim();
  const options = configuredUserId ? { userId: configuredUserId } : {};

  const runtime = await createProductionMemoryManager({
    /* manager 在维护脚本中不会使用，但生产工厂仍要求一个 userId。 */
    userId: configuredUserId || "memory-maintenance",
    infrastructure: loadProductionMemoryConfig(),
  });

  try {
    const report = await runtime.consistencyScanner.scan(options);
    console.log(JSON.stringify({ mode: "scan", report }, null, 2));
  } finally {
    await runtime.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
