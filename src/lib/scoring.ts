import { addMonths, monthOf, weekStartOf, weeksBetween } from "./date";
import type {
  AttendanceRecord,
  IsoDate,
  IsoMonth,
  Member,
  SoloRun,
} from "./types";

/**
 * 규칙 숫자는 전부 여기 모여 있습니다.
 *
 * 점수를 시트에 저장하지 않고 매번 계산하는 이유가 이것입니다. 규칙이 바뀌면
 * 이 상수만 고쳐도 과거 기록까지 다시 계산됩니다. 대신 이미 확정한 달은
 * 잠가서(store 계층) 끝난 추첨이 뒤집히지 않게 합니다.
 */
export const RULES = {
  /** 일반 일정 참여 1회 */
  attendancePoints: 10,
  /** 일반 일정 참여의 주간 상한 */
  weeklyAttendanceCap: 20,
  /** 정기러닝: 월 1회 참여 */
  regularOnce: 30,
  /** 정기러닝: 월 2회 이상 참여 (합계) */
  regularTwice: 40,
  /** 혼뛰 후기 1개 */
  soloPoints: 5,
  /** 혼뛰 후기 주간 상한 */
  weeklySoloCap: 10,
  /** 혼뛰 후기 인정 최소 시간(분) */
  soloMinMinutes: 40,
  /** 노쇼 1회 (면책 시 미적용) */
  noShowPenalty: -10,
  /** 월말 추첨 자격 기준 */
  raffleThreshold: 100,
  /** 경고 누적 퇴출 기준 */
  warningLimit: 3,
  /** 첫 경고로부터 이 개월이 지나면 경고를 전부 초기화 */
  warningWindowMonths: 3,
  /** 연속 불참 퇴출 기준(주) */
  consecutiveAbsenceLimit: 2,
} as const;

/** 점수 한 줄. 어느 날 무엇 때문에 몇 점인지 근거로 그대로 보여줍니다. */
export interface PointLine {
  date: IsoDate;
  amount: number;
  label: string;
}

export interface WeekOutcome {
  weekStart: IsoDate;
  /** 크루 전체에 그 주 일정이 있었는지 */
  hadEvents: boolean;
  attended: number;
  noShows: number;
  excusedNoShows: number;
  warned: boolean;
  /** 판정을 건너뛴 이유 */
  skipped: "no-events" | "before-join" | null;
  note: string;
}

export interface WarningState {
  count: number;
  firstOn: IsoDate | null;
  /** 첫 경고 + 3개월. 이 날짜가 되면 전부 초기화됩니다. */
  resetOn: IsoDate | null;
  reachedLimitOn: IsoDate | null;
}

export interface MemberEvaluation {
  memberId: string;
  lines: PointLine[];
  monthlyPoints: Record<IsoMonth, number>;
  weeks: WeekOutcome[];
  warnings: WarningState;
  longestAbsenceStreak: number;
  absenceExpulsionOn: IsoDate | null;
  /**
   * 퇴출 "대상"일 뿐입니다. 자동으로 내보내지 않습니다 — 사람에게 직접 영향을
   * 주는 판정이라 크루장이 근거를 확인한 뒤 결정합니다.
   */
  expulsionCandidate: boolean;
  reasons: string[];
}

function byDate<T extends { date: IsoDate }>(items: T[]): T[] {
  return [...items].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

function groupByWeek<T extends { date: IsoDate }>(items: T[]): Map<IsoDate, T[]> {
  const out = new Map<IsoDate, T[]>();
  for (const item of byDate(items)) {
    const key = weekStartOf(item.date);
    const bucket = out.get(key);
    if (bucket) bucket.push(item);
    else out.set(key, [item]);
  }
  return out;
}

/**
 * 주간 상한을 날짜 순서대로 배분합니다.
 *
 * 주는 월 경계를 넘을 수 있어서(예: 8/31~9/6) 상한을 적용한 뒤 총점을 한 달에
 * 몰아 넣으면 월별 집계가 틀립니다. 그래서 이른 날짜부터 상한까지 채우고,
 * 각 점수를 그 기록의 날짜에 귀속시킵니다.
 */
function allocateWithWeeklyCap<T extends { date: IsoDate }>(
  items: T[],
  perItem: number,
  weeklyCap: number,
  label: (item: T) => string,
): PointLine[] {
  const lines: PointLine[] = [];
  for (const [, weekItems] of groupByWeek(items)) {
    let used = 0;
    for (const item of weekItems) {
      const grant = Math.min(perItem, Math.max(0, weeklyCap - used));
      if (grant <= 0) {
        lines.push({ date: item.date, amount: 0, label: `${label(item)} · 주간 상한 초과` });
        continue;
      }
      used += grant;
      lines.push({ date: item.date, amount: grant, label: label(item) });
    }
  }
  return lines;
}

/**
 * 크루 전체 기록에서 "일정이 있었던 주"를 뽑습니다.
 *
 * 일정 목록을 따로 관리하지 않으므로, 체크 기록이 있는 날이 곧 일정이 있던 날입니다.
 * 크루장이 체크를 빼먹은 주는 일정이 없던 주로 보여 전원 경고가 면제되는데,
 * 이는 과잉 처벌이 아니라 과소 처벌 방향이라 안전한 쪽 오류입니다.
 */
export function eventWeeksFrom(records: AttendanceRecord[]): Set<IsoDate> {
  return new Set(records.map((r) => weekStartOf(r.date)));
}

export function computePointLines(
  member: Member,
  records: AttendanceRecord[],
  soloRuns: SoloRun[],
): PointLine[] {
  const mine = records.filter((r) => r.memberId === member.id);

  // 1) 일반 일정 참여 — 1회 10점, 주간 20점 상한
  const generalAttendance = mine.filter((r) => r.state === "참여" && r.kind === "일반");
  const lines = allocateWithWeeklyCap(
    generalAttendance,
    RULES.attendancePoints,
    RULES.weeklyAttendanceCap,
    () => "일정 참여",
  );

  // 2) 혼뛰 후기 — 1개 5점, 주간 10점 상한, 40분 이상만
  const validSolo = soloRuns.filter(
    (s) => s.memberId === member.id && s.minutes >= RULES.soloMinMinutes,
  );
  lines.push(
    ...allocateWithWeeklyCap(
      validSolo,
      RULES.soloPoints,
      RULES.weeklySoloCap,
      (s) => `혼뛰 후기 ${s.minutes}분`,
    ),
  );

  // 3) 정기러닝 — 월 단위로 1회 30점 / 2회 이상 40점, 주간 상한 예외.
  //    상한을 걸면 월 최대 80점이라 100점 추첨 자격자가 영구히 0명이 됩니다.
  const regularByMonth = new Map<IsoMonth, AttendanceRecord[]>();
  for (const r of byDate(mine.filter((x) => x.state === "참여" && x.kind === "정기"))) {
    const key = monthOf(r.date);
    const bucket = regularByMonth.get(key);
    if (bucket) bucket.push(r);
    else regularByMonth.set(key, [r]);
  }
  for (const [, monthRecords] of regularByMonth) {
    const count = monthRecords.length;
    const amount = count >= 2 ? RULES.regularTwice : RULES.regularOnce;
    lines.push({
      date: monthRecords[monthRecords.length - 1].date,
      amount,
      label: `정기러닝 ${count}회`,
    });
  }

  // 4) 노쇼 벌점 — 정기·일반 동일하게 −10, 면책되면 없음.
  //    상한은 얻은 점수에만 걸고 벌점은 그 뒤에 차감하므로 상한과 무관합니다.
  for (const r of byDate(mine.filter((x) => x.state === "노쇼"))) {
    if (r.excused) {
      lines.push({ date: r.date, amount: 0, label: "노쇼 · 사전 고지 면책" });
    } else {
      lines.push({ date: r.date, amount: RULES.noShowPenalty, label: "노쇼" });
    }
  }

  return byDate(lines);
}

export function sumByMonth(lines: PointLine[]): Record<IsoMonth, number> {
  const out: Record<IsoMonth, number> = {};
  for (const line of lines) {
    const key = monthOf(line.date);
    out[key] = (out[key] ?? 0) + line.amount;
  }
  return out;
}

/**
 * 주별 요건을 훑어 경고와 연속 불참을 판정합니다.
 *
 * 주간 요건: 그 주에 참여가 1회 이상 있어야 합니다.
 */
function evaluateWeeks(
  member: Member,
  records: AttendanceRecord[],
  eventWeeks: Set<IsoDate>,
  from: IsoDate,
  to: IsoDate,
): WeekOutcome[] {
  const mine = records.filter((r) => r.memberId === member.id);
  const mineByWeek = groupByWeek(mine);

  return weeksBetween(from, to).map((weekStart) => {
    const rows = mineByWeek.get(weekStart) ?? [];
    const attended = rows.filter((r) => r.state === "참여");
    const noShows = rows.filter((r) => r.state === "노쇼");
    const excusedNoShows = noShows.filter((r) => r.excused);

    const base: Omit<WeekOutcome, "warned" | "skipped" | "note"> = {
      weekStart,
      hadEvents: eventWeeks.has(weekStart),
      attended: attended.length,
      noShows: noShows.length,
      excusedNoShows: excusedNoShows.length,
    };

    // 주가 시작되기 전에 가입한 사람만 그 주로 판정합니다. 주 중간에 가입했으면
    // 남은 며칠로 "주 1회 참여"를 요구하는 셈이라 부당합니다. 퇴출로 이어지는
    // 판정이므로 느슨한 쪽을 택합니다.
    if (weekStart < member.joinedOn) {
      return { ...base, warned: false, skipped: "before-join", note: "가입 전" };
    }

    if (!base.hadEvents) {
      return { ...base, warned: false, skipped: "no-events", note: "그 주 일정 없음" };
    }

    if (attended.length > 0) {
      return { ...base, warned: false, skipped: null, note: `참여 ${attended.length}회` };
    }

    if (excusedNoShows.length > 0) {
      return { ...base, warned: false, skipped: null, note: "사전 고지로 면책" };
    }

    const why = noShows.length > 0 ? `노쇼 ${noShows.length}회` : "참여 없음";
    return { ...base, warned: true, skipped: null, note: why };
  });
}

export function evaluateMember(
  member: Member,
  records: AttendanceRecord[],
  soloRuns: SoloRun[],
  asOf: IsoDate,
  eventWeeks: Set<IsoDate> = eventWeeksFrom(records),
): MemberEvaluation {
  const lines = computePointLines(member, records, soloRuns);
  const weeks = evaluateWeeks(member, records, eventWeeks, member.joinedOn, asOf);

  const warnings: WarningState = {
    count: 0,
    firstOn: null,
    resetOn: null,
    reachedLimitOn: null,
  };
  const reasons: string[] = [];
  let streak = 0;
  let longestStreak = 0;
  let absenceExpulsionOn: IsoDate | null = null;

  for (const week of weeks) {
    // 첫 경고로부터 3개월이 지났으면 그 주를 판정하기 전에 전부 초기화합니다.
    if (warnings.resetOn && week.weekStart >= warnings.resetOn) {
      reasons.push(`${warnings.resetOn} · 첫 경고로부터 3개월 경과 → 경고 초기화`);
      warnings.count = 0;
      warnings.firstOn = null;
      warnings.resetOn = null;
    }

    if (week.skipped) {
      // 일정이 없거나 활동 기간이 아닌 주는 연속 불참 흐름을 끊습니다.
      // 없는 일정에 불참할 수는 없고, 이 판정이 퇴출로 이어지므로 느슨한 쪽이
      // 안전합니다. "빠진 기회 2번"으로 세려면 이 줄을 continue 로만 두면 됩니다.
      streak = 0;
      continue;
    }

    if (week.attended > 0 || week.excusedNoShows > 0) {
      streak = 0;
    } else {
      streak += 1;
      longestStreak = Math.max(longestStreak, streak);
      if (streak >= RULES.consecutiveAbsenceLimit && !absenceExpulsionOn) {
        absenceExpulsionOn = week.weekStart;
        reasons.push(
          `${week.weekStart} · ${RULES.consecutiveAbsenceLimit}주 연속 불참 → 퇴출 대상`,
        );
      }
    }

    if (week.warned) {
      warnings.count += 1;
      if (!warnings.firstOn) {
        warnings.firstOn = week.weekStart;
        warnings.resetOn = addMonths(week.weekStart, RULES.warningWindowMonths);
      }
      reasons.push(`${week.weekStart} · ${week.note} → 경고 ${warnings.count}`);
      if (warnings.count >= RULES.warningLimit && !warnings.reachedLimitOn) {
        warnings.reachedLimitOn = week.weekStart;
        reasons.push(`${week.weekStart} · 경고 ${RULES.warningLimit}회 도달 → 퇴출 대상`);
      }
    }
  }

  if (warnings.resetOn) {
    reasons.push(`경고는 ${warnings.resetOn} 에 초기화됩니다`);
  }

  return {
    memberId: member.id,
    lines,
    monthlyPoints: sumByMonth(lines),
    weeks,
    warnings,
    longestAbsenceStreak: longestStreak,
    absenceExpulsionOn,
    expulsionCandidate: warnings.reachedLimitOn !== null || absenceExpulsionOn !== null,
    reasons,
  };
}

export interface MonthlySummaryRow {
  member: Member;
  points: number;
  raffleEligible: boolean;
  warnings: number;
  expulsionCandidate: boolean;
  reasons: string[];
}

export function monthlySummary(
  members: Member[],
  records: AttendanceRecord[],
  soloRuns: SoloRun[],
  month: IsoMonth,
): MonthlySummaryRow[] {
  const eventWeeks = eventWeeksFrom(records);
  const asOf = `${month}-28`; // 월 판정 기준일. 확정 시점에 맞춰 조정할 수 있습니다.

  return members
    .map((member) => {
      const evaluation = evaluateMember(member, records, soloRuns, asOf, eventWeeks);
      const points = evaluation.monthlyPoints[month] ?? 0;
      return {
        member,
        points,
        raffleEligible: points >= RULES.raffleThreshold,
        warnings: evaluation.warnings.count,
        expulsionCandidate: evaluation.expulsionCandidate,
        reasons: evaluation.reasons,
      };
    })
    .sort((a, b) => b.points - a.points);
}
