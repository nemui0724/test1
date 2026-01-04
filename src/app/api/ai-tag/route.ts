// src/app/api/ai-tag/route.ts
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // 生成系はキャッシュ回避

type Draft = {
  title: string;
  type: "account" | "todo" | "subscription" | "memo" | string; // 参照のみ。タグ決定に使わない
  url?: string;
  username?: string;
  note?: string;
};

type AIJson = { tags?: unknown; summary?: unknown; confidence?: unknown };

const FIXED = [
  "お金","購入","アカウント","タスク","サブスク","連絡","学校","仕事","重要","至急","解約","支払い",
  "請求","更新","期日","メンテ","設定","障害","連携","動画","音楽","写真","学割","領収書","旅行","地名","日本"
] as const;

const BRAND_TAGS: Record<string, string[]> = {
  youtube: ["サブスク","動画","Google"],
  "youtube premium": ["サブスク","動画","Google"],
  netflix: ["サブスク","動画"],
  spotify: ["サブスク","音楽"],
  "prime video": ["サブスク","動画","Amazon"],
  "apple music": ["サブスク","音楽","Apple"],
  icloud: ["サブスク","Apple"],
  adobe: ["サブスク","Adobe"],
  microsoft: ["サブスク","Microsoft"],
  github: ["開発","コード","アカウント"],
  google: ["Google"],
};

const KEYWORD_TAGS: Array<[RegExp, string[]]> = [
  [/(請求|支払|支払い|入金|料金|振込|引き落とし|明細|領収書)/i, ["お金","請求"]],
  [/(購入|買|発注|注文|納品|見積|請求書|領収書)/i, ["購入"]],
  [/(解約|退会|停止|キャンセル|解除)/i, ["解約"]],
  [/(更新|自動更新|サブスク|subscription)/i, ["サブスク","更新"]],
  [/(todo|やる|締切|期限|提出|課題|タスク)/i, ["タスク","期日"]],
  [/(ログイン|account|アカウント|password|パスワード|2fa|otp|ユーザー)/i, ["アカウント","認証"]],
  [/(問い合わせ|連絡|メール|電話|サポート|サポセン)/i, ["連絡"]],
  [/(動画|movie|video|vod)/i, ["動画"]],
  [/(音楽|music|song|曲)/i, ["音楽"]],
];

const GEO_TAGS: Array<[RegExp, string[]]> = [
  [/(東京|tokyo)/i, ["地名","日本","旅行","関東","首都圏"]],
  [/(京都|kyoto)/i, ["地名","日本","旅行","関西"]],
  [/(大阪|osaka)/i, ["地名","日本","旅行","関西"]],
];

const SYN_EXPAND: Record<string, string[]> = {
  解約: ["キャンセル","退会","停止"],
  請求: ["支払い","料金","明細"],
  サブスク: ["定額","月額","定期"],
  動画: ["映像","VOD","配信"],
  音楽: ["ミュージック","楽曲","ストリーミング"],
  購入: ["注文","ショッピング","支出"],
  アカウント: ["ログイン","ユーザー","認証"],
  旅行: ["観光","トラベル","観光地"],
  地名: ["ロケーション","場所"],
  重要: ["優先","注目"],
  期日: ["締切","デッドライン"],
};

/* ===== Utils ===== */
const isStringArray = (x: unknown): x is string[] =>
  Array.isArray(x) && x.every((v) => typeof v === "string");

const extractJsonObject = (text: string): Record<string, unknown> | null => {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const addFromUrl = (url: string | undefined, into: Set<string>) => {
  if (!url) return;
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    into.add(host); // 例: youtube.com
    const parts = host.split(".").filter(Boolean);
    if (parts.length >= 2) into.add(parts[parts.length - 2]); // youtube
    for (const k of Object.keys(BRAND_TAGS)) {
      if (host.includes(k)) BRAND_TAGS[k].forEach((t) => into.add(t));
    }
  } catch {
    /* ignore */
  }
};

const addLooseKeywords = (base: string, into: Set<string>) => {
  if (/\d{1,2}\/\d{1,2}|\d{4}[-/年]\d{1,2}/.test(base)) into.add("日付");
  if (/\d+円/.test(base)) into.add("金額");
  if (/\b(20\d{2}|19\d{2})\b/.test(base)) into.add("年");
  const kata = base.match(/[ァ-ヶー]{2,10}/g);
  kata?.slice(0, 3).forEach((k) => into.add(k));
  const ascii = base.match(/[A-Za-z0-9][A-Za-z0-9\-_.]{1,19}/g);
  ascii?.slice(0, 3).forEach((t) => into.add(t.toLowerCase()));
};

const ensureMinTags = (
  seed: string[],
  ctx: { base: string; url?: string },
  min = 6,
  max = 10
): string[] => {
  const set = new Set<string>(seed.filter(Boolean));
  for (const [k, tags] of Object.entries(BRAND_TAGS)) {
    if (ctx.base.includes(k)) tags.forEach((t) => set.add(t));
  }
  for (const [re, tags] of KEYWORD_TAGS) {
    if (re.test(ctx.base)) tags.forEach((t) => set.add(t));
  }
  for (const [re, tags] of GEO_TAGS) {
    if (re.test(ctx.base)) tags.forEach((t) => set.add(t));
  }
  addFromUrl(ctx.url, set);
  for (const t of Array.from(set)) {
    const exp = SYN_EXPAND[t];
    exp?.forEach((e) => set.add(e));
  }
  addLooseKeywords(ctx.base, set);
  let i = 0;
  while (set.size < min && i < FIXED.length) {
    const c = FIXED[i++];
    if (!set.has(c)) set.add(c);
  }
  return Array.from(set).slice(0, max);
};

const heuristic = (d: Draft) => {
  const base = `${d.title} ${d.note ?? ""}`.toLowerCase();
  const seeded: string[] = [];
  const final = ensureMinTags(seeded, { base, url: d.url }, 6, 10);
  return {
    tags: final,
    summary: d.note?.trim() ? d.note.slice(0, 80) : d.title,
    confidence: 0.6,
  };
};

const errorMessage = (x: unknown): string => {
  if (x instanceof Error) return x.message;
  if (typeof x === "string") return x;
  try {
    return JSON.stringify(x);
  } catch {
    return String(x);
  }
};

const isDraft = (x: unknown): x is Draft => {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (typeof o.title !== "string") return false;
  if (typeof o.type !== "string") return false;
  if (o.url !== undefined && typeof o.url !== "string") return false;
  if (o.username !== undefined && typeof o.username !== "string") return false;
  if (o.note !== undefined && typeof o.note !== "string") return false;
  return true;
};

export async function POST(req: NextRequest) {
  const urlObj = new URL(req.url);
  const trace = urlObj.searchParams.get("trace") === "1";
  const force = urlObj.searchParams.get("force") === "1";

  const raw = (await req.json().catch(() => ({} as unknown))) as unknown;
  if (!isDraft(raw)) {
    return NextResponse.json(
      { error: "invalid body" },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }
  const draft: Draft = raw;

  // 入力ガード（短文 & サイズ）
  const titleLen = (draft.title ?? "").trim().length;
  const noteLen = (draft.note ?? "").trim().length;
  if (titleLen + noteLen < 3) {
    return NextResponse.json(
      { error: "text too short" },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }
  if (titleLen > 2000 || noteLen > 8000) {
    return NextResponse.json(
      { error: "input too large" },
      { status: 413, headers: { "Cache-Control": "no-store" } }
    );
  }

  // デバッグ: 強制ヒューリスティック
  if (force) {
    const h = heuristic(draft);
    return NextResponse.json(
      { ...h, model: "heuristic:force", fallback: true },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  // キー検証
  const key = process.env.GEMINI_API_KEY;
  const looksLikeGoogleKey =
    typeof key === "string" && /^AIza[0-9A-Za-z_\-]{20,}$/.test(key || "");
  if (!key) {
    const h = heuristic(draft);
    return NextResponse.json(
      { ...h, model: "heuristic:no-key", fallback: true, error: "GEMINI_API_KEY が未設定です。" },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
  if (!looksLikeGoogleKey) {
    const h = heuristic(draft);
    return NextResponse.json(
      {
        ...h,
        model: "heuristic:bad-key",
        fallback: true,
        error: "GEMINI_API_KEY が Google 形式ではありません。`AIza...` で始まるキーを設定してください。",
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    // まず SDK、ダメなら REST にフォールバック
    const models = Array.from(
      new Set(
        [process.env.GEMINI_MODEL, "gemini-1.5-flash", "gemini-2.0-flash"].filter(
          (m): m is string => typeof m === "string" && m.length > 0
        )
      )
    );

    const prompt = `
あなたは日本語で「タイトル/メモ」からタグを返す分類器です。
**必ず次のJSONだけ** を返してください（解説や文章は禁止）:
{"tags":["タグ1","タグ2", ...], "summary":"要約", "confidence":0.0～1.0}

厳守:
- tags は **最低6個・最大10個**、重複なし、日本語の短い名詞を中心に。内容に**緩やかに関連**していれば採用可（検索性重視）。
- "type"はメタ情報。**タグ決定に使ってはいけません**（"account"/"todo"/"subscription"/"memo" からタグは作らない）。
- 有名サービス名（YouTube/Netflix/Spotify…）から連想カテゴリ（サブスク/動画/音楽/Google 等）を加えて良い。
- 地名（東京/京都/大阪 等）があれば、状況に応じて「地名」「旅行」「日本」「関東/関西」等を検討。
- 曖昧な単語だけでも、内容無関係のタグ（例: サブスク/動画 など）を**無理に**入れない。

入力:
- title="${draft.title}"
- type="${draft.type}"  ※参照のみ。タグ決定に使わない
- note="${draft.note ?? ""}"
- url="${draft.url ?? ""}"

固定候補（使っても良い）: ${FIXED.join(", ")}
`.trim();

    let lastErr: unknown = null;

    for (const m of models) {
      // -------- 1) SDK で試す --------
      try {
        const { GoogleGenerativeAI } = await import("@google/generative-ai");
        const genAI = new GoogleGenerativeAI(key);
        const mdl = genAI.getGenerativeModel({
          model: m,
          generationConfig: { responseMimeType: "application/json" }, // JSON強制
        });

        const result = await mdl.generateContent(prompt);
        const text = result.response.text() || "{}";

        let obj: AIJson | null = null;
        try {
          obj = JSON.parse(text) as AIJson;
        } catch {
          obj = extractJsonObject(text);
        }

        const aiTags = isStringArray(obj?.tags) ? (obj as AIJson).tags as string[] : [];
        const summary =
          typeof obj?.summary === "string" && (obj as AIJson).summary?.toString().trim()
            ? ((obj as AIJson).summary as string)
            : draft.title;
        const confidence =
          typeof obj?.confidence === "number" ? ((obj as AIJson).confidence as number) : 0.7;

        const base = `${draft.title} ${draft.note ?? ""}`.toLowerCase();
        const merged = ensureMinTags(aiTags, { base, url: draft.url }, 6, 10);

        const modelFailed = aiTags.length < 1;

        return NextResponse.json(
          { tags: merged, summary, confidence, model: m, fallback: modelFailed, ...(trace ? { raw: text } : {}) },
          { headers: { "Cache-Control": "no-store" } }
        );
      } catch (e: unknown) {
        lastErr = e;
        // 続けて REST を試す
      }

      // -------- 2) REST 直叩きで試す --------
      try {
        const resp = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
            m
          )}:generateContent?key=${encodeURIComponent(key)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ role: "user", parts: [{ text: prompt }] }],
              generationConfig: { responseMimeType: "application/json" },
            }),
          }
        );

        if (!resp.ok) {
          lastErr = `REST ${m} HTTP ${resp.status}`;
          continue;
        }

        const j: unknown = await resp.json();
        const candidates = Array.isArray((j as { candidates?: unknown }).candidates)
          ? ((j as { candidates: unknown[] }).candidates as unknown[])
          : [];
        const content = candidates.length > 0 && typeof candidates[0] === "object"
          ? ((candidates[0] as { content?: unknown }).content as unknown)
          : undefined;
        const parts = content && Array.isArray((content as { parts?: unknown }).parts)
          ? ((content as { parts: unknown[] }).parts as unknown[])
          : [];

        const part0 = parts[0] as { text?: unknown; inlineData?: { data?: unknown } } | undefined;
        const textRaw =
          (part0?.text as string | undefined) ??
          (part0?.inlineData?.data as string | undefined) ??
          "{}";
        const text = typeof textRaw === "string" ? textRaw : "{}";

        let obj: AIJson | null = null;
        try {
          obj = JSON.parse(text) as AIJson;
        } catch {
          obj = extractJsonObject(String(text));
        }

        const aiTags = isStringArray(obj?.tags) ? (obj as AIJson).tags as string[] : [];
        const summary =
          typeof obj?.summary === "string" && (obj as AIJson).summary?.toString().trim()
            ? ((obj as AIJson).summary as string)
            : draft.title;
        const confidence =
          typeof obj?.confidence === "number" ? ((obj as AIJson).confidence as number) : 0.7;

        const base = `${draft.title} ${draft.note ?? ""}`.toLowerCase();
        const merged = ensureMinTags(aiTags, { base, url: draft.url }, 6, 10);

        const modelFailed = aiTags.length < 1;

        return NextResponse.json(
          { tags: merged, summary, confidence, model: `rest:${m}`, fallback: modelFailed, ...(trace ? { raw: text } : {}) },
          { headers: { "Cache-Control": "no-store" } }
        );
      } catch (e: unknown) {
        lastErr = e;
        continue; // 次のモデルへ
      }
    }

    // すべて失敗 → 200 + 保険
    const h = heuristic(draft);
    return NextResponse.json(
      { ...h, model: "heuristic:fallback", fallback: true, error: errorMessage(lastErr) },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: unknown) {
    // 想定外でも 200 + 保険（UI は fallback を検知して保存中断できる）
    const h = heuristic(draft);
    return NextResponse.json(
      { ...h, model: "heuristic:error", fallback: true, error: errorMessage(e) },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
}
