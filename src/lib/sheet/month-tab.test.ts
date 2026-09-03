import { describe, expect, it } from "vitest";

import { lastDateOfTab } from "./month-tab";

describe("탭 헤더에서 마지막 날짜 읽기", () => {
  it("그 달 날짜는 일 숫자로 적혀 있다", () => {
    // 실제 2026-09 탭의 헤더 앞부분. 8/31 은 serial(46265), 나머지는 일 숫자.
    const header = ["Rank", "Name", "최종 합산", 46265, 1, 2, 3, 4, 5, 6, "1주차 합산", 7];
    expect(lastDateOfTab("2026-09", header)).toBe("2026-09-07");
  });

  it("다른 달에서 넘어온 serial 날짜도 읽는다", () => {
    // 46265 = 2026-08-31. 그 달 날짜가 하나도 없으면 이것이 마지막입니다.
    expect(lastDateOfTab("2026-09", ["Rank", "Name", "최종 합산", 46265])).toBe("2026-08-31");
  });

  it("2026-09 탭 전체 헤더에서 9/27 을 찾아낸다", () => {
    // 실제 시트의 2026-09 헤더를 그대로 적었습니다. 46265 = 8/31.
    // 이 값이 10월 탭의 시작일(9/28)을 정하므로, 틀리면 날짜가 겹치거나 빠집니다.
    const header = [
      "Rank", "Name", "최종 합산",
      46265, 1, 2, 3, 4, 5, 6, "1주차 합산",
      7, 8, 9, 10, 11, 12, 13, "2주차 합산",
      14, 15, 16, 17, 18, 19, 20, "3주차 합산",
      21, 22, 23, 24, 25, 26, 27, "4주차 합산",
    ];
    expect(header).toHaveLength(35);
    expect(lastDateOfTab("2026-09", header)).toBe("2026-09-27");
  });

  it("주차 합산 라벨과 빈칸은 무시한다", () => {
    const header = ["Rank", "Name", "최종 합산", 1, "", null, "1주차 합산", 2];
    expect(lastDateOfTab("2026-10", header)).toBe("2026-10-02");
  });

  it("날짜 열이 없으면 null 이다", () => {
    expect(lastDateOfTab("2026-09", ["Rank", "Name", "최종 합산"])).toBe(null);
  });

  it("serial 은 31 을 넘어서 일 숫자와 헷갈리지 않는다", () => {
    // 2026년 serial 은 46000 대라 1~31 과 겹치지 않습니다.
    const iso = lastDateOfTab("2026-01", ["", "", "", 46023]);
    expect(iso).toBe("2026-01-01");
  });
});
