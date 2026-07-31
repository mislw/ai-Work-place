import { format, getISOWeek, startOfDay, subDays } from "date-fns";
import { zhCN, enUS } from "date-fns/locale";

export const CHINESE_WEEKDAYS = [
  "星期日",
  "星期一",
  "星期二",
  "星期三",
  "星期四",
  "星期五",
  "星期六",
] as const;

export type LocaleMode = "zh" | "en";

/** 获得日期的中文星期。 */
export function chineseWeekday(date: Date): string {
  return CHINESE_WEEKDAYS[date.getDay()] ?? "";
}

/** 完整中文日期，例如 2026 年 7 月 31 日。 */
export function formatChineseDate(date: Date): string {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  return `${y} 年 ${m} 月 ${d} 日`;
}

/** 根据小时数返回问候语。 */
export function greeting(date: Date = new Date()): string {
  const h = date.getHours();
  if (h < 5) return "夜深了";
  if (h < 11) return "早上好";
  if (h < 13) return "中午好";
  if (h < 18) return "下午好";
  return "晚上好";
}

/** yyyy-MM-dd 形式日期键。 */
export function dateKey(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

/** 计算本周起止（周一开始）。 */
export function thisWeekRange(reference: Date = new Date()): {
  start: Date;
  end: Date;
} {
  const day = reference.getDay();
  const diff = day === 0 ? 6 : day - 1; // 周一为起点
  const start = startOfDay(subDays(reference, diff));
  const end = startOfDay(subDays(start, -6));
  return { start, end };
}

/** ISO 周数。 */
export function isoWeek(date: Date): number {
  return getISOWeek(date);
}

/** HH:mm 字符串 -> 分钟数。 */
export function hhmmToMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
  const parts = value.split(":");
  if (parts.length !== 2) return null;
  const h = Number.parseInt(parts[0] ?? "", 10);
  const m = Number.parseInt(parts[1] ?? "", 10);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

export function minutesToHHmm(total: number): string {
  const h = Math.floor(total / 60).toString().padStart(2, "0");
  const m = (total % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

export { format, zhCN, enUS };
