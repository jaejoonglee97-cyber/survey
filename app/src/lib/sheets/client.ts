import "server-only";
import { SurveyStore } from "../store/survey-store";
import { createBackend, type Backend } from "./backend";

// 앱 코드는 이 파일로만 데이터에 접근함. 'server-only' 때문에 클라이언트 컴포넌트에서 가져오면 빌드가 실패함.

let cached: { backend: Backend; store: SurveyStore } | null = null;

export function getStore(): SurveyStore {
  if (!cached) {
    const backend = createBackend(process.env);
    cached = { backend, store: new SurveyStore(backend.gateway) };
  }
  return cached.store;
}

export function getBackendKind(): Backend["kind"] {
  getStore();
  return cached!.backend.kind;
}
