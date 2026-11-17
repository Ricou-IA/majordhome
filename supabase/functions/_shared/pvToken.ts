// supabase/functions/_shared/pvToken.ts
// ============================================================================
// Jeton du lien « PV de réception à signer » — edge `chantier-pv`.
// Format : pv.<chantier_id>.<exp>.<sig>, HMAC-SHA256 sur "pv.<chantier_id>.<exp>",
// base64url. Sans état : l'organisation est TOUJOURS dérivée du chantier porté par
// le jeton, jamais de la requête. Même construction que _shared/autoRdvToken.ts.
//
// Secret : MDH_PV_SECRET s'il est posé, sinon MDH_AUTO_RDV_SECRET (déjà en place).
// Le préfixe signé (« pv. » ici, « rdv. » là-bas) sépare les deux usages : un lien
// de prise de RDV ne vaut jamais lien de PV, et inversement.
// ⚠ Poser MDH_PV_SECRET plus tard invalide les liens déjà envoyés (il faudra les
// renvoyer) : à faire à un moment où aucun PV n'est en attente de signature.
// ============================================================================

import { timingSafeEqual } from "./auth.ts";

const SECRET = Deno.env.get("MDH_PV_SECRET") || Deno.env.get("MDH_AUTO_RDV_SECRET") || "";
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return base64UrlEncode(new Uint8Array(sig));
}

export function secretConfigure(): boolean {
  return SECRET.length >= 32;
}

export async function signerPv(chantierId: string, exp: number): Promise<string> {
  const base = `pv.${chantierId}.${exp}`;
  return `${base}.${await hmac(base)}`;
}

export type VerifPv = { ok: true; chantierId: string; exp: number } | { ok: false; status: number; error: string };

export async function verifierPv(token: string): Promise<VerifPv> {
  if (!secretConfigure()) return { ok: false, status: 500, error: "secret_non_configure" };
  if (!token) return { ok: false, status: 400, error: "invalid_token" };
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "pv") return { ok: false, status: 400, error: "invalid_token" };
  const [, chantierId, expStr, sig] = parts;
  if (!UUID_RE.test(chantierId) || !/^\d{9,11}$/.test(expStr)) return { ok: false, status: 400, error: "invalid_token" };
  const attendu = await hmac(`pv.${chantierId}.${expStr}`);
  if (!timingSafeEqual(sig, attendu)) return { ok: false, status: 401, error: "signature_mismatch" };
  const exp = Number.parseInt(expStr, 10);
  if (exp < Math.floor(Date.now() / 1000)) return { ok: false, status: 410, error: "token_expired" };
  return { ok: true, chantierId, exp };
}
