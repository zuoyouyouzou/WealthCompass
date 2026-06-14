import type { WealthState } from "./types";

export interface WealthMetrics {
  liquidAssets: number;
  investmentAssets: number;
  propertyAssets: number;
  liabilities: number;
  propertyEquity: number;
  netWorth: number;
  netWorthGrowth: number;
  income: number;
  expenses: number;
  netCashFlow: number;
  stockReturn: number;
  optionReturn: number;
  investmentReturn: number;
  unexplainedDifference: number;
}

export function calculateMetrics(state: WealthState): WealthMetrics {
  const liquidAssets = sum(state.accounts.map((account) => account.balance));
  const investmentAssets = sum(
    state.positions.map((position) => position.marketValue),
  );
  const propertyAssets = sum(
    state.properties.map((property) => property.valuation),
  );
  const liabilities = sum(
    state.liabilities.map((liability) => liability.balance),
  );
  const income = sum(
    state.transactions
      .filter((transaction) => transaction.kind === "income")
      .map((transaction) => transaction.amount),
  );
  const expenses = sum(
    state.transactions
      .filter((transaction) => transaction.kind === "expense")
      .map((transaction) => transaction.amount),
  );
  const stockReturn = sum(
    state.positions
      .filter((position) => position.assetClass === "stock")
      .map(
        (position) =>
          position.marketValue - position.costBasis + position.realizedProfit,
      ),
  );
  const optionReturn = sum(
    state.positions
      .filter((position) => position.assetClass === "option")
      .map(
        (position) =>
          position.marketValue - position.costBasis + position.realizedProfit,
      ),
  );
  const netWorth =
    liquidAssets + investmentAssets + propertyAssets - liabilities;
  const netWorthGrowth = netWorth - state.openingNetWorth;
  const netCashFlow = income - expenses;
  const investmentReturn = stockReturn + optionReturn;

  return {
    liquidAssets,
    investmentAssets,
    propertyAssets,
    liabilities,
    propertyEquity: propertyAssets - liabilities,
    netWorth,
    netWorthGrowth,
    income,
    expenses,
    netCashFlow,
    stockReturn,
    optionReturn,
    investmentReturn,
    unexplainedDifference: netWorthGrowth - netCashFlow - investmentReturn,
  };
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
