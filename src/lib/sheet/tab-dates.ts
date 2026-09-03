import { COL_FIRST_DAY } from "../sheet-layout";
import type { IsoDate, IsoMonth } from "../types";
import type { CellValue } from "./client";

/** 구글 시트 날짜 serial 의 기준일 (1899-12-30). */
const SHEET_EPOCH_UTC = Date.UTC(1899, 11, 30);

export function serialToIso(serial: number): IsoDate {
  const d = new Date(SHEET_EPOCH_UTC + serial * 86_400_000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate(),
  ).padStart(2, "0")}`;
}

/**
 * 월별 탭의 헤더 행에서 "날짜 → 컬럼 index" 표를 만듭니다.
 *
 * 배치를 계산하지 않고 **실제 헤더를 읽는** 이유가 있습니다. 기존 탭들은 손으로
 * 만들어져서 주 수와 시작일이 일정하지 않습니다 (2026-08 은 4주, 2026-07 은 5주).
 * 계산으로 위치를 추측하면 엉뚱한 사람의 셀에 쓰게 됩니다.
 *
 * 헤더 규칙:
 * - 그 달에 속한 날 → 일 숫자 (`27`)
 * - 다른 달에서 넘어온 날 → 날짜 serial (`46265` = 2026-08-31)
 * - `N주차 합산` 라벨과 빈칸은 날짜가 아닙니다
 *
 * 2026년 serial 은 46000 대라 1~31 과 겹치지 않습니다.
 */
export function parseTabDates(
  tabMonth: IsoMonth,
  header: CellValue[],
): Map<IsoDate, number> {
  const out = new Map<IsoDate, number>();
  for (let column = COL_FIRST_DAY; column < header.length; column++) {
    const raw = header[column];
    if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
    const iso =
      raw >= 1 && raw <= 31
        ? `${tabMonth}-${String(raw).padStart(2, "0")}`
        : serialToIso(raw);
    // 같은 날짜가 두 번 나오면 앞의 것을 씁니다. 손으로 만든 탭에서 드물게
    // 중복이 생길 수 있는데, 뒤의 것으로 덮으면 이미 입력된 값을 놓칩니다.
    if (!out.has(iso)) out.set(iso, column);
  }
  return out;
}

/**
 * 셀 값을 출석 상태로 해석합니다.
 *
 * 기존 시트는 점수를 셀에 직접 적습니다 (`10` 참여, `-5` 감점). `o` / `ㅇ` 로
 * 마크만 한 달도 있어서(2026-08) 그것도 참여로 봅니다.
 */
export function parseCell(value: CellValue): "참여" | "노쇼" | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    if (value > 0) return "참여";
    if (value < 0) return "노쇼";
    return null; // 0 은 기록 없음으로 봅니다
  }
  const text = String(value).trim();
  if (!text) return null;
  if (text === "o" || text === "O" || text === "ㅇ") return "참여";
  const asNumber = Number(text);
  if (Number.isFinite(asNumber)) {
    if (asNumber > 0) return "참여";
    if (asNumber < 0) return "노쇼";
    return null;
  }
  // `(5)` 처럼 괄호로 감싼 음수 표기도 쓰인 적이 있습니다.
  if (/^\(\d+(\.\d+)?\)$/.test(text)) return "노쇼";
  return null;
}
