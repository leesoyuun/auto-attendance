import type { IsoDate, IsoMonth } from "./types";

export const TIME_ZONE = "Asia/Seoul";

/**
 * 날짜는 전부 한국 시간(Asia/Seoul) 기준입니다.
 *
 * 9시간을 직접 더하지 않고 Intl에 맡깁니다. 서버가 어느 타임존에 있어도
 * 같은 날짜가 나와야 하고, 직접 계산하면 배포 환경이 바뀔 때 조용히 틀립니다.
 * 실측: 2026-09-03T00:00Z 는 KST 09-03 이지만 America/Los_Angeles 로는 09-02 입니다.
 * 매일 8시간 동안 날짜가 하루 어긋나고, 그러면 주 경계가 밀려 경고가 엉뚱한 주에 붙습니다.
 */
function kstParts(options: Intl.DateTimeFormatOptions, at: Date): Record<string, string> {
  const parts: Record<string, string> = {};
  new Intl.DateTimeFormat("ko-KR", { timeZone: TIME_ZONE, ...options })
    .formatToParts(at)
    .forEach((p) => {
      parts[p.type] = p.value;
    });
  return parts;
}

/** 한국 시간 기준 오늘 (YYYY-MM-DD). */
export function kstToday(at: Date = new Date()): IsoDate {
  const p = kstParts({ year: "numeric", month: "2-digit", day: "2-digit" }, at);
  return `${p.year}-${p.month}-${p.day}`;
}

/** 한국 시간 기준 현재 시각 (YYYY-MM-DD HH:mm). 저장 시각용. */
export function kstStamp(at: Date = new Date()): string {
  const p = kstParts(
    {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    },
    at,
  );
  return `${p.year}-${p.month}-${p.day} ${p.hour.replace("24", "00")}:${p.minute}`;
}

/**
 * ISO 날짜를 Date로 바꿉니다. 정오(UTC)를 쓰는 이유는 어느 타임존에서 읽어도
 * 달력상 날짜가 흔들리지 않게 하려는 것입니다.
 */
export function toDate(iso: IsoDate): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

export function toIso(date: Date): IsoDate {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function shiftDays(iso: IsoDate, days: number): IsoDate {
  const d = toDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return toIso(d);
}

export function addMonths(iso: IsoDate, months: number): IsoDate {
  const d = toDate(`${iso.slice(0, 8)}01`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return toIso(d);
}

export function monthOf(iso: IsoDate): IsoMonth {
  return iso.slice(0, 7);
}

const DOW = ["일", "월", "화", "수", "목", "금", "토"] as const;

export function dayOfWeek(iso: IsoDate): string {
  return DOW[toDate(iso).getUTCDay()];
}

/**
 * 주 경계는 월요일~일요일입니다. 그 주의 월요일 날짜를 주 키로 씁니다.
 */
export function weekStartOf(iso: IsoDate): IsoDate {
  const d = toDate(iso);
  const dow = d.getUTCDay(); // 0=일
  const backToMonday = dow === 0 ? 6 : dow - 1;
  return shiftDays(iso, -backToMonday);
}

/** from~to 사이의 모든 주(월요일 키)를 순서대로 반환합니다. */
export function weeksBetween(from: IsoDate, to: IsoDate): IsoDate[] {
  if (from > to) return [];
  const weeks: IsoDate[] = [];
  let cursor = weekStartOf(from);
  const last = weekStartOf(to);
  while (cursor <= last) {
    weeks.push(cursor);
    cursor = shiftDays(cursor, 7);
  }
  return weeks;
}
