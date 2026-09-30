// supabase/functions/_shared/autoRdvToken.ts
// ============================================================================
// Jeton de prise de rendez-vous (auto-RDV) — partagé par les edges `auto-rdv`
// (vérification, action sign) et `auto-rdv-cron` (signature des liens envoyés).
// Format : rdv.<contract_id>.<exp>.<sig>, HMAC-SHA256(MDH_AUTO_RDV_SECRET) sur
// "rdv.<contract_id>.<exp>", base64url. Sans état : l'org est TOUJOURS dérivée
// du contrat porté par le jeton, jamais du payload.
// ============================================================================

import { timingSafeEqual } from "./auth.ts";

const SECRET = Deno.env.get("MDH_AUTO_RDV_SECRET") || "";
const FUSEAU = "Europe/Paris";
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
  return SECRET.length > 0;
}

export async function signer(contractId: string, exp: number): Promise<string> {
  const base = `rdv.${contractId}.${exp}`;
  return `${base}.${await hmac(base)}`;
}

export type Verif = { ok: true; contractId: string; exp: number } | { ok: false; status: number; error: string };

export async function verifier(token: string): Promise<Verif> {
  if (!SECRET) return { ok: false, status: 500, error: "secret_non_configure" };
  if (!token) return { ok: false, status: 400, error: "invalid_token" };
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "rdv") return { ok: false, status: 400, error: "invalid_token" };
  const [, contractId, expStr, sig] = parts;
  if (!UUID_RE.test(contractId)) return { ok: false, status: 400, error: "invalid_token" };
  const exp = Number.parseInt(expStr, 10);
  if (!Number.isFinite(exp)) return { ok: false, status: 400, error: "invalid_token" };
  const attendu = await hmac(`rdv.${contractId}.${expStr}`);
  if (!timingSafeEqual(sig, attendu)) return { ok: false, status: 401, error: "signature_mismatch" };
  if (exp < Math.floor(Date.now() / 1000)) return { ok: false, status: 410, error: "token_expired" };
  return { ok: true, contractId, exp };
}

/** Composantes de la date locale Europe/Paris. */
export function localParis(now = new Date()): { y: number; m: number; d: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("fr-FR", {
    timeZone: FUSEAU, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  return { y: get("year"), m: get("month"), d: get("day"), minutes: get("hour") * 60 + get("minute") };
}

/** `YYYY-MM-DD` du jour, heure de Paris. */
export function isoLocal(now = new Date()): string {
  const { y, m, d } = localParis(now);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Expiration du lien : fin du mois en cours (≈ 23:59:59 Paris, pris à 22:59:59 UTC),
 * ou fin du mois suivant s'il reste moins de 7 jours — même règle que bornesMois.
 */
export function expirationLien(now = new Date()): number {
  const { y, m, d } = localParis(now);
  const dernierJour = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cible = dernierJour - d < 7 ? new Date(Date.UTC(y, m + 1, 0)) : new Date(Date.UTC(y, m, 0));
  return Math.floor(Date.UTC(cible.getUTCFullYear(), cible.getUTCMonth(), cible.getUTCDate(), 22, 59, 59) / 1000);
}
