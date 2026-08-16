export type MemoryKind = "execution" | "reflection";

export interface MemoryRecord {
  kind: MemoryKind;
  content: string;
}

/**
 * 保存一次 Reflection 任务中的临时轨迹。
 *
 * execution：某一版执行结果
 * reflection：针对某一版结果的评审反馈
 */
export class ShortTermMemory {
  private readonly records: MemoryRecord[] = [];

  /**
   * 添加一条记忆。
   */
  public add(record: MemoryRecord): void {
    const normalizedContent = record.content.trim();

    if (!normalizedContent) {
      throw new Error("不能向记忆中添加空内容");
    }

    this.records.push({
      kind: record.kind,
      content: normalizedContent,
    });
  }

  /**
   * 获取最近一次执行结果。
   */
  public latestExecution(): string | undefined {
    for (let index = this.records.length - 1; index >= 0; index -= 1) {
      const record = this.records[index];

      if (record?.kind === "execution") {
        return record.content;
      }
    }

    return undefined;
  }

  /**
   * 把完整记忆转换为适合放入提示词的文本。
   */
  public trajectory(): string {
    if (this.records.length === 0) {
      return "暂无历史记录。";
    }

    let executionNumber = 0;
    let reflectionNumber = 0;

    return this.records
      .map((record) => {
        if (record.kind === "execution") {
          executionNumber += 1;

          return [
            `--- 第 ${executionNumber} 版执行结果 ---`,
            record.content,
          ].join("\n");
        }

        reflectionNumber += 1;

        return [
          `--- 第 ${reflectionNumber} 轮反思反馈 ---`,
          record.content,
        ].join("\n");
      })
      .join("\n\n");
  }
}
