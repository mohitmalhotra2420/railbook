import { env } from "./env.js";

export interface WalletTxn {
  id: string;
  type: "CREDIT" | "DEBIT";
  amount: number;
  note: string;
  at: string;
}

export interface WalletState {
  balance: number;
  currency: "INR";
  transactions: WalletTxn[];
}

const wallets = new Map<string, WalletState>();

function fresh(): WalletState {
  return {
    balance: env.walletInitial,
    currency: "INR",
    transactions: [
      {
        id: "seed",
        type: "CREDIT",
        amount: env.walletInitial,
        note: "Opening balance",
        at: new Date().toISOString(),
      },
    ],
  };
}

export function getWallet(userId = "demo"): WalletState {
  if (!wallets.has(userId)) wallets.set(userId, fresh());
  return wallets.get(userId)!;
}

export function addMoney(amount: number, userId = "demo"): WalletState {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw Object.assign(new Error("Enter a valid amount."), { status: 400 });
  }
  const w = getWallet(userId);
  w.balance += Math.round(amount);
  w.transactions.unshift({
    id: `txn-${Date.now()}`,
    type: "CREDIT",
    amount: Math.round(amount),
    note: "Added money",
    at: new Date().toISOString(),
  });
  return w;
}

export function debit(
  amount: number,
  note: string,
  userId = "demo",
): WalletState {
  const w = getWallet(userId);
  if (w.balance < amount) {
    throw Object.assign(new Error("Insufficient wallet balance."), {
      status: 402,
      code: "INSUFFICIENT_FUNDS",
      wallet: w,
    });
  }
  w.balance -= amount;
  w.transactions.unshift({
    id: `txn-${Date.now()}`,
    type: "DEBIT",
    amount,
    note,
    at: new Date().toISOString(),
  });
  return w;
}

export function credit(
  amount: number,
  note: string,
  userId = "demo",
): WalletState {
  const w = getWallet(userId);
  w.balance += amount;
  w.transactions.unshift({
    id: `txn-${Date.now()}`,
    type: "CREDIT",
    amount,
    note,
    at: new Date().toISOString(),
  });
  return w;
}

export function resetWallet(userId = "demo"): void {
  wallets.set(userId, fresh());
}
