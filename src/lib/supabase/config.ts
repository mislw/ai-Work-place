export function getServerSupabaseUrl() {
  return (
    process.env.SUPABASE_INTERNAL_URL ??
    process.env.NEXT_PUBLIC_SUPABASE_URL
  );
}

export function getSupabaseAuthCookieName() {
  const publicUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!publicUrl) {
    throw new Error("Supabase 未配置：缺少 NEXT_PUBLIC_SUPABASE_URL");
  }
  const hostname = new URL(publicUrl).hostname;
  return `sb-${hostname.split(".")[0]}-auth-token`;
}
