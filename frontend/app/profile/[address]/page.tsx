"use client";
import { useEffect, useState, useRef, use } from "react";
import { isAddress } from "ethers";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import { useWallet } from "@/lib/useWallet";
import { getProfile, saveProfile, getUserRoasts, type Profile, type RoastIndex } from "@/lib/api";
import { STATE_NAME_COLOR, effectiveStateName } from "@/lib/contract";

export default function ProfilePage({ params }: { params: Promise<{ address: string }> }) {
  const { address: paramAddress } = use(params);
  const { address: myAddress, signer } = useWallet();

  const isOwner = myAddress?.toLowerCase() === paramAddress.toLowerCase();

  const [profile, setProfile]   = useState<Profile | null>(null);
  const [roasts, setRoasts]     = useState<RoastIndex[]>([]);
  const [editing, setEditing]   = useState(false);
  const [username, setUsername] = useState("");
  const [bio, setBio]           = useState("");
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState("");
  const [saved, setSaved]       = useState(false);
  const [loading, setLoading]   = useState(true);
  const [loadError, setLoadError] = useState("");
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (savedTimer.current) clearTimeout(savedTimer.current);
  }, []);

  const validAddress = isAddress(paramAddress);

  useEffect(() => {
    if (!validAddress) { setLoading(false); return; }
    Promise.allSettled([
      getProfile(paramAddress).then((p) => {
        setProfile(p);
        setUsername(p.username);
        setBio(p.bio);
      }),
      getUserRoasts(paramAddress).then(setRoasts),
    ]).then((results) => {
      if (results.some((r) => r.status === "rejected")) {
        setLoadError("Could not load profile data — is the backend running?");
      } else {
        setLoadError("");
      }
      setLoading(false);
    });
  }, [paramAddress, validAddress]);

  const handleSave = async () => {
    if (!myAddress || !signer) return;
    setSaving(true); setError("");
    try {
      await saveProfile(signer, { address: myAddress, username, bio });
      setProfile((p) => p ? { ...p, username, bio } : p);
      setEditing(false);
      setSaved(true);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaved(false), 2000);
    } catch (err: unknown) {
      setError((err as Error).message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const short = `${paramAddress.slice(0, 6)}…${paramAddress.slice(-4)}`;

  if (!validAddress) {
    return (
      <div className="min-h-screen flex flex-col">
        <Navbar />
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-zinc-500">
          <p>That doesn&apos;t look like a wallet address.</p>
          <Link href="/" className="text-orange-400 underline text-sm">← Back to arenas</Link>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col">
        <Navbar />
        <div className="flex-1 flex items-center justify-center text-zinc-600">
          Loading profile…
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-10">

        <Link href="/" className="text-zinc-600 hover:text-white text-sm mb-6 inline-block">
          ← Home
        </Link>

        {loadError && <p className="text-red-400 text-sm mb-4">{loadError}</p>}

        {/* Profile card */}
        <div className="border border-zinc-800 rounded-lg p-6 mb-8">
          <div className="flex items-start justify-between mb-4">
            <div>
              {editing ? (
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  maxLength={32}
                  placeholder="Username"
                  className="bg-zinc-900 border border-zinc-700 rounded px-3 py-1 text-white text-xl font-bold focus:outline-none focus:border-orange-500 w-full"
                />
              ) : (
                <h1 className="text-2xl font-bold">
                  {profile?.username || short}
                </h1>
              )}
              <p className="text-zinc-600 text-sm mt-1 break-all">{paramAddress}</p>
            </div>

            {isOwner && !editing && (
              <button
                onClick={() => setEditing(true)}
                className="text-zinc-500 hover:text-white text-sm border border-zinc-700 px-3 py-1 rounded"
              >
                Edit
              </button>
            )}
          </div>

          {editing ? (
            <>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                maxLength={160}
                rows={2}
                placeholder="Short bio (160 chars)"
                className="w-full bg-zinc-900 border border-zinc-700 rounded p-3 text-white text-sm resize-none focus:outline-none focus:border-orange-500 mt-2"
              />
              {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
              <div className="flex gap-3 mt-3">
                <button
                  onClick={handleSave}
                  disabled={saving || !username.trim()}
                  className="bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-sm px-4 py-2 rounded"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
                <button
                  onClick={() => setEditing(false)}
                  className="text-zinc-500 hover:text-white text-sm px-4 py-2"
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            profile?.bio && <p className="text-zinc-400 text-sm mt-2">{profile.bio}</p>
          )}

          {saved && <p className="text-green-400 text-sm mt-2">Profile saved!</p>}
        </div>

        {/* Roast history */}
        <h2 className="text-zinc-500 text-xs uppercase tracking-widest mb-4">
          Arenas Participated In ({roasts.length})
        </h2>

        {roasts.length === 0 ? (
          <p className="text-zinc-700 text-sm">No arenas yet.</p>
        ) : (
          <div className="space-y-3">
            {roasts.map((r) => (
              <Link
                key={r.roast_id}
                href={`/arena/${r.roast_id}`}
                className="flex items-center justify-between border border-zinc-800 hover:border-zinc-600 rounded-lg px-4 py-3 transition-all"
              >
                <div>
                  <span className="text-white font-bold">Arena #{r.roast_id}</span>
                  {r.state === "SETTLED" && r.winner?.toLowerCase() === paramAddress.toLowerCase() && (
                    <span className="ml-2 text-orange-400 text-xs">WINNER</span>
                  )}
                </div>
                {(() => {
                  const name = effectiveStateName(r.state, r.open_until);
                  return <span className={STATE_NAME_COLOR[name]}>{name}</span>;
                })()}
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
