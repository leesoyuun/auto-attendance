import { NextResponse } from "next/server";

import { RULES } from "@/lib/scoring";
import { getStore } from "@/lib/store";
import type { SoloRun } from "@/lib/types";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** 혼뛰 후기 목록. 점수 인정 기준(40분)도 함께 알려줍니다. */
export async function GET() {
  try {
    return NextResponse.json({
      runs: await getStore().listSoloRuns(),
      minMinutes: RULES.soloMinMinutes,
      points: RULES.soloPoints,
      weeklyCap: RULES.weeklySoloCap,
    });
  } catch (error) {
    return NextResponse.json({ error: messageOf(error) }, { status: 500 });
  }
}

function parseRun(raw: unknown): SoloRun | string {
  if (typeof raw !== "object" || raw === null) return "본문이 객체가 아닙니다.";
  const { memberId, date, minutes } = raw as Record<string, unknown>;
  if (typeof memberId !== "string" || !memberId.trim()) return "이름이 없습니다.";
  if (typeof date !== "string" || !ISO_DATE.test(date)) {
    return "date 가 YYYY-MM-DD 형식이 아닙니다.";
  }
  const mins = Number(minutes);
  if (!Number.isFinite(mins) || mins <= 0) return "시간(분)을 숫자로 입력해주세요.";
  if (mins > 1000) return "시간이 너무 깁니다.";
  return { memberId: memberId.trim(), date, minutes: Math.round(mins) };
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "본문을 JSON으로 읽을 수 없습니다." }, { status: 400 });
  }

  const run = parseRun(body);
  if (typeof run === "string") return NextResponse.json({ error: run }, { status: 400 });

  try {
    await getStore().addSoloRun(run);
    return NextResponse.json({
      run,
      // 40분 미달은 기록은 남지만 점수가 붙지 않습니다. 화면에서 알려줘야 합니다.
      counted: run.minutes >= RULES.soloMinMinutes,
    });
  } catch (error) {
    return NextResponse.json({ error: messageOf(error) }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "본문을 JSON으로 읽을 수 없습니다." }, { status: 400 });
  }

  const run = parseRun(body);
  if (typeof run === "string") return NextResponse.json({ error: run }, { status: 400 });

  try {
    const deleted = await getStore().deleteSoloRun(run);
    if (!deleted) {
      return NextResponse.json({ error: "해당 기록을 찾지 못했습니다." }, { status: 404 });
    }
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return NextResponse.json({ error: messageOf(error) }, { status: 500 });
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "알 수 없는 오류가 났습니다.";
}
