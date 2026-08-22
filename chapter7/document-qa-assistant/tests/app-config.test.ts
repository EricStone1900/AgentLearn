import { describe, expect, it } from "vitest";
import { loadAppConfig } from "../src/config/app-config.js";

describe("loadAppConfig", () => {
  it("未提供配置时使用默认值", () => {
    const config = loadAppConfig({});

    expect(config).toEqual({
      NODE_ENV: "development",
      HOST: "127.0.0.1",
      PORT: 3000,
      LOG_LEVEL: "info",
    });
  });

  it("将字符串端口转换为数字", () => {
    const config = loadAppConfig({
      NODE_ENV: "test",
      HOST: "0.0.0.0",
      PORT: "4000",
      LOG_LEVEL: "debug",
    });

    expect(config).toEqual({
      NODE_ENV: "test",
      HOST: "0.0.0.0",
      PORT: 4000,
      LOG_LEVEL: "debug",
    });
  });

  it("拒绝非法端口", () => {
    expect(() => {
      loadAppConfig({
        PORT: "70000",
      });
    }).toThrow("应用环境变量配置不正确");
  });
});
