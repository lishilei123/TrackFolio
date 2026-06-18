import { z } from "zod";
import { FX_PROVIDER_NAMES } from "../providers/fx/index.js";
import { isValidTimeZone } from "./timezone.js";
import { ASSET_TYPES, CURRENCIES, DEFAULT_CURRENCY, MARKETS } from "./types.js";
import type { AssetType, Currency, Market } from "./types.js";

/** 各市场代码格式校验（需求 5.2 添加校验） */
const SYMBOL_PATTERNS: Record<Market, RegExp> = {
  CN: /^\d{6}$/, // A股/基金 6 位数字
  HK: /^\d{4,5}$/, // 港股 4-5 位数字
  US: /^[A-Z]{1,6}(\.[A-Z]{1,3})?$/, // 美股字母代码
};

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isDateTimeInput(value: string): boolean {
  if (isIsoDate(value)) return true;
  const datePrefix = value.match(/^(\d{4}-\d{2}-\d{2})(?:[T\s]|$)/)?.[1];
  if (datePrefix && !isIsoDate(datePrefix)) return false;
  return Number.isFinite(Date.parse(value));
}

const isoDateSchema = z.string().trim().refine(isIsoDate, "需要 YYYY-MM-DD 日期");
const dateTimeSchema = z.string().trim().min(1).refine(isDateTimeInput, "需要有效日期");

export function isValidSymbol(market: Market, symbol: string): boolean {
  return SYMBOL_PATTERNS[market].test(symbol);
}

export function defaultCurrencyFor(market: Market): Currency {
  return DEFAULT_CURRENCY[market];
}

export const createAssetSchema = z
  .object({
    asset_type: z.enum(ASSET_TYPES as [AssetType, ...AssetType[]]),
    market: z.enum(MARKETS as [Market, ...Market[]]),
    symbol: z.string().trim().min(1).transform((s) => s.toUpperCase()),
    name: z.string().trim().min(1),
    currency: z.enum(CURRENCIES as [Currency, ...Currency[]]).optional(),
    exchange: z.string().trim().optional().nullable(),
    fund_type: z.string().trim().optional().nullable(), // 'etf' | 'otc' | ...
    allow_custom: z.boolean().optional(), // 行情不可用时允许保存为自定义标的
  })
  .refine((d) => isValidSymbol(d.market, d.symbol) || d.allow_custom === true, {
    message: "资产代码不符合所选市场格式",
    path: ["symbol"],
  });

export type CreateAssetBody = z.infer<typeof createAssetSchema>;

export const allocationImportItemSchema = z
  .object({
    asset_type: z.enum(ASSET_TYPES as [AssetType, ...AssetType[]]),
    market: z.enum(MARKETS as [Market, ...Market[]]),
    symbol: z.string().trim().min(1).transform((s) => s.toUpperCase()),
    name: z.string().trim().min(1),
    currency: z.enum(CURRENCIES as [Currency, ...Currency[]]).optional(),
    exchange: z.string().trim().optional().nullable(),
    fund_type: z.string().trim().optional().nullable(),
    allow_custom: z.boolean().optional(),
    quantity: z.number().finite().positive(),
    avg_cost: z.number().finite().nonnegative(),
    total_fee: z.number().finite().nonnegative().optional(),
    opened_at: dateTimeSchema.optional().nullable(),
    tags: z.array(z.string().trim()).optional().transform((tags) => tags?.filter(Boolean)),
    note: z.string().optional().nullable(),
  })
  .refine((d) => isValidSymbol(d.market, d.symbol) || d.allow_custom === true, {
    message: "资产代码不符合所选市场格式",
    path: ["symbol"],
  });

export const allocationImportSchema = z.object({
  schema: z.literal("trackfolio.assetAllocation.v1"),
  holdings: z.array(allocationImportItemSchema).min(1, "至少需要 1 项资产配置").max(500, "单次最多导入 500 项"),
  mode: z.enum(["skip_existing", "append"]).optional().default("skip_existing"),
});

export type AllocationImportBody = z.infer<typeof allocationImportSchema>;
export type AllocationImportItem = z.infer<typeof allocationImportItemSchema>;

/** 交易流水录入（成本由交易加权平均自动推算，需求 7.3 / 5.3） */
export const createTransactionSchema = z.object({
  side: z.enum(["BUY", "SELL"]),
  quantity: z.number().finite().positive(),
  price: z.number().finite().nonnegative(),
  fee: z.number().finite().nonnegative().optional(),
  trade_time: dateTimeSchema.optional().nullable(),
  note: z.string().optional().nullable(),
  // 仅首次建仓时用于初始化持仓级元数据
  tags: z.array(z.string()).optional(),
});

export const updateTransactionSchema = createTransactionSchema
  .omit({ tags: true })
  .partial()
  .refine((d) => Object.keys(d).length > 0, { message: "至少提供一个要修改的字段" });

/** 批量录入交易（基金定投补录：一次生成多期 BUY 流水，需求 5.3 加权平均自动重算） */
export const createBatchTransactionsSchema = z
  .object({
    side: z.enum(["BUY", "SELL"]).optional(), // 默认 BUY；定投补录为买入
    transactions: z
      .array(
        z.object({
          quantity: z.number().finite().positive(),
          price: z.number().finite().nonnegative(),
          fee: z.number().finite().nonnegative().optional(),
          trade_time: dateTimeSchema.optional().nullable(),
          note: z.string().optional().nullable(),
        }),
      )
      .max(500, "单次最多 500 期"),
    // 净值待披露的定投期，存为「待确认」占位，由后台任务披露后自动折算补录
    pending: z
      .array(
        z.object({
          trade_time: isoDateSchema, // 份额确认日（= 收益起算日）
          nav_date: isoDateSchema, // 申购成交日（净值对应日）
          sip_mode: z.enum(["amount", "shares"]),
          per_value: z.number().finite().positive(),
          fee: z.number().finite().nonnegative().optional(),
          note: z.string().optional().nullable(),
        }),
      )
      .max(500, "单次最多 500 期")
      .optional(),
    // 仅首次建仓时用于初始化持仓级元数据
    tags: z.array(z.string()).optional(),
  })
  .refine((d) => d.transactions.length + (d.pending?.length ?? 0) >= 1, {
    message: "至少需要一期",
    path: ["transactions"],
  });

/** 持仓只允许编辑元数据；数量/成本由交易流水推算，不可手改 */
export const updatePositionSchema = z.object({
  opened_at: dateTimeSchema.optional().nullable(),
  tags: z.array(z.string()).optional(),
  note: z.string().optional().nullable(),
});

export const closePositionSchema = z.object({
  price: z.number().finite().nonnegative().optional(),
  fee: z.number().finite().nonnegative().optional(),
  trade_time: dateTimeSchema.optional().nullable(),
  note: z.string().optional().nullable(),
});

/** 历史盈亏查询（需求 5.5.4） */
export const historyQuerySchema = z.object({
  range: z.enum(["7d", "30d", "90d", "ytd", "custom"]).optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  granularity: z.enum(["day", "week", "month", "year"]).optional(),
  currency: z.enum(CURRENCIES as [Currency, ...Currency[]]).optional(),
  asset_id: z.string().optional(),
});

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "需为 #RRGGBB 格式");

export const customThemeSchema = z.object({
  base: z.enum(["dark", "light"]),
  accent: hexColor,
  bg: hexColor,
  surface: hexColor,
  border: hexColor,
  text: hexColor,
  textDim: hexColor,
});

export const updateDisplaySchema = z.object({
  settlement_currency: z.enum(CURRENCIES as [Currency, ...Currency[]]).optional(),
  settlement_timezone: z.string().trim().min(1).max(64).refine(isValidTimeZone, "不支持的时区").optional(),
  show_original_currency: z.boolean().optional(),
  use_us_premarket_pnl: z.boolean().optional(),
  exchange_rate_provider: z.enum(FX_PROVIDER_NAMES).optional(),
  theme: z.enum(["dark", "light", "auto", "custom"]).optional(),
  quote_refresh_interval: z.number().int().min(5).max(600).optional(),
  pnl_color_scheme: z.enum(["green_up", "red_up", "custom"]).optional(),
  pnl_up_color: hexColor.optional(),
  pnl_down_color: hexColor.optional(),
  pnl_flat_color: hexColor.optional(),
  custom_theme: customThemeSchema.nullable().optional(),
  // 背景图：data:image/ 开头的 base64；上限 ~8MB 防滥用
  background_image: z
    .string()
    .regex(/^data:image\/[a-z+]+;base64,/, "需为图片 data URL")
    .max(8_000_000)
    .nullable()
    .optional(),
  background_dim: z.number().min(0).max(0.9).optional(),
  background_blur: z.number().int().min(0).max(40).optional(),
});

export const adminUnlockSchema = z.object({
  password: z.string().trim().min(1, "请输入后台密码"),
  captcha_id: z.string().optional(),
  captcha_answer: z.union([z.string(), z.number()]).optional(),
});

export const adminChangePasswordSchema = z.object({
  current_password: z.string().min(1),
  new_password: z.string().min(4, "新密码至少 4 位"),
});
