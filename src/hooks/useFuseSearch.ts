// src/hooks/useFuseSearch.ts
import { useMemo } from "react";
import Fuse from "fuse.js";

type UseFuseSearchParams<T> = {
  items: T[];
  search: string;
  keys: string[];     // 検索対象にするフィールド名
  threshold?: number; // あいまい度（0〜1）
  distance?: number;  // どれくらい離れた位置まで許容するか
};

export function useFuseSearch<T>({
  items,
  search,
  keys,
  threshold = 0.5,
  distance = 100,  // ← タイプミスに少し強くする
}: UseFuseSearchParams<T>): T[] {
  const fuse = useMemo(() => {
    if (!items.length) return null;
    return new Fuse(items, {
      keys,
      threshold,
      ignoreLocation: true,
      distance,
    });
  }, [items, keys, threshold, distance]);

  const results = useMemo(() => {
    const q = search.trim();
    if (!q) return items;
    if (!fuse) return items;
    return fuse.search(q).map((r) => r.item);
  }, [search, fuse, items]);

  return results;
}


