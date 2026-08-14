/**
 * signing.ts — builds the plain-text messages the wallet signs for backend
 * writes. MUST stay byte-identical to backend/auth.js.
 */

export function profileMessage(
  address: string, username: string, bio: string, avatarUrl: string, ts: number,
): string {
  return (
    `RoastArena profile update\n` +
    `address: ${address.toLowerCase()}\n` +
    `username: ${username}\n` +
    `bio: ${bio}\n` +
    `avatar: ${avatarUrl}\n` +
    `ts: ${ts}`
  );
}

export function contentMessage(
  roastId: number, author: string, content: string, ts: number,
): string {
  return (
    `RoastArena roast submission\n` +
    `roast: ${roastId}\n` +
    `address: ${author.toLowerCase()}\n` +
    `ts: ${ts}\n\n` +
    content
  );
}

export function challengeMessage(
  roastId: number, creator: string, title: string, description: string, mediaUrl: string, ts: number,
): string {
  return (
    `RoastArena challenge\n` +
    `roast: ${roastId}\n` +
    `address: ${creator.toLowerCase()}\n` +
    `ts: ${ts}\n` +
    `title: ${title}\n` +
    `description: ${description}\n` +
    `media: ${mediaUrl}`
  );
}
