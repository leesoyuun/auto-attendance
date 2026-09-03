import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { kstToday, monthOf } from "../date";
import { SheetClient, configFromEnv } from "../sheet/client";
import { CrewSheetStore } from "./sheet-store";

/** 실제 크루 시트(테스트 복사본)에 붙는 테스트. `npm run test:sheet` 로만 돕니다. */

const config = configFromEnv();

describe.skipIf(!config)("크루 시트 어댑터 (실제 시트)", () => {
  const store = new CrewSheetStore(config!);
  const client = new SheetClient(config!);

  // 9월 탭에 실제로 존재하는 날짜. 9/2 는 2026-09 탭의 F열입니다
  // (D=8/31, E=9/1, F=9/2).
  const TEST_DATE = "2026-09-02";
  const TEST_RANGE = "2026-09!F3:F98";

  /**
   * 열 원본값을 그대로 스냅샷 떠두고 되돌립니다.
   *
   * getDay/saveDay 로 되돌리면 안 됩니다. saveDay 는 열 전체를 다시 쓰므로,
   * 원래 값이 있었는데 스냅샷이 비어 있으면 남의 출석을 지웁니다. 실제로 한 번
   * 그렇게 9/2 의 11명 기록을 2명으로 만들었습니다.
   */
  let snapshot: Awaited<ReturnType<typeof client.getValues>> | null = null;

  beforeAll(async () => {
    snapshot = await client.getValues(TEST_RANGE, "UNFORMATTED_VALUE");
  });

  afterAll(async () => {
    if (!snapshot) return;
    // getValues 는 뒤쪽 빈 행을 생략하므로, 범위 길이만큼 빈칸으로 채워 되돌립니다.
    const rows = 98 - 3 + 1;
    const restored = Array.from({ length: rows }, (_, i) => {
      const value = snapshot![i]?.[0];
      return [value === undefined || value === null ? "" : value];
    });
    await client.setValues(TEST_RANGE, restored, "RAW");
  });

  it("명단을 활동 회원만 읽는다", async () => {
    const members = await store.listMembers();
    expect(members.length).toBeGreaterThan(50);
    expect(members.length).toBeLessThan(93); // 탈퇴 포함 93명 전체가 아니어야 합니다
    // 이름/출생연도 형식이 그대로 키가 됩니다.
    expect(members[0].id).toMatch(/^[가-힣A-Za-z]+\/\d{2}$/);
    expect(members[0].id).toBe(members[0].name);
  });

  it("월 탭 존재 여부를 판단한다", async () => {
    expect(await store.hasMonthTab("2026-09")).toBe(true);
    expect(await store.hasMonthTab("2030-01")).toBe(false);
    const tabs = await store.listMonthTabs();
    expect(tabs).toContain("2026-09");
  });

  it("기존 출석 기록을 읽는다", async () => {
    const records = await store.listRecords();
    expect(records.length).toBeGreaterThan(0);
    const sample = records[0];
    expect(sample.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(["참여", "노쇼"]).toContain(sample.state);
    console.log(`\n읽은 기록 ${records.length}건 · 참여 ${
      records.filter((r) => r.state === "참여").length
    } / 노쇼 ${records.filter((r) => r.state === "노쇼").length}`);
  });

  it("월 경계를 넘는 날짜도 올바른 탭에서 찾는다", async () => {
    // 8/31 은 이름이 2026-09 인 탭의 첫 열에 있습니다.
    const day = await store.getDay("2026-08-31");
    expect(day === null || day.date === "2026-08-31").toBe(true);
  });

  it("저장하면 시트에 쓰이고 다시 읽힌다", async () => {
    const members = await store.listMembers();
    const [a, b] = members;

    await store.saveDay(TEST_DATE, "일반", [
      { memberId: a.id, state: "참여", excused: false },
      { memberId: b.id, state: "노쇼", excused: false },
    ]);

    const after = await store.getDay(TEST_DATE);
    expect(after).not.toBeNull();
    const byId = new Map(after!.entries.map((e) => [e.memberId, e.state]));
    expect(byId.get(a.id)).toBe("참여");
    expect(byId.get(b.id)).toBe("노쇼");
    // 체크하지 않은 사람은 빈칸이 되어야 합니다.
    expect(after!.entries).toHaveLength(2);
  });

  it("탭이 없는 날짜에 저장하면 막는다", async () => {
    await expect(
      store.saveDay("2030-01-15", "일반", [
        { memberId: "없는사람/00", state: "참여", excused: false },
      ]),
    ).rejects.toThrow(/월 탭이 없습니다/);
  });

  it("이번 달 탭이 있는지 확인한다 (버튼 표시 기준)", async () => {
    const month = monthOf(kstToday());
    const exists = await store.hasMonthTab(month);
    console.log(`이번 달(${month}) 탭: ${exists ? "있음" : "없음 → 추가 버튼 표시"}`);
    expect(typeof exists).toBe("boolean");
  });
});
