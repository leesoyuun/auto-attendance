import { configFromEnv } from "../sheet/client";
import { MockStore } from "./mock";
import { CrewSheetStore } from "./sheet-store";
import type { AttendanceStore } from "./types";

export * from "./types";
export { MockStore } from "./mock";
export { CrewSheetStore } from "./sheet-store";

let cached: AttendanceStore | null = null;

/**
 * 환경변수가 갖춰져 있으면 실제 크루 시트를, 없으면 목 저장소를 씁니다.
 *
 * 목 저장소는 프로세스 메모리에만 있어서 서버를 재시작하면 초기화됩니다.
 * 자격 증명 없이 화면을 확인하는 용도입니다.
 */
export function getStore(): AttendanceStore {
  if (cached) return cached;
  const config = configFromEnv();
  cached = config ? new CrewSheetStore(config) : new MockStore();
  return cached;
}

export function isUsingMockStore(): boolean {
  return configFromEnv() === null;
}
