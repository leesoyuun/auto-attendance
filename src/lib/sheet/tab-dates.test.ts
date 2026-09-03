import { describe, expect, it } from "vitest";

import { columnLetter } from "../sheet-layout";
import { parseCell, parseTabDates, serialToIso } from "./tab-dates";

describe("serial → 날짜", () => {
  it("실제 시트의 46265 는 2026-08-31 이다", () => {
    expect(serialToIso(46265)).toBe("2026-08-31");
  });
});

describe("헤더에서 날짜 → 컬럼 표 만들기", () => {
  // 실제 2026-09 탭 헤더
  const sepHeader = [
    "Rank", "Name", "최종 합산",
    46265, 1, 2, 3, 4, 5, 6, "1주차 합산",
    7, 8, 9, 10, 11, 12, 13, "2주차 합산",
    14, 15, 16, 17, 18, 19, 20, "3주차 합산",
    21, 22, 23, 24, 25, 26, 27, "4주차 합산",
  ];

  it("다른 달에서 넘어온 첫 날짜를 D열에 매핑한다", () => {
    const map = parseTabDates("2026-09", sepHeader);
    expect(columnLetter(map.get("2026-08-31")!)).toBe("D");
  });

  it("그 달 날짜를 일 숫자에서 복원한다", () => {
    const map = parseTabDates("2026-09", sepHeader);
    expect(columnLetter(map.get("2026-09-01")!)).toBe("E");
    expect(columnLetter(map.get("2026-09-06")!)).toBe("J");
  });

  it("주차 합산 열을 건너뛴다", () => {
    const map = parseTabDates("2026-09", sepHeader);
    // 9/6(일) → J, 9/7(월) → L. K는 1주차 합산이라 날짜가 아닙니다.
    expect(columnLetter(map.get("2026-09-07")!)).toBe("L");
    expect([...map.values()]).not.toContain(10); // K
  });

  it("날짜 개수가 주 수 x 7 과 맞는다", () => {
    const map = parseTabDates("2026-09", sepHeader);
    expect(map.size).toBe(28); // 4주
  });

  it("마지막 날짜가 9/27 이다", () => {
    const map = parseTabDates("2026-09", sepHeader);
    expect([...map.keys()].sort().at(-1)).toBe("2026-09-27");
  });

  it("라벨과 빈칸은 무시한다", () => {
    const map = parseTabDates("2026-10", ["Rank", "Name", "최종 합산", 1, "", null, "1주차 합산", 2]);
    expect([...map.keys()]).toEqual(["2026-10-01", "2026-10-02"]);
  });

  it("헤더가 비어 있으면 빈 표다", () => {
    expect(parseTabDates("2026-10", []).size).toBe(0);
  });
});

describe("셀 값 → 출석 상태", () => {
  it("양수는 참여다", () => {
    expect(parseCell(10)).toBe("참여");
    expect(parseCell(5)).toBe("참여");
    expect(parseCell("10")).toBe("참여");
  });

  it("음수는 노쇼다", () => {
    expect(parseCell(-10)).toBe("노쇼");
    expect(parseCell(-5)).toBe("노쇼");
    expect(parseCell("-5")).toBe("노쇼");
  });

  it("o / ㅇ 마크도 참여로 본다", () => {
    // 2026-08 탭은 점수 대신 마크만 찍혀 있습니다 (o 231개, ㅇ 55개).
    expect(parseCell("o")).toBe("참여");
    expect(parseCell("O")).toBe("참여");
    expect(parseCell("ㅇ")).toBe("참여");
  });

  it("괄호 표기 음수도 노쇼로 본다", () => {
    // 2026-06 탭에 (5) 형태가 있습니다.
    expect(parseCell("(5)")).toBe("노쇼");
  });

  it("빈칸과 0 은 기록 없음이다", () => {
    expect(parseCell("")).toBe(null);
    expect(parseCell(null)).toBe(null);
    expect(parseCell(0)).toBe(null);
    expect(parseCell("  ")).toBe(null);
  });

  it("해석할 수 없는 값은 기록 없음으로 둔다", () => {
    // 조용히 참여로 처리하면 점수가 잘못 붙습니다.
    expect(parseCell("미정")).toBe(null);
    expect(parseCell(true)).toBe(null);
  });
});
