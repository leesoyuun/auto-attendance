import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // 실제 시트에 붙는 테스트는 자격 증명이 필요하고 시트를 바꾸므로 분리합니다.
    exclude: ["src/**/*.integration.test.ts", "node_modules/**"],
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
