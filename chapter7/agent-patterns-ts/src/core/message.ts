import { z } from "zod";

export const messageRoles = ["system", "user", "assistant", "tool"] as const;

export const messageRoleSchema = z.enum(messageRoles);

export type MessageRole = z.infer<typeof messageRoleSchema>;

export type MessageMetadata = Record<string, unknown>;

/**
 * 可以直接发送给 LLM 适配层的最小消息结构。
 */
export interface MessageData {
  role: MessageRole;
  content: string;
}

/**
 * 创建 Message 时可传入的额外信息。
 */
export interface MessageOptions {
  timestamp?: Date;
  metadata?: MessageMetadata;
}

const messageSchema = z.object({
  content: z.string(),
  role: messageRoleSchema,
  timestamp: z.date(),
  metadata: z.record(z.string(), z.unknown()),
});

export class Message implements MessageData {
  public readonly content: string;
  public readonly role: MessageRole;
  public readonly timestamp: Date;
  public readonly metadata: Readonly<MessageMetadata>;

  public constructor(
    content: string,
    role: MessageRole,
    options: MessageOptions = {},
  ) {
    const parsed = messageSchema.parse({
      content,
      role,
      timestamp: options.timestamp ?? new Date(),
      metadata: options.metadata ?? {},
    });

    this.content = parsed.content;
    this.role = parsed.role;
    this.timestamp = parsed.timestamp;

    /*
     * 复制后冻结，避免外部继续修改原始对象，
     * 影响已经保存的历史记录。
     */
    this.metadata = Object.freeze({
      ...parsed.metadata,
    });
  }

  /**
   * 转换成 LLM 接口需要的最小消息格式。
   */
  public toDict(): MessageData {
    return {
      role: this.role,
      content: this.content,
    };
  }

  public toString(): string {
    return `[${this.role}] ${this.content}`;
  }
}
