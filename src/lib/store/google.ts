import { JWT } from "google-auth-library";

import { kstStamp, monthOf } from "../date";
import { nextMemberId } from "../roster";
import type {
  AttendanceRecord,
  DayEntry,
  EventKind,
  IsoDate,
  IsoMonth,
  Member,
  SoloRun,
} from "../types";
import { MonthClosedError, type AttendanceStore, type DaySnapshot } from "./types";

/**
 * 구글 시트 저장소.
 *
 * 시트 이름과 열 순서는 아래 상수와 반드시 일치해야 합니다. 사람이 열을
 * 옮기면 조용히 엉뚱한 값을 읽으므로, 헤더 행을 검증합니다.
 *
 * 설정 절차는 docs/기획서.md 의 "구글 시트 연결" 절을 보세요.
 */

const SHEETS = {
  members: "명단",
  attendance: "출석",
  soloRuns: "혼뛰후기",
  closed: "확정",
} as const;

const HEADERS = {
  members: ["회원ID", "이름", "가입일", "탈퇴일"],
  attendance: ["회원ID", "날짜", "구분", "상태", "후기", "면책", "기록시각", "수정시각"],
  soloRuns: ["회원ID", "날짜", "시간"],
  closed: ["월"],
} as const;

const API = "https://sheets.googleapis.com/v4/spreadsheets";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";

type Row = string[];

export interface GoogleSheetsConfig {
  spreadsheetId: string;
  clientEmail: string;
  privateKey: string;
}

export function configFromEnv(): GoogleSheetsConfig | null {
  const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY;
  if (!spreadsheetId || !clientEmail || !privateKey) return null;
  return {
    spreadsheetId,
    clientEmail,
    // .env 한 줄에 담으려면 개행을 \n 으로 적게 되므로 되돌립니다.
    privateKey: privateKey.replace(/\\n/g, "\n"),
  };
}

export class GoogleSheetsStore implements AttendanceStore {
  private auth: JWT;

  constructor(private config: GoogleSheetsConfig) {
    this.auth = new JWT({
      email: config.clientEmail,
      key: config.privateKey,
      scopes: [SCOPE],
    });
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const { token } = await this.auth.getAccessToken();
    if (!token) throw new Error("구글 인증 토큰을 받지 못했습니다. 서비스 계정 설정을 확인하세요.");

    const response = await fetch(`${API}/${this.config.spreadsheetId}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...init?.headers,
      },
      cache: "no-store",
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`시트 요청 실패 (${response.status}): ${detail.slice(0, 400)}`);
    }
    return (await response.json()) as T;
  }

  private async readRows(sheet: string, expected: readonly string[]): Promise<Row[]> {
    const data = await this.request<{ values?: Row[] }>(
      `/values/${encodeURIComponent(sheet)}`,
    );
    const rows = data.values ?? [];
    if (rows.length === 0) return [];

    const header = rows[0].map((h) => h.trim());
    const mismatch = expected.findIndex((name, i) => header[i] !== name);
    if (mismatch !== -1) {
      throw new Error(
        `"${sheet}" 시트의 ${mismatch + 1}번째 열이 "${expected[mismatch]}" 이어야 하는데 ` +
          `"${header[mismatch] ?? "(없음)"}" 입니다. 열 순서를 바꾸면 값이 어긋납니다.`,
      );
    }
    return rows.slice(1).filter((row) => row.some((cell) => cell?.trim()));
  }

  /**
   * 시트를 지우고 전체를 다시 씁니다. 크루 규모(수백 행)에서는 행 단위 수정보다
   * 단순하고 안전합니다. 다만 두 사람이 동시에 저장하면 나중 저장이 앞의 것을
   * 덮으므로, 크루장 한 명이 쓰는 전제입니다.
   */
  private async writeAll(sheet: string, header: readonly string[], rows: Row[]): Promise<void> {
    await this.request(`/values/${encodeURIComponent(sheet)}:clear`, { method: "POST" });
    await this.request(
      `/values/${encodeURIComponent(sheet)}?valueInputOption=RAW`,
      {
        method: "PUT",
        body: JSON.stringify({ values: [[...header], ...rows] }),
      },
    );
  }

  async listMembers(): Promise<Member[]> {
    const rows = await this.readRows(SHEETS.members, HEADERS.members);
    return rows.map((row) => ({
      id: row[0].trim(),
      name: row[1]?.trim() ?? "",
      joinedOn: row[2]?.trim() ?? "",
      leftOn: row[3]?.trim() ? row[3].trim() : null,
    }));
  }

  async addMember(name: string, joinedOn: IsoDate): Promise<Member> {
    const members = await this.listMembers();
    const member: Member = { id: nextMemberId(members), name, joinedOn, leftOn: null };
    await this.request(
      `/values/${encodeURIComponent(SHEETS.members)}:append?valueInputOption=RAW`,
      {
        method: "POST",
        body: JSON.stringify({ values: [[member.id, member.name, member.joinedOn, ""]] }),
      },
    );
    return member;
  }

  async listRecords(): Promise<AttendanceRecord[]> {
    const rows = await this.readRows(SHEETS.attendance, HEADERS.attendance);
    return rows.map((row) => ({
      memberId: row[0].trim(),
      date: row[1]?.trim() ?? "",
      kind: (row[2]?.trim() === "정기" ? "정기" : "일반") as EventKind,
      state: row[3]?.trim() === "노쇼" ? "노쇼" : "참여",
      reviewed: row[4]?.trim() === "Y",
      excused: row[5]?.trim() === "Y",
      recordedAt: row[6]?.trim() ?? "",
      updatedAt: row[7]?.trim() || undefined,
    }));
  }

  async listSoloRuns(): Promise<SoloRun[]> {
    const rows = await this.readRows(SHEETS.soloRuns, HEADERS.soloRuns);
    return rows.map((row) => ({
      memberId: row[0].trim(),
      date: row[1]?.trim() ?? "",
      minutes: Number(row[2] ?? 0),
    }));
  }

  async getDay(date: IsoDate): Promise<DaySnapshot | null> {
    const records = (await this.listRecords()).filter((r) => r.date === date);
    if (records.length === 0) return null;
    return {
      date,
      kind: records[0].kind,
      entries: records.map((r) => ({
        memberId: r.memberId,
        state: r.state,
        reviewed: r.reviewed,
        excused: r.excused,
      })),
    };
  }

  async saveDay(date: IsoDate, kind: EventKind, entries: DayEntry[]): Promise<void> {
    const month = monthOf(date);
    if ((await this.listClosedMonths()).includes(month)) throw new MonthClosedError(month);

    const stamp = kstStamp();
    const existing = await this.listRecords();
    const previous = new Map(
      existing.filter((r) => r.date === date).map((r) => [r.memberId, r]),
    );

    const merged: AttendanceRecord[] = [
      ...existing.filter((r) => r.date !== date),
      ...entries.map<AttendanceRecord>((entry) => {
        const before = previous.get(entry.memberId);
        return {
          memberId: entry.memberId,
          date,
          kind,
          state: entry.state,
          reviewed: entry.state === "참여" ? entry.reviewed : false,
          excused: entry.state === "노쇼" ? entry.excused : false,
          recordedAt: before?.recordedAt ?? stamp,
          updatedAt: before ? stamp : undefined,
        };
      }),
    ].sort((a, b) =>
      a.date === b.date ? a.memberId.localeCompare(b.memberId) : a.date.localeCompare(b.date),
    );

    await this.writeAll(
      SHEETS.attendance,
      HEADERS.attendance,
      merged.map((r) => [
        r.memberId,
        r.date,
        r.kind,
        r.state,
        r.state === "참여" ? (r.reviewed ? "Y" : "N") : "-",
        r.state === "노쇼" ? (r.excused ? "Y" : "N") : "-",
        r.recordedAt,
        r.updatedAt ?? "",
      ]),
    );
  }

  async listClosedMonths(): Promise<IsoMonth[]> {
    const rows = await this.readRows(SHEETS.closed, HEADERS.closed);
    return rows.map((row) => row[0].trim()).filter(Boolean);
  }
}
