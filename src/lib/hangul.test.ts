import { describe, expect, it } from "vitest";

import { initials, isInitialsQuery, matchesName } from "./hangul";

describe("초성 추출", () => {
  it("이름의 초성을 뽑는다", () => {
    expect(initials("주원")).toBe("ㅈㅇ");
    expect(initials("푸름")).toBe("ㅍㄹ");
    expect(initials("형섭")).toBe("ㅎㅅ");
    expect(initials("소정")).toBe("ㅅㅈ");
    expect(initials("윤아")).toBe("ㅇㅇ");
  });

  it("한글이 아닌 글자는 그대로 둔다", () => {
    expect(initials("Amy")).toBe("Amy");
    expect(initials("주원2")).toBe("ㅈㅇ2");
  });
});

describe("질의 종류 판별", () => {
  it("자모만 있으면 초성 검색으로 본다", () => {
    expect(isInitialsQuery("ㅈㅇ")).toBe(true);
    expect(isInitialsQuery("ㅎ")).toBe(true);
  });

  it("완성된 음절이 섞이면 초성 검색이 아니다", () => {
    expect(isInitialsQuery("주")).toBe(false);
    expect(isInitialsQuery("ㅈ원")).toBe(false);
    expect(isInitialsQuery("")).toBe(false);
  });
});

describe("이름 검색", () => {
  const names = ["주원", "중현", "푸름", "세정", "세종", "효신", "유주", "소정", "형섭"];
  const find = (q: string) => names.filter((n) => matchesName(n, q));

  it("초성으로 찾는다", () => {
    expect(find("ㅈㅇ")).toEqual(["주원"]);
    expect(find("ㅇㅇ")).toEqual([]);
  });

  it("이름 일부로 찾는다", () => {
    expect(find("원")).toEqual(["주원"]);
    expect(find("세")).toEqual(["세정", "세종"]);
  });

  it("첫 글자가 아니어도 걸린다", () => {
    // 앞에서만 맞추면 "원"으로 "주원"을 못 찾습니다.
    expect(find("주")).toEqual(["주원", "유주"]);
    expect(find("ㅅ")).toEqual(["세정", "세종", "효신", "소정", "형섭"]);
  });

  it("빈 질의는 전부 통과시킨다", () => {
    expect(find("")).toEqual(names);
    expect(find("   ")).toEqual(names);
  });

  it("없는 이름은 빈 결과다", () => {
    expect(find("김철수")).toEqual([]);
  });
});
