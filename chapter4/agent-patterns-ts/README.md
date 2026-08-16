# Agent Patterns TypeScript

这是《第四章 智能体经典范式构建》的 Node.js + TypeScript 渐进式练习工程。

工程刻意只提供类型、目录、输出契约与 `TODO(step-xx)` 骨架，核心算法由学习者按顺序亲手完成。

## 快速开始

```bash
cd chapter4/agent-patterns-ts
npm install
cp .env.example .env
npm run dev
npm run typecheck
npm test
```

随后打开 [LEARNING_GUIDE.md](./LEARNING_GUIDE.md)，严格按 step-01 到 step-07 实现。查找当前任务可使用：

```bash
rg 'TODO\(step-02\)' src tests
```

## 目录职责

```text
src/
├── core/                 # 配置、LLM 抽象、JSON 解析
├── tools/                # 工具协议、注册表、计算器
├── agents/
│   ├── react/            # 思考 → 行动 → 观察
│   ├── plan-and-solve/   # 规划 → 执行
│   └── reflection/       # 执行 → 反思 → 优化
└── index.ts              # 后续改造成命令行入口
tests/                    # 不调用真实 API 的单元测试
```

## 完成标准

每完成一步，都运行：

```bash
npm run typecheck
npm test
```

不要一开始同时实现三个 Agent。它们共享很多基础能力，按顺序完成更容易定位问题。
