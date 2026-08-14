"use client";
/**
 * Thin re-export so existing `useWallet()` call sites keep working.
 * The actual state lives once in WalletContext (see WalletContext.tsx);
 * previously every caller built its own provider and event listeners.
 */
export { useWalletContext as useWallet, type WalletState } from "./WalletContext";
