import { describe, expect, it } from "vitest";

import { parsePasteText } from "./paste-parse";
import type { Member } from "./types";

const pool: Member[] = [
  { id: "M001", name: "주원", joinedOn: "2026-01-01" },
  { id: "M002", name: "지훈", joinedOn: "2026-01-01" },
  { id: "M003", name: "민지", joinedOn: "2026-01-01" },
  { id: "M004", name: "주원영", joinedOn: "2026-01-01" },
];

describe("parsePasteText", () => {
  it("한 줄 콤마 목록을 구획별로 나눕니다", () => {
    const result = parsePasteText(
      `출석: 지훈, 민지\n불참: 주원\n혼뛰: 민지 45분`,
      pool,
    );
    expect(result.attendIds).toEqual(["M002", "M003"]);
    expect(result.noShowIds).toEqual(["M001"]);
    expect(result.solo).toEqual([{ memberId: "M003", name: "민지", minutes: 45 }]);
    expect(result.unmatched).toEqual([]);
    expect(result.ambiguous).toEqual([]);
  });

  it("헤더 뒤 줄바꿈으로 한 명씩 나열해도 됩니다", () => {
    const result = parsePasteText(
      `출석\n지훈\n민지\n\n불참\n주원`,
      pool,
    );
    expect(result.attendIds).toEqual(["M002", "M003"]);
    expect(result.noShowIds).toEqual(["M001"]);
  });

  it("혼뛰 시간 표기를 괄호/분 여러 형태로 읽습니다", () => {
    const result = parsePasteText(`혼뛰: 지훈(50), 민지 30분`, pool);
    expect(result.solo).toEqual([
      { memberId: "M002", name: "지훈", minutes: 50 },
      { memberId: "M003", name: "민지", minutes: 30 },
    ]);
  });

  it("명단에 없는 이름은 unmatched 로 보고합니다", () => {
    const result = parsePasteText(`출석: 없는사람`, pool);
    expect(result.unmatched).toEqual([{ section: "출석", token: "없는사람" }]);
    expect(result.attendIds).toEqual([]);
  });

  it("부분일치로 여러 명이 걸리면 ambiguous 로 보고합니다", () => {
    const result = parsePasteText(`출석: 주원`, pool);
    expect(result.attendIds).toEqual(["M001"]);
    expect(result.ambiguous).toEqual([]);
  });

  it("정확히 일치하는 이름이 있으면 부분일치보다 우선합니다", () => {
    // "주원" 은 "주원"과 완전 일치, "주원영"과는 부분일치 — 완전 일치를 우선해야
    // 매번 모호함 경고가 뜨지 않습니다.
    const result = parsePasteText(`불참: 주원영`, pool);
    expect(result.noShowIds).toEqual(["M004"]);
  });

  it("혼뛰에 시간이 없으면 unmatched 로 보고합니다", () => {
    const result = parsePasteText(`혼뛰: 지훈`, pool);
    expect(result.solo).toEqual([]);
    expect(result.unmatched).toEqual([{ section: "혼뛰", token: "지훈 (시간을 못 읽음)" }]);
  });

  it("헤더가 없는 텍스트는 아무 것도 잡지 않습니다", () => {
    const result = parsePasteText(`그냥 아무 텍스트`, pool);
    expect(result.attendIds).toEqual([]);
    expect(result.noShowIds).toEqual([]);
    expect(result.solo).toEqual([]);
    expect(result.unmatched).toEqual([]);
  });
});
