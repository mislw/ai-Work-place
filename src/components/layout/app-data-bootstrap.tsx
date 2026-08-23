"use client";

import { useBootstrapData } from "@/hooks/use-bootstrap-data";
import { isPreviewAuthEnabled } from "@/lib/auth/preview";
import { isSupabaseBrowserConfigured } from "@/lib/supabase/client";

export function AppDataBootstrap() {
  if (!isPreviewAuthEnabled() && !isSupabaseBrowserConfigured()) return null;
  return <ConfiguredAppDataBootstrap />;
}

function ConfiguredAppDataBootstrap() {
  useBootstrapData();
  return null;
}
