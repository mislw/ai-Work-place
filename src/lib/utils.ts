import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** 合并 Tailwind class 名，去重并解决冲突。 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** 范围限制。 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** 简单的对象值只读克隆。 */
export function deepReadonly<T>(obj: T): Readonly<T> {
  return obj;
}
