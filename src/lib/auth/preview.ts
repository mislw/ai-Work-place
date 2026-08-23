export function isPreviewAuthEnabled(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.NEXT_PUBLIC_ENABLE_AUTH_PREVIEW === "true"
  );
}
