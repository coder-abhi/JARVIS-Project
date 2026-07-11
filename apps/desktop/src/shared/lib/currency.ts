import { getWealthData } from "@/lib/api";

export type Currency = "INR" | "USD" | "EUR" | "GBP";

export const DEFAULT_CURRENCY: Currency = "INR";

export function normalizeCurrency(value: unknown): Currency {
  return value === "USD" || value === "EUR" || value === "GBP" ? value : DEFAULT_CURRENCY;
}

export function formatCurrency(value: number, currency: Currency) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
}

export async function getPreferredCurrency(): Promise<Currency> {
  try {
    const data = await getWealthData<{ currency?: unknown }>();
    return normalizeCurrency(data && typeof data === "object" ? data.currency : undefined);
  } catch {
    return DEFAULT_CURRENCY;
  }
}
