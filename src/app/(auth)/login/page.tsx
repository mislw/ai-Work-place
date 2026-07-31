import { Suspense } from "react";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginForm />
    </Suspense>
  );
}

function LoginFallback() {
  return (
    <div className="min-h-svh flex items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="h-6 w-32 animate-pulse rounded bg-muted" />
        <div className="mt-6 space-y-3">
          <div className="h-9 animate-pulse rounded bg-muted" />
          <div className="h-9 animate-pulse rounded bg-muted" />
          <div className="h-9 animate-pulse rounded bg-muted" />
        </div>
      </div>
    </div>
  );
}
