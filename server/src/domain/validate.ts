import { z } from "zod";
import { FX_PROVIDER_NAMES } from "../providers/fx/index.js";
import { ASSET_TYPES, CURRENCIES, DEFAULT_CURRENCY, MARKETS } from "./types.js";
import type { AssetType, Currency, Market } from "./types.js";

/** 各市场代码格式校验（需求 5.2 添加校验） */
const SYMBOL_PATTERNS: Record<Market, RegExp> = {
  CN: /^\d{6}$/, // A股/基金 6 位数字
  HK: /^\d{4,5}$/, // 港股 4-5 位数字
  US: /^[A-Z]{1,6}(\.[A-Z]{1,3})?$/, // 美股字母代码
};

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

/** 交易流水录入（成本由交易加权平均自动推算，需求 7.3 / 5.3） */
export const createTransactionSchema = z.object({
  side: z.enum(["BUY", "SELL"]),
  quantity: z.number().finite().positive(),
  price: z.number().finite().nonnegative(),
  fee: z.number().finite().nonnegative().optional(),
  trade_time: z.string().optional().nullable(),
  note: z.string().optional().nullable(),
  // 仅首次建仓时用于初始化持仓级元数据
  tags: z.array(z.string()).optional(),
});

export const updateTransactionSchema = createTransactionSchema
  .omit({ tags: true })
  .partial()
  .refine((d) => Object.keys(d).length > 0, { message: "至少提供一个要修改的字段" });

/** 批量录入交易（基金定投补录：一次生成多期 BUY 流水，需求 5.3 加权平均自动重算） */
export const createBatchTransactionsSchema = z.object({
  side: z.enum(["BUY", "SELL"]).optional(), // 默认 BUY；定投补录为买入
  transactions: z
    .array(
      z.object({
        quantity: z.number().finite().positive(),
        price: z.number().finite().nonnegative(),
        fee: z.number().finite().nonnegative().optional(),
        trade_time: z.string().optional().nullable(),
        note: z.string().optional().nullable(),
      }),
    )
    .min(1, "至少需要一期")
    .max(500, "单次最多 500 期"),
  // 仅首次建仓时用于初始化持仓级元数据
  tags: z.array(z.string()).optional(),
});

/** 持仓只允许编辑元数据；数量/成本由交易流水推算，不可手改 */
export const updatePositionSchema = z.object({
  opened_at: z.string().optional().nullable(),
  tags: z.array(z.string()).optional(),
  note: z.string().optional().nullable(),
});

export const closePositionSchema = z.object({
  price: z.number().finite().nonnegative().optional(),
  fee: z.number().finite().nonnegative().optional(),
  trade_time: z.string().optional().nullable(),
  note: z.string().optional().nullable(),
});

/** 历史盈亏查询（需求 5.5.4） */
export const historyQuerySchema = z.object({
  range: z.enum(["7d", "30d", "90d", "ytd", "custom"]).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
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
  show_original_currency: z.boolean().optional(),
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
