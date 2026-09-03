import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { columnLetter } from "../sheet-layout";
import { SheetClient, configFromEnv } from "./client";
import { ACTIVE_STATUS, ensureMonthTab, lastDateOfTab, readRoster } from "./month-tab";

/**
 * 실제 구글 시트에 붙는 테스트입니다. `npm run test:sheet` 로만 돕니다.
 *
 * 탭을 실제로 만들고, 확인한 뒤 지웁니다. 테스트 복사본에서만 돌리세요.
 */

const config = configFromEnv();
const TARGET_MONTH = "2026-10";

describe.skipIf(!config)("월 탭 자동 생성 (실제 시트)", () => {
  const client = new SheetClient(config!);
  let createdSheetId: number | null = null;

  beforeAll(async () => {
    // 이전 실행이 남긴 탭이 있으면 먼저 치웁니다.
    const tabs = await client.listTabs();
    const stale = tabs.find((t) => t.title === TARGET_MONTH);
    if (stale) {
      await client.batchUpdate([{ deleteSheet: { sheetId: stale.sheetId } }]);
    }
  });

  afterAll(async () => {
    if (createdSheetId !== null) {
      await client.batchUpdate([{ deleteSheet: { sheetId: createdSheetId } }]);
    }
  });

  it("문서에 접근할 수 있다", async () => {
    const tabs = await client.listTabs();
    expect(tabs.map((t) => t.title)).toContain("현황&회비");
    expect(tabs.filter((t) => /^\d{4}-\d{2}$/.test(t.title)).length).toBeGreaterThan(0);
  });

  it("10월 탭을 만든다", async () => {
    const result = await ensureMonthTab(client, TARGET_MONTH);
    expect(result.created).toBe(true);
    expect(result.layout?.startDate).toBe("2026-09-28"); // 9월 탭이 9/27 로 끝나므로
    expect(result.layout?.endDate).toBe("2026-11-01");
    expect(result.layout?.weeks).toBe(5);
    expect(result.memberCount).toBeGreaterThan(50);

    const tabs = await client.listTabs();
    const created = tabs.find((t) => t.title === TARGET_MONTH);
    expect(created).toBeDefined();
    createdSheetId = created!.sheetId;

    // 열이 5주치(AQ = index 42)까지 확보돼야 합니다.
    expect(created!.columnCount).toBeGreaterThanOrEqual(43);
  });

  it("헤더가 9/28 부터 11/1 까지 빈틈없이 들어간다", async () => {
    const header = (
      await client.getValues(`${TARGET_MONTH}!A2:BZ2`, "UNFORMATTED_VALUE")
    )[0];
    expect(header.slice(0, 3)).toEqual(["Rank", "Name", "최종 합산"]);
    // 말일이 속한 주의 일요일까지 덮으므로 마지막 날짜는 11/1 입니다.
    // 이 값이 11월 탭의 시작일(11/2)을 정해서 날짜가 빈틈없이 이어집니다.
    expect(lastDateOfTab(TARGET_MONTH, header)).toBe("2026-11-01");

    // 주차 합산 라벨이 5개
    const labels = header.filter((c) => typeof c === "string" && c.includes("주차 합산"));
    expect(labels).toEqual([
      "1주차 합산",
      "2주차 합산",
      "3주차 합산",
      "4주차 합산",
      "5주차 합산",
    ]);
  });

  it("수식이 기존 시트와 같은 형태로 들어간다", async () => {
    const rows = await client.getValues(`${TARGET_MONTH}!A3:AQ4`, "FORMULA");
    const [first] = rows;
    expect(first[0]).toBe("=RANK.EQ(C3,$C$3:$C$98,0)");
    expect(first[2]).toBe("=SUM(K3+S3+AA3+AI3+AQ3)");
    expect(first[10]).toBe("=MIN(SUM(D3:J3),20)"); // K열 1주차 합산
    expect(first[18]).toBe("=MIN(SUM(L3:R3),20)"); // S열 2주차 합산

    const countRow = (await client.getValues(`${TARGET_MONTH}!D1:F1`, "FORMULA"))[0];
    expect(countRow[0]).toBe("=COUNT(D3:D98)");
  });

  it("활동 회원만 현황&회비 순서대로 채워진다", async () => {
    // 명단 탭에는 탈퇴한 사람 행도 회비 이력 때문에 남아 있습니다.
    // 새 탭에 그들까지 넣으면 나간 사람이 랭킹에 들어갑니다.
    const roster = await readRoster(client, "현황&회비");
    const active = roster.filter((e) => e.status === ACTIVE_STATUS).map((e) => e.name);
    const withdrawn = roster.filter((e) => e.status !== ACTIVE_STATUS);
    expect(withdrawn.length).toBeGreaterThan(0); // 걸러낼 대상이 실제로 있어야 의미 있는 검사

    const tabNames = (await client.getValues(`${TARGET_MONTH}!B3:B200`))
      .map((r) => String(r[0] ?? "").trim())
      .filter(Boolean);
    expect(tabNames).toEqual(active);
    for (const gone of withdrawn) {
      expect(tabNames).not.toContain(gone.name);
    }
  });

  it("날짜 셀은 비어 있고 합산은 0 이다", async () => {
    const rows = await client.getValues(`${TARGET_MONTH}!C3:J3`, "UNFORMATTED_VALUE");
    const [row] = rows;
    expect(row[0]).toBe(0); // 최종 합산 — 아직 출석이 없으므로
    // D~J(날짜 7칸)는 값이 없어야 합니다.
    expect(row.slice(1).filter((c) => c !== "" && c !== null && c !== undefined)).toEqual([]);
  });

  it("이미 있으면 다시 만들지 않는다", async () => {
    const again = await ensureMonthTab(client, TARGET_MONTH);
    expect(again.created).toBe(false);
    expect(again.reason).toBe("이미 있습니다");
  });

  it("날짜 셀에 점수를 쓰면 시트 수식이 합산한다", async () => {
    // 앱은 점수를 계산하지 않습니다. 셀에 10 을 쓰면 주간 상한과 합산이
    // 시트 수식으로 처리되는지 확인합니다.
    const col = columnLetter(3); // D열 = 9/28
    await client.setValues(`${TARGET_MONTH}!${col}3`, [[10]]);
    const after = (await client.getValues(`${TARGET_MONTH}!C3:K3`, "UNFORMATTED_VALUE"))[0];
    expect(after[0]).toBe(10); // 최종 합산
    expect(after[8]).toBe(10); // K열 1주차 합산
    await client.setValues(`${TARGET_MONTH}!${col}3`, [[""]]);
  });
});
