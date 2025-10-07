"use client";

import { useEffect } from "react";
import { getAnalyticsClient } from "@/lib/firebase";

/**
 * Firebase Analytics のクライアント初期化を安全に実行
 * layout.tsx などで一度だけ呼び出す
 */
export default function AnalyticsInit() {
  useEffect(() => {
    // measurementId 未設定 or 非対応ブラウザなら何もしない
    getAnalyticsClient().catch(() => {});
  }, []);

  return null;
}
