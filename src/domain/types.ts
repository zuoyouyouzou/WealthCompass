export type AccountKind =
  | "bank"
  | "alipay"
  | "brokerage"
  | "options"
  | "custom";

export type TransactionKind = "income" | "expense" | "transfer";

export interface Account {
  id: string;
  name: string;
  kind: AccountKind;
  balance: number;
  updatedAt: string;
}

export interface PropertyAsset {
  id: string;
  name: string;
  valuation: number;
  updatedAt: string;
}

export interface Liability {
  id: string;
  name: string;
  balance: number;
  propertyId?: string;
  updatedAt: string;
}

export interface InvestmentPosition {
  id: string;
  accountId: string;
  symbol: string;
  name: string;
  marketValue: number;
  costBasis: number;
  realizedProfit: number;
  assetClass: "stock" | "option";
}

export interface Transaction {
  id: string;
  date: string;
  kind: TransactionKind;
  amount: number;
  category: string;
  accountId: string;
  targetAccountId?: string;
  note?: string;
}

export interface MonthlyTargets {
  month: string;
  netWorthGrowth: number;
  netCashFlow: number;
  investmentReturn: number;
}

export interface WealthState {
  accounts: Account[];
  properties: PropertyAsset[];
  liabilities: Liability[];
  positions: InvestmentPosition[];
  transactions: Transaction[];
  targets: MonthlyTargets;
  openingNetWorth: number;
}
