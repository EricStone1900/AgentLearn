# 学习实现指南

## 总体路线

```text
配置与 LLM → 工具系统 → ReAct → Plan-and-Solve → Reflection → 测试比较
```

顺序的原因是：三个 Agent 都需要稳定的模型调用；ReAct 额外依赖工具；Plan-and-Solve 重点练习任务分解和状态传递；Reflection 最后复用前面的“执行结果”，增加质量控制循环。

---

## Step 01：跑通工程骨架

### 目标

安装依赖、创建 `.env`，确认 TypeScript 编译器和测试框架可以运行。

### 为什么先做

把环境问题与业务逻辑问题分开。以后出现错误时，可以优先判断是代码问题，而不是 Node.js、模块系统或依赖没有配置好。

### 操作

```bash
cd chapter4/agent-patterns-ts
npm install
cp .env.example .env
npm run dev
npm run typecheck
npm test
```

在 `.env` 中填写：

- `LLM_API_KEY`：密钥，不要提交到 Git。
- `LLM_MODEL_ID`：实际可用的模型 ID，不在代码中写死。
- `LLM_BASE_URL`：只有使用兼容服务时才需要。
- `LLM_TIMEOUT_MS`：网络调用超时，防止请求无限等待。

### 观察代码

- `type: module` + `NodeNext`：使用现代 ESM；TypeScript 源码导入本地文件时写 `.js`，编译后路径才能被 Node 正确识别。
- `strict`：让类型错误尽早暴露。
- `.env` 在 `.gitignore` 中，而 `.env.example` 可以提交。

### 验收

三个命令都成功，并看到学习步骤列表。此步不调用真实模型。

---

## Step 02：实现 LLM 客户端与结构化解析

### 目标

完成：

1. `src/core/json.ts` 的 `parseJson`。
2. `src/core/openai-llm.ts` 的 `generate`。

查找任务：

```bash
rg 'TODO\(step-02\)' src
```

### 为什么要抽象 `LlmClient`

Agent 不应该知道使用的是 OpenAI SDK、兼容服务还是假模型。它只关心“输入消息，返回文本”。这样可以：

- 单元测试时不花 API 费用；
- 更换模型时不改 Agent；
- 将网络错误集中在一处处理。

### 2.1 实现 `parseJson`

建议流程：

1. 对字符串 `trim()`。
2. 如果模型包了 ` ```json ... ``` `，去掉围栏。
3. 使用 `JSON.parse` 得到未知值。
4. 使用传入的 Zod schema 校验并返回。

不要只写 `JSON.parse(raw) as T`。`as T` 只会欺骗编译器，不会验证模型在运行时返回的数据。

### 2.2 实现 `generate`

把 `Message[]` 转为一个清晰的文本输入，调用：

```ts
const response = await this.client.responses.create({
  model: this.config.LLM_MODEL_ID,
  input: messages.map(({ role, content }) => ({ role, content })),
});

return response.output_text;
```

如果你的兼容服务不支持 Responses API，可以在这个类内部改用它支持的接口；不要让兼容逻辑泄漏到 Agent 类中。

### 验收

临时在 `src/index.ts` 调用一次 `generate`，确认能返回文本，然后删除临时代码，避免后续每次 `npm run dev` 都产生费用。

---

## Step 03：实现工具系统

### 目标

完成 `ToolRegistry` 和 `calculatorTool`。

```bash
rg 'TODO\(step-03\)' src
```

### 为什么工具需要名称、描述、输入 Schema 和执行逻辑

- 名称：让模型能准确选择工具。
- 描述：告诉模型“什么时候用”，它直接影响选择质量。
- Schema：工具边界上的运行时防线，避免错误参数进入业务逻辑。
- 执行逻辑：真正改变或查询外部世界。

### 3.1 实现注册表

`register`：

1. 检查 `Map` 是否已经存在同名工具。
2. 重名时抛错，避免无声覆盖。
3. 保存工具。

`describe`：把工具转换成提示词可读的列表，例如：

```text
- calculator: 对两个数字进行加、减、乘、除运算
```

`execute`：

1. 按名称查找工具。
2. 找不到时返回明确错误。
3. 使用 `tool.inputSchema.safeParse(input)` 校验参数。
4. 调用 `tool.execute(parsed.data)`。
5. 捕获异常，并转换成可供 Agent 阅读的 Observation。

这里推荐“返回错误 Observation”，而不是直接让整个 Agent 崩溃，因为 ReAct 可以在下一轮根据错误信息纠正自己。

### 3.2 实现计算器

用 `switch (input.operator)` 实现四则运算，并显式处理除零。不要使用 `eval` 执行模型提供的字符串：模型输入属于不可信输入，`eval` 会带来任意代码执行风险。

### 验收

先不用模型，直接注册并执行：

```ts
await registry.execute("calculator", {
  left: 579,
  operator: "*",
  right: 789,
});
```

再验证错误工具名、缺失参数和除零都能返回清楚的错误。

---

## Step 04：实现 ReAct Agent

### 核心循环

```text
问题 + 历史轨迹
       ↓
    LLM 决策
       ↓
  tool ──→ 执行工具 ──→ Observation ──┐
  finish ─→ 返回答案                  │
       ↑                              │
       └──────────────────────────────┘
```

### 为什么先实现 ReAct

它最直接地展示 Agent 和普通聊天模型的区别：模型不只生成答案，还能选择动作，并根据环境反馈改变下一步决策。

### 输出协议

要求模型每轮只返回以下两种 JSON 之一：

```json
{"type":"tool","thought":"需要精确计算","tool":"calculator","input":{"left":123,"operator":"+","right":456}}
```

```json
{"type":"finish","thought":"信息足够","answer":"最终答案"}
```

文档原例使用正则表达式解析 `Thought/Action`。本工程改用 JSON + Zod，是为了保留教学概念，同时降低换行、标点和格式漂移造成的解析失败。

### `run` 的实现步骤

1. `maxSteps` 默认设为 6。这是防止死循环的安全阀。
2. 创建空的 `trajectory: string[]`。
3. 每轮构造 system prompt，必须包含：工具列表、JSON 格式、只能选择已知工具、失败后根据 Observation 修正。
4. user prompt 包含原问题和当前轨迹。
5. 调用 LLM，用 `parseJson(raw, reactDecisionSchema)` 解析。
6. 若 `type === "finish"`，返回答案和步数。
7. 否则调用工具，把 Thought、Action、Observation 追加到轨迹。
8. 达到上限仍未完成时抛出包含轨迹摘要的错误。

### 关键理解

Observation 必须进入下一轮上下文，否则循环只是重复调用模型，不具备“根据环境反馈修正”的能力。

### 验收任务

让 Agent 计算 `(123 + 456) × 789 ÷ 12`。由于当前计算器一次只能做一个二元运算，模型应分三次调用工具，并把前一步结果用于下一步。

---

## Step 05：实现 Plan-and-Solve Agent

### 核心流程

```text
原始问题 → Planner → [步骤1, 步骤2, ...] → Executor 逐步执行 → 最终答案
```

### 为什么与 ReAct 分开

ReAct 每一步才决定下一步，适应性强；Plan-and-Solve 在开始时建立全局路线，结构更稳定，但静态计划遇到意外时不容易调整。

### 实现步骤

1. 规划调用：要求只返回 `{"steps":[...]}`。
2. 用 `planSchema` 校验，限制最多 12 步，防止不受控的长计划。
3. 创建 `history: StepRecord[]`。
4. 遍历计划，每次提示模型：原问题、完整计划、当前步骤、此前结果。
5. 把每一步结果写入 `history`，这是状态管理的核心。
6. 所有步骤完成后，再做一次总结调用，而不是盲目把最后一步当最终答案；这样对报告类任务也适用。

### 为什么每一步都要看到完整计划

只给当前步骤会让执行器失去全局目标；只给完整计划而不给历史结果，又会切断步骤之间的数据依赖。

### 验收任务

使用原章节中的多步数学应用题。检查日志是否展示计划，并确认第 2 步确实使用了第 1 步的结果。

### 进阶练习

当某步失败时，让 Planner 根据失败原因和已完成历史生成剩余计划，这就是动态重规划。

---

## Step 06：实现 Reflection Agent

### 核心循环

```text
生成初稿 → 评审 → 是否需要改进？ ─否→ 返回
                │
                是
                ↓
          根据反馈优化 ─────────→ 再次评审
```

### 6.1 先实现短期记忆

完成 `ShortTermMemory`：

- `add`：按时间保存 execution/reflection。
- `latestExecution`：反向查找最近初稿或修订稿。
- `trajectory`：用带编号的文本串联历史。

不要直接暴露内部数组，避免 Agent 在外部意外修改记忆。

### 6.2 实现 Agent

1. 先生成初稿并存为 `execution`。
2. 每轮用独立的评审提示词检查事实、逻辑、遗漏、效率和可读性。
3. 要求返回 `{"needsImprovement": boolean, "feedback": "..."}`。
4. 若不需要改进，返回最近一次 execution。
5. 若需要，把任务、最近版本和反馈交给模型生成修订稿。
6. 保存 reflection 和新 execution，再继续。
7. `maxIterations` 默认 3，达到上限返回当前最佳版本，并清楚标明是因上限停止。

### 为什么使用布尔字段终止

检查字符串是否包含“无需改进”容易受到同义词和否定句影响。结构化布尔字段仍可能判断错误，但终止逻辑更稳定、可测试。

### 验收任务

让它编写“返回 1 到 n 之间所有素数的 TypeScript 函数”。观察初稿是否被评审为低效，并逐步优化到筛法，同时检查边界条件。

---

## Step 07：不调用真实 API 的测试

### 为什么必须使用假模型

真实模型输出不完全确定，而且有费用和网络延迟。单元测试应该快速、稳定、可重复。

### 实现 `FakeLlmClient`

在 `tests/helpers/fake-llm.ts` 中保存一个预设响应队列：

```ts
export class FakeLlmClient implements LlmClient {
  public constructor(private readonly replies: string[]) {}

  public async generate(): Promise<string> {
    const reply = this.replies.shift();
    if (reply === undefined) throw new Error("假模型响应已耗尽");
    return reply;
  }
}
```

分别测试：

- ReAct：一次工具调用后 finish；未知工具后能再次决策；超过最大步数会停止。
- Plan-and-Solve：严格按计划执行；后一步提示词包含前一步结果；非法计划会失败。
- Reflection：评审通过时立即停止；两轮改进后停止；达到迭代上限会停止。
- ToolRegistry：重名、非法参数、执行异常都能得到预期结果。

### 最后的比较实验

给三个 Agent 相同任务，记录：

| 指标 | ReAct | Plan-and-Solve | Reflection |
|---|---|---|---|
| LLM 调用次数 |  |  |  |
| 工具调用次数 |  |  |  |
| 总耗时 |  |  |  |
| 是否能动态调整 | 是 | 默认否 | 通过迭代优化 |
| 最适合的任务 | 外部信息、探索 | 路径明确、多步骤 | 高质量、高可靠性 |

做到这里，你掌握的就不只是三个类，而是 Agent 工程中的五个通用部件：模型适配层、结构化协议、工具系统、状态/记忆、循环与终止条件。

---

## 推荐节奏

每次只完成一个 Step：

1. 阅读目标与原因。
2. 用 `rg 'TODO(step-xx)'` 找到代码点。
3. 自己实现，不复制整章代码。
4. 运行类型检查和测试。
5. 写两三句话记录“这一层解决了什么问题、失败时会怎样”。

如果某一步卡住，提供报错和对应文件即可针对性排查，不需要把三个 Agent 一起改。
