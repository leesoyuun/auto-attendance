import { dayOfWeek, monthOf, shiftDays, toDate, weekStartOf } from "./date";
import type { IsoDate, IsoMonth } from "./types";

/**
 * 월별 탭의 컬럼 배치.
 *
 * 실제 시트를 역산해서 얻은 구조입니다. 날짜 7칸 + 주차 합산 1칸이 한 블록이고,
 * 이것이 주 수만큼 반복됩니다.
 *
 *   A=Rank  B=Name  C=최종 합산
 *   1주차: D~J(7일) K(합산)    2주차: L~R  S
 *   3주차: T~Z      AA         4주차: AB~AH AI
 *   5주차: AJ~AP    AQ
 *
 * 기존 시트의 `=SUM(K3+S3+AA3+AI3)` 가 정확히 이 K·S·AA·AI 와 맞습니다.
 */

/** A=0, B=1 ... Z=25, AA=26 */
export function columnLetter(index: number): string {
  if (index < 0) throw new Error(`컬럼 index 가 음수입니다: ${index}`);
  let n = index;
  let out = "";
  while (true) {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
    if (n < 0) break;
  }
  return out;
}

export const COL_RANK = 0;
export const COL_NAME = 1;
export const COL_TOTAL = 2;
/** 날짜 블록이 시작하는 컬럼 (D) */
export const COL_FIRST_DAY = 3;
const DAYS_PER_WEEK = 7;
/** 날짜 7칸 + 주차 합산 1칸 */
const COLS_PER_WEEK = DAYS_PER_WEEK + 1;

export interface WeekBlock {
  /** 1부터 시작하는 주차 번호 */
  week: number;
  /** 날짜 7칸의 첫 컬럼 index */
  dayStart: number;
  /** 날짜 7칸의 마지막 컬럼 index */
  dayEnd: number;
  /** 주차 합산 컬럼 index */
  subtotal: number;
}

export function weekBlock(week: number): WeekBlock {
  if (week < 1) throw new Error(`주차는 1 이상이어야 합니다: ${week}`);
  const dayStart = COL_FIRST_DAY + (week - 1) * COLS_PER_WEEK;
  return {
    week,
    dayStart,
    dayEnd: dayStart + DAYS_PER_WEEK - 1,
    subtotal: dayStart + DAYS_PER_WEEK,
  };
}

/** 날짜 하나가 들어갈 컬럼 index. 범위를 벗어나면 null. */
export function columnForDate(layout: MonthLayout, date: IsoDate): number | null {
  const index = layout.dates.indexOf(date);
  if (index === -1) return null;
  const week = Math.floor(index / DAYS_PER_WEEK) + 1;
  const offset = index % DAYS_PER_WEEK;
  return weekBlock(week).dayStart + offset;
}

export interface MonthLayout {
  month: IsoMonth;
  /** 탭 이름. 기존 시트와 같은 `YYYY-MM` 형식입니다. */
  tabName: string;
  /** 첫 날짜 (월요일) */
  startDate: IsoDate;
  /** 마지막 날짜 (일요일) */
  endDate: IsoDate;
  weeks: number;
  /** 날짜 열에 들어갈 모든 날짜. 주 단위로 이어집니다. */
  dates: IsoDate[];
  blocks: WeekBlock[];
  /** 마지막으로 쓰이는 컬럼 index */
  lastColumn: number;
}

/**
 * 새 월 탭의 배치를 계산합니다.
 *
 * 규칙은 **빈틈 없는 월~일 주 단위**입니다.
 * - 시작: 직전 탭의 마지막 날짜 다음 날. 직전 탭이 없으면 1일이 속한 주의 월요일.
 * - 끝: 그 달 말일이 속한 주의 일요일.
 *
 * 이렇게 하면 어떤 날짜도 두 탭에 중복되거나 어느 탭에도 없는 일이 생기지 않습니다.
 * 실제 시트의 2026-07 탭이 `6/29 ~ 8/2` 로 되어 있는 것과 같은 방식입니다.
 * (2026-08 은 4주만 있어 이 규칙과 한 주 다르지만, 이미 만들어진 탭은 건드리지 않고
 *  새로 만드는 달부터 이 규칙을 적용합니다.)
 */
export function monthLayout(month: IsoMonth, previousEnd: IsoDate | null): MonthLayout {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new Error(`월 형식이 YYYY-MM 이 아닙니다: ${month}`);
  }

  const firstOfMonth = `${month}-01`;
  const lastOfMonth = lastDayOf(month);

  const startDate = previousEnd ? shiftDays(previousEnd, 1) : weekStartOf(firstOfMonth);
  if (dayOfWeek(startDate) !== "월") {
    throw new Error(
      `시작일 ${startDate} 이 월요일이 아닙니다. 직전 탭이 일요일로 끝나지 않았습니다.`,
    );
  }

  // 말일이 속한 주의 일요일까지 덮습니다.
  let endDate = shiftDays(weekStartOf(lastOfMonth), 6);
  // 직전 탭이 이미 이 달 말일 주까지 덮은 경우에도 최소 한 주는 만듭니다.
  if (endDate < startDate) endDate = shiftDays(startDate, 6);

  const totalDays = daysBetween(startDate, endDate) + 1;
  if (totalDays % DAYS_PER_WEEK !== 0) {
    throw new Error(`${startDate}~${endDate} 이 주 단위로 나뉘지 않습니다 (${totalDays}일).`);
  }
  const weeks = totalDays / DAYS_PER_WEEK;

  const dates: IsoDate[] = [];
  for (let i = 0; i < totalDays; i++) dates.push(shiftDays(startDate, i));

  const blocks = Array.from({ length: weeks }, (_, i) => weekBlock(i + 1));

  return {
    month,
    tabName: month,
    startDate,
    endDate,
    weeks,
    dates,
    blocks,
    lastColumn: blocks[blocks.length - 1].subtotal,
  };
}

/**
 * 날짜 헤더 행(2행)에 들어갈 값.
 *
 * 기존 시트를 그대로 따릅니다. 그 달에 속한 날은 일(day) 숫자만, 다른 달에서
 * 넘어온 날은 실제 날짜를 넣어 `8/31` 처럼 보이게 합니다. 그래야 어느 달 날짜인지
 * 헷갈리지 않습니다.
 */
export function headerRow(layout: MonthLayout): Array<string | number> {
  const row: Array<string | number> = ["Rank", "Name", "최종 합산"];
  layout.blocks.forEach((block, i) => {
    for (let d = 0; d < DAYS_PER_WEEK; d++) {
      const date = layout.dates[i * DAYS_PER_WEEK + d];
      row.push(monthOf(date) === layout.month ? Number(date.slice(8, 10)) : date);
    }
    row.push(`${block.week}주차 합산`);
  });
  return row;
}

export interface RowFormulas {
  rank: string;
  total: string;
  subtotals: Array<{ column: number; formula: string }>;
}

/**
 * 한 회원 행의 수식. 기존 시트에서 읽은 형태를 그대로 씁니다.
 *
 * 주간 20점 상한이 `MIN(SUM(...), 20)` 으로 시트에 들어 있어서, 앱은 날짜 셀에
 * 값만 쓰면 됩니다. 점수를 앱에서 계산해 넣으면 상한이 두 번 걸립니다.
 */
export function rowFormulas(
  layout: MonthLayout,
  row: number,
  weeklyCap: number,
  lastMemberRow: number,
): RowFormulas {
  const total = columnLetter(COL_TOTAL);
  const subtotalRefs = layout.blocks.map((b) => `${columnLetter(b.subtotal)}${row}`);
  return {
    rank: `=RANK.EQ(${total}${row},$${total}$3:$${total}$${lastMemberRow},0)`,
    total: `=SUM(${subtotalRefs.join("+")})`,
    subtotals: layout.blocks.map((b) => ({
      column: b.subtotal,
      formula: `=MIN(SUM(${columnLetter(b.dayStart)}${row}:${columnLetter(b.dayEnd)}${row}),${weeklyCap})`,
    })),
  };
}

/** 1행의 참석자 수 수식 (날짜 열마다). */
export function attendanceCountFormula(column: number, lastMemberRow: number): string {
  const letter = columnLetter(column);
  return `=COUNT(${letter}3:${letter}${lastMemberRow})`;
}

function lastDayOf(month: IsoMonth): IsoDate {
  const [y, m] = month.split("-").map(Number);
  // 다음 달 0일 = 이번 달 말일
  const d = new Date(Date.UTC(y, m, 0, 12));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate(),
  ).padStart(2, "0")}`;
}

function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((toDate(to).getTime() - toDate(from).getTime()) / 86_400_000);
}
