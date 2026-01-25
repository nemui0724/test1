"use client";

import { useEffect } from "react";
import { getAnalyticsClient } from "@/lib/firebase";

export default function AnalyticsInit() {
  useEffect(() => {
    getAnalyticsClient().catch(() => {});
  }, []);

  return null;
}
