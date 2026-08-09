import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],

  /**
   * ⚠️ Ship the resvg WASM binary with the render route.
   *
   * `app/api/render/slide` loads `index_bg.wasm` from `node_modules` at
   * runtime, deliberately via a path the bundler cannot statically see —
   * Turbopack tries to bundle a `.wasm` specifier as a module and fails on
   * wasm-bindgen's `wbg` namespace.
   *
   * The cost of hiding it is that **Next's output file tracing can't see it
   * either**, so the binary would be missing from the deployed function and
   * every render would fail with ENOENT — passing locally, where
   * `node_modules` is right there, and only in production. This names the file
   * so it gets traced anyway.
   */
  outputFileTracingIncludes: {
    "/api/render/slide": [
      "./node_modules/@resvg/resvg-wasm/index_bg.wasm",
      // ⚠️ Without these the route renders text-free images and still returns
      // 200 — resvg draws nothing rather than erroring on a missing font.
      "./assets/fonts/*.ttf",
    ],
  },
};

export default nextConfig;
