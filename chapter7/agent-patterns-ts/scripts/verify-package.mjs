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
    `${packageName}/memory`,
    memoryPackage,
    "createProductionMemoryManager",
  ],

  [
    `${packageName}/rag`,
    ragPackage,
    "createProductionRag",
  ],
];

for (const [moduleName, moduleExports, exportName] of requiredExports) {
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

console.log("npm 包公共入口验证通过");