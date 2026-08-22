const packageName = "@ericstone/agent-patterns-ts";

const rootPackage = await import(packageName);
const corePackage = await import(`${packageName}/core`);
const agentsPackage = await import(`${packageName}/agents`);
const toolsPackage = await import(`${packageName}/tools`);
const memoryPackage = await import(`${packageName}/memory`);
const ragPackage = await import(`${packageName}/rag`);

const requiredExports = [
  [packageName, rootPackage, "HelloAgentsLlm"],
  [packageName, rootPackage, "FunctionCallAgent"],
  [packageName, rootPackage, "ToolRegistry"],

  [
    `${packageName}/core`,
    corePackage,
    "HelloAgentsLlm",
  ],

  [
    `${packageName}/agents`,
    agentsPackage,
    "FunctionCallAgent",
  ],

  [
    `${packageName}/tools`,
    toolsPackage,
    "ToolRegistry",
  ],

  [
    `${packageName}/tools`,
    toolsPackage,
    "createDefaultToolRegistry",
  ],

  [
    `${packageName}/memory`,
    memoryPackage,
    "createInMemoryMemoryManager",
  ],

  [
    `${packageName}/memory`,
    memoryPackage,
    "createProductionMemoryManager",
  ],

  [
    `${packageName}/rag`,
    ragPackage,
    "createProductionRag",
  ],

  [
    `${packageName}/rag`,
    ragPackage,
    "RagService",
  ],
];

for (const [
  moduleName,
  moduleExports,
  exportName,
] of requiredExports) {
  if (!(exportName in moduleExports)) {
    throw new Error(
      `${moduleName} 缺少公共导出：${exportName}`,
    );
  }
}

const registry = new toolsPackage.ToolRegistry();

if (registry.size !== 0) {
  throw new Error("新创建的 ToolRegistry 应为空");
}

const memoryManager =
  memoryPackage.createInMemoryMemoryManager({
    userId: "stage-4-package-verification",
  });

const registryWithMemory =
  toolsPackage.createDefaultToolRegistry({
    includeSearch: false,
    memoryManager,
  });

if (!registryWithMemory.has("memory")) {
  throw new Error("MemoryTool 没有成功注册");
}

console.log(
  JSON.stringify(
    {
      success: true,
      packageName,
      rootExports: {
        HelloAgentsLlm:
          typeof rootPackage.HelloAgentsLlm,
        FunctionCallAgent:
          typeof rootPackage.FunctionCallAgent,
        ToolRegistry:
          typeof rootPackage.ToolRegistry,
      },
      registeredTools:
        registryWithMemory.listNames(),
    },
    null,
    2,
  ),
);