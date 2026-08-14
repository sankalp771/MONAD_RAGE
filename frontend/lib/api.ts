import type { ethers } from "ethers";
import { profileMessage, contentMessage, challengeMessage } from "./signing";

export const BASE = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

type Signer = Pick<ethers.JsonRpcSigner, "signMessage">;

const nowTs = () => Math.floor(Date.now() / 1000);

export interface Profile {
  address: string;
  username: string;
  avatar_url: string;
  bio: string;
}
// Note: The API returns created_at as a timestamp, but we convert it to a Date object in the frontend for easier handling.


export interface RoastContent {
  id: number;
  roast_id: number;
  author: string;
  content: string;
  created_at: number;
  username?: string;
  avatar_url?: string;
}

export interface RoastIndex {
  roast_id: number;
  creator: string;
  creator_username?: string;
  open_until: number;
  vote_until: number;
  state: "OPEN" | "VOTING" | "SETTLED" | "CANCELLED";
  winner?: string;
  winning_votes?: number;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ─── Profile ───────────────────────────────────────────────────────────────

export const getProfile = (address: string) =>
  request<Profile>(`/profile/${address}`);

export const saveProfile = async (
  signer: Signer,
  data: { address: string; username: string; avatar_url?: string; bio?: string },
) => {
  const ts = nowTs();
  const signature = await signer.signMessage(
    profileMessage(data.address, data.username, data.bio ?? "", data.avatar_url ?? "", ts),
  );
  return request<{ ok: boolean }>("/profile", {
    method: "POST",
    body: JSON.stringify({ ...data, ts, signature }),
  });
};

export const getUserRoasts = (address: string) =>
  request<RoastIndex[]>(`/profile/${address}/roasts`);

export interface ChallengeContent {
  roast_id: number;
  creator: string;
  title: string;
  description: string;
  media_url: string;
  created_at: number;
}

// ─── Content ───────────────────────────────────────────────────────────────

export const getRoastContent = (roastId: number) =>
  request<RoastContent[]>(`/roast/${roastId}/content`);

export const submitContent = async (
  signer: Signer, roastId: number, author: string, content: string,
) => {
  const ts = nowTs();
  const signature = await signer.signMessage(contentMessage(roastId, author, content, ts));
  return request<{ ok: boolean }>(`/roast/${roastId}/content`, {
    method: "POST",
    body: JSON.stringify({ author, content, ts, signature }),
  });
};

// ─── File Upload ───────────────────────────────────────────────────────────

export const uploadMedia = async (file: File): Promise<string> => {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${BASE}/upload`, { method: "POST", body: form });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Upload failed: HTTP ${res.status}`);
  }
  const { url } = await res.json();
  return url as string;
};

// ─── Challenge Content ─────────────────────────────────────────────────────

export const getChallengeContent = (roastId: number) =>
  request<ChallengeContent | null>(`/roast/${roastId}/challenge`);

export const submitChallengeContent = async (
  signer: Signer,
  roastId: number,
  creator: string,
  title: string,
  description: string,
  mediaUrl: string,
) => {
  const ts = nowTs();
  const signature = await signer.signMessage(
    challengeMessage(roastId, creator, title, description, mediaUrl, ts),
  );
  return request<{ ok: boolean }>(`/roast/${roastId}/challenge`, {
    method: "POST",
    body: JSON.stringify({ creator, title, description, media_url: mediaUrl, ts, signature }),
  });
};

// ─── Roast Index ───────────────────────────────────────────────────────────

export const getRecentRoastsFromDB = (limit = 20) =>
  request<RoastIndex[]>(`/roasts?limit=${limit}`);

export const getRoastFromDB = (roastId: number) =>
  request<RoastIndex>(`/roast/${roastId}`);
