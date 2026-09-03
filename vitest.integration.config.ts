import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// 실제 구글 시트에 붙는 테스트. `npm run test:sheet` 로만 돕니다.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    setupFiles: ["./vitest.env.ts"],
    testTimeout: 60_000,
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
