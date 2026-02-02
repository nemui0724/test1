import { useMemo } from "react";
import Fuse from "fuse.js";

type UseFuseSearchParams<T> = {
  items: T[];
  search: string;
  keys: string[];
  threshold?: number;
  distance?: number;
};

export function useFuseSearch<T>({
  items,
  search,
  keys,
  threshold = 0.4,
  distance = 100,
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


