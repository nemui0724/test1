// src/app/api/aiTag.ts

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

  // サーバ(route.ts)がfallback時に付ける
  fallback?: boolean;

  // サーバ(route.ts)がエラー詳細を入れる（あれば）
  error?: string;

  // trace=1 の時に route.ts 側が返すことがある（デバッグ用）
  raw?: unknown;
};

export type Options = {
  /**
   * true にすると fallback: true を許可する（=ヒューリスティックでも受け入れる）
   * 既定: false（AI失敗は弾く）
   */
  allowFallback?: boolean;

  /**
   * true にすると /api/ai-tag?trace=1 を叩く
   * route.ts 側で raw を返す実装があれば、それも受け取れる
   */
  trace?: boolean;

  /**
   * APIパスを変えたい時用（テスト/将来の変更用）
   * 既定: "/api/ai-tag"
   */
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

  // 入力ガード：短すぎると毎回同じタグになりがち
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
    // ネットワークレベル（DNS / CORS / 接続失敗など）
    throw new Error(
      `AIタグAPIへの通信に失敗しました（fetch失敗）: ${e instanceof Error ? e.message : safeString(e)}`
    );
  }

  // サーバは基本JSONを返す想定なので、本文も検査する
  let data: AiTagResponse | null = null;
  let textBody = "";

  try {
    // JSONが壊れてるとここで落ちる
    data = (await res.json()) as AiTagResponse;
  } catch {
    // JSONでない場合に備えて本文のプレビューを取る
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

  // HTTPエラーはそのまま表示（サーバがerrorを返してる想定）
  if (!res.ok) {
    throw new Error(
      data?.error ||
        `AIタグAPIエラー（HTTP ${res.status} ${res.statusText}）`
    );
  }

  // tags が無い/空は未採用（保存しない）
  if (!Array.isArray(data.tags) || data.tags.length === 0) {
    // traceで raw が返ってきてたら出す
    const rawHint =
      trace && data.raw !== undefined ? ` / raw=${trimPreview(safeString(data.raw), 600)}` : "";
    throw new Error(`AIタグが生成されませんでした（tags: []）${rawHint}`);
  }

  // ヒューリスティック返しは既定で弾く（毎回同じになりやすい）
  if (!allowFallback && data.fallback) {
    const m = data.model || "unknown";
    const err = data.error ? ` / error=${data.error}` : "";
    const rawHint =
      trace && data.raw !== undefined ? ` / raw=${trimPreview(safeString(data.raw), 600)}` : "";
    throw new Error(
      `AI生成に失敗しヒューリスティックにフォールバックしました（model=${m}）。${err}${rawHint}`
    );
  }

  // ここまで来たらOK
  return data;
}

  