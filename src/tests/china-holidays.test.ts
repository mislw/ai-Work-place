import { describe, expect, it } from "vitest";
import { getChinaDayInfo } from "@/lib/china-holidays";

describe("China holiday calendar data", () => {
  it("marks official 2026 holidays and adjusted workdays", () => {
    expect(getChinaDayInfo("2026-02-17")).toMatchObject({
      festival: "春节",
      schedule: "holiday",
      scheduleName: "春节",
    });
    expect(getChinaDayInfo("2026-02-14")).toMatchObject({
      schedule: "workday",
      scheduleName: "春节调休",
    });
    expect(getChinaDayInfo("2026-10-01")).toMatchObject({
      schedule: "holiday",
      scheduleName: "国庆节",
    });
  });

  it("calculates common traditional festivals beyond statutory holidays", () => {
    expect(getChinaDayInfo("2026-08-19")).toMatchObject({
      festival: "七夕",
      lunarLabel: "初七",
      lunarDate: "农历七月初七",
    });
  });

  it("provides compact lunar dates and solar terms for the month grid", () => {
    expect(getChinaDayInfo("2026-08-07")).toMatchObject({
      lunarLabel: "廿五",
      solarTerm: "立秋",
    });
    expect(getChinaDayInfo("2026-08-13")).toMatchObject({
      lunarLabel: "七月",
      lunarDate: "农历七月初一",
    });
  });

  it("does not invent an official schedule for unsupported years", () => {
    const info = getChinaDayInfo("2027-01-01");

    expect(info.schedule).toBeUndefined();
    expect(info.scheduleName).toBeUndefined();
  });
});
