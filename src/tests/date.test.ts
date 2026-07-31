import { describe, expect, it } from "vitest";
import {
  greeting,
  formatChineseDate,
  chineseWeekday,
  dateKey,
  thisWeekRange,
  hhmmToMinutes,
  minutesToHHmm,
} from "@/lib/date";

describe("date utils", () => {
  it("greeting 按时段返回", () => {
    expect(greeting(new Date("2026-07-31T03:00:00"))).toBe("夜深了");
    expect(greeting(new Date("2026-07-31T08:00:00"))).toBe("早上好");
    expect(greeting(new Date("2026-07-31T12:30:00"))).toBe("中午好");
    expect(greeting(new Date("2026-07-31T15:00:00"))).toBe("下午好");
    expect(greeting(new Date("2026-07-31T20:00:00"))).toBe("晚上好");
  });

  it("formatChineseDate 输出中文日期", () => {
    expect(formatChineseDate(new Date("2026-07-31"))).toBe("2026 年 7 月 31 日");
  });

  it("chineseWeekday", () => {
    expect(chineseWeekday(new Date("2026-07-31"))).toBe("星期五");
    expect(chineseWeekday(new Date("2026-08-02"))).toBe("星期日");
  });

  it("dateKey", () => {
    expect(dateKey(new Date("2026-07-31T15:00:00"))).toBe("2026-07-31");
  });

  it("thisWeekRange 包含 7 天", () => {
    const { start, end } = thisWeekRange(new Date("2026-07-31"));
    const ms = end.getTime() - start.getTime();
    expect(Math.round(ms / 86_400_000)).toBe(6);
  });

  it("hhmmToMinutes / minutesToHHmm 互转", () => {
    expect(hhmmToMinutes("09:30")).toBe(9 * 60 + 30);
    expect(minutesToHHmm(570)).toBe("09:30");
    expect(hhmmToMinutes("not-a-time")).toBeNull();
  });
});
