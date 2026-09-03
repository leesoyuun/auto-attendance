import { describe, expect, it } from "vitest";

import {
  RULES,
  computePointLines,
  evaluateMember,
  eventWeeksFrom,
  monthlySummary,
  sumByMonth,
} from "./scoring";
import type { AttendanceRecord, EventKind, IsoDate, Member, SoloRun } from "./types";

const target: Member = {
  id: "M001",
  name: "주원",
  joinedOn: "2026-08-31",
};

/** 크루에 일정이 있었다는 사실만 만들어 주는 다른 멤버. */
const FILLER = "M999";

function attend(
  memberId: string,
  date: IsoDate,
  kind: EventKind = "일반",
): AttendanceRecord {
  return {
    memberId,
    date,
    kind,
    state: "참여",
    recordedAt: "2026-08-31 21:00",
  };
}

function noShow(
  memberId: string,
  date: IsoDate,
  kind: EventKind = "일반",
): AttendanceRecord {
  return {
    memberId,
    date,
    kind,
    state: "노쇼",
    recordedAt: "2026-08-31 21:00",
  };
}

function solo(date: IsoDate, minutes: number): SoloRun {
  return { memberId: target.id, date, minutes };
}

function points(records: AttendanceRecord[], soloRuns: SoloRun[] = []) {
  return sumByMonth(computePointLines(target, records, soloRuns));
}

describe("일정 참여 점수와 주간 상한", () => {
  it("참여 1회는 10점이다", () => {
    expect(points([attend(target.id, "2026-09-01")])["2026-09"]).toBe(10);
  });

  it("주간 상한 20점을 넘지 않는다", () => {
    // 같은 주(월 08-31 ~ 일 09-06) 안에서 3회 참여
    const sameWeek = [
      attend(target.id, "2026-09-01"),
      attend(target.id, "2026-09-02"),
      attend(target.id, "2026-09-03"),
    ];
    expect(points(sameWeek)["2026-09"]).toBe(RULES.weeklyAttendanceCap);
  });

  it("다른 주는 각각 상한이 적용된다", () => {
    const twoWeeks = [
      attend(target.id, "2026-09-01"),
      attend(target.id, "2026-09-02"),
      attend(target.id, "2026-09-03"),
      attend(target.id, "2026-09-08"),
      attend(target.id, "2026-09-09"),
      attend(target.id, "2026-09-10"),
    ];
    expect(points(twoWeeks)["2026-09"]).toBe(40);
  });

  it("월 경계를 넘는 주에서도 점수가 각 달에 나뉘어 귀속된다", () => {
    // 08-31(월) 과 09-01(화) 은 같은 주지만 다른 달입니다.
    const straddling = [
      attend(target.id, "2026-08-31"),
      attend(target.id, "2026-09-01"),
      attend(target.id, "2026-09-02"), // 상한 초과 → 0점
    ];
    const byMonth = points(straddling);
    expect(byMonth["2026-08"]).toBe(10);
    expect(byMonth["2026-09"]).toBe(10);
  });
});

describe("정기러닝 점수", () => {
  it("월 1회 참여는 30점이다", () => {
    expect(points([attend(target.id, "2026-09-14", "정기")])["2026-09"]).toBe(RULES.regularOnce);
  });

  it("월 2회 참여는 합계 40점이다 (30+30 이 아니다)", () => {
    const twice = [
      attend(target.id, "2026-09-14", "정기"),
      attend(target.id, "2026-09-27", "정기"),
    ];
    expect(points(twice)["2026-09"]).toBe(RULES.regularTwice);
  });

  it("주간 20점 상한에 걸리지 않는다", () => {
    // 상한을 걸면 월 최대 80점이라 100점 추첨 자격자가 영구히 0명이 됩니다.
    const regularAndGeneral = [
      attend(target.id, "2026-09-14", "정기"),
      attend(target.id, "2026-09-15"),
      attend(target.id, "2026-09-16"),
      attend(target.id, "2026-09-17"),
    ];
    expect(points(regularAndGeneral)["2026-09"]).toBe(RULES.regularOnce + 20);
  });
});

describe("혼뛰 후기", () => {
  it("1개 5점이다", () => {
    expect(points([], [solo("2026-09-01", 45)])["2026-09"]).toBe(RULES.soloPoints);
  });

  it("40분 미달은 인정되지 않는다", () => {
    expect(points([], [solo("2026-09-01", 39)])["2026-09"] ?? 0).toBe(0);
  });

  it("주간 10점 상한을 넘지 않는다", () => {
    const three = [solo("2026-09-01", 45), solo("2026-09-02", 50), solo("2026-09-03", 60)];
    expect(points([], three)["2026-09"]).toBe(RULES.weeklySoloCap);
  });
});

describe("노쇼 벌점", () => {
  it("1회 −10점이다", () => {
    expect(points([noShow(target.id, "2026-09-01")])["2026-09"]).toBe(RULES.noShowPenalty);
  });

  it("노쇼를 취소하면 기록이 없어져 벌점도 없다", () => {
    // 면책은 별도 플래그가 아니라 "찍었던 노쇼를 취소하는 것"입니다.
    // 취소하면 기록 자체가 사라지므로 점수 계산에 아무것도 남지 않습니다.
    expect(points([])["2026-09"] ?? 0).toBe(0);
  });

  it("정기러닝 노쇼도 동일하게 −10점이다", () => {
    expect(points([noShow(target.id, "2026-09-14", "정기")])["2026-09"]).toBe(
      RULES.noShowPenalty,
    );
  });

  it("상한은 얻은 점수에만 걸고 벌점은 그 뒤에 차감한다", () => {
    // 참여 3회(30점 → 상한 20점) + 노쇼 1회(−10) = 10점.
    // 벌점을 먼저 빼고 상한을 걸면 20점이 되어 규칙과 달라집니다.
    const mixed = [
      attend(target.id, "2026-09-01"),
      attend(target.id, "2026-09-02"),
      attend(target.id, "2026-09-03"),
      noShow(target.id, "2026-09-04"),
    ];
    expect(points(mixed)["2026-09"]).toBe(10);
  });

  it("월 점수가 음수까지 내려간다", () => {
    const bad = [noShow(target.id, "2026-09-01"), noShow(target.id, "2026-09-08")];
    expect(points(bad)["2026-09"]).toBe(-20);
  });
});

describe("경고 판정", () => {
  const evaluate = (records: AttendanceRecord[], asOf: IsoDate, member: Member = target) =>
    evaluateMember(member, records, [], asOf, eventWeeksFrom(records));

  it("참여가 없으면 경고를 받는다", () => {
    const records = [attend(FILLER, "2026-09-01")]; // 크루에 일정은 있었음
    const result = evaluate(records, "2026-09-06");
    expect(result.warnings.count).toBe(1);
  });

  it("주 1회 참여하면 경고가 없다", () => {
    const records = [attend(target.id, "2026-09-01")];
    expect(evaluate(records, "2026-09-06").warnings.count).toBe(0);
  });

  it("그 주에 일정이 아예 없으면 경고를 매기지 않는다", () => {
    // 참여할 일정이 없는데 미참여 경고를 주면 부당합니다.
    const records = [attend(FILLER, "2026-09-01")];
    const result = evaluate(records, "2026-09-13");
    const secondWeek = result.weeks.find((w) => w.weekStart === "2026-09-07");
    expect(secondWeek?.skipped).toBe("no-events");
    expect(result.warnings.count).toBe(1); // 첫 주 것만
  });

  it("노쇼는 경고 대상이다", () => {
    const records = [noShow(target.id, "2026-09-01")];
    expect(evaluate(records, "2026-09-06").warnings.count).toBe(1);
  });

  it("주 중간에 가입했으면 그 주는 판정하지 않는다", () => {
    // 남은 며칠로 "주 1회 참여"를 요구하는 셈이라 부당합니다.
    const midWeek: Member = { ...target, joinedOn: "2026-09-03" };
    const records = [attend(FILLER, "2026-09-01"), attend(FILLER, "2026-09-08")];
    const result = evaluate(records, "2026-09-13", midWeek);
    const joiningWeek = result.weeks.find((w) => w.weekStart === "2026-08-31");
    expect(joiningWeek?.skipped).toBe("before-join");
    // 다음 주(월요일 시작)부터는 판정합니다.
    expect(result.warnings.count).toBe(1);
  });

  it("경고 3회에 도달하면 퇴출 대상으로 표시된다", () => {
    const records = [
      attend(FILLER, "2026-08-31"),
      attend(FILLER, "2026-09-07"),
      attend(FILLER, "2026-09-14"),
    ];
    const result = evaluate(records, "2026-09-20");
    expect(result.warnings.count).toBe(RULES.warningLimit);
    expect(result.warnings.reachedLimitOn).toBe("2026-09-14");
    expect(result.expulsionCandidate).toBe(true);
  });

  it("첫 경고로부터 3개월이 지나면 경고가 초기화된다", () => {
    // 일정이 있는 주가 1월과 4월뿐이고 둘 다 불참.
    // 첫 경고 2026-01-05 → 초기화 2026-04-01 → 04-06 주는 초기화 후 다시 1회.
    const records = [attend(FILLER, "2026-01-05"), attend(FILLER, "2026-04-06")];
    const early: Member = { ...target, joinedOn: "2026-01-05" };
    const result = evaluate(records, "2026-04-12", early);
    expect(result.warnings.count).toBe(1);
    expect(result.reasons.some((r) => r.includes("경고 초기화"))).toBe(true);
  });

  it("2주 연속 불참이면 퇴출 대상으로 표시된다", () => {
    const records = [attend(FILLER, "2026-08-31"), attend(FILLER, "2026-09-07")];
    const result = evaluate(records, "2026-09-13");
    expect(result.absenceExpulsionOn).toBe("2026-09-07");
    expect(result.expulsionCandidate).toBe(true);
  });

  it("일정 없는 주가 끼면 연속 불참이 끊긴다", () => {
    // 없는 일정에 불참할 수는 없습니다. 퇴출로 이어지는 판정이라 느슨한 쪽입니다.
    const records = [attend(FILLER, "2026-08-31"), attend(FILLER, "2026-09-14")];
    const result = evaluate(records, "2026-09-20");
    expect(result.absenceExpulsionOn).toBe(null);
  });
});

describe("월별 집계", () => {
  it("100점 이상이면 추첨 자격이 생긴다", () => {
    const members = [target];
    const records = [
      attend(target.id, "2026-09-14", "정기"),
      attend(target.id, "2026-09-27", "정기"), // 40
      attend(target.id, "2026-09-01"),
      attend(target.id, "2026-09-02"), // 20
      attend(target.id, "2026-09-08"),
      attend(target.id, "2026-09-09"), // 20
      attend(target.id, "2026-09-15"),
      attend(target.id, "2026-09-16"), // 20
    ];
    const [row] = monthlySummary(members, records, [], "2026-09");
    expect(row.points).toBe(100);
    expect(row.raffleEligible).toBe(true);
  });

  it("점수가 높은 사람부터 정렬된다", () => {
    const other: Member = { id: "M002", name: "중현", joinedOn: "2026-08-31" };
    const records = [
      attend(target.id, "2026-09-01"),
      attend(other.id, "2026-09-01"),
      attend(other.id, "2026-09-08"),
    ];
    const rows = monthlySummary([target, other], records, [], "2026-09");
    expect(rows.map((r) => r.member.id)).toEqual(["M002", "M001"]);
  });
});
