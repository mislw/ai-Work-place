import {
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { describe, expect, it } from "vitest";

describe("calendar weekday alignment", () => {
  it("places August 2026 dates under the correct Monday-first weekday", () => {
    const cursor = new Date(2026, 7, 22);
    const monthStart = startOfMonth(cursor);
    const days = eachDayOfInterval({
      start: startOfWeek(monthStart, { weekStartsOn: 1 }),
      end: endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 }),
    });

    expect(days[5]).toEqual(new Date(2026, 7, 1));
    expect(days[26]).toEqual(new Date(2026, 7, 22));
    expect(days[5]?.getDay()).toBe(6);
    expect(days[26]?.getDay()).toBe(6);
  });
});
