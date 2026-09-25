/**
 * Next.js startup hook: validate configuration before serving any request
 * (a production server with missing/weak secrets must not start half-configured)
 * and start the alert scheduler. Node-only code lives in instrumentation-node.ts;
 * the NEXT_RUNTIME check lets the bundler drop it from the edge build.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startNode } = await import("./instrumentation-node");
    startNode();
  }
}
