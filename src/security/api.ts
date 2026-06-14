import { invoke } from "@tauri-apps/api/core";
import type { WealthState } from "../domain/types";

export interface VaultInitialization {
  recoveryKey: string;
}

export function isDesktopApp(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

export async function getVaultStatus(): Promise<boolean> {
  if (!isDesktopApp()) return true;
  return invoke<boolean>("vault_status");
}

export async function initializeVault(
  password: string,
): Promise<VaultInitialization> {
  return invoke<VaultInitialization>("initialize", { password });
}

export async function unlockVault(password: string): Promise<boolean> {
  return invoke<boolean>("unlock", { password });
}

export async function lockVault(): Promise<void> {
  if (isDesktopApp()) {
    await invoke("lock");
  }
}

export async function loadWealthData(): Promise<WealthState> {
  if (!isDesktopApp()) {
    const stored = localStorage.getItem("wealth-compass-preview-data");
    return stored ? (JSON.parse(stored) as WealthState) : emptyWealthState();
  }
  return invoke<WealthState>("load_data");
}

export async function saveWealthData(data: WealthState): Promise<WealthState> {
  if (!isDesktopApp()) {
    localStorage.setItem("wealth-compass-preview-data", JSON.stringify(data));
    return data;
  }
  return invoke<WealthState>("save_data", { data });
}

export function emptyWealthState(): WealthState {
  return {
    accounts: [],
    properties: [],
    liabilities: [],
    positions: [],
    transactions: [],
    targets: {
      month: "2026-07",
      netWorthGrowth: 0,
      netCashFlow: 0,
      investmentReturn: 0,
    },
    openingNetWorth: 0,
  };
}
