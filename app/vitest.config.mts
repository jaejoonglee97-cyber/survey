import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/lib/survey-core/**", "src/lib/store/**", "src/lib/sheets/**", "src/lib/dashboard/**", "src/lib/admin/**", "src/lib/respond/**", "src/lib/auth/policy.ts"],
      // 실제 구글 API 호출부는 연결 확인 스크립트(sheets:check)로 확인
      exclude: ["src/lib/sheets/google-gateway.ts", "src/lib/sheets/google.ts", "src/lib/sheets/client.ts", "src/lib/**/server.ts", "src/lib/admin/load.ts", "src/lib/admin/previous.ts"],
      // 단계 1 완료 기준: survey-core 커버리지 90% 이상
      thresholds: { statements: 90, branches: 90, functions: 90, lines: 90 },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      // 'server-only'는 Next.js 밖(시험·스크립트)에서는 빈 모듈로 취급
      "server-only": path.resolve(import.meta.dirname, "tests/stubs/empty.ts"),
    },
  },
});
