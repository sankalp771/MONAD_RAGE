"use client";
import { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import { TARGET_CHAIN } from "./contract";

type EthereumProvider = ethers.Eip1193Provider & {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
};

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

export interface WalletState {
  address: string | null;
  signer: ethers.JsonRpcSigner | null;
  provider: ethers.BrowserProvider | null;
  chainId: number | null;
  isConnecting: boolean;
  isWrongNetwork: boolean;
  connect: () => Promise<void>;
  switchNetwork: () => Promise<void>;
}

export function useWallet(): WalletState {
  const [address, setAddress]       = useState<string | null>(null);
  const [signer, setSigner]         = useState<ethers.JsonRpcSigner | null>(null);
  const [provider, setProvider]     = useState<ethers.BrowserProvider | null>(null);
  const [chainId, setChainId]       = useState<number | null>(null);
  const [isConnecting, setConnecting] = useState(false);

  const isWrongNetwork = chainId !== null && chainId !== TARGET_CHAIN.id;

  const init = useCallback(async (eth: typeof window.ethereum) => {
    if (!eth) return;
    const prov = new ethers.BrowserProvider(eth);
    const network = await prov.getNetwork();
    const accounts = await prov.listAccounts();
    if (accounts.length > 0) {
      const s = await prov.getSigner();
      setProvider(prov);
      setSigner(s);
      setAddress(await s.getAddress());
      setChainId(Number(network.chainId));
    }
  }, []);

  // Auto-connect if wallet already approved
  useEffect(() => {
    if (window.ethereum) init(window.ethereum);
  }, [init]);

  // Listen for account / chain changes
  useEffect(() => {
    const eth = window.ethereum;
    if (!eth) return;

    const onAccounts = (accounts: string[]) => {
      if (accounts.length === 0) {
        setAddress(null); setSigner(null); setProvider(null);
      } else {
        init(eth);
      }
    };
    const onChain = (chainIdHex: string) => {
      setChainId(parseInt(chainIdHex, 16));
    };

    eth.on?.("accountsChanged", onAccounts as (...args: unknown[]) => void);
    eth.on?.("chainChanged", onChain as (...args: unknown[]) => void);
    return () => {
      eth.removeListener?.("accountsChanged", onAccounts as (...args: unknown[]) => void);
      eth.removeListener?.("chainChanged", onChain as (...args: unknown[]) => void);
    };
  }, [init]);

  const connect = useCallback(async () => {
    if (!window.ethereum) {
      alert("No wallet detected. Install MetaMask or a compatible wallet.");
      return;
    }
    setConnecting(true);
    try {
      await window.ethereum.request({ method: "eth_requestAccounts" });
      await init(window.ethereum);
    } catch (err) {
      console.error("connect error:", err);
    } finally {
      setConnecting(false);
    }
  }, [init]);

  const switchNetwork = useCallback(async () => {
    if (!window.ethereum) return;
    const chainHex = `0x${TARGET_CHAIN.id.toString(16)}`;
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: chainHex }],
      });
    } catch (err: unknown) {
      // Chain not added yet — add it
      if ((err as { code?: number }).code === 4902) {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: chainHex,
              chainName: TARGET_CHAIN.name,
              nativeCurrency: TARGET_CHAIN.nativeCurrency,
              rpcUrls: [TARGET_CHAIN.rpcUrls.default.http[0]],
              blockExplorerUrls: [TARGET_CHAIN.blockExplorers.default.url],
            },
          ],
        });
      }
    }
  }, []);

  return {
    address, signer, provider, chainId,
    isConnecting, isWrongNetwork,
    connect, switchNetwork,
  };
}
