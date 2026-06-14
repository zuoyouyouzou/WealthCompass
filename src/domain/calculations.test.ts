import { describe, expect, it } from "vitest";
import { calculateMetrics } from "./calculations";
import type { WealthState } from "./types";

const fixture: WealthState = {
  accounts: [
    {
      id: "bank",
      name: "银行卡",
      kind: "bank",
      balance: 100_000,
      updatedAt: "2026-07-01",
    },
  ],
  properties: [
    {
      id: "home",
      name: "自住房",
      valuation: 2_000_000,
      updatedAt: "2026-07-01",
    },
  ],
  liabilities: [
    {
      id: "mortgage",
      name: "房贷",
      balance: 1_000_000,
      propertyId: "home",
      updatedAt: "2026-07-01",
    },
  ],
  positions: [
    {
      id: "stock",
      accountId: "broker",
      symbol: "600000",
      name: "示例股票",
      marketValue: 55_000,
      costBasis: 50_000,
      realizedProfit: 1_000,
      assetClass: "stock",
    },
    {
      id: "option",
      accountId: "option-account",
      symbol: "IO2607-C-4000",
      name: "示例期权",
      marketValue: 9_000,
      costBasis: 10_000,
      realizedProfit: 500,
      assetClass: "option",
    },
  ],
  transactions: [
    {
      id: "salary",
      date: "2026-07-02",
      kind: "income",
      amount: 20_000,
      category: "工资",
      accountId: "bank",
    },
    {
      id: "expense",
      date: "2026-07-03",
      kind: "expense",
      amount: 5_000,
      category: "生活",
      accountId: "bank",
    },
    {
      id: "transfer",
      date: "2026-07-04",
      kind: "transfer",
      amount: 10_000,
      category: "内部转账",
      accountId: "bank",
      targetAccountId: "broker",
    },
  ],
  targets: {
    month: "2026-07",
    netWorthGrowth: 30_000,
    netCashFlow: 15_000,
    investmentReturn: 10_000,
  },
  openingNetWorth: 1_150_000,
};

describe("calculateMetrics", () => {
  it("does not count internal transfers as income or expense", () => {
    const metrics = calculateMetrics(fixture);
    expect(metrics.income).toBe(20_000);
    expect(metrics.expenses).toBe(5_000);
    expect(metrics.netCashFlow).toBe(15_000);
  });

  it("calculates net worth and property equity", () => {
    const metrics = calculateMetrics(fixture);
    expect(metrics.propertyEquity).toBe(1_000_000);
    expect(metrics.netWorth).toBe(1_164_000);
    expect(metrics.netWorthGrowth).toBe(14_000);
  });

  it("separates stock and option returns", () => {
    const metrics = calculateMetrics(fixture);
    expect(metrics.stockReturn).toBe(6_000);
    expect(metrics.optionReturn).toBe(-500);
    expect(metrics.investmentReturn).toBe(5_500);
  });
});
