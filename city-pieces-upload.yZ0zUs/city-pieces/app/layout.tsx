import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "City Pieces 城市拼图",
  description: "在一张地图上整理旅行收藏，安排顺路的每日行程。",
  applicationName: "City Pieces",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "城市拼图" },
  formatDetection: { telephone: false },
  icons: { icon: "/favicon-v3.png", apple: "/apple-touch-icon-v3.png" },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, maximumScale: 1, viewportFit: "cover", themeColor: [{ media: "(prefers-color-scheme: light)", color: "#F4F3EF" }, { media: "(prefers-color-scheme: dark)", color: "#151514" }] };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
