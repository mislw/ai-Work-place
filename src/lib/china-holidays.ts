import { addDays, format, parseISO } from "date-fns";
import { Solar } from "lunar-typescript";

export type ChinaSchedule = "holiday" | "workday";

export interface ChinaDayInfo {
  festival?: string;
  lunarDate?: string;
  lunarLabel?: string;
  schedule?: ChinaSchedule;
  scheduleName?: string;
  solarTerm?: string;
}

interface ScheduleEntry {
  schedule: ChinaSchedule;
  scheduleName: string;
}

const OFFICIAL_SCHEDULE = new Map<string, ScheduleEntry>();

function addHolidayRange(start: string, end: string, name: string) {
  const last = parseISO(end);
  for (let day = parseISO(start); day <= last; day = addDays(day, 1)) {
    OFFICIAL_SCHEDULE.set(format(day, "yyyy-MM-dd"), {
      schedule: "holiday",
      scheduleName: name,
    });
  }
}

function addAdjustedWorkday(date: string, name: string) {
  OFFICIAL_SCHEDULE.set(date, {
    schedule: "workday",
    scheduleName: `${name}调休`,
  });
}

// 国务院办公厅关于 2026 年部分节假日安排的通知，2025-11-04。
addHolidayRange("2026-01-01", "2026-01-03", "元旦");
addAdjustedWorkday("2026-01-04", "元旦");
addHolidayRange("2026-02-15", "2026-02-23", "春节");
addAdjustedWorkday("2026-02-14", "春节");
addAdjustedWorkday("2026-02-28", "春节");
addHolidayRange("2026-04-04", "2026-04-06", "清明节");
addHolidayRange("2026-05-01", "2026-05-05", "劳动节");
addAdjustedWorkday("2026-05-09", "劳动节");
addHolidayRange("2026-06-19", "2026-06-21", "端午节");
addHolidayRange("2026-09-25", "2026-09-27", "中秋节");
addHolidayRange("2026-10-01", "2026-10-07", "国庆节");
addAdjustedWorkday("2026-09-20", "国庆节");
addAdjustedWorkday("2026-10-10", "国庆节");

const SOLAR_FESTIVALS: Record<string, string> = {
  "01-01": "元旦",
  "05-01": "劳动节",
  "10-01": "国庆节",
};

const TRADITIONAL_FESTIVALS: Record<string, string> = {
  春节: "春节",
  元宵节: "元宵",
  端午节: "端午",
  七夕节: "七夕",
  中元节: "中元",
  中秋节: "中秋",
  重阳节: "重阳",
  腊八节: "腊八",
  小年: "小年",
  除夕: "除夕",
};

export function getChinaDayInfo(date: string): ChinaDayInfo {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return {};

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const solar = Solar.fromYmd(year, month, day);
  const lunar = solar.getLunar();
  const lunarMonth = `${lunar.getMonthInChinese()}月`;
  const lunarDay = lunar.getDayInChinese();
  const lunarFestival = lunar
    .getFestivals()
    .map((name) => TRADITIONAL_FESTIVALS[name])
    .find(Boolean);
  const festival =
    SOLAR_FESTIVALS[`${match[2]}-${match[3]}`] ??
    lunarFestival ??
    (lunar.getJieQi() === "清明" ? "清明" : undefined);
  const solarTerm = lunar.getJieQi() || undefined;
  const schedule = OFFICIAL_SCHEDULE.get(date);

  return {
    ...(festival ? { festival } : {}),
    lunarDate: `农历${lunarMonth}${lunarDay}`,
    lunarLabel: lunar.getDay() === 1 ? lunarMonth : lunarDay,
    ...(schedule ?? {}),
    ...(solarTerm && solarTerm !== festival ? { solarTerm } : {}),
  };
}
