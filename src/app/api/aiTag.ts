export type Draft = {
  title: string;
  type: "account" | "todo" | "subscription" | "memo" | string;
  url?: string;
  username?: string;
  note?: string;
};

export type AiTagResponse = {
  tags: string[];
  summary: string;
  confidence: number;
  model?: string;

  fallback?: boolean;

  error?: string;

  raw?: unknown;
};

export type Options = {

  allowFallback?: boolean;

  trace?: boolean;

  endpoint?: string;
};

const safeString = (x: unknown) => {
  if (typeof x === "string") return x;
  try {
    return JSON.stringify(x);
  } catch {
    return String(x);
  }
};

const trimPreview = (s: string, max = 400) =>
  s.length > max ? s.slice(0, max) + " …(truncated)" : s;

export async function aiTag(draft: Draft, opts: Options = {}) {
  const {
    allowFallback = false,
    trace = false,
    endpoint = "/api/ai-tag",
  } = opts;

  const contentLen =
    (draft.title?.trim().length || 0) + (draft.note?.trim().length || 0);
  if (contentLen < 3) {
    throw new Error("タイトル/メモが短すぎます（3文字以上にしてください）");
  }

  const url = `${endpoint}${trace ? "?trace=1" : ""}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
  } catch (e: unknown) {
    throw new Error(
      `AIタグAPIへの通信に失敗しました（fetch失敗）: ${e instanceof Error ? e.message : safeString(e)}`
    );
  }

  let data: AiTagResponse | null = null;
  let textBody = "";

  try {
    data = (await res.json()) as AiTagResponse;
  } catch {
    try {
      textBody = await res.text();
    } catch {
      textBody = "";
    }
    throw new Error(
      `AIタグAPIのレスポンスを解析できません（HTTP ${res.status}）。本文: ${trimPreview(
        textBody || "(empty)"
      )}`
    );
  }

  if (!res.ok) {
    throw new Error(
      data?.error ||
        `AIタグAPIエラー（HTTP ${res.status} ${res.statusText}）`
    );
  }

  if (!Array.isArray(data.tags) || data.tags.length === 0) {
    const rawHint =
      trace && data.raw !== undefined ? ` / raw=${trimPreview(safeString(data.raw), 600)}` : "";
    throw new Error(`AIタグが生成されませんでした（tags: []）${rawHint}`);
  }

  if (!allowFallback && data.fallback) {
    const m = data.model || "unknown";
    const err = data.error ? ` / error=${data.error}` : "";
    const rawHint =
      trace && data.raw !== undefined ? ` / raw=${trimPreview(safeString(data.raw), 600)}` : "";
    throw new Error(
      `AI生成に失敗しヒューリスティックにフォールバックしました（model=${m}）。${err}${rawHint}`
    );
  }

  return data;
}

  