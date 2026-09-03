import { kstStamp } from "../date";
import type { IsoDate, SoloRun } from "../types";
import type { SheetClient } from "./client";

/**
 * 앱이 소유하는 보조 탭.
 *
 * 정기러닝 여부와 혼뛰 후기를 월별 탭에 담을 수 없습니다. 월별 탭 셀에는 점수
 * 하나만 들어가고, 열을 추가하면 `=SUM(K3+S3+AA3+AI3)` 같은 고정 참조 수식이
 * 깨집니다. 그래서 별도 탭에 둡니다.
 *
 * 두 탭 모두 없으면 자동으로 만듭니다. 기존 탭은 건드리지 않습니다.
 */

export const REGULAR_TAB = "정기러닝일";
export const SOLO_TAB = "혼뛰후기";

const REGULAR_HEADER = ["날짜"];
const SOLO_HEADER = ["이름", "날짜", "시간(분)", "기록시각"];

async function hasTab(client: SheetClient, title: string): Promise<boolean> {
  return (await client.listTabs()).some((t) => t.title === title);
}

async function ensureTab(
  client: SheetClient,
  title: string,
  header: readonly string[],
): Promise<void> {
  if (await hasTab(client, title)) return;
  await client.batchUpdate([{ addSheet: { properties: { title } } }]);
  await client.setValues(`${title}!A1`, [[...header]]);
}

/** 정기러닝으로 지정된 날짜 목록. */
export async function readRegularDates(client: SheetClient): Promise<IsoDate[]> {
  if (!(await hasTab(client, REGULAR_TAB))) return [];

  const rows = await client.getValues(`${REGULAR_TAB}!A2:A400`);
  const seen = new Set<IsoDate>();
  for (const row of rows) {
    const value = String(row[0] ?? "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) seen.add(value);
  }
  return [...seen].sort();
}

/**
 * 그 날짜의 정기러닝 지정을 켜거나 끕니다.
 *
 * 목록을 전부 다시 씁니다. 날짜 수가 많지 않고(월 2회), 부분 수정보다 단순합니다.
 */
export async function setRegularDate(
  client: SheetClient,
  date: IsoDate,
  isRegular: boolean,
): Promise<void> {
  const current = await readRegularDates(client);
  const has = current.includes(date);
  if (isRegular === has) return;

  await ensureTab(client, REGULAR_TAB, REGULAR_HEADER);

  const next = isRegular ? [...current, date].sort() : current.filter((d) => d !== date);

  await client.clearRange(`${REGULAR_TAB}!A2:A400`);
  if (next.length > 0) {
    await client.setValues(
      `${REGULAR_TAB}!A2:A${next.length + 1}`,
      next.map((d) => [d]),
      "RAW",
    );
  }
}

/** 혼뛰 후기 목록. 40분 미달도 기록은 남기고, 점수 계산에서만 빠집니다. */
export async function readSoloRuns(client: SheetClient): Promise<SoloRun[]> {
  if (!(await hasTab(client, SOLO_TAB))) return [];

  const rows = await client.getValues(`${SOLO_TAB}!A2:C1000`, "UNFORMATTED_VALUE");
  const out: SoloRun[] = [];
  for (const row of rows) {
    const memberId = String(row[0] ?? "").trim();
    const date = String(row[1] ?? "").trim();
    const minutes = Number(row[2] ?? 0);
    if (!memberId || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(minutes)) continue;
    out.push({ memberId, date, minutes });
  }
  return out;
}

export async function addSoloRun(
  client: SheetClient,
  run: SoloRun,
): Promise<void> {
  await ensureTab(client, SOLO_TAB, SOLO_HEADER);
  const existing = await readSoloRuns(client);
  const row = existing.length + 2;
  await client.setValues(
    `${SOLO_TAB}!A${row}:D${row}`,
    [[run.memberId, run.date, run.minutes, kstStamp()]],
    "RAW",
  );
}

/**
 * 혼뛰 후기 한 건을 지웁니다.
 *
 * 잘못 넣었을 때 되돌릴 방법이 있어야 합니다. 같은 사람·날짜·시간이 여러 건이면
 * 뒤에 있는 것부터 하나만 지웁니다.
 */
export async function deleteSoloRun(
  client: SheetClient,
  run: SoloRun,
): Promise<boolean> {
  const existing = await readSoloRuns(client);
  const index = existing.findIndex(
    (r) => r.memberId === run.memberId && r.date === run.date && r.minutes === run.minutes,
  );
  if (index === -1) return false;

  const next = existing.filter((_, i) => i !== index);
  await client.clearRange(`${SOLO_TAB}!A2:D1000`);
  if (next.length > 0) {
    await client.setValues(
      `${SOLO_TAB}!A2:C${next.length + 1}`,
      next.map((r) => [r.memberId, r.date, r.minutes]),
      "RAW",
    );
  }
  return true;
}
