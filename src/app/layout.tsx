import { type Metadata, type Viewport } from "next";
import { Inter } from "next/font/google";
import { Toaster } from "@/components/ui/toaster";
import { ThemeScript } from "@/components/common/theme-script";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "AI 工作站 · Personal AI Workspace",
  description:
    "一个简洁、私密、支持多端同步的个人工作管理平台。日历、待办、笔记、AI 整理。",
  applicationName: "AI 工作站",
  manifest: "/manifest.json",
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/icon-192.png",
  },
  appleWebApp: {
    capable: true,
    title: "AI 工作站",
    statusBarStyle: "default",
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1115" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" suppressHydrationWarning className={inter.variable}>
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-svh bg-background font-sans">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
