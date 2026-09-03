import { monthOf } from "../date";
import { RULES } from "../scoring";
import {
  COL_FIRST_DAY,
  attendanceCountFormula,
  columnLetter,
  headerRow,
  monthLayout,
  type MonthLayout,
} from "../sheet-layout";
import type { IsoDate, IsoMonth } from "../types";
import type { CellValue, SheetClient, TabProperties } from "./client";

/**
 * 월별 탭 자동 생성.
 *
 * 새 달이 되면 기존 탭 하나를 복제해서 날짜와 수식만 바꿔 끼웁니다. 처음부터
 * 만들지 않는 이유는 서식(색·테두리·열 너비)을 그대로 물려받기 위해서입니다.
 */

const MONTH_TAB = /^\d{4}-\d{2}$/;
const HEADER_ROW = 2;
const FIRST_MEMBER_ROW = 3;

/**
 * 수식의 회원 범위 끝. 기존 시트가 `$C$3:$C$98`, `COUNT(D3:D98)` 을 쓰고 있어
 * 같은 값을 유지합니다. 실제 회원 수보다 넉넉해서 사람이 늘어도 수식을 안 고칩니다.
 */
const FORMULA_RANGE_END = 98;

/** 구글 시트 날짜 serial 의 기준일 (1899-12-30). */
const SHEET_EPOCH_UTC = Date.UTC(1899, 11, 30);

export interface MonthTabResult {
  month: IsoMonth;
  created: boolean;
  /** 이미 있어서 만들지 않은 경우 이유 */
  reason?: string;
  layout?: MonthLayout;
  copiedFrom?: string;
  memberCount?: number;
}

function serialToIso(serial: number): IsoDate {
  const d = new Date(SHEET_EPOCH_UTC + serial * 86_400_000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate(),
  ).padStart(2, "0")}`;
}

/**
 * 탭의 헤더 행에서 마지막 날짜를 읽습니다.
 *
 * 기존 시트는 그 달에 속한 날은 일 숫자만(`27`), 다른 달에서 넘어온 날은 실제
 * 날짜(serial)로 적습니다. 2026년 serial 은 46000 대라 31 이하와 겹치지 않습니다.
 */
export function lastDateOfTab(tabMonth: IsoMonth, header: CellValue[]): IsoDate | null {
  let last: IsoDate | null = null;
  for (let i = COL_FIRST_DAY; i < header.length; i++) {
    const raw = header[i];
    if (typeof raw !== "number") continue; // "N주차 합산" 라벨과 빈칸은 건너뜁니다
    const iso =
      raw <= 31 ? `${tabMonth}-${String(raw).padStart(2, "0")}` : serialToIso(raw);
    if (!last || iso > last) last = iso;
  }
  return last;
}

/** 헤더에서 "N주차 합산" 라벨 개수를 세어 주 수를 알아냅니다. */
function weekCountOf(header: CellValue[]): number {
  return header.filter((c) => typeof c === "string" && c.includes("주차 합산")).length;
}

function monthTabs(tabs: TabProperties[]): TabProperties[] {
  return tabs
    .filter((t) => MONTH_TAB.test(t.title))
    .sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * 대상 월의 탭이 없으면 만듭니다. 이미 있으면 아무것도 하지 않습니다.
 *
 * 저장할 때마다 호출해도 안전합니다 — 새 달의 첫 저장에서 한 번만 실제로 만듭니다.
 */
export async function ensureMonthTab(
  client: SheetClient,
  month: IsoMonth,
  options: { rosterTab?: string; dryRun?: boolean } = {},
): Promise<MonthTabResult> {
  const rosterTab = options.rosterTab ?? "현황&회비";
  const tabs = await client.listTabs();

  if (tabs.some((t) => t.title === month)) {
    return { month, created: false, reason: "이미 있습니다" };
  }

  const months = monthTabs(tabs);
  const earlier = months.filter((t) => t.title < month);
  if (earlier.length === 0) {
    throw new Error(
      `${month} 이전의 월 탭이 없어 시작일을 정할 수 없습니다. 첫 탭은 직접 만들어주세요.`,
    );
  }
  const previous = earlier[earlier.length - 1];

  // 직전 탭의 마지막 날짜 다음 날부터 시작해야 날짜가 겹치거나 빠지지 않습니다.
  const prevHeader = (
    await client.getValues(`${previous.title}!A${HEADER_ROW}:BZ${HEADER_ROW}`, "UNFORMATTED_VALUE")
  )[0];
  if (!prevHeader) throw new Error(`${previous.title} 탭의 헤더 행을 읽지 못했습니다.`);

  const previousEnd = lastDateOfTab(previous.title, prevHeader);
  if (!previousEnd) {
    throw new Error(`${previous.title} 탭에서 날짜 열을 찾지 못했습니다.`);
  }

  const layout = monthLayout(month, previousEnd);

  // 주 수가 같은 탭을 복제하면 열 개수와 서식이 그대로 맞습니다.
  let source = previous;
  if (weekCountOf(prevHeader) !== layout.weeks) {
    for (const candidate of months) {
      const header = (
        await client.getValues(`${candidate.title}!A${HEADER_ROW}:BZ${HEADER_ROW}`, "UNFORMATTED_VALUE")
      )[0];
      if (header && weekCountOf(header) === layout.weeks) {
        source = candidate;
        break;
      }
    }
  }

  // 활동 회원만 넣습니다. 탈퇴한 사람 행도 회비 이력 때문에 남아 있어서
  // 걸러내지 않으면 나간 사람까지 새 탭의 랭킹에 들어갑니다.
  const names = await readActiveNames(client, rosterTab);

  if (options.dryRun) {
    return {
      month,
      created: false,
      reason: "dryRun",
      layout,
      copiedFrom: source.title,
      memberCount: names.length,
    };
  }

  // 1) 복제 후 이름 변경
  const dup = await client.batchUpdate<{
    replies: Array<{ duplicateSheet?: { properties: { sheetId: number } } }>;
  }>([
    {
      duplicateSheet: {
        sourceSheetId: source.sheetId,
        newSheetName: month,
        insertSheetIndex: 0,
      },
    },
  ]);
  const sheetId = dup.replies[0]?.duplicateSheet?.properties.sheetId;
  if (sheetId === undefined) throw new Error("탭 복제 결과에서 sheetId 를 찾지 못했습니다.");

  // 2) 주 수가 늘어난 달이면 열을 넓힙니다.
  const neededColumns = layout.lastColumn + 1;
  if (source.columnCount < neededColumns) {
    await client.batchUpdate([
      {
        appendDimension: {
          sheetId,
          dimension: "COLUMNS",
          length: neededColumns - source.columnCount,
        },
      },
    ]);
  }

  // 3) 값은 지우고 서식은 남깁니다. clear 는 서식을 건드리지 않습니다.
  const lastCol = columnLetter(layout.lastColumn);
  await client.clearRange(`${month}!A1:${lastCol}${FORMULA_RANGE_END}`);

  // 4) 1행 참석자 수, 2행 헤더, 3행부터 회원 행을 한 번에 씁니다.
  const grid: CellValue[][] = [countRow(layout), headerRow(layout) as CellValue[]];
  names.forEach((name, i) => grid.push(memberRow(layout, name, FIRST_MEMBER_ROW + i)));
  await client.setValues(`${month}!A1:${lastCol}${FIRST_MEMBER_ROW + names.length - 1}`, grid);

  // 5) 헤더 날짜 서식. 다른 달에서 넘어온 날은 `8/31` 처럼 보여야 합니다.
  await applyHeaderDateFormats(client, sheetId, layout);

  return {
    month,
    created: true,
    layout,
    copiedFrom: source.title,
    memberCount: names.length,
  };
}

function countRow(layout: MonthLayout): CellValue[] {
  const row: CellValue[] = ["참석자 수 (참고용)", "", ""];
  for (const block of layout.blocks) {
    for (let c = block.dayStart; c <= block.dayEnd; c++) {
      row.push(attendanceCountFormula(c, FORMULA_RANGE_END));
    }
    row.push(""); // 주차 합산 열에는 참석자 수를 넣지 않습니다
  }
  return row;
}

function memberRow(layout: MonthLayout, name: string, row: number): CellValue[] {
  const total = columnLetter(2);
  const subtotalRefs = layout.blocks.map((b) => `${columnLetter(b.subtotal)}${row}`);
  const cells: CellValue[] = [
    `=RANK.EQ(${total}${row},$${total}$${FIRST_MEMBER_ROW}:$${total}$${FORMULA_RANGE_END},0)`,
    name,
    `=SUM(${subtotalRefs.join("+")})`,
  ];
  for (const block of layout.blocks) {
    for (let c = block.dayStart; c <= block.dayEnd; c++) cells.push("");
    // 주간 상한이 시트 수식에 들어 있어서, 앱은 날짜 셀에 값만 쓰면 됩니다.
    cells.push(
      `=MIN(SUM(${columnLetter(block.dayStart)}${row}:${columnLetter(block.dayEnd)}${row}),${
        RULES.weeklyAttendanceCap
      })`,
    );
  }
  return cells;
}

/**
 * 2행의 날짜 셀 서식을 지정합니다.
 *
 * 그 달 날짜는 숫자(1, 2, ...), 다른 달에서 넘어온 날짜는 `M/D` 로 보이게 합니다.
 * 서식을 지정하지 않으면 날짜가 `46293` 같은 serial 로 보여 깨진 것처럼 됩니다.
 */
async function applyHeaderDateFormats(
  client: SheetClient,
  sheetId: number,
  layout: MonthLayout,
): Promise<void> {
  const requests: unknown[] = [];
  layout.blocks.forEach((block, weekIndex) => {
    for (let d = 0; d < 7; d++) {
      const date = layout.dates[weekIndex * 7 + d];
      const column = block.dayStart + d;
      const inMonth = monthOf(date) === layout.month;
      requests.push({
        repeatCell: {
          range: {
            sheetId,
            startRowIndex: HEADER_ROW - 1,
            endRowIndex: HEADER_ROW,
            startColumnIndex: column,
            endColumnIndex: column + 1,
          },
          cell: {
            userEnteredFormat: {
              numberFormat: inMonth
                ? { type: "NUMBER", pattern: "0" }
                : { type: "DATE", pattern: "M/d" },
            },
          },
          fields: "userEnteredFormat.numberFormat",
        },
      });
    }
  });
  if (requests.length > 0) await client.batchUpdate(requests);
}

/** `현황&회비` 탭의 활동여부. 나간 사람도 행이 남아 있습니다. */
export const ACTIVE_STATUS = "활동";

export interface RosterEntry {
  name: string;
  status: string;
}

/**
 * `현황&회비` 탭에서 명단을 읽습니다. 3행이 헤더, 4행부터 데이터입니다.
 *
 * 이 탭에는 탈퇴한 사람의 행도 남아 있어서(회비 이력 때문), 활동여부로 걸러야
 * 합니다. 안 걸러내면 새 월 탭에 나간 사람까지 들어가 랭킹이 어지러워집니다.
 */
export async function readRoster(
  client: SheetClient,
  rosterTab: string,
): Promise<RosterEntry[]> {
  const rows = await client.getValues(`${rosterTab}!B3:C200`);
  const header = rows[0] ?? [];
  if (String(header[0] ?? "").trim() !== "Name") {
    throw new Error(
      `${rosterTab} 탭 3행 B열이 "Name" 이어야 하는데 "${String(header[0] ?? "")}" 입니다.`,
    );
  }
  return rows
    .slice(1)
    .map((r) => ({
      name: String(r[0] ?? "").trim(),
      status: String(r[1] ?? "").trim(),
    }))
    .filter((entry) => entry.name.length > 0);
}

async function readActiveNames(client: SheetClient, rosterTab: string): Promise<string[]> {
  const roster = await readRoster(client, rosterTab);
  const active = roster.filter((e) => e.status === ACTIVE_STATUS);
  if (active.length === 0) {
    throw new Error(
      `${rosterTab} 탭에 활동여부가 "${ACTIVE_STATUS}" 인 사람이 없습니다. ` +
        `읽은 행 ${roster.length}개의 활동여부: ${[...new Set(roster.map((e) => e.status))].join(", ")}`,
    );
  }
  return active.map((e) => e.name);
}
