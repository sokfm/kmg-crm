import type { MetadataRoute } from "next";

// Επιτρέπει «Προσθήκη στην αρχική οθόνη» στο κινητό, σαν εφαρμογή.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "KMG CRM",
    short_name: "KMG CRM",
    start_url: "/today",
    display: "standalone",
    background_color: "#F4F5F7",
    theme_color: "#14171F",
    lang: "el",
    icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }, { src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
