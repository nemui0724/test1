// src/app/page.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import type { Theme } from "@mui/material/styles";
import {
  Alert,
  AppBar,
  Avatar,
  Box,
  Button,
  Card,
  CardActions,
  CardContent,
  CardHeader,
  Chip,
  Collapse,
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
  useMediaQuery,
} from "@mui/material";
import { ThemeProvider, alpha, createTheme, styled } from "@mui/material/styles";
import type { SelectChangeEvent } from "@mui/material/Select";

import Fuse from "fuse.js";
import { toHiragana } from "wanakana";

// Firestore
import { db } from "../lib/firebase";
import {
  Timestamp,
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";

/* -------------------- Types -------------------- */
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

type SearchItem = Item & {
  titleSearch: string;
  usernameSearch: string;
  noteSearch: string;
  tagsSearch: string;
};

type AiTagResponse = {
  tags: string[];
  summary?: string;
  confidence?: number;
  model?: string;
};

/* -------------------- Helpers -------------------- */
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

const toEpochMillis = (v: unknown): number => {
  if (typeof v === "number") return v;
  if (v instanceof Timestamp) return v.toMillis();
  if (v && typeof (v as { toMillis?: () => number }).toMillis === "function") {
    return (v as { toMillis: () => number }).toMillis();
  }
  return Date.now();
};

const normalizeKana = (input: string | null | undefined): string =>
  input ? toHiragana(input) : "";

const isNonEmptyStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string" && x.trim().length > 0);

const typeMeta: Record<ItemType, { label: string; color: string; emoji: string }> =
  {
    account: { label: "アカウント", color: "#60a5fa", emoji: "🔐" },
    todo: { label: "ToDo", color: "#f59e0b", emoji: "✅" },
    subscription: { label: "サブスク", color: "#34d399", emoji: "💳" },
    memo: { label: "メモ", color: "#a78bfa", emoji: "📝" },
  };

/* -------------------- Theme (dark fixed) -------------------- */
const useAppTheme = () =>
  useMemo(
    () =>
      createTheme({
        palette: {
          mode: "dark",
          primary: { main: "#38bdf8" },
          background: {
            default: "#0b1020",
            paper: "rgba(11,16,32,1)",
          },
        },
        shape: { borderRadius: 16 },
        typography: {
          fontFamily:
            "'Inter','Noto Sans JP',system-ui,-apple-system,Segoe UI,Roboto,'Helvetica Neue',Arial",
        },
      }),
    []
  );

/* -------------------- UI constants -------------------- */
const CARD_HEIGHT = 280;
const TITLE_LINES = 2;
const NOTE_LINES = 3;
const TAG_ROWS_MAX = 2;
const CHIP_HEIGHT = 28;
const CHIP_ROW_GAP = 6;

const PlusCard = styled(Paper)(({ theme }) => ({
  height: CARD_HEIGHT,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  border: `2px dashed ${alpha(theme.palette.text.primary, 0.25)}`,
  background: alpha(theme.palette.primary.main, 0.12),
  cursor: "pointer",
  transition: "all .2s",
  "&:hover": {
    transform: "translateY(-3px)",
    boxShadow: theme.shadows[8],
    borderColor: theme.palette.primary.main,
  },
}));

const TypeChip: React.FC<{ type: ItemType }> = ({ type }) => (
  <Chip
    size="small"
    sx={{
      bgcolor: alpha(typeMeta[type].color, 0.2),
      color: typeMeta[type].color,
      fontWeight: 800,
    }}
    label={`${typeMeta[type].emoji} ${typeMeta[type].label}`}
  />
);

/* -------------------- AI tag call (via API route) -------------------- */
async function requestAiTags(draft: {
  title: string;
  type: ItemType;
  url?: string;
  username?: string;
  note?: string;
}): Promise<AiTagResponse> {
  const res = await fetch("/api/ai-tag", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(draft),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || "AIタグ生成に失敗しました");
  }

  const data: unknown = await res.json();
  if (!data || typeof data !== "object") {
    throw new Error("AI応答の形式が不正です");
  }

  const obj = data as Record<string, unknown>;
  const tags = obj.tags;

  if (!isNonEmptyStringArray(tags)) {
    throw new Error("AIタグが生成されませんでした（tagsが空）");
  }

  return {
    tags: tags.map((t) => t.trim()).slice(0, 12),
    summary: typeof obj.summary === "string" ? obj.summary : undefined,
    confidence: typeof obj.confidence === "number" ? obj.confidence : undefined,
    model: typeof obj.model === "string" ? obj.model : undefined,
  };
}

/* -------------------- Dialogs -------------------- */
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
              onChange={(e: SelectChangeEvent) => setType(e.target.value as ItemType)}
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
              label={type === "account" ? "ユーザー名 / メール" : type === "subscription" ? "プラン名" : "担当"}
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
              startAdornment: <InputAdornment position="start">🔗</InputAdornment>,
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
              startAdornment: <InputAdornment position="start">📝</InputAdornment>,
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
      tags?: string[];
      retagWithAI: boolean;
    }
  ) => void;
}) {
  const [type, setType] = useState<ItemType>(item?.type ?? "account");
  const [title, setTitle] = useState(item?.title ?? "");
  const [url, setUrl] = useState(item?.url ?? "");
  const [username, setUsername] = useState(item?.username ?? "");
  const [note, setNote] = useState(item?.note ?? "");

  const [retagWithAI, setRetagWithAI] = useState(true);
  const [tags, setTags] = useState<string[]>(item?.tags ?? []);
  const [tagText, setTagText] = useState("");

  useEffect(() => {
    setType(item?.type ?? "account");
    setTitle(item?.title ?? "");
    setUrl(item?.url ?? "");
    setUsername(item?.username ?? "");
    setNote(item?.note ?? "");
    setTags(item?.tags ?? []);
    setRetagWithAI(true);
    setTagText("");
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
      tags,
      retagWithAI,
    });
    onClose();
  };

  const canManualTagEdit = !retagWithAI;

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
              onChange={(e: SelectChangeEvent) => setType(e.target.value as ItemType)}
            >
              <MenuItem value="account">🔐 アカウント</MenuItem>
              <MenuItem value="todo">✅ ToDo</MenuItem>
              <MenuItem value="subscription">💳 サブスク</MenuItem>
              <MenuItem value="memo">📝 メモ</MenuItem>
            </Select>
          </FormControl>

          <TextField label="タイトル" fullWidth value={title} onChange={(e) => setTitle(e.target.value)} />

          {type !== "memo" && (
            <TextField
              label={type === "account" ? "ユーザー名 / メール" : type === "subscription" ? "プラン名" : "担当者"}
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
              startAdornment: <InputAdornment position="start">🔗</InputAdornment>,
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
              startAdornment: <InputAdornment position="start">📝</InputAdornment>,
            }}
          />

          <Divider sx={{ my: 1 }} />

          <Stack direction="row" alignItems="center" justifyContent="space-between">
            <Typography fontWeight={800}>AIで再タグ付け</Typography>
            <Switch checked={retagWithAI} onChange={(e) => setRetagWithAI(e.target.checked)} />
          </Stack>

          <Typography variant="body2" sx={{ opacity: 0.75 }}>
            {retagWithAI
              ? "ON の場合：保存時に AI がタグを作り直します（手動編集は無効）"
              : "OFF の場合：タグを手動で編集して保存します"}
          </Typography>

          <Typography variant="subtitle2" fontWeight={800}>
            タグ（最大12）
          </Typography>

          <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
            {tags.length === 0 ? (
              <Typography variant="body2" sx={{ opacity: 0.6 }}>
                タグがありません
              </Typography>
            ) : (
              tags.map((t) => (
                <Chip
                  key={t}
                  label={t}
                  onDelete={canManualTagEdit ? () => setTags(tags.filter((x) => x !== t)) : undefined}
                  sx={{ mb: 1 }}
                />
              ))
            )}
          </Stack>

          {canManualTagEdit ? (
            <Stack direction="row" spacing={1}>
              <TextField
                label="タグを追加"
                size="small"
                value={tagText}
                onChange={(e) => setTagText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  const t = tagText.trim();
                  if (!t) return;
                  if (tags.includes(t)) {
                    setTagText("");
                    return;
                  }
                  setTags([...tags, t].slice(0, 12));
                  setTagText("");
                }}
                fullWidth
              />
              <Button
                variant="outlined"
                onClick={() => {
                  const t = tagText.trim();
                  if (!t) return;
                  if (tags.includes(t)) {
                    setTagText("");
                    return;
                  }
                  setTags([...tags, t].slice(0, 12));
                  setTagText("");
                }}
                disabled={tagText.trim().length === 0}
              >
                追加
              </Button>
            </Stack>
          ) : (
            <Typography variant="caption" sx={{ opacity: 0.7 }}>
              タグを追加・削除するには OFF にしてください
            </Typography>
          )}
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
      <DialogTitle
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 1,
        }}
      >
        <span>{item.title}</span>
        <Button size="small" variant="outlined" onClick={() => onEdit(item)}>
          ✏️ 編集
        </Button>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.2}>
          <Typography variant="body2">
            種類: <b>{item.type}</b>
          </Typography>
          <Typography variant="body2">作成: {formatJST(item.createdAt)}</Typography>
          {item.updatedAt ? <Typography variant="body2">更新: {formatJST(item.updatedAt)}</Typography> : null}
          {item.username ? <Typography variant="body2">識別子: {item.username}</Typography> : null}
          {item.url ? (
            <Typography variant="body2">
              URL:{" "}
              <a href={item.url} target="_blank" rel="noreferrer">
                {item.url}
              </a>
            </Typography>
          ) : null}
          {item.note ? (
            <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", mt: 1 }}>
              {item.note}
            </Typography>
          ) : null}

          {item.tags.length > 0 ? (
            <>
              <Divider sx={{ my: 1 }} />
              <Typography variant="body2" sx={{ opacity: 0.7 }}>
                タグ
              </Typography>
              <Stack direction="row" flexWrap="wrap" sx={{ columnGap: 0.75, rowGap: 0.75 }}>
                {item.tags.map((t) => (
                  <Chip key={t} size="small" label={t} />
                ))}
              </Stack>
            </>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>閉じる</Button>
      </DialogActions>
    </Dialog>
  );
}

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
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <Card
      onClick={() => onOpen(item)}
      sx={(theme: Theme) => {
        const border = alpha(theme.palette.text.primary, 0.22);
        const left = alpha(typeMeta[item.type].color, 0.55);
        const paperBg = alpha("#ffffff", 0.03);
        const line = alpha(theme.palette.text.primary, 0.1);

        const memoLines =
          item.type === "memo"
            ? {
                backgroundImage: `repeating-linear-gradient(to bottom, transparent 0px, transparent 26px, ${line} 27px, ${line} 28px)`,
              }
            : {};

        return {
          cursor: "pointer",
          height: CARD_HEIGHT,
          display: "grid",
          gridTemplateRows: "auto 1fr auto",
          overflow: "hidden",
          border: `1px solid ${border}`,
          borderLeft: "8px solid",
          borderLeftColor: left,
          backgroundColor: paperBg,
          transition: "transform .15s ease, box-shadow .15s ease, border-color .15s ease",
          "&:hover": {
            transform: "translateY(-2px)",
            boxShadow: theme.shadows[6],
            borderColor: alpha(theme.palette.primary.main, 0.45),
          },
          ...memoLines,
        };
      }}
    >
      <CardHeader
        avatar={
          <Avatar
            sx={{
              bgcolor: alpha(typeMeta[item.type].color, 0.18),
              color: typeMeta[item.type].color,
            }}
          >
            {typeMeta[item.type].emoji}
          </Avatar>
        }
        title={item.title}
        titleTypographyProps={{
          fontWeight: 800,
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

        {item.username ? (
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
        ) : null}

        {item.url ? (
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
                fontWeight: 700,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                display: "block",
              }}
              title={item.url ?? undefined}
            >
              {item.url}
            </a>
          </Stack>
        ) : null}

        {item.note ? (
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
        ) : null}

        <Stack
          direction="row"
          sx={{
            mt: 0.75,
            flexWrap: "wrap",
            alignContent: "flex-start",
            overflow: "hidden",
            columnGap: 0.5,
            rowGap: `${CHIP_ROW_GAP}px`,
            maxHeight: TAG_ROWS_MAX * CHIP_HEIGHT + (TAG_ROWS_MAX - 1) * CHIP_ROW_GAP,
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

      <CardActions sx={{ pt: 0, display: "flex", justifyContent: "space-between" }}>
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

export default function Page() {
  const theme = useAppTheme();

  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const [compactHeader, setCompactHeader] = useState(false);
  const lastYRef = useRef(0);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isMobile) {
      setCompactHeader(false);
      return;
    }

    lastYRef.current = window.scrollY || 0;

    const MIN_Y_TO_COMPACT = 80;
    const DELTA = 12;
    let ticking = false;

    const onScroll = () => {
      const y = window.scrollY || 0;
      if (ticking) return;
      ticking = true;

      window.requestAnimationFrame(() => {
        const dy = y - lastYRef.current;

        if (y < 24) {
          setCompactHeader(false);
        } else if (dy > DELTA && y > MIN_Y_TO_COMPACT) {
          setCompactHeader(true);
        } else if (dy < -DELTA) {
          setCompactHeader(false);
        }

        lastYRef.current = y;
        ticking = false;
      });
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [isMobile]);

  const [items, setItems] = useState<Item[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    try {
      const q = query(collection(db, "items"), orderBy("createdAt", "desc"));
      const unsub = onSnapshot(q, (snap) => {
        const arr: Item[] = snap.docs.map((d) => {
          const data = d.data() as Record<string, unknown>;
          const created = toEpochMillis(data.createdAt);
          const updated = data.updatedAt !== undefined ? toEpochMillis(data.updatedAt) : null;

          return {
            id: d.id,
            title: (data.title as string) ?? "",
            type: ((data.type as ItemType) ?? "memo") as ItemType,
            url: (data.url as string) ?? null,
            username: (data.username as string) ?? null,
            note: (data.note as string) ?? null,
            tags: Array.isArray(data.tags) ? (data.tags as string[]) : [],
            createdAt: created,
            updatedAt: updated,
            aiSummary: typeof data.aiSummary === "string" ? data.aiSummary : null,
            aiConfidence: typeof data.aiConfidence === "number" ? data.aiConfidence : null,
            aiModel: typeof data.aiModel === "string" ? data.aiModel : null,
          };
        });
        setItems(arr);
      });
      return () => unsub();
    } catch (e) {
      console.error(e);
      setErrorMsg("Firestoreの読み込みに失敗しました");
    }
  }, []);

  const [queryText, setQueryText] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | ItemType>("all");
  const [sortKey, setSortKey] = useState<"recent" | "title">("recent");
  const [addOpen, setAddOpen] = useState(false);
  const [detailItem, setDetailItem] = useState<Item | null>(null);
  const [editItem, setEditItem] = useState<Item | null>(null);

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

  const searched = useMemo(() => {
    const q = queryText.trim();
    if (!q) return itemsForSearch;

    const fuse = new Fuse(itemsForSearch, {
      keys: ["titleSearch", "usernameSearch", "noteSearch", "tagsSearch", "url"],
      threshold: 0.5,
      distance: 100,
      ignoreLocation: true,
    });

    return fuse.search(q).map((r) => r.item);
  }, [itemsForSearch, queryText]);

  const filtered = useMemo(() => {
    let arr = searched;

    if (typeFilter !== "all") arr = arr.filter((it) => it.type === typeFilter);

    if (sortKey === "title") {
      arr = [...arr].sort((a, b) => a.title.localeCompare(b.title));
    } else {
      arr = [...arr].sort((a, b) => b.createdAt - a.createdAt);
    }
    return arr;
  }, [searched, sortKey, typeFilter]);

  const deleteItem = async (id: string) => {
    await deleteDoc(doc(db, "items", id));
  };

  const saveNewItem = async (draft: {
    title: string;
    type: ItemType;
    url?: string;
    username?: string;
    note?: string;
  }) => {
    setErrorMsg(null);

    const contentLen = (draft.title?.trim().length || 0) + (draft.note?.trim().length || 0);
    if (contentLen < 3) {
      setErrorMsg("タイトル/メモが短すぎます（3文字以上にしてください）");
      return;
    }

    try {
      const ai = await requestAiTags(draft);

      await addDoc(collection(db, "items"), {
        title: draft.title,
        type: draft.type,
        url: draft.url ?? null,
        username: draft.username ?? null,
        note: draft.note ?? null,
        tags: ai.tags.slice(0, 12),
        aiSummary: ai.summary ?? null,
        aiConfidence: ai.confidence ?? null,
        aiModel: ai.model ?? null,
        createdAt: serverTimestamp(),
        lastTaggedAt: serverTimestamp(),
      });
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : "AIタグ生成に失敗しました");
    }
  };

  const updateExistingItem = async (
    id: string,
    patch: {
      title: string;
      type: ItemType;
      url?: string;
      username?: string;
      note?: string;
      tags?: string[];
      retagWithAI: boolean;
    }
  ) => {
    setErrorMsg(null);

    const contentLen = (patch.title?.trim().length || 0) + (patch.note?.trim().length || 0);
    if (contentLen < 3) {
      setErrorMsg("タイトル/メモが短すぎます（3文字以上にしてください）");
      return;
    }

    try {
      let tagsToSave: string[] = (patch.tags ?? []).slice(0, 12);
      let aiSummary: string | null = null;
      let aiConfidence: number | null = null;
      let aiModel: string | null = null;

      if (patch.retagWithAI) {
        const ai = await requestAiTags({
          title: patch.title,
          type: patch.type,
          url: patch.url,
          username: patch.username,
          note: patch.note,
        });
        tagsToSave = ai.tags.slice(0, 12);
        aiSummary = ai.summary ?? null;
        aiConfidence = ai.confidence ?? null;
        aiModel = ai.model ?? null;
      }

      await updateDoc(doc(db, "items", id), {
        title: patch.title,
        type: patch.type,
        url: patch.url ?? null,
        username: patch.username ?? null,
        note: patch.note ?? null,
        tags: tagsToSave,
        aiSummary,
        aiConfidence,
        aiModel,
        lastTaggedAt: patch.retagWithAI ? serverTimestamp() : null,
        updatedAt: serverTimestamp(),
      });
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : "更新に失敗しました");
    }
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />

      {errorMsg ? (
        <Alert severity="error" onClose={() => setErrorMsg(null)} sx={{ borderRadius: 0 }}>
          {errorMsg}
        </Alert>
      ) : null}

      <AppBar position="sticky" elevation={4}>
      <Toolbar
  sx={{
    transition: "all .2s",
    minHeight: isMobile && compactHeader ? 48 : undefined,
    px: isMobile && compactHeader ? 1 : 2,

    // ★ ここがポイント：3カラムにして中央を固定
    display: "grid",
    gridTemplateColumns:
      isMobile && compactHeader
        ? "1fr auto 1fr"
        : "1fr minmax(260px, 560px) 1fr",
    alignItems: "center",
    columnGap: 16,
  }}
>
  {/* 左：タイトル */}
  <Typography
    variant={isMobile && compactHeader ? "subtitle1" : "h6"}
    fontWeight={900}
    sx={{ whiteSpace: "nowrap", justifySelf: "start" }}
  >
    AI Tag Box
  </Typography>

  {/* 中央：検索 */}
  {isMobile && compactHeader ? (
    <IconButton
      aria-label="検索を表示"
      sx={{ justifySelf: "center" }}
      onClick={() => {
        setCompactHeader(false);
        setTimeout(() => searchRef.current?.focus(), 0);
      }}
    >
      🔎
    </IconButton>
  ) : (
    <TextField
      inputRef={searchRef}
      placeholder="検索 (タイトル・タグ・URL)"
      value={queryText}
      onChange={(e) => setQueryText(e.target.value)}
      InputProps={{
        startAdornment: <InputAdornment position="start">🔎</InputAdornment>,
      }}
      sx={{
        justifySelf: "center",
        width: "100%", // ★ 中央カラムいっぱいを使う
      }}
    />
  )}

  {/* 右：ダミー（中央ズレ防止用） */}
  <Box sx={{ justifySelf: "end" }} />
</Toolbar>


        <Collapse in={!isMobile || !compactHeader} timeout={180} unmountOnExit>
          <Toolbar sx={{ justifyContent: "center", gap: 2, pt: 0 }}>
            <FormControl size="small" sx={{ minWidth: 140 }}>
              <InputLabel>種類</InputLabel>
              <Select
                label="種類"
                value={typeFilter}
                onChange={(e: SelectChangeEvent) => setTypeFilter(e.target.value as "all" | ItemType)}
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
                onChange={(e: SelectChangeEvent) => setSortKey(e.target.value as "recent" | "title")}
              >
                <MenuItem value="recent">新着順</MenuItem>
                <MenuItem value="title">タイトル順</MenuItem>
              </Select>
            </FormControl>

            <Button variant="outlined" onClick={() => setAddOpen(true)}>
              ＋ 追加
            </Button>
          </Toolbar>
        </Collapse>
      </AppBar>

      <Container maxWidth="lg" sx={{ py: 3 }}>
        {filtered.length === 0 ? (
          <Paper sx={{ p: 4, textAlign: "center", opacity: 0.85 }}>
            <Typography fontWeight={900}>該当するデータがありません</Typography>
            <Typography variant="body2" sx={{ mt: 1, opacity: 0.8 }}>
              検索条件を変えるか、「＋追加」から登録できます
            </Typography>
          </Paper>
        ) : null}

        <Box
          sx={{
            display: "grid",
            gap: { xs: 2.5, sm: 3 },
            gridTemplateColumns: {
              xs: "1fr",
              sm: "repeat(2, 1fr)",
              md: "repeat(3, 1fr)",
              lg: "repeat(4, 1fr)",
            },
            alignItems: "stretch",
            mt: filtered.length === 0 ? 2 : 0,
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
                <Typography fontWeight={900}>＋</Typography>
                <Typography variant="body2" sx={{ opacity: 0.8 }}>
                  新しい情報を登録
                </Typography>
              </Stack>
            </PlusCard>
          </Box>
        </Box>
      </Container>

      <AddItemDialog open={addOpen} onClose={() => setAddOpen(false)} onSave={saveNewItem} />

      <ItemDetailDialog
        item={detailItem}
        open={!!detailItem}
        onClose={() => setDetailItem(null)}
        onEdit={(item) => {
          setDetailItem(null);
          setEditItem(item);
        }}
      />

      <EditItemDialog
        item={editItem}
        open={!!editItem}
        onClose={() => setEditItem(null)}
        onSave={(id, patch) => updateExistingItem(id, patch)}
      />
    </ThemeProvider>
  );
}

