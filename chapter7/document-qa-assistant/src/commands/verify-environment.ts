import "dotenv/config";
import {
  loadAppConfig,
  toSafeConfigSummary,
} from "../config/app-config.js";

try {
  const config = loadAppConfig();

  console.log(
    JSON.stringify(
      {
        success: true,
        message: "环境变量配置验证通过",
        config:
          toSafeConfigSummary(config),
      },
      null,
      2,
    ),
  );
} catch (error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : String(error);

  console.error(
    JSON.stringify(
      {
        success: false,
        message,
      },
      null,
      2,
    ),
  );

  process.exitCode = 1;
}