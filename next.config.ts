// next.config.ts

const nextConfig = {
  reactStrictMode: true, // 必要に応じて
  experimental: {
    appDir: true, // App Router を使っているなら
  },

  // 開発環境でのクロスオリジン警告を抑える
  // Vercel 本番デプロイでは不要なので削除しても OK
  allowedDevOrigins: [
    "https://3000-firebase-test-1759060727505.cluster-iktsryn7xnhpexlu6255bftka4.cloudworkstations.dev",
  ],
};

export default nextConfig;