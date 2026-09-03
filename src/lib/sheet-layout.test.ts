import { describe, expect, it } from "vitest";

import {
  COL_FIRST_DAY,
  attendanceCountFormula,
  columnForDate,
  columnLetter,
  headerRow,
  monthLayout,
  rowFormulas,
  weekBlock,
} from "./sheet-layout";

describe("컬럼 문자 변환", () => {
  it("A부터 AQ까지 맞게 변환한다", () => {
    expect(columnLetter(0)).toBe("A");
    expect(columnLetter(3)).toBe("D");
    expect(columnLetter(10)).toBe("K");
    expect(columnLetter(18)).toBe("S");
    expect(columnLetter(25)).toBe("Z");
    expect(columnLetter(26)).toBe("AA");
    expect(columnLetter(34)).toBe("AI");
    expect(columnLetter(42)).toBe("AQ");
  });
});

describe("주차 블록 배치", () => {
  it("실제 시트의 K·S·AA·AI 위치와 일치한다", () => {
    // 기존 시트의 최종 합산이 =SUM(K3+S3+AA3+AI3) 이므로 이 위치가 맞아야 합니다.
    expect(columnLetter(weekBlock(1).subtotal)).toBe("K");
    expect(columnLetter(weekBlock(2).subtotal)).toBe("S");
    expect(columnLetter(weekBlock(3).subtotal)).toBe("AA");
    expect(columnLetter(weekBlock(4).subtotal)).toBe("AI");
    expect(columnLetter(weekBlock(5).subtotal)).toBe("AQ");
  });

  it("1주차 날짜는 D~J 이다", () => {
    const b = weekBlock(1);
    expect(b.dayStart).toBe(COL_FIRST_DAY);
    expect(columnLetter(b.dayStart)).toBe("D");
    expect(columnLetter(b.dayEnd)).toBe("J");
  });

  it("주차마다 8칸씩 밀린다", () => {
    expect(weekBlock(2).dayStart - weekBlock(1).dayStart).toBe(8);
    expect(columnLetter(weekBlock(2).dayStart)).toBe("L");
    expect(columnLetter(weekBlock(3).dayStart)).toBe("T");
    expect(columnLetter(weekBlock(4).dayStart)).toBe("AB");
  });

  it("0주차 이하는 거부한다", () => {
    expect(() => weekBlock(0)).toThrow();
  });
});

describe("월 배치 계산", () => {
  it("직전 탭 다음 날부터 시작해 빈틈이 없다", () => {
    // 실제 시트의 2026-09 탭은 9/27 로 끝납니다 → 10월은 9/28 부터.
    const oct = monthLayout("2026-10", "2026-09-27");
    expect(oct.startDate).toBe("2026-09-28");
    expect(oct.endDate).toBe("2026-11-01"); // 10/31 이 속한 주의 일요일
    expect(oct.weeks).toBe(5);
    expect(oct.dates).toHaveLength(35);
  });

  it("직전 탭이 없으면 1일이 속한 주의 월요일부터 시작한다", () => {
    // 2026-06-01 은 월요일이라 그대로 시작합니다.
    const jun = monthLayout("2026-06", null);
    expect(jun.startDate).toBe("2026-06-01");
    expect(jun.weeks).toBe(5); // 6/30 이 속한 주의 일요일(7/5)까지
    expect(jun.endDate).toBe("2026-07-05");
  });

  it("실제 시트의 2026-07 배치를 재현한다", () => {
    // 기존 2026-07 탭은 6/29 ~ 8/2, 5주(날짜 열 35개 + 합산 5개 = 40개)였습니다.
    const jul = monthLayout("2026-07", "2026-06-28");
    expect(jul.startDate).toBe("2026-06-29");
    expect(jul.endDate).toBe("2026-08-02");
    expect(jul.weeks).toBe(5);
    expect(columnLetter(jul.lastColumn)).toBe("AQ");
  });

  it("항상 월요일에 시작하고 일요일에 끝난다", () => {
    for (const [month, prev] of [
      ["2026-10", "2026-09-27"],
      ["2026-11", "2026-11-01"],
      ["2027-01", "2026-12-27"],
      ["2027-02", "2027-01-31"],
    ] as const) {
      const l = monthLayout(month, prev);
      expect(l.dates).toHaveLength(l.weeks * 7);
      expect(l.dates[0]).toBe(l.startDate);
      expect(l.dates[l.dates.length - 1]).toBe(l.endDate);
    }
  });

  it("직전 탭이 일요일로 끝나지 않으면 거부한다", () => {
    // 조용히 어긋난 배치를 만드는 것보다 멈추는 편이 낫습니다.
    expect(() => monthLayout("2026-10", "2026-09-26")).toThrow(/월요일/);
  });

  it("월 형식이 틀리면 거부한다", () => {
    expect(() => monthLayout("2026-9", null)).toThrow();
    expect(() => monthLayout("202610", null)).toThrow();
  });

  it("연속으로 만들어도 날짜가 겹치거나 빠지지 않는다", () => {
    let prev: string | null = "2026-09-27";
    const seen = new Set<string>();
    for (const month of ["2026-10", "2026-11", "2026-12", "2027-01", "2027-02"]) {
      const l = monthLayout(month, prev);
      for (const d of l.dates) {
        expect(seen.has(d)).toBe(false); // 중복 없음
        seen.add(d);
      }
      prev = l.endDate;
    }
    // 9/28 부터 마지막까지 하루도 빠지지 않았는지 확인
    const sorted = [...seen].sort();
    expect(sorted[0]).toBe("2026-09-28");
    for (let i = 1; i < sorted.length; i++) {
      const gap =
        (new Date(sorted[i] + "T12:00:00Z").getTime() -
          new Date(sorted[i - 1] + "T12:00:00Z").getTime()) /
        86_400_000;
      expect(gap).toBe(1);
    }
  });
});

describe("날짜 → 컬럼 매핑", () => {
  const oct = monthLayout("2026-10", "2026-09-27");

  it("첫 날짜는 D 열이다", () => {
    expect(columnLetter(columnForDate(oct, "2026-09-28")!)).toBe("D");
  });

  it("주차 합산 열을 건너뛰고 다음 주 첫날은 L 열이다", () => {
    expect(columnLetter(columnForDate(oct, "2026-10-04")!)).toBe("J"); // 1주차 마지막(일)
    expect(columnLetter(columnForDate(oct, "2026-10-05")!)).toBe("L"); // 2주차 첫날(월)
  });

  it("범위 밖 날짜는 null 이다", () => {
    expect(columnForDate(oct, "2026-09-27")).toBe(null);
    expect(columnForDate(oct, "2026-11-02")).toBe(null);
  });
});

describe("헤더 행", () => {
  const oct = monthLayout("2026-10", "2026-09-27");
  const row = headerRow(oct);

  it("앞 세 칸은 Rank·Name·최종 합산이다", () => {
    expect(row.slice(0, 3)).toEqual(["Rank", "Name", "최종 합산"]);
  });

  it("다른 달에서 넘어온 날은 전체 날짜로 표시한다", () => {
    // 9/28~9/30 은 10월 탭이지만 9월 날짜라 어느 달인지 보여야 합니다.
    expect(row[3]).toBe("2026-09-28");
    expect(row[5]).toBe("2026-09-30");
  });

  it("그 달 날짜는 일 숫자만 넣는다", () => {
    expect(row[6]).toBe(1); // 10/1
    expect(row[7]).toBe(2);
  });

  it("주차 합산 라벨이 8칸마다 들어간다", () => {
    expect(row[10]).toBe("1주차 합산");
    expect(row[18]).toBe("2주차 합산");
    expect(row[42]).toBe("5주차 합산");
  });

  it("전체 길이가 마지막 컬럼과 맞는다", () => {
    expect(row).toHaveLength(oct.lastColumn + 1);
  });
});

describe("수식 생성", () => {
  const oct = monthLayout("2026-10", "2026-09-27");
  const f = rowFormulas(oct, 3, 20, 98);

  it("최종 합산이 주차 합산 열을 모두 더한다", () => {
    expect(f.total).toBe("=SUM(K3+S3+AA3+AI3+AQ3)");
  });

  it("4주 달이면 기존 시트와 똑같은 수식이 나온다", () => {
    // 기존 2026-09 탭의 =SUM(K3+S3+AA3+AI3) 과 일치해야 합니다.
    const fourWeeks = monthLayout("2026-08", "2026-08-02");
    expect(fourWeeks.weeks).toBe(5);
    // 4주 케이스는 블록을 직접 구성해 확인합니다.
    const four = { ...fourWeeks, blocks: fourWeeks.blocks.slice(0, 4) };
    expect(rowFormulas(four, 3, 20, 98).total).toBe("=SUM(K3+S3+AA3+AI3)");
  });

  it("주차 합산에 주간 상한이 들어간다", () => {
    expect(f.subtotals[0]).toEqual({ column: 10, formula: "=MIN(SUM(D3:J3),20)" });
    expect(f.subtotals[1].formula).toBe("=MIN(SUM(L3:R3),20)");
  });

  it("Rank 수식이 기존 시트 형태와 같다", () => {
    expect(f.rank).toBe("=RANK.EQ(C3,$C$3:$C$98,0)");
  });

  it("참석자 수는 회원 행 범위를 센다", () => {
    expect(attendanceCountFormula(3, 98)).toBe("=COUNT(D3:D98)");
  });
});
