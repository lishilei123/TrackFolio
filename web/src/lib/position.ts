import type { Position } from "../types";

export function unitCostWithFee(position: Pick<Position, "avg_cost" | "quantity" | "total_fee">): number | null {
  if (position.quantity <= 0) return null;
  return (position.avg_cost * position.quantity + position.total_fee) / position.quantity;
}
