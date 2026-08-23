export default function AppLoading() {
  return (
    <div
      className="mx-auto w-full max-w-6xl animate-pulse px-4 py-5 sm:px-6 sm:py-6"
      role="status"
      aria-label="页面加载中"
    >
      <div className="h-7 w-32 rounded bg-muted" />
      <div className="mt-3 h-4 w-64 max-w-full rounded bg-muted/70" />
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="h-32 rounded-md bg-muted/70" />
        <div className="h-32 rounded-md bg-muted/70" />
      </div>
      <div className="mt-4 h-56 rounded-md bg-muted/60" />
      <span className="sr-only">正在加载页面</span>
    </div>
  );
}
