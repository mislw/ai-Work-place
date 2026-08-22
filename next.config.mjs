import nextPWA from "next-pwa";

const withPWA = nextPWA({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  register: true,
  skipWaiting: true,
  cacheOnFrontEndNav: false,
  reloadOnOnline: true,
  navigateFallback: "/",
  navigateFallbackDenylist: [/^\/api\//, /^\/assistant(?:\/|$)/],
  runtimeCaching: [
    {
      urlPattern: ({ request, url }) =>
        request.mode === "navigate" &&
        url.origin === self.location.origin &&
        (url.pathname === "/assistant" ||
          url.pathname.startsWith("/assistant/")),
      handler: "NetworkOnly",
      options: { cacheName: "assistant-navigation" },
    },
    {
      urlPattern: ({ request }) =>
        request.destination === "style" ||
        request.destination === "script" ||
        request.destination === "font" ||
        request.destination === "image",
      handler: "StaleWhileRevalidate",
      options: { cacheName: "assets" },
    },
  ],
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    typedRoutes: false,
  },
  images: {
    remotePatterns: [{ protocol: "https", hostname: "*.supabase.co" }],
  },
};

export default withPWA(nextConfig);
