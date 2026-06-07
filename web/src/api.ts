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
  return localStorage.getItem(ADMIN_TOKEN_KEY);
}

function saveAdminToken(token: string | null | undefined): void {
  if (token) localStorage.setItem(ADMIN_TOKEN_KEY, token);
}

function clearAdminToken(): void {
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
  updateTransaction: (id: string, body: UpdateTransactionInput) =>
    http<TransactionMutationResult>(`/transactions/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteTransaction: (id: string) => http<TransactionMutationResult>(`/transactions/${id}`, { method: "DELETE" }),
  closePosition: (id: string, body?: ClosePositionInput) =>
    http<TransactionMutationResult>(`/positions/${id}/close`, { method: "POST", body: JSON.stringify(body ?? {}) }),
  deletePosition: (id: string) => http<void>(`/positions/${id}`, { method: "DELETE" }),
};
