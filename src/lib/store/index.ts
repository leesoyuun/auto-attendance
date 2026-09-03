import { MockStore } from "./mock";
import { GoogleSheetsStore, configFromEnv } from "./google";
import type { AttendanceStore } from "./types";

export * from "./types";
export { MockStore } from "./mock";
export { GoogleSheetsStore, configFromEnv } from "./google";

let cached: AttendanceStore | null = null;

/**
 * 환경변수가 갖춰져 있으면 구글 시트를, 없으면 목 저장소를 씁니다.
 *
 * 목 저장소는 프로세스 메모리에만 있어서 서버를 재시작하면 초기화됩니다.
 * 개발 중 화면을 확인하는 용도이고, 실제 데이터는 시트에 들어갑니다.
 */
export function getStore(): AttendanceStore {
  if (cached) return cached;
  const config = configFromEnv();
  cached = config ? new GoogleSheetsStore(config) : new MockStore();
  return cached;
}

export function isUsingMockStore(): boolean {
  return configFromEnv() === null;
}
