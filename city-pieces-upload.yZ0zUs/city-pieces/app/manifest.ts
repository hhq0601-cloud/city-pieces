import type { MetadataRoute } from "next";
export const dynamic = "force-static";
export default function manifest(): MetadataRoute.Manifest {
  return { name: "City Pieces 城市拼图", short_name: "城市拼图", description: "把收藏的城市地点拼成一张旅行地图", start_url: "/", display: "standalone", background_color: "#F4F3EF", theme_color: "#F4F3EF", orientation: "portrait", icons: [{ src: "/city-pieces-daycycle-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" }, { src: "/city-pieces-daycycle-icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }, { src: "/apple-touch-icon-v3.png", sizes: "180x180", type: "image/png", purpose: "any" }] };
}
