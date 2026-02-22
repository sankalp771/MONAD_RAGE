"use client";
import Link from "next/link";
import { useWallet } from "@/lib/useWallet";

export default function Navbar() {
  const { address, isConnecting, isWrongNetwork, connect, switchNetwork } = useWallet();

  const short = address
    ? `${address.slice(0, 6)}…${address.slice(-4)}`
    : null;

  return (
    <nav className="border-b border-zinc-800 px-6 py-4 flex items-center justify-between">
      <Link href="/" className="text-xl font-bold text-orange-500 tracking-widest">
        ROAST<span className="text-white">ARENA</span>
      </Link>

      <div className="flex items-center gap-4">
        {address && (
          <Link href={`/profile/${address}`} className="text-zinc-400 hover:text-white text-sm">
            {short}
          </Link>
        )}

        {isWrongNetwork ? (
          <button
            onClick={switchNetwork}
            className="bg-red-600 hover:bg-red-500 text-white text-sm px-4 py-2 rounded"
          >
            Switch to Monad
          </button>
        ) : address ? (
          <span className="bg-zinc-800 text-green-400 text-sm px-4 py-2 rounded">
            {short}
          </span>
        ) : (
          <button
            onClick={connect}
            disabled={isConnecting}
            className="bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-sm px-4 py-2 rounded"
          >
            {isConnecting ? "Connecting…" : "Connect Wallet"}
          </button>
        )}
      </div>
    </nav>
  );
}
