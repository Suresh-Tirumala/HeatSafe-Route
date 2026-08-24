import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import * as maplibregl from "maplibre-gl";
import App from "./App";
import { ThemeProvider } from "./ThemeProvider";
import "./index.css";

// MapLibre v6 resolves its worker relative to its own (Vite-pre-bundled)
// module URL, which does not exist under `node_modules/.vite/deps/`.
// Point it at the real worker shipped in /public so GeoJSON sources,
// clustering and tile processing work in both dev and production builds.
maplibregl.setWorkerUrl("/maplibre-gl-worker.mjs");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>
);
