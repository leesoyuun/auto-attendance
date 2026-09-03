import { afterAll, describe, expect, it } from "vitest";

import { configFromEnv, SheetClient } from "./client";
import {
  REGULAR_TAB,
  SOLO_TAB,
  addSoloRun,
  deleteSoloRun,
  readRegularDates,
  readSoloRuns,
  setRegularDate,
} from "./aux-tabs";

/** 실제 시트(복사본)에 붙습니다. `npm run test:sheet` 로만 돕니다. */

const config = configFromEnv();

describe.skipIf(!config)("보조 탭 (실제 시트)", () => {
  const client = new SheetClient(config!);
  const TEST_DATE = "2026-10-12";
  const TEST_RUN = { memberId: "가형/94", date: "2026-10-13", minutes: 47 };

  afterAll(async () => {
    // 테스트가 넣은 것만 정리합니다.
    await setRegularDate(client, TEST_DATE, false);
    await deleteSoloRun(client, TEST_RUN);
  });

  it("정기러닝일 탭이 없으면 만들고 날짜를 넣는다", async () => {
    await setRegularDate(client, TEST_DATE, true);
    const tabs = await client.listTabs();
    expect(tabs.map((t) => t.title)).toContain(REGULAR_TAB);
    expect(await readRegularDates(client)).toContain(TEST_DATE);
  });

  it("같은 날짜를 두 번 넣어도 중복되지 않는다", async () => {
    await setRegularDate(client, TEST_DATE, true);
    const dates = await readRegularDates(client);
    expect(dates.filter((d) => d === TEST_DATE)).toHaveLength(1);
  });

  it("끄면 목록에서 빠진다", async () => {
    await setRegularDate(client, TEST_DATE, false);
    expect(await readRegularDates(client)).not.toContain(TEST_DATE);
    await setRegularDate(client, TEST_DATE, true); // 다음 테스트를 위해 되돌림
  });

  it("혼뛰후기 탭이 없으면 만들고 기록을 넣는다", async () => {
    await addSoloRun(client, TEST_RUN);
    const tabs = await client.listTabs();
    expect(tabs.map((t) => t.title)).toContain(SOLO_TAB);

    const runs = await readSoloRuns(client);
    const mine = runs.filter(
      (r) => r.memberId === TEST_RUN.memberId && r.date === TEST_RUN.date,
    );
    expect(mine).toHaveLength(1);
    expect(mine[0].minutes).toBe(47);
  });

  it("혼뛰 기록을 지울 수 있다", async () => {
    const before = (await readSoloRuns(client)).length;
    expect(await deleteSoloRun(client, TEST_RUN)).toBe(true);
    const after = await readSoloRuns(client);
    expect(after).toHaveLength(before - 1);
    expect(
      after.filter((r) => r.memberId === TEST_RUN.memberId && r.date === TEST_RUN.date),
    ).toHaveLength(0);
  });

  it("없는 기록을 지우면 false 를 준다", async () => {
    expect(
      await deleteSoloRun(client, { memberId: "없는사람/00", date: "2026-10-01", minutes: 1 }),
    ).toBe(false);
  });
});
