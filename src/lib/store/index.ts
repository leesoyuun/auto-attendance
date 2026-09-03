import { configFromEnv, missingEnv } from "../sheet/client";
import { CrewSheetStore } from "./sheet-store";
import type { AttendanceStore } from "./types";

export * from "./types";
export { CrewSheetStore } from "./sheet-store";
export { missingEnv } from "../sheet/client";

let cached: AttendanceStore | null = null;

/**
 * 실제 크루 시트 저장소.
 *
 * 목 저장소는 두지 않습니다. 환경변수가 빠졌을 때 가짜 명단을 보여주면 배포가
 * 정상인 줄 알고 넘어가게 됩니다 — 실제로 배포판이 없는 사람 이름을 띄우는 걸
 * 크루 시트가 잘못된 것으로 오해하고 한참 찾은 적이 있습니다. 이제 바로 실패합니다.
 *
 * 화면은 부르기 전에 `missingEnv()` 로 걸러서 안내를 띄웁니다. API 라우트는
 * 이 예외를 잡아 메시지를 그대로 응답에 담습니다.
 */
export function getStore(): AttendanceStore {
  if (cached) return cached;
  const config = configFromEnv();
  if (!config) {
    throw new Error(
      `구글 시트 환경변수가 없습니다: ${missingEnv().join(", ")}. ` +
        `Vercel 은 배포 시점에 환경변수를 주입하므로, 값을 넣었으면 재배포해야 반영됩니다.`,
    );
  }
  cached = new CrewSheetStore(config);
  return cached;
}
