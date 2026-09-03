import { describe, expect, it } from "vitest";

import {
  addMonths,
  dayOfWeek,
  kstStamp,
  kstToday,
  monthOf,
  shiftDays,
  weekStartOf,
  weeksBetween,
} from "./date";

describe("한국 시간 기준 날짜", () => {
  it("서버 타임존과 무관하게 KST 날짜를 반환한다", () => {
    // 00:00 UTC 는 KST 로는 이미 같은 날 09:00 이지만, 미국 서부는 아직 전날입니다.
    expect(kstToday(new Date("2026-09-03T00:00:00Z"))).toBe("2026-09-03");
    // 15:00 UTC 는 KST 로 다음 날 00:00 입니다.
    expect(kstToday(new Date("2026-09-03T15:00:00Z"))).toBe("2026-09-04");
    expect(kstToday(new Date("2026-09-03T14:59:00Z"))).toBe("2026-09-03");
  });

  it("자정 직후에도 날짜가 밀리지 않는다", () => {
    expect(kstStamp(new Date("2026-09-03T15:00:00Z"))).toBe("2026-09-04 00:00");
    expect(kstStamp(new Date("2026-09-03T11:04:00Z"))).toBe("2026-09-03 20:04");
  });
});

describe("주 경계 (월요일 시작)", () => {
  it("주 안의 어느 날을 넣어도 같은 월요일을 반환한다", () => {
    // 2026-09-03 은 목요일, 그 주 월요일은 08-31
    expect(weekStartOf("2026-09-03")).toBe("2026-08-31");
    expect(weekStartOf("2026-08-31")).toBe("2026-08-31");
    // 일요일은 그 주의 마지막 날이므로 여전히 08-31 주
    expect(weekStartOf("2026-09-06")).toBe("2026-08-31");
    // 월요일이 되면 다음 주
    expect(weekStartOf("2026-09-07")).toBe("2026-09-07");
  });

  it("월 경계를 넘는 주를 하나의 주로 다룬다", () => {
    expect(weekStartOf("2026-08-31")).toBe(weekStartOf("2026-09-01"));
    expect(monthOf("2026-08-31")).not.toBe(monthOf("2026-09-01"));
  });

  it("기간 사이의 주를 빠짐없이 나열한다", () => {
    const weeks = weeksBetween("2026-09-01", "2026-09-21");
    expect(weeks).toEqual(["2026-08-31", "2026-09-07", "2026-09-14", "2026-09-21"]);
  });

  it("시작이 끝보다 늦으면 빈 배열이다", () => {
    expect(weeksBetween("2026-09-21", "2026-09-01")).toEqual([]);
  });
});

describe("날짜 계산", () => {
  it("요일을 맞게 계산한다", () => {
    expect(dayOfWeek("2026-08-31")).toBe("월");
    expect(dayOfWeek("2026-09-06")).toBe("일");
  });

  it("월말에서 일수를 더해도 넘어간다", () => {
    expect(shiftDays("2026-08-31", 1)).toBe("2026-09-01");
    expect(shiftDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("개월 계산은 그 달 1일 기준이라 말일에서도 넘치지 않는다", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-01");
    expect(addMonths("2026-09-15", 3)).toBe("2026-12-01");
    expect(addMonths("2026-01-15", -2)).toBe("2025-11-01");
  });
});
