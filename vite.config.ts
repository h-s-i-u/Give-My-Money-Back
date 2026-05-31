import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // Generate a service worker that auto-updates in the background and
      // takes over on the next visit (no manual "new version" prompt needed).
      registerType: "autoUpdate",
      // Static assets (outside the JS/CSS bundle) the SW should precache.
      includeAssets: ["favicon.svg", "icons/apple-touch-icon-180x180.png"],
      manifest: {
        name: "Split Bill App",
        short_name: "SplitBill",
        description: "Split bills together with friends — no signup needed.",
        // Match the dark-tech UI: slate-950 background, slate-950 chrome.
        theme_color: "#020617",
        background_color: "#020617",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        scope: "/",
        icons: [
          { src: "/icons/pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/pwa-512x512.png", sizes: "512x512", type: "image/png" },
          {
            // Adaptive icon for Android (content kept inside the safe zone).
            src: "/icons/maskable-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      // Lets you test the PWA (manifest + SW) with `npm run dev`. Safe to keep;
      // it only enables the dev service worker locally.
      devOptions: { enabled: true },
    }),
  ],
});
