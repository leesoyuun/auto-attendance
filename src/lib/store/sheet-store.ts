import { kstToday, monthOf } from "../date";
import { RULES } from "../scoring";
import { SheetClient, type CellValue, type SheetConfig } from "../sheet/client";
import {
  addSoloRun,
  deleteSoloRun,
  readRegularDates,
  readSoloRuns,
  setRegularDate,
} from "../sheet/aux-tabs";
import { ACTIVE_STATUS, ensureMonthTab, readRoster } from "../sheet/month-tab";
import { parseCell, parseTabDates } from "../sheet/tab-dates";
import type {
  AttendanceRecord,
  AttendanceState,
  DayEntry,
  EventKind,
  IsoDate,
  IsoMonth,
  Member,
  SoloRun,
} from "../types";
import type { AttendanceStore, DaySnapshot } from "./types";

/**
 * 실제 크루 시트(런나잇_출석포인트) 어댑터.
 *
 * 이 시트는 월별 탭에 날짜가 열로 펼쳐진 가로형이고, 주간 상한·합산·랭크가
 * 이미 수식으로 들어 있습니다. 그래서 앱은 **날짜 셀에 값만 씁니다.** 점수를
 * 계산해서 넣으면 상한이 두 번 걸립니다.
 *
 * - 명단: `현황&회비` 탭 (활동여부가 `활동` 인 사람만)
 * - 출석: 월별 `YYYY-MM` 탭의 날짜 셀
 * - 회원 키: `가형/94` 처럼 이름/출생연도. 출생연도는 안 바뀌어서 그대로 키가 됩니다.
 */

const ROSTER_TAB = "현황&회비";
const MONTH_TAB = /^\d{4}-\d{2}$/;
const HEADER_ROW = 2;
const FIRST_MEMBER_ROW = 3;
const LAST_MEMBER_ROW = 98;

/** 일반 참여 시 셀에 쓰는 값. 시트가 이 값을 합산합니다. */
const ATTEND_VALUE = RULES.attendancePoints;
/** 정기러닝 참여 시 셀에 쓰는 값. */
const REGULAR_ATTEND_VALUE = RULES.regularOnce;
/** 노쇼 시 셀에 쓰는 값. 기존 시트도 음수를 셀에 직접 적는 관행이 있습니다. 정기·일반 동일합니다. */
const NO_SHOW_VALUE = RULES.noShowPenalty;

interface TabIndex {
  title: IsoMonth;
  sheetId: number;
  /** 날짜 → 컬럼 index */
  dates: Map<IsoDate, number>;
}

export class CrewSheetStore implements AttendanceStore {
  private client: SheetClient;
  private tabCache: TabIndex[] | null = null;
  private memberCache: Member[] | null = null;
  private regularCache: IsoDate[] | null = null;

  constructor(config: SheetConfig) {
    this.client = new SheetClient(config);
  }

  /** 캐시를 비웁니다. 저장 후 다시 읽어야 할 때 씁니다. */
  private invalidate(): void {
    this.tabCache = null;
    this.memberCache = null;
    this.regularCache = null;
  }

  /** 정기러닝으로 지정된 날짜. 셀에 구분을 담을 수 없어 별도 탭에 둡니다. */
  private async regularDates(): Promise<IsoDate[]> {
    if (!this.regularCache) this.regularCache = await readRegularDates(this.client);
    return this.regularCache;
  }

  /**
   * 다음 조회에서 시트를 다시 읽게 합니다.
   *
   * 시트가 원본이므로, 사람이 시트를 직접 고쳤을 때 앱이 캐시된 옛 값을 계속
   * 보여주면 안 됩니다. 동기화 버튼이 이 경로를 씁니다.
   */
  async refresh(): Promise<void> {
    // 클라이언트의 탭 목록 캐시까지 버려야 새로 만든 탭을 알아챕니다.
    this.client.forgetTabs();
    this.invalidate();
  }

  private async monthTabs(): Promise<TabIndex[]> {
    if (this.tabCache) return this.tabCache;

    const tabs = (await this.client.listTabs()).filter((t) => MONTH_TAB.test(t.title));
    // 탭마다 따로 읽으면 탭 개수만큼 요청이 나갑니다. 한 번에 묶어 읽습니다.
    const headers = await this.client.batchGetValues(
      tabs.map((t) => `${t.title}!A${HEADER_ROW}:BZ${HEADER_ROW}`),
      "UNFORMATTED_VALUE",
    );

    const indexed: TabIndex[] = tabs.map((tab, i) => {
      const header = headers[i]?.[0];
      return {
        title: tab.title,
        sheetId: tab.sheetId,
        dates: header ? parseTabDates(tab.title, header) : new Map(),
      };
    });
    indexed.sort((a, b) => a.title.localeCompare(b.title));
    this.tabCache = indexed;
    return indexed;
  }

  /** 그 날짜를 담고 있는 탭. 월 경계를 넘는 주가 있어 탭 이름만으로는 못 찾습니다. */
  private async tabForDate(date: IsoDate): Promise<{ tab: TabIndex; column: number } | null> {
    for (const tab of await this.monthTabs()) {
      const column = tab.dates.get(date);
      if (column !== undefined) return { tab, column };
    }
    return null;
  }

  /**
   * 명단을 읽습니다. 체크 화면이 매번 부르는 경로라 **가볍게 유지합니다.**
   *
   * 시트에 가입일 열이 없어서 가장 이른 월 탭의 시작일을 가입일로 둡니다.
   * 이걸 "기록에 처음 등장한 날"로 정확히 구하려면 모든 탭을 읽어야 하는데,
   * 페이지를 열 때마다 그러면 분당 요청 제한에 걸립니다. 정확한 값이 필요한
   * 집계 화면에서는 `withFirstSeenJoinDates` 로 보정합니다.
   */
  async listMembers(): Promise<Member[]> {
    if (this.memberCache) return this.memberCache;

    const [roster, tabs] = await Promise.all([
      readRoster(this.client, ROSTER_TAB),
      this.monthTabs(),
    ]);
    const active = roster.filter((e) => e.status === ACTIVE_STATUS);

    const earliest = tabs
      .flatMap((t) => [...t.dates.keys()])
      .reduce<IsoDate | null>((min, d) => (min === null || d < min ? d : min), null);
    const joinedOn = earliest ?? kstToday();

    this.memberCache = active.map((entry) => ({
      id: entry.name,
      name: entry.name,
      joinedOn,
    }));
    return this.memberCache;
  }

  /**
   * 명단에 사람을 추가합니다.
   *
   * `현황&회비` 탭 맨 아래에 한 줄 넣습니다. 회원ID를 따로 발급하지 않습니다 —
   * 이름/출생연도가 이미 키라서, 이름 형식만 맞으면 됩니다.
   */
  async addMember(name: string, _joinedOn: IsoDate): Promise<Member> {
    const roster = await readRoster(this.client, ROSTER_TAB);
    if (roster.some((e) => e.name === name)) {
      throw new Error(`"${name}" 은 이미 명단에 있습니다.`);
    }
    const row = FIRST_MEMBER_ROW + 1 + roster.length; // 3행 헤더, 4행부터 데이터
    await this.client.setValues(`${ROSTER_TAB}!B${row}:C${row}`, [[name, ACTIVE_STATUS]]);
    this.invalidate();
    return { id: name, name, joinedOn: kstToday() };
  }

  async getDay(date: IsoDate): Promise<DaySnapshot | null> {
    const found = await this.tabForDate(date);
    if (!found) return null;

    const { tab, column } = found;
    const rows = await this.client.getValues(
      `${tab.title}!B${FIRST_MEMBER_ROW}:${columnRange(column)}${LAST_MEMBER_ROW}`,
      "UNFORMATTED_VALUE",
    );

    const entries: DayEntry[] = [];
    for (const row of rows) {
      const name = String(row[0] ?? "").trim();
      if (!name) continue;
      // B열이 index 0 이므로 대상 컬럼은 (column - 1) 만큼 떨어져 있습니다.
      const state = parseCell(row[column - 1] ?? null);
      if (!state) continue;
      entries.push({ memberId: name, state });
    }

    if (entries.length === 0) return null;
    const regular = await this.regularDates();
    return { date, kind: regular.includes(date) ? "정기" : "일반", entries };
  }

  async listRecords(): Promise<AttendanceRecord[]> {
    const [tabs, regular] = await Promise.all([
      this.monthTabs().then((all) => all.filter((t) => t.dates.size > 0)),
      this.regularDates(),
    ]);
    const regularSet = new Set(regular);
    // 탭 전체를 한 요청으로 읽습니다. 탭마다 부르면 분당 제한에 걸립니다.
    const blocks = await this.client.batchGetValues(
      tabs.map(
        (t) =>
          `${t.title}!B${FIRST_MEMBER_ROW}:${columnRange(
            Math.max(...t.dates.values()),
          )}${LAST_MEMBER_ROW}`,
      ),
      "UNFORMATTED_VALUE",
    );

    const records: AttendanceRecord[] = [];
    tabs.forEach((tab, tabIndex) => {
      const rows = blocks[tabIndex] ?? [];
      for (const row of rows) {
        const name = String(row[0] ?? "").trim();
        if (!name) continue;
        for (const [date, column] of tab.dates) {
          const state = parseCell(row[column - 1] ?? null);
          if (!state) continue;
          records.push({
            memberId: name,
            date,
            kind: regularSet.has(date) ? "정기" : "일반",
            state,
            recordedAt: "",
          });
        }
      }
    });
    return records;
  }

  async listSoloRuns(): Promise<SoloRun[]> {
    return readSoloRuns(this.client);
  }

  /** 혼뛰 후기를 추가합니다. 탭이 없으면 만듭니다. */
  async addSoloRun(run: SoloRun): Promise<void> {
    const members = await this.listMembers();
    if (!members.some((m) => m.id === run.memberId)) {
      throw new Error(`"${run.memberId}" 은 활동 명단에 없습니다.`);
    }
    await addSoloRun(this.client, run);
  }

  /** 잘못 넣은 혼뛰 후기를 지웁니다. */
  async deleteSoloRun(run: SoloRun): Promise<boolean> {
    return deleteSoloRun(this.client, run);
  }

  /**
   * 그 날짜 열에 값을 씁니다.
   *
   * 참여는 일반 10 / 정기러닝 30, 노쇼는 −10 (정기·일반 동일). 정기러닝
   * 여부는 그 날 하루 단위(kind)로만 구분하고, 한 달에 정기러닝을 여러 번
   * 나가도 각 날짜 셀에 매번 30이 그대로 찍힙니다 — 월 합계 상한은 없습니다.
   * 정기러닝 지정 자체는 셀에 담을 수 없어 `정기러닝일` 탭에 날짜만 남깁니다.
   */
  async saveDay(date: IsoDate, kind: EventKind, entries: DayEntry[]): Promise<void> {
    const found = await this.tabForDate(date);
    if (!found) {
      throw new Error(
        `${date} 을 담은 월 탭이 없습니다. ${monthOf(date)} 탭을 먼저 추가해주세요.`,
      );
    }
    const { tab, column } = found;

    const rows = await this.client.getValues(
      `${tab.title}!B${FIRST_MEMBER_ROW}:B${LAST_MEMBER_ROW}`,
    );
    const rowOf = new Map<string, number>();
    rows.forEach((row, i) => {
      const name = String(row[0] ?? "").trim();
      if (name && !rowOf.has(name)) rowOf.set(name, FIRST_MEMBER_ROW + i);
    });

    const byMember = new Map<string, AttendanceState>(
      entries.map((e) => [e.memberId, e.state]),
    );

    // 그 열 전체를 다시 씁니다. 체크에서 빠진 사람은 빈칸이 되어야 하므로,
    // 있는 값만 덮어쓰면 이전 기록이 남습니다.
    const column1 = columnRange(column);
    const values: CellValue[][] = [];
    const unknown: string[] = [];
    for (let row = FIRST_MEMBER_ROW; row <= LAST_MEMBER_ROW; row++) {
      values.push([""]);
    }
    for (const [name, state] of byMember) {
      const row = rowOf.get(name);
      if (row === undefined) {
        unknown.push(name);
        continue;
      }
      values[row - FIRST_MEMBER_ROW] = [
        state === "참여"
          ? kind === "정기"
            ? REGULAR_ATTEND_VALUE
            : ATTEND_VALUE
          : NO_SHOW_VALUE,
      ];
    }
    if (unknown.length > 0) {
      throw new Error(
        `${tab.title} 탭에 없는 이름이 있습니다: ${unknown.join(", ")}. ` +
          `명단에 추가된 사람은 새 월 탭부터 반영됩니다.`,
      );
    }

    await this.client.setValues(
      `${tab.title}!${column1}${FIRST_MEMBER_ROW}:${column1}${LAST_MEMBER_ROW}`,
      values,
      "RAW",
    );
    await setRegularDate(this.client, date, kind === "정기");
    this.invalidate();
  }

  /** 확정 개념이 이 시트에 없습니다. 도입하면 여기에 연결합니다. */
  async listClosedMonths(): Promise<IsoMonth[]> {
    return [];
  }

  // ---------- 월 탭 관리 ----------

  /** 그 달 탭이 있는지. 없으면 화면에 추가 버튼을 띄웁니다. */
  async hasMonthTab(month: IsoMonth): Promise<boolean> {
    return (await this.monthTabs()).some((t) => t.title === month);
  }

  async listMonthTabs(): Promise<IsoMonth[]> {
    return (await this.monthTabs()).map((t) => t.title);
  }

  async createMonthTab(month: IsoMonth) {
    const result = await ensureMonthTab(this.client, month, { rosterTab: ROSTER_TAB });
    this.invalidate();
    return result;
  }
}

/** 0-based 컬럼 index → 시트 문자. A=0 */
function columnRange(index: number): string {
  let n = index;
  let out = "";
  while (true) {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
    if (n < 0) break;
  }
  return out;
}
