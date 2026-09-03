import { NextResponse } from "next/server";

import { monthOf } from "@/lib/date";
import { MonthClosedError, getStore } from "@/lib/store";
import type { DayEntry, EventKind } from "@/lib/types";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

interface SaveBody {
  kind?: unknown;
  entries?: unknown;
}

function parseEntries(raw: unknown): DayEntry[] | string {
  if (!Array.isArray(raw)) return "entries 가 배열이 아닙니다.";
  const entries: DayEntry[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) return "entries 항목이 객체가 아닙니다.";
    const { memberId, state, excused } = item as Record<string, unknown>;
    if (typeof memberId !== "string" || !memberId) return "memberId 가 없습니다.";
    if (state !== "참여" && state !== "노쇼") return `상태 "${String(state)}" 는 참여/노쇼만 됩니다.`;
    entries.push({
      memberId,
      state,
      excused: excused === true,
    });
  }
  const ids = new Set(entries.map((e) => e.memberId));
  if (ids.size !== entries.length) return "같은 사람이 두 번 들어 있습니다.";
  return entries;
}

export async function GET(_request: Request, context: { params: Promise<{ date: string }> }) {
  const { date } = await context.params;
  if (!ISO_DATE.test(date)) {
    return NextResponse.json({ error: "날짜 형식이 YYYY-MM-DD 가 아닙니다." }, { status: 400 });
  }

  const store = getStore();
  try {
    const month = monthOf(date);
    const [snapshot, closedMonths, monthTabExists] = await Promise.all([
      store.getDay(date),
      store.listClosedMonths(),
      store.hasMonthTab(month),
    ]);
    return NextResponse.json({
      snapshot,
      closed: closedMonths.includes(month),
      monthTabExists,
      month,
    });
  } catch (error) {
    return NextResponse.json({ error: messageOf(error) }, { status: 500 });
  }
}

export async function PUT(request: Request, context: { params: Promise<{ date: string }> }) {
  const { date } = await context.params;
  if (!ISO_DATE.test(date)) {
    return NextResponse.json({ error: "날짜 형식이 YYYY-MM-DD 가 아닙니다." }, { status: 400 });
  }

  let body: SaveBody;
  try {
    body = (await request.json()) as SaveBody;
  } catch {
    return NextResponse.json({ error: "본문을 JSON으로 읽을 수 없습니다." }, { status: 400 });
  }

  const kind: EventKind = body.kind === "정기" ? "정기" : "일반";
  const entries = parseEntries(body.entries);
  if (typeof entries === "string") {
    return NextResponse.json({ error: entries }, { status: 400 });
  }

  try {
    await getStore().saveDay(date, kind, entries);
    return NextResponse.json({ saved: entries.length });
  } catch (error) {
    // 확정된 달은 고치면 끝난 추첨 결과가 뒤집히므로 막습니다.
    if (error instanceof MonthClosedError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json({ error: messageOf(error) }, { status: 500 });
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "알 수 없는 오류가 났습니다.";
}
