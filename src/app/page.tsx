// src/app/page.tsx
"use client";

import React, { useMemo, useState, useEffect } from "react";
import {
  AppBar,
  Avatar,
  Box,
  Button,
  Card,
  CardActions,
  CardContent,
  CardHeader,
  Chip,
  Container,
  CssBaseline,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  IconButton,
  InputAdornment,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  TextField,
  Toolbar,
  Typography,
  Alert,
} from "@mui/material";
import { ThemeProvider, alpha, createTheme, styled } from "@mui/material/styles";
import type { SelectChangeEvent } from "@mui/material/Select";

// Firestore
import { db } from "../lib/firebase";
import {
  collection,
  addDoc,
  deleteDoc,
  updateDoc,
  doc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";

// AIタグヘルパー
import { aiTag, Draft as AiDraft } from "./api/aiTag";

// Fuse.js hook
import { useFuseSearch } from "../hooks/useFuseSearch";

// ひらがな変換ライブラリ
import { toHiragana } from "wanakana";

/* ---- JST固定フォーマッタ（SSR/CSRで同一出力） ---- */
const formatJST = (ts: number) =>
  new Date(ts).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

/* ===== Types ===== */
type ItemType = "account" | "todo" | "subscription" | "memo";
interface Item {
  id: string;
  title: string;
  type: ItemType;
  url?: string | null;
  username?: string | null;
  note?: string | null;
  tags: string[];
  createdAt: number; // epoch millis
  updatedAt?: number | null;
  aiSummary?: string | null;
  aiConfidence?: number | null;
  aiModel?: string | null;
}

/**
 * Fuse検索用に「元の文字列 + ひらがな化した文字列」を持たせた型
 * 例：タイトル「アカウント」 → "アカウント あかうんと"
 */
type SearchItem = Item & {
  titleSearch: string;
  usernameSearch: string;
  noteSearch: string;
  tagsSearch: string;
};

/* ===== Theme ===== */
const useAppTheme = (mode: "light" | "dark") =>
  useMemo(
    () =>
      createTheme({
        palette: {
          mode,
          primary: { main: mode === "light" ? "#0ea5e9" : "#38bdf8" },
          background: {
            default: mode === "light" ? "#f7fafc" : "#0b1020",
            paper: mode === "light" ? "#ffffff" : "rgba(11,16,32,0.6)",
          },
        },
        shape: { borderRadius: 16 },
        typography: {
          fontFamily:
            "'Inter','Noto Sans JP',system-ui,-apple-system,Segoe UI,Roboto,'Helvetica Neue',Arial",
        },
      }),
    [mode]
  );

/* ===== 固定サイズ設定 ===== */
const CARD_HEIGHT = 280;
const TITLE_LINES = 2;
const NOTE_LINES = 3;
const TAG_ROWS_MAX = 2;
const CHIP_HEIGHT = 28;
const CHIP_ROW_GAP = 6;

/* ===== Fuse.js 用の対象キー =====
 * 元の値 + ひらがなをくっつけた field を検索対象にする
 */
const FUSE_KEYS: string[] = [
  "titleSearch",
  "usernameSearch",
  "noteSearch",
  "tagsSearch",
  "url",
];

/* ===== Utilities ===== */
const typeMeta: Record<
  ItemType,
  { label: string; color: string; emoji: string }
> = {
  account: { label: "アカウント", color: "#60a5fa", emoji: "🔐" },
  todo: { label: "ToDo", color: "#f59e0b", emoji: "✅" },
  subscription: { label: "サブスク", color: "#34d399", emoji: "💳" },
  memo: { label: "メモ", color: "#a78bfa", emoji: "📝" },
};

const PlusCard = styled(Paper)(({ theme }) => ({
  height: CARD_HEIGHT,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  border: `2px dashed ${alpha(theme.palette.text.primary, 0.2)}`,
  background: alpha(
    theme.palette.primary.main,
    theme.palette.mode === "light" ? 0.06 : 0.12
  ),
  cursor: "pointer",
  transition: "all .2s",
  "&:hover": {
    transform: "translateY(-3px)",
    boxShadow: theme.shadows[6],
    borderColor: theme.palette.primary.main,
  },
}));

const TypeChip: React.FC<{ type: ItemType }> = ({ type }) => (
  <Chip
    size="small"
    sx={{
      bgcolor: alpha(typeMeta[type].color, 0.15),
      color: typeMeta[type].color,
      fontWeight: 700,
    }}
    label={`${typeMeta[type].emoji} ${typeMeta[type].label}`}
  />
);

// Timestamp/number/未定義を安全にエポックミリ秒へ
const toEpochMillis = (v: unknown): number => {
  if (typeof v === "number") return v;
  if (v instanceof Timestamp) return v.toMillis();
  if (v && typeof (v as { toMillis?: () => number }).toMillis === "function") {
    return (v as { toMillis: () => number }).toMillis();
  }
  return Date.now();
};

// ひらがな正規化（null/undefinedにも安全）
const normalizeKana = (input: string | null | undefined): string =>
  input ? toHiragana(input) : "";

/* ===== Add Dialog ===== */
function AddItemDialog({
  open,
  onClose,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (draft: {
    title: string;
    type: ItemType;
    url?: string;
    username?: string;
    note?: string;
  }) => void;
}) {
  const [type, setType] = useState<ItemType>("account");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [username, setUsername] = useState("");
  const [note, setNote] = useState("");

  const canSave = title.trim().length > 0;

  const handleSave = () => {
    onSave({
      title: title.trim(),
      type,
      url: url || undefined,
      username: username || undefined,
      note: note || undefined,
    });
    onClose();
    setType("account");
    setTitle("");
    setUrl("");
    setUsername("");
    setNote("");
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>新規項目を追加</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <FormControl fullWidth>
            <InputLabel id="type-label">種類</InputLabel>
            <Select
              labelId="type-label"
              label="種類"
              value={type}
              onChange={(e: SelectChangeEvent) =>
                setType(e.target.value as ItemType)
              }
            >
              <MenuItem value="account">🔐 アカウント</MenuItem>
              <MenuItem value="todo">✅ ToDo</MenuItem>
              <MenuItem value="subscription">💳 サブスク</MenuItem>
              <MenuItem value="memo">📝 メモ</MenuItem>
            </Select>
          </FormControl>

          <TextField
            label="タイトル"
            fullWidth
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例: バイト申請"
          />

          {type !== "memo" && (
            <TextField
              label={
                type === "account"
                  ? "ユーザー名 / メール"
                  : type === "subscription"
                  ? "プラン名"
                  : "担当"
              }
              fullWidth
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          )}

          <TextField
            label="URL (任意)"
            fullWidth
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">🔗</InputAdornment>
              ),
            }}
          />

          <TextField
            label="メモ"
            fullWidth
            multiline
            minRows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">📝</InputAdornment>
              ),
            }}
          />

          <Typography variant="body2" sx={{ opacity: 0.7 }}>
            保存すると AI が自動でタグ付けします。
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>キャンセル</Button>
        <Button variant="contained" onClick={handleSave} disabled={!canSave}>
          保存
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/* ===== Edit Dialog ===== */
function EditItemDialog({
  item,
  open,
  onClose,
  onSave,
}: {
  item: Item | null;
  open: boolean;
  onClose: () => void;
  onSave: (
    id: string,
    patch: {
      title: string;
      type: ItemType;
      url?: string;
      username?: string;
      note?: string;
    }
  ) => void;
}) {
  const [type, setType] = useState<ItemType>(item?.type ?? "account");
  const [title, setTitle] = useState(item?.title ?? "");
  const [url, setUrl] = useState(item?.url ?? "");
  const [username, setUsername] = useState(item?.username ?? "");
  const [note, setNote] = useState(item?.note ?? "");

  useEffect(() => {
    setType(item?.type ?? "account");
    setTitle(item?.title ?? "");
    setUrl(item?.url ?? "");
    setUsername(item?.username ?? "");
    setNote(item?.note ?? "");
  }, [item, open]);

  const canSave = !!item && title.trim().length > 0;

  const handleSave = () => {
    if (!item) return;
    onSave(item.id, {
      title: title.trim(),
      type,
      url: url || undefined,
      username: username || undefined,
      note: note || undefined,
    });
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>項目を編集</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <FormControl fullWidth>
            <InputLabel id="edit-type-label">種類</InputLabel>
            <Select
              labelId="edit-type-label"
              label="種類"
              value={type}
              onChange={(e: SelectChangeEvent) =>
                setType(e.target.value as ItemType)
              }
            >
              <MenuItem value="account">🔐 アカウント</MenuItem>
              <MenuItem value="todo">✅ ToDo</MenuItem>
              <MenuItem value="subscription">💳 サブスク</MenuItem>
              <MenuItem value="memo">📝 メモ</MenuItem>
            </Select>
          </FormControl>

          <TextField
            label="タイトル"
            fullWidth
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />

          {type !== "memo" && (
            <TextField
              label={
                type === "account"
                  ? "ユーザー名 / メール"
                  : type === "subscription"
                  ? "プラン名"
                  : "担当者"
              }
              fullWidth
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          )}

          <TextField
            label="URL (任意)"
            fullWidth
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">🔗</InputAdornment>
              ),
            }}
          />

          <TextField
            label="メモ"
            fullWidth
            multiline
            minRows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">📝</InputAdornment>
              ),
            }}
          />

          <Typography variant="body2" sx={{ opacity: 0.7 }}>
            保存時に AI が再度タグ付けします。
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>キャンセル</Button>
        <Button variant="contained" onClick={handleSave} disabled={!canSave}>
          保存
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/* ===== 詳細モーダル ===== */
function ItemDetailDialog({
  item,
  open,
  onClose,
  onEdit,
}: {
  item: Item | null;
  open: boolean;
  onClose: () => void;
  onEdit: (item: Item) => void;
}) {
  if (!item) return null;
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 1,
          }}
        >
          <span>{item.title}</span>
          <Button
            size="small"
            variant="outlined"
            onClick={() => onEdit(item)}
          >
            ✏️ 編集
          </Button>
        </Box>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.2}>
          <Typography variant="body2">
            種類: <b>{item.type}</b>
          </Typography>
          <Typography variant="body2">
            作成: {formatJST(item.createdAt)}
          </Typography>
          {item.updatedAt ? (
            <Typography variant="body2">
              更新: {formatJST(item.updatedAt)}
            </Typography>
          ) : null}
          {item.username && (
            <Typography variant="body2">識別子: {item.username}</Typography>
          )}
          {item.url && (
            <Typography variant="body2">
              URL:{" "}
              <a href={item.url} target="_blank" rel="noreferrer">
                {item.url}
              </a>
            </Typography>
          )}
          {item.note && (
            <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", mt: 1 }}>
              {item.note}
            </Typography>
          )}
          {item.tags?.length > 0 && (
            <>
              <Divider sx={{ my: 1 }} />
              <Typography variant="body2" sx={{ opacity: 0.7 }}>
                タグ
              </Typography>
              <Stack
                direction="row"
                flexWrap="wrap"
                sx={{ columnGap: 0.75, rowGap: 0.75 }}
              >
                {item.tags.map((t) => (
                  <Chip key={t} size="small" label={t} />
                ))}
              </Stack>
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>閉じる</Button>
      </DialogActions>
    </Dialog>
  );
}

/* ===== Item Card ===== */
function ItemCard({
  item,
  onDelete,
  onOpen,
  onEdit,
}: {
  item: Item;
  onDelete: (id: string) => void;
  onOpen: (item: Item) => void;
  onEdit: (item: Item) => void;
}) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  return (
    <Card
      onClick={() => onOpen(item)}
      sx={{
        cursor: "pointer",
        height: CARD_HEIGHT,
        display: "grid",
        gridTemplateRows: "auto 1fr auto",
        overflow: "hidden",
      }}
    >
      <CardHeader
        avatar={
          <Avatar
            sx={{
              bgcolor: alpha(typeMeta[item.type].color, 0.15),
              color: typeMeta[item.type].color,
            }}
          >
            {typeMeta[item.type].emoji}
          </Avatar>
        }
        title={item.title}
        titleTypographyProps={{
          fontWeight: 700,
          sx: {
            display: "-webkit-box",
            WebkitLineClamp: TITLE_LINES,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          },
        }}
        subheader={mounted ? formatJST(item.createdAt) : ""}
      />

      <CardContent
        sx={{
          minHeight: 0,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          gap: 1,
        }}
      >
        <TypeChip type={item.type} />

        {item.username && (
          <Typography
            variant="body2"
            sx={{
              opacity: 0.8,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            識別子: {item.username}
          </Typography>
        )}

        {item.url && (
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography component="span" sx={{ fontSize: 14 }}>
              🔗
            </Typography>
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              style={{
                textDecoration: "none",
                fontWeight: 600,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                display: "block",
              }}
              title={item.url || undefined}
            >
              {item.url}
            </a>
          </Stack>
        )}

        {item.note && (
          <Typography
            variant="body2"
            sx={{
              whiteSpace: "pre-wrap",
              display: "-webkit-box",
              WebkitLineClamp: NOTE_LINES,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              minHeight: 0,
            }}
          >
            {item.note}
          </Typography>
        )}

        <Stack
          direction="row"
          sx={{
            mt: 0.75,
            flexWrap: "wrap",
            alignContent: "flex-start",
            overflow: "hidden",
            columnGap: 0.5,
            rowGap: `${CHIP_ROW_GAP}px`,
            maxHeight:
              TAG_ROWS_MAX * CHIP_HEIGHT + (TAG_ROWS_MAX - 1) * CHIP_ROW_GAP,
          }}
        >
          {item.tags.map((t) => (
            <Chip
              key={t}
              size="small"
              label={t}
              sx={{
                maxWidth: 110,
                "& .MuiChip-label": {
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                },
              }}
              title={t}
            />
          ))}
        </Stack>
      </CardContent>

      <CardActions
        sx={{ pt: 0, display: "flex", justifyContent: "space-between" }}
      >
        <Button
          size="small"
          color="inherit"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(item.id);
          }}
        >
          削除
        </Button>
        <Button
          size="small"
          onClick={(e) => {
            e.stopPropagation();
            onEdit(item);
          }}
        >
          ✏️ 編集
        </Button>
      </CardActions>
    </Card>
  );
}

/* ===== Page ===== */
export default function Page() {
  const [dark, setDark] = useState(true);
  const theme = useAppTheme(dark ? "dark" : "light");

  // Firestore 購読
  const [items, setItems] = useState<Item[]>([]);
  useEffect(() => {
    try {
      const q = query(collection(db, "items"), orderBy("createdAt", "desc"));
      const unsub = onSnapshot(q, (snap) => {
        const arr: Item[] = snap.docs.map((d) => {
          const data = d.data() as Record<string, unknown>;
          const created = toEpochMillis(data.createdAt);
          const updated =
            data.updatedAt !== undefined ? toEpochMillis(data.updatedAt) : null;

          return {
            id: d.id,
            title: (data.title as string) ?? "",
            type: ((data.type as ItemType) ?? "memo") as ItemType,
            url: ((data.url as string) ?? null) as string | null,
            username: ((data.username as string) ?? null) as string | null,
            note: ((data.note as string) ?? null) as string | null,
            tags: Array.isArray(data.tags) ? (data.tags as string[]) : [],
            createdAt: created,
            updatedAt: updated,
            aiSummary: ((data.aiSummary as string) ?? null) as string | null,
            aiConfidence:
              typeof data.aiConfidence === "number"
                ? (data.aiConfidence as number)
                : null,
            aiModel: ((data.aiModel as string) ?? null) as string | null,
          };
        });
        setItems(arr);
      });
      return () => unsub();
    } catch (e) {
      console.error("onSnapshot error:", e);
    }
  }, []);

  // 検索・絞り込み
  const [queryText, setQueryText] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | ItemType>("all");
  const [sortKey, setSortKey] = useState<"recent" | "title">("recent");
  const [addOpen, setAddOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [detailItem, setDetailItem] = useState<Item | null>(null);
  const [editItem, setEditItem] = useState<Item | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Fuse用に「元文字列 + ひらがな」を仕込んだ配列を作る
  const itemsForSearch = useMemo<SearchItem[]>(() => {
    return items.map((it) => {
      const titleKana = normalizeKana(it.title);
      const usernameKana = normalizeKana(it.username ?? "");
      const noteKana = normalizeKana(it.note ?? "");
      const tagsJoined = it.tags.join(" ");
      const tagsKana = normalizeKana(tagsJoined);

      return {
        ...it,
        titleSearch: `${it.title} ${titleKana}`.trim(),
        usernameSearch: `${it.username ?? ""} ${usernameKana}`.trim(),
        noteSearch: `${it.note ?? ""} ${noteKana}`.trim(),
        tagsSearch: `${tagsJoined} ${tagsKana}`.trim(),
      };
    });
  }, [items]);

  // Fuse.js であいまい検索
  const searched = useFuseSearch<SearchItem>({
    items: itemsForSearch,
    search: queryText, // 入力そのまま（カタカナ/ひらがな/漢字どれでもOK）
    keys: FUSE_KEYS,
    threshold: 0.5,
    distance: 100,
  });

  // 種類フィルタ & ソート
  const filtered = useMemo(() => {
    let arr = searched;

    if (typeFilter !== "all") {
      arr = arr.filter((it) => it.type === typeFilter);
    }

    if (sortKey === "title") {
      arr = [...arr].sort((a, b) => a.title.localeCompare(b.title));
    } else {
      arr = [...arr].sort((a, b) => b.createdAt - a.createdAt);
    }

    return arr;
  }, [searched, typeFilter, sortKey]);

  // 追加保存：AIでタグ付け
  const saveNewItem = async (draft: {
    title: string;
    type: ItemType;
    url?: string;
    username?: string;
    note?: string;
  }) => {
    setErrorMsg(null);

    const contentLen =
      (draft.title?.trim().length || 0) + (draft.note?.trim().length || 0);
    if (contentLen < 3) {
      setErrorMsg("タイトル/メモが短すぎます（3文字以上にしてください）");
      return;
    }

    try {
      const data = await aiTag(
        {
          title: draft.title,
          type: draft.type,
          url: draft.url,
          username: draft.username,
          note: draft.note,
        } as AiDraft,
        { allowFallback: false }
      );

      const tags = Array.isArray(data.tags) ? data.tags : [];
      if (!tags.length) {
        setErrorMsg(
          "AIタグが生成されませんでした。内容を少し詳しくして再試行してください。"
        );
        return; // 未分類で保存しない
      }

      await addDoc(collection(db, "items"), {
        title: draft.title,
        type: draft.type,
        url: draft.url ?? null,
        username: draft.username ?? null,
        note: draft.note ?? null,
        tags: tags.slice(0, 12),
        aiSummary: (data as { summary?: string }).summary ?? null,
        aiConfidence:
          typeof (data as { confidence?: unknown }).confidence === "number"
            ? ((data as { confidence: number }).confidence as number)
            : null,
        aiModel: (data as { model?: string }).model ?? null,
        createdAt: serverTimestamp(),
        lastTaggedAt: serverTimestamp(),
      });
    } catch (e: unknown) {
      setErrorMsg(
        e instanceof Error
          ? e.message
          : "AIタグ生成に失敗しました。時間をおいて再試行してください。"
      );
    }
  };

  // 更新：AIで再タグ付けしてから updateDoc
  const updateExistingItem = async (
    id: string,
    patch: {
      title: string;
      type: ItemType;
      url?: string;
      username?: string;
      note?: string;
    }
  ) => {
    setErrorMsg(null);

    const contentLen =
      (patch.title?.trim().length || 0) + (patch.note?.trim().length || 0);
    if (contentLen < 3) {
      setErrorMsg("タイトル/メモが短すぎます（3文字以上にしてください）");
      return;
    }

    try {
      const data = await aiTag(
        {
          title: patch.title,
          type: patch.type,
          url: patch.url,
          username: patch.username,
          note: patch.note,
        } as AiDraft,
        { allowFallback: false }
      );

      const tags = Array.isArray(data.tags) ? data.tags : [];
      if (!tags.length) {
        setErrorMsg(
          "AIタグが生成されませんでした。内容を少し詳しくして再試行してください。"
        );
        return;
      }

      await updateDoc(doc(db, "items", id), {
        title: patch.title,
        type: patch.type,
        url: patch.url ?? null,
        username: patch.username ?? null,
        note: patch.note ?? null,
        tags: tags.slice(0, 12),
        aiSummary: (data as { summary?: string }).summary ?? null,
        aiConfidence:
          typeof (data as { confidence?: unknown }).confidence === "number"
            ? ((data as { confidence: number }).confidence as number)
            : null,
        aiModel: (data as { model?: string }).model ?? null,
        lastTaggedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (e: unknown) {
      setErrorMsg(
        e instanceof Error
          ? e.message
          : "更新に失敗しました。時間をおいて再試行してください。"
      );
    }
  };

  const deleteItem = async (id: string) => {
    await deleteDoc(doc(db, "items", id));
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />

      {/* エラー表示 */}
      {errorMsg && (
        <Alert
          severity="error"
          onClose={() => setErrorMsg(null)}
          sx={{ borderRadius: 0 }}
        >
          {errorMsg}
        </Alert>
      )}

      {/* ヘッダー */}
      <AppBar position="sticky" elevation={4}>
        <Toolbar sx={{ gap: 2 }}>
          <Typography variant="h6" fontWeight={900}>
            卒研タイトル考えるサイト
          </Typography>
          <Box sx={{ flex: 1, display: "flex", justifyContent: "center" }}>
            <TextField
              placeholder="検索 (タイトル・タグ・URL)"
              value={queryText}
              onChange={(e) => setQueryText(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">🔎</InputAdornment>
                ),
              }}
              sx={{ width: 560, maxWidth: "60vw" }}
            />
          </Box>
          <IconButton
            onClick={() => setSettingsOpen(true)}
            aria-label="設定を開く"
          >
            ⚙️
          </IconButton>
        </Toolbar>

        <Toolbar sx={{ justifyContent: "center", gap: 2, pt: 0 }}>
          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel>種類</InputLabel>
            <Select
              label="種類"
              value={typeFilter}
              onChange={(e: SelectChangeEvent) =>
                setTypeFilter(e.target.value as "all" | ItemType)
              }
            >
              <MenuItem value="all">すべて</MenuItem>
              <MenuItem value="account">アカウント</MenuItem>
              <MenuItem value="todo">ToDo</MenuItem>
              <MenuItem value="subscription">サブスク</MenuItem>
              <MenuItem value="memo">メモ</MenuItem>
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel>並び替え</InputLabel>
            <Select
              label="並び替え"
              value={sortKey}
              onChange={(e: SelectChangeEvent) =>
                setSortKey(e.target.value as "recent" | "title")
              }
            >
              <MenuItem value="recent">新着順</MenuItem>
              <MenuItem value="title">タイトル順</MenuItem>
            </Select>
          </FormControl>
          <Button variant="outlined" onClick={() => setAddOpen(true)}>
            ＋ 追加
          </Button>
        </Toolbar>
      </AppBar>

      {/* 一覧 */}
      <Container maxWidth="lg" sx={{ py: 3 }}>
        <Box
          sx={{
            display: "grid",
            gap: 2,
            gridTemplateColumns: {
              xs: "1fr",
              sm: "repeat(2, 1fr)",
              md: "repeat(3, 1fr)",
              lg: "repeat(4, 1fr)",
            },
            alignItems: "stretch",
          }}
        >
          {filtered.map((it) => (
            <Box key={it.id}>
              <ItemCard
                item={it}
                onDelete={deleteItem}
                onOpen={(item) => setDetailItem(item)}
                onEdit={(item) => setEditItem(item)}
              />
            </Box>
          ))}

          <Box>
            <PlusCard onClick={() => setAddOpen(true)}>
              <Stack alignItems="center" spacing={1}>
                <Typography fontWeight={700}>＋</Typography>
                <Typography variant="body2" sx={{ opacity: 0.7 }}>
                  ここから新規追加
                </Typography>
              </Stack>
            </PlusCard>
          </Box>
        </Box>
      </Container>

      {/* 追加ダイアログ */}
      <AddItemDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSave={saveNewItem}
      />

      {/* 設定モーダル */}
      <Dialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>設定</DialogTitle>
        <DialogContent>
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
          >
            <Typography>ダークモード</Typography>
            <Switch checked={dark} onChange={() => setDark(!dark)} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSettingsOpen(false)}>閉じる</Button>
        </DialogActions>
      </Dialog>

      {/* 詳細モーダル（右上に編集ボタン追加済み） */}
      <ItemDetailDialog
        item={detailItem}
        open={!!detailItem}
        onClose={() => setDetailItem(null)}
        onEdit={(item) => {
          setDetailItem(null);
          setEditItem(item);
        }}
      />

      {/* 編集ダイアログ */}
      <EditItemDialog
        item={editItem}
        open={!!editItem}
        onClose={() => setEditItem(null)}
        onSave={(id, patch) => updateExistingItem(id, patch)}
      />
    </ThemeProvider>
  );
}

