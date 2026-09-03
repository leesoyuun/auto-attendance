import { NextResponse } from "next/server";

import { monthOf } from "@/lib/date";
import { getStore } from "@/lib/store";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 시트에서 다시 읽어옵니다.
 *
 * **시트가 원본입니다.** 앱은 요청 수를 줄이려고 명단과 탭 배치를 캐시하는데,
 * 그 사이 누군가 시트를 직접 고치면 앱이 옛 값을 보게 됩니다. 이 경로는 캐시를
 * 버리고 명단과 그 날 기록을 한 번에 새로 가져옵니다.
 */
export async function POST(request: Request) {
  let body: { date?: unknown };
  try {
    body = (await request.json()) as { date?: unknown };
  } catch {
    return NextResponse.json({ error: "본문을 JSON으로 읽을 수 없습니다." }, { status: 400 });
  }

  const date = typeof body.date === "string" ? body.date : "";
  if (!ISO_DATE.test(date)) {
    return NextResponse.json({ error: "date 가 YYYY-MM-DD 형식이 아닙니다." }, { status: 400 });
  }

  try {
    const store = getStore();
    await store.refresh();

    const month = monthOf(date);
    const [members, snapshot, closedMonths, monthTabExists] = await Promise.all([
      store.listMembers(),
      store.getDay(date),
      store.listClosedMonths(),
      store.hasMonthTab(month),
    ]);

    return NextResponse.json({
      members,
      snapshot,
      closed: closedMonths.includes(month),
      monthTabExists,
      month,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "알 수 없는 오류가 났습니다." },
      { status: 500 },
    );
  }
}
