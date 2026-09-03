import { NextResponse } from "next/server";

import { getStore } from "@/lib/store";

const MONTH = /^\d{4}-\d{2}$/;

/** 그 달 탭이 있는지 확인합니다. 화면이 추가 버튼을 띄울지 정하는 데 씁니다. */
export async function GET(request: Request) {
  const month = new URL(request.url).searchParams.get("month") ?? "";
  if (!MONTH.test(month)) {
    return NextResponse.json({ error: "month 가 YYYY-MM 형식이 아닙니다." }, { status: 400 });
  }
  try {
    return NextResponse.json({ month, exists: await getStore().hasMonthTab(month) });
  } catch (error) {
    return NextResponse.json({ error: messageOf(error) }, { status: 500 });
  }
}

/**
 * 그 달 탭을 만듭니다.
 *
 * 자동으로 만들지 않고 버튼을 눌렀을 때만 실행합니다. 탭 생성은 시트를 바꾸는
 * 일이라, 페이지를 열었을 뿐인데 시트가 변경되면 안 됩니다.
 */
export async function POST(request: Request) {
  let body: { month?: unknown };
  try {
    body = (await request.json()) as { month?: unknown };
  } catch {
    return NextResponse.json({ error: "본문을 JSON으로 읽을 수 없습니다." }, { status: 400 });
  }

  const month = typeof body.month === "string" ? body.month : "";
  if (!MONTH.test(month)) {
    return NextResponse.json({ error: "month 가 YYYY-MM 형식이 아닙니다." }, { status: 400 });
  }

  try {
    const result = await getStore().createMonthTab(month);
    return NextResponse.json({ month, ...result });
  } catch (error) {
    return NextResponse.json({ error: messageOf(error) }, { status: 500 });
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "알 수 없는 오류가 났습니다.";
}
