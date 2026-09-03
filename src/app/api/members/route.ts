import { NextResponse } from "next/server";

import { kstToday } from "@/lib/date";
import { getStore } from "@/lib/store";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET() {
  try {
    return NextResponse.json({ members: await getStore().listMembers() });
  } catch (error) {
    return NextResponse.json({ error: messageOf(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let body: { name?: unknown; joinedOn?: unknown };
  try {
    body = (await request.json()) as { name?: unknown; joinedOn?: unknown };
  } catch {
    return NextResponse.json({ error: "본문을 JSON으로 읽을 수 없습니다." }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "이름을 입력해주세요." }, { status: 400 });
  }
  if (name.length > 20) {
    return NextResponse.json({ error: "이름이 너무 깁니다." }, { status: 400 });
  }

  const joinedOn =
    typeof body.joinedOn === "string" && ISO_DATE.test(body.joinedOn)
      ? body.joinedOn
      : kstToday();

  try {
    const store = getStore();
    const existing = await store.listMembers();
    // 같은 이름이 이미 있으면 새 ID를 발급해도 되는지 사람이 판단해야 합니다.
    // 동명이인일 수도, 중복 추가일 수도 있어서 자동으로 정하지 않습니다.
    const duplicate = existing.find((m) => m.name === name);
    if (duplicate) {
      return NextResponse.json(
        {
          error: `"${name}" 은 이미 명단에 있습니다 (${duplicate.id}). 동명이인이면 시트에서 직접 추가해주세요.`,
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ member: await store.addMember(name, joinedOn) });
  } catch (error) {
    return NextResponse.json({ error: messageOf(error) }, { status: 500 });
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "알 수 없는 오류가 났습니다.";
}
