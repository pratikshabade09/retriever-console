import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // A standalone build bundles only the files a Docker image actually needs to run — far
  // smaller than shipping the whole node_modules tree.
  output: "standalone",
  // Pins Turbopack's workspace root to this project instead of letting it search upward and
  // possibly land on an unrelated lockfile outside the repo.
  turbopack: {
    root: path.resolve(__dirname),
  },
  // better-sqlite3 is a native addon — bundling it would break the compiled binary, so it
  // must stay an external require resolved at runtime instead.
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
