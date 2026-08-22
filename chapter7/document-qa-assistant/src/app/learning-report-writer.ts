import { mkdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

export interface LearningReportWriter {
  write(sessionId: string, report: unknown): Promise<string>;
}

export class JsonLearningReportWriter implements LearningReportWriter {
  private constructor(private readonly reportRoot: string) {}

  public static async create(
    reportRoot: string,
  ): Promise<JsonLearningReportWriter> {
    await mkdir(reportRoot, {
      recursive: true,
    });

    return new JsonLearningReportWriter(await realpath(reportRoot));
  }

  public async write(sessionId: string, report: unknown): Promise<string> {
    const normalizedSessionId = sessionId.trim();

    if (!/^[a-zA-Z0-9_-]+$/u.test(normalizedSessionId)) {
      throw new Error("sessionId 包含非法字符");
    }

    const fileName = `learning-report-${normalizedSessionId}.json`;

    const targetPath = join(this.reportRoot, fileName);

    const temporaryPath = join(
      this.reportRoot,
      `.${fileName}.${randomUUID()}.tmp`,
    );

    try {
      await writeFile(temporaryPath, JSON.stringify(report, null, 2), {
        encoding: "utf8",
      });

      await rename(temporaryPath, targetPath);

      return fileName;
    } catch (error: unknown) {
      await rm(temporaryPath, {
        force: true,
      });

      throw error;
    }
  }
}
