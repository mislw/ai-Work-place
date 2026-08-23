import { isPreviewAuthEnabled } from "@/lib/auth/preview";

export function getAppNow(): Date {
  const previewNow = process.env.NEXT_PUBLIC_PREVIEW_NOW;
  if (isPreviewAuthEnabled() && previewNow) {
    const parsed = new Date(previewNow);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}
