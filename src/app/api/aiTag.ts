// src/app/api/aiTag.ts
export type Draft = {
  title: string;
  type: "account" | "todo" | "subscription" | "memo" | string;
  url?: string;
  username?: string;
  note?: string;
};

type AiTagResponse = {
  tags: string[];
  summary: string;
  confidence: number;
  model?: string;
  fallback?: boolean;   // ← サーバ側で付くことがある
  error?: string;       // ← サーバ側の素エラー（あれば）
};

type Options = {
  allowFallback?: boolean; // ヒューリスティックでも許可するか
  trace?: boolean;         // サーバから raw を返したい時に使う（デバッグ）
};

export async function aiTag(draft: Draft, opts: Options = {}) {
  const { allowFallback = false, trace = false } = opts;

  // 入力ガード：短すぎると毎回同じタグになりがち
  const contentLen =
    (draft.title?.trim().length || 0) + (draft.note?.trim().length || 0);
  if (contentLen < 3) {
    throw new Error("タイトル/メモが短すぎます（3文字以上にしてください）");
  }

  const url = `/api/ai-tag${trace ? "?trace=1" : ""}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(draft),
  });

  // サーバは基本200を返す想定なので、本文も検査する
  let data: AiTagResponse;
  try {
    data = (await res.json()) as AiTagResponse;
  } catch {
    throw new Error(`AIタグAPIのレスポンスを解析できません（HTTP ${res.status}）`);
  }

  // HTTPエラーはそのまま表示
  if (!res.ok) {
    throw new Error(data?.error || `AIタグAPIエラー（HTTP ${res.status}）`);
  }

  // 空配列は未採用（保存しない）
  if (!Array.isArray(data.tags) || data.tags.length === 0) {
    throw new Error("AIタグが生成されませんでした（tags: []）");
  }

  // ヒューリスティック返しは既定で弾く（毎回同じになりやすい）
  if (!allowFallback && data.fallback) {
    throw new Error(
      `AI生成に失敗しヒューリスティックにフォールバックしました（model=${data.model || "unknown"}）。`
    );
  }

  // ここまで来たらOK
  return data;
}

  