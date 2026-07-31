import nextPWA from "next-pwa";

const withPWA = nextPWA({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  register: true,
  skipWaiting: true,
  cacheOnFrontEndNav: true,
  reloadOnOnline: true,
  navigateFallback: "/",
  navigateFallbackDenylist: [/^\/api\//],
  runtimeCaching: [
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
