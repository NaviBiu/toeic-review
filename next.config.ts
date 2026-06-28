import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse pulls in pdfjs-dist, which loads @napi-rs/canvas's native
  // binary via a runtime platform check Next.js's serverless file-tracer
  // can't follow statically -- excluding the binary from the deployed
  // bundle and crashing with "ReferenceError: DOMMatrix is not defined"
  // in production while working fine locally. Marking these external
  // makes Next.js leave them as plain Node `require()`s instead of trying
  // to trace/bundle them, so Node's own module resolution finds the
  // binary at runtime.
  serverExternalPackages: ["pdf-parse", "pdfjs-dist", "@napi-rs/canvas"],
  // Marking the packages external (above) stops Next.js from bundling them,
  // but the actual platform-specific @napi-rs/canvas-* native .node binary
  // still has to physically end up inside the deployed function -- and
  // Next.js's automatic file tracer doesn't follow @napi-rs/canvas's
  // runtime require(`@napi-rs/canvas-${platform}-${arch}`) call to find it.
  // Force-include every platform variant; Vercel's Linux build only ever
  // installs the one that matches its own runtime anyway.
  outputFileTracingIncludes: {
    "/api/knowledge-points/import": ["./node_modules/@napi-rs/canvas-*/**/*"],
  },
};

export default nextConfig;
