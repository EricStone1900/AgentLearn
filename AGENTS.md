# 仓库贡献指南

## 项目结构与模块组织

本仓库由中文章节笔记和可运行的 TypeScript 示例组成。`chapter1/travel-agent/` 是一个小型旅行智能体应用，源代码位于 `src/`，编译结果输出到 `dist/`。`chapter4/agent-patterns-ts/` 包含可复用的 ReAct、Plan-and-Solve 和 Reflection 示例；其中 `src/core/` 存放共享的 LLM 抽象，`src/tools/` 存放工具实现，`src/agents/` 按智能体范式组织代码，`src/examples/` 提供可运行示例。第四章单元测试位于 `tests/`，测试替身位于 `tests/helpers/`。章节文档应以 Markdown 格式放在对应的 `chapter1/` 或 `chapter4/` 目录中。

## 构建、测试与开发命令

仓库根目录没有统一的 package 脚本，请进入对应项目目录执行命令。

```bash
cd chapter1/travel-agent
npm install
npm run dev       # 使用 tsx 运行 src/index.ts
npm run build     # 将 TypeScript 编译到 dist/
npm start         # 运行编译后的应用

cd chapter4/agent-patterns-ts
npm install
npm run dev       # 运行第四章入口
npm run typecheck # 执行严格类型检查，不生成文件
npm test          # 运行一次 Vitest 测试套件
npm run test:watch
npm run demo:react # 其他示例：demo:plan、demo:reflection、demo:llm
```

## 编码风格与命名约定

使用现代 ESM TypeScript：两空格缩进、双引号、分号，并在多行结构中保留尾随逗号。相对导入必须显式使用 `.js` 扩展名。保持严格类型检查，优先使用 `unknown` 配合校验，避免 `any`。函数和变量使用 `camelCase`，类和接口使用 `PascalCase`，文件名使用 kebab-case，例如 `react-agent.ts`。项目目前未配置格式化器或 lint 工具，因此请遵循相邻代码风格，并在提交前运行类型检查。

## 测试规范

第四章使用 Vitest。测试文件命名为 `*.test.ts`，内容应对应被测行为，并使用 `FakeLlmClient`，不要调用真实 API。根据功能补充成功路径、模型输出无效、工具报错和终止条件等测试。创建拉取请求前运行 `npm run typecheck && npm test`。第一章目前没有自动化测试，修改后至少执行 `npm run build`。

## 提交与拉取请求规范

提交信息应遵循现有的简短祈使句风格，例如 `Add Chapter 4 agent pattern examples`。每次提交聚焦一个章节或单一关注点。拉取请求需要说明改动内容、改动原因、对学习者的影响及已执行的验证；如有相关 Issue，应添加链接，只有视觉改动才需要截图。禁止提交 `.env`、`node_modules/`、`dist/` 或 `.DS_Store` 文件。
