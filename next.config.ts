import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Avatar hosts for the sign-in providers surfaced on the settings page.
    remotePatterns: [
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      { protocol: "https", hostname: "*.cloudfront.net" },
    ],
  },
};

export default nextConfig;
