// src/app/layout.tsx
import type { Metadata } from "next";
import type { ReactNode } from "react";
import AnalyticsInit from "@/components/AnalyticsInit"; // ★ 追加

export const metadata: Metadata = {
  title: "卒研デモ",
  description: "情報マネージャ",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <AnalyticsInit />  {/* ★ 追加：クライアント側でAnalyticsを安全初期化 */}
        {children}
      </body>
    </html>
  );
}