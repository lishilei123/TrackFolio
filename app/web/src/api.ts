import type {
  AdminCaptcha,
  AdminSession,
  AdminSettingsResponse,
  Asset,
  Currency,
  DisplaySetting,
  FxResponse,
  Granularity,
  HistoryRange,
  HistoryResponse,
  Meta,
  PortfolioResponse,
  Position,
  RefreshResult,
  RevalidateResult,
  SearchResult,
  Transaction,
} from "./types";

const BASE = "/api";
const ADMIN_TOKEN_KEY = "trackfolio_admin_token";

function getAdminToken(): string | null {
  return sessionStorage.getItem(ADMIN_TOKEN_KEY);
}

function saveAdminToken(token: string | null | undefined): void {
  if (token) sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
  localStorage.removeItem(ADMIN_TOKEN_KEY);
}

function clearAdminToken(): void {
  sessionStorage.removeItem(ADMIN_TOKEN_KEY);
  localStorage.removeItem(ADMIN_TOKEN_KEY);
}

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  // 仅在带 body 时声明 JSON 类型：Fastify 会拒绝 content-type 为 application/json 的空 body（400 Bad Request）
  if (init?.body != null) headers.set("Content-Type", "application/json");
  const adminToken = getAdminToken();
  if (adminToken) headers.set("X-Admin-Token", adminToken);

  const res = await fetch(BASE + path, {
    ...init,
    headers,
  });
  if (!res.ok) {
    let detail: unknown;
    try {
      detail = await res.json();
    } catch {
      detail = await res.text();
    }
    if (res.status === 401 && (detail as { error?: string })?.error === "请先输入后台密码") clearAdminToken();
    const msg =
      (detail as { error?: string })?.error ?? `请求失败 (${res.status})`;
    throw new ApiError(msg, res.status, detail);
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json() as T;
  const token = (data as { token?: string })?.token;
  if (token) saveAdminToken(token);
  return data;
}

export class ApiError extends Error {
  constructor(message: string, public status: number, public detail: unknown) {
    super(message);
  }
}

export interface CreateAssetInput {
  asset_type: Asset["asset_type"];
  market: Asset["market"];
  symbol: string;
  name: string;
  currency?: Currency;
  fund_type?: string | null;
  allow_custom?: boolean;
}

export interface CreateTransactionInput {
  side: "BUY" | "SELL";
  quantity: number;
  price: number;
  fee?: number;
  trade_time?: string | null;
  note?: string | null;
  tags?: string[];
}

export type UpdateTransactionInput = Partial<Omit<CreateTransactionInput, "tags">>;

export interface BatchTransactionItem {
  quantity: number;
  price: number;
  fee?: number;
  trade_time?: string | null;
  note?: string | null;
}

/** 净值待披露的定投期，存为「待确认」占位，由后台任务披露后自动折算补录 */
export interface PendingSipItem {
  trade_time: string; // 份额确认日（yyyy-mm-dd，= 收益起算日）
  nav_date: string; // 申购成交日（净值对应日）
  sip_mode: "amount" | "shares";
  per_value: number; // 每期金额或份额
  fee?: number;
  note?: string | null;
}

export interface PendingSipOrder extends PendingSipItem {
  id: string;
  asset_id: string;
  side: "BUY";
  fee: number;
  currency: string;
  tags: string[] | null;
  created_at: string;
}

export interface CreateBatchTransactionsInput {
  side?: "BUY" | "SELL";
  transactions: BatchTransactionItem[];
  pending?: PendingSipItem[];
  tags?: string[];
}

export interface BatchTransactionResult {
  transactions: Transaction[];
  count: number;
  pending: PendingSipOrder[];
  position: Position | null;
  history_recompute?: TransactionMutationResult["history_recompute"];
}

export interface ClosePositionInput {
  price?: number;
  fee?: number;
  trade_time?: string | null;
  note?: string | null;
}

export interface TransactionMutationResult {
  transaction?: Transaction;
  position: Position | null;
  history_recompute?: {
    asset_id: string;
    status: "ok" | "skipped" | "failed";
    rows: number;
    from: string | null;
    reason?: string;
  };
}

export const api = {
  meta: () => http<Meta>("/meta"),
  portfolio: (currency?: Currency) =>
    http<PortfolioResponse>(`/portfolio${currency ? `?currency=${currency}` : ""}`),
  refresh: () => http<RefreshResult>("/refresh", { method: "POST" }),
  fx: (target?: Currency) => http<FxResponse>(`/fx${target ? `?target=${target}` : ""}`),
  refreshFx: () => http<RefreshResult["fx"]>("/fx/refresh", { method: "POST" }),

  adminSession: () => http<AdminSession>("/admin/session"),
  adminCaptcha: () => http<AdminCaptcha>("/admin/captcha"),
  adminUnlock: (password: string, captcha?: { id: string; answer: string }) =>
    http<AdminSession>("/admin/unlock", {
      method: "POST",
      body: JSON.stringify(
        captcha ? { password, captcha_id: captcha.id, captcha_answer: captcha.answer } : { password },
      ),
    }),
  adminLock: async () => {
    const session = await http<AdminSession>("/admin/lock", { method: "POST" });
    clearAdminToken();
    return session;
  },
  adminGetSettings: () => http<AdminSettingsResponse>("/admin/settings"),
  adminUpdateSettings: (body: Partial<DisplaySetting>) =>
    http<AdminSettingsResponse>("/admin/settings", { method: "PATCH", body: JSON.stringify(body) }),
  adminValidate: () => http<RevalidateResult>("/admin/validate", { method: "POST" }),
  adminChangePassword: async (currentPassword: string, newPassword: string) => {
    const res = await http<{ ok: true; security: AdminSession }>("/admin/password", {
      method: "POST",
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
    });
    clearAdminToken();
    return res;
  },

  history: (params: { range: HistoryRange | "custom"; currency?: Currency; granularity?: Granularity; from?: string; to?: string; asset_id?: string }) => {
    const qs = new URLSearchParams({ range: params.range });
    if (params.currency) qs.set("currency", params.currency);
    if (params.granularity) qs.set("granularity", params.granularity);
    if (params.from) qs.set("from", params.from);
    if (params.to) qs.set("to", params.to);
    if (params.asset_id) qs.set("asset_id", params.asset_id);
    return http<HistoryResponse>(`/history?${qs.toString()}`);
  },

  getDisplay: () => http<DisplaySetting>("/settings/display"),
  updateDisplay: (body: Partial<DisplaySetting>) =>
    http<DisplaySetting>("/settings/display", { method: "PATCH", body: JSON.stringify(body) }),

  search: (q: string) =>
    http<{ results: SearchResult[] }>(`/search?q=${encodeURIComponent(q)}`).then((r) => r.results),

  // 场外基金历史单位净值（定投补录自动填净值用）
  fundNavHistory: (symbol: string, from?: string, to?: string) => {
    const qs = new URLSearchParams({ symbol });
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    return http<{ points: { date: string; close: number }[] }>(`/fund-nav-history?${qs.toString()}`);
  },

  createAsset: (body: CreateAssetInput) =>
    http<Asset>("/assets", { method: "POST", body: JSON.stringify(body) }),
  deleteAsset: (id: string) => http<void>(`/assets/${id}`, { method: "DELETE" }),

  // 录入/编辑/删除交易（成本与历史盈亏由后端按交易流水重算）
  listTransactions: (assetId: string) => http<Transaction[]>(`/assets/${assetId}/transactions`),
  createTransaction: (assetId: string, body: CreateTransactionInput) =>
    http<TransactionMutationResult>(`/assets/${assetId}/transactions`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  createTransactionsBatch: (assetId: string, body: CreateBatchTransactionsInput) =>
    http<BatchTransactionResult>(`/assets/${assetId}/transactions/batch`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateTransaction: (id: string, body: UpdateTransactionInput) =>
    http<TransactionMutationResult>(`/transactions/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteTransaction: (id: string) => http<TransactionMutationResult>(`/transactions/${id}`, { method: "DELETE" }),

  // 定投「待确认」占位（净值待披露，后台自动回填）
  listPendingSip: (assetId: string) => http<PendingSipOrder[]>(`/assets/${assetId}/pending-sip`),
  deletePendingSip: (id: string) => http<{ ok: boolean }>(`/pending-sip/${id}`, { method: "DELETE" }),
  closePosition: (id: string, body?: ClosePositionInput) =>
    http<TransactionMutationResult>(`/positions/${id}/close`, { method: "POST", body: JSON.stringify(body ?? {}) }),
  deletePosition: (id: string) => http<void>(`/positions/${id}`, { method: "DELETE" }),
};
