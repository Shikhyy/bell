import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The research CSVs are read with fs at request time; make sure serverless builds bundle them.
  outputFileTracingIncludes: { "/**": ["./data/**"] },
};

export default nextConfig;
