// supabase/functions/auto-rdv-cron/index.ts
// ============================================================================
// auto-rdv-cron — le cycle mensuel de l'auto-RDV (spec 2026-09-29 § 4.1, § 6)
// ============================================================================
// verify_jwt:false + MDH_CRON_SECRET (pg_cron, migration 20260930_6). Deux modes :
//   { mode: "ouverture" }  le 1er du mois : pour chaque org où
//     settings.tournees.auto_rdv.enabled = true — contrats dus du mois (anniversaire
//     ou retard), un mail par client avec son lien signé (gabarit `auto_rdv` de
//     mail_campaigns), invitation `outcome = phone` pour les clients sans e-mail,
//     puis étiquetage des journées VIDES par grand secteur selon le besoin.
//   { mode: "relances" }  chaque jour : SMS J+7 (`auto_rdv_relance`), liste
//     d'appels J+15, expiration fin de mois, réouverture d'une journée vide dans
//     les secteurs saturés, étiquettes `deduite` des journées amorcées.
// Options : dry_run (rien n'est écrit ni envoyé), org_id, aujourdhui (YYYY-MM-DD).
// Journal : majordhome.planification_runs (auto-rdv-ouverture | auto-rdv-relances).
// Un flux serveur ne crée JAMAIS de lead ni de client (Eric, 2026-09-16).
// ============================================================================

import { requireSharedSecret, jsonResponse, buildCorsHeaders, getAdminClient, sanitizeError } from "../_shared/auth.ts";
import { signer, expirationLien, isoLocal } from "../_shared/autoRdvToken.ts";
import {
  orgBranding, brandingReplacements, wrapWithSkeleton, applyPlaceholders, escapeHtml, sendResendEmail, insertMailingLog,
} from "../_shared/mail.ts";
import { sendCampaignSms, type SmsSettings } from "../_shared/sms.ts";
import { capitaliserPrenom } from "../_shared/smsCampaigns.js";
import { isMobileFR } from "../_shared/phoneUtils.js";
import { AUTO_RDV_TEMPLATE_KEY } from "../_shared/autoRdvEmailTemplates.js";
import { chargerJournees } from "../_shared/tournee/loaders.js";
import { construireReglages } from "../_shared/tournee/reglages.js";
import { bornesMois } from "../_shared/tournee/auto-rdv.js";
import { deduireSecteur } from "../_shared/tournee/etat.js";
import { chargerPopulations } from "../_shared/tournee/populations.js";
import { secteursDepuisContrats, normaliserSecteur } from "../_shared/tournee/secteurs.js";
import { besoinParSecteur, journeesAEtiqueter, secteursAReouvrir } from "../_shared/tournee/etiquetage.js";
import { contratsAInviter, etapeRelance } from "../_shared/tournee/invitations.js";

const MDH_CRON_SECRET = Deno.env.get("MDH_CRON_SECRET") || "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const APP_URL = (Deno.env.get("MDH_APP_URL") || "https://majordhome.vercel.app").replace(/\/+$/, "");
const SMS_CAMPAIGN = "auto_rdv_relance";
const MOIS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

type Admin = ReturnType<typeof getAdminClient>;
type Mode = "ouverture" | "relances";

interface OrgReport {
  org_id: string;
  name: string | null;
  skipped?: string;
  error?: string;
  invitations?: { a_inviter: number; envoyees: number; echecs: number; sans_email: number; exclus: Record<string, number>; template_missing?: boolean };
  etiquetees?: Array<{ date: string; technicien_id: string; secteur: string }>;
  besoin?: Record<string, number>;
  relances?: { sms: number; sms_skipped: number; appel: number; expire: number };
  deduites?: number;
}

function joursEntre(debutIso: string, finIso: string): number {
  const [y1, m1, d1] = debutIso.split("-").map(Number);
  const [y2, m2, d2] = finIso.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

function siegeDepuis(settings: Record<string, unknown>): { lat: number; lng: number } | null {
  const centres = settings?.territoire_centers;
  if (!centres || typeof centres !== "object") return null;
  const premier = Object.values(centres as Record<string, { lat?: unknown; lng?: unknown }>)[0];
  if (!premier || typeof premier.lat !== "number" || typeof premier.lng !== "number") return null;
  return { lat: premier.lat, lng: premier.lng };
}

async function lireTout<T>(q: { range: (a: number, b: number) => Promise<{ data: T[] | null; error: unknown }> }, pas = 1000): Promise<{ data: T[]; error: unknown }> {
  const out: T[] = [];
  for (let from = 0; ; from += pas) {
    const { data, error } = await q.range(from, from + pas - 1);
    if (error) return { data: out, error };
    out.push(...(data ?? []));
    if (!data || data.length < pas) break;
  }
  return { data: out, error: null };
}

// ── Données communes d'une org ──────────────────────────────────────────────

interface Donnees {
  coreOrgId: string; mdhOrgId: string; settings: Record<string, unknown>; reglages: Record<string, unknown>;
  aujourdhui: string; mois: string; bornes: { debut: string; fin: string };
  contrats: Array<Record<string, unknown> & { id: string; client_id: string }>;
  clients: Map<string, Record<string, unknown>>;
  cartesEnCours: Set<string>;
  invitationsDuMois: Array<Record<string, unknown> & { contract_id: string }>;
  byClient: Map<string, string>; byCp: Map<string, string>;
  equipementsParContrat: Map<string, string[]>;
}

async function chargerDonnees(admin: Admin, org: { id: string; settings: Record<string, unknown> }, mdhOrgId: string, aujourdhui: string): Promise<Donnees | { error: string }> {
  const settings = org.settings ?? {};
  const reglages = construireReglages(settings) as Record<string, unknown>;
  const autoRdv = reglages.auto_rdv as Record<string, unknown>;
  const bornes = bornesMois(aujourdhui, { delaiMinJours: Number(autoRdv.delai_min_jours ?? 2) });
  const mois = `${aujourdhui.slice(0, 7)}-01`;

  const { data: contrats, error: cErr } = await lireTout<Record<string, unknown> & { id: string; client_id: string }>(
    admin.from("majordhome_contracts")
      .select("id, client_id, start_date, status, current_year_visit_status, client_postal_code, client_city")
      .eq("org_id", org.id).eq("status", "active").order("id") as never,
  );
  if (cErr) return { error: sanitizeError(cErr, "contrats illisibles") };

  const clientIds = [...new Set(contrats.map((c) => c.client_id).filter(Boolean))];
  const clients = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < clientIds.length; i += 500) {
    const { data, error } = await admin.from("majordhome_clients")
      .select("id, email, first_name, last_name, phone, mail_optin, email_unsubscribed_at, is_archived, latitude, longitude, postal_code")
      .eq("org_id", org.id).in("id", clientIds.slice(i, i + 500));
    if (error) return { error: sanitizeError(error, "clients illisibles") };
    for (const cl of data ?? []) clients.set(String(cl.id), cl as Record<string, unknown>);
  }

  const { data: cartes, error: kErr } = await lireTout<{ effective_contract_id: string | null }>(
    admin.from("majordhome_entretien_sav").select("effective_contract_id")
      .eq("org_id", org.id).eq("intervention_type", "entretien").neq("workflow_status", "realise").order("id") as never,
  );
  if (kErr) return { error: sanitizeError(kErr, "cartes illisibles") };
  const cartesEnCours = new Set(cartes.map((k) => k.effective_contract_id).filter(Boolean) as string[]);

  const { data: invitations, error: iErr } = await admin.from("majordhome_auto_rdv_invitations")
    .select("id, contract_id, client_id, mois, sent_at, booked_at, sms_relance_at, escalade_appel_at, outcome, relances")
    .eq("org_id", org.id).eq("mois", mois);
  if (iErr) return { error: sanitizeError(iErr, "invitations illisibles") };

  // Grands secteurs : même partition que l'onglet Programmation, noms normalisés.
  const enrichis = contrats.map((c) => {
    const cl = clients.get(c.client_id) ?? {};
    return { ...c, client_latitude: cl.latitude ?? null, client_longitude: cl.longitude ?? null };
  });
  const cityPopulation = await chargerPopulations([...new Set(contrats.map((c) => String(c.client_postal_code || "")))], { logger: console });
  const { byClient, byCp } = secteursDepuisContrats(enrichis as never, { radiusKm: 15, cityPopulation });

  // Équipements (libellés de catégorie) pour le mail : 3 requêtes, pas une par contrat.
  const equipementsParContrat = new Map<string, string[]>();
  const { data: ce } = await lireTout<{ contract_id: string; equipment_id: string }>(
    admin.from("majordhome_contract_equipments").select("contract_id, equipment_id").in("contract_id", contrats.map((c) => c.id)).order("contract_id") as never,
  );
  const equipIds = [...new Set((ce ?? []).map((r) => r.equipment_id))];
  const catParEquip = new Map<string, string | null>();
  for (let i = 0; i < equipIds.length; i += 500) {
    const { data } = await admin.from("majordhome_equipments").select("id, category_id").in("id", equipIds.slice(i, i + 500));
    for (const e of data ?? []) catParEquip.set(String(e.id), (e.category_id as string | null) ?? null);
  }
  const { data: cats } = await admin.from("majordhome_equipment_categories").select("id, label").eq("org_id", org.id);
  const labelCat = new Map((cats ?? []).map((c) => [String(c.id), String(c.label)]));
  for (const r of ce ?? []) {
    const label = labelCat.get(catParEquip.get(r.equipment_id) ?? "") ?? null;
    if (!label) continue;
    const l = equipementsParContrat.get(r.contract_id) ?? [];
    if (!l.includes(label)) l.push(label);
    equipementsParContrat.set(r.contract_id, l);
  }

  return {
    coreOrgId: org.id, mdhOrgId, settings, reglages, aujourdhui, mois, bornes,
    contrats, clients, cartesEnCours, invitationsDuMois: (invitations ?? []) as Donnees["invitationsDuMois"],
    byClient, byCp, equipementsParContrat,
  };
}

function secteurDuContrat(d: Donnees, c: { client_id: string; client_postal_code?: unknown }): string | null {
  return d.byClient.get(c.client_id) ?? d.byCp.get(String(c.client_postal_code || "").trim()) ?? null;
}

// ── Étiquetage ─────────────────────────────────────────────────────────────

async function etiqueter(admin: Admin, d: Donnees, dusParSecteur: Map<string, number>, dryRun: boolean, report: OrgReport, besoinForce?: Map<string, number>) {
  const { data: journees, error } = await chargerJournees({
    client: admin, coreOrgId: d.coreOrgId, mdhOrgId: d.mdhOrgId, joursApres: Math.max(0, joursEntre(d.aujourdhui, d.bornes.fin)), reglages: d.reglages, logger: console,
  });
  if (error) throw new Error(`journées illisibles : ${sanitizeError(error, "")}`);
  const { data: etiquettes, error: eErr } = await admin.from("majordhome_journees_secteur")
    .select("date, team_member_id, grand_secteur, origine, figee_at").eq("org_id", d.coreOrgId).gte("date", d.bornes.debut).lte("date", d.bornes.fin);
  if (eErr) throw new Error(`étiquettes illisibles : ${sanitizeError(eErr, "")}`);
  const parCle = new Map((etiquettes ?? []).map((e) => [`${e.date}|${e.team_member_id}`, e]));

  type J = { date: string; technicienId: string; rdvs: Array<Record<string, unknown>>; chargeMinutes: number; budgetMinutes: number };
  const dansBornes = (journees as J[]).filter((j) => j.date >= d.bornes.debut && j.date <= d.bornes.fin);
  const journeesVides = dansBornes.filter((j) => j.rdvs.length === 0 && !parCle.has(`${j.date}|${j.technicienId}`));
  const journeesAmorcees = dansBornes.filter((j) => j.rdvs.length > 0).map((j) => {
    const e = parCle.get(`${j.date}|${j.technicienId}`);
    const secteur = normaliserSecteur((e?.grand_secteur as string) || deduireSecteur(j.rdvs as never) || "");
    return { secteur, chargeMinutes: j.chargeMinutes, budgetMinutes: j.budgetMinutes, date: j.date, technicienId: j.technicienId };
  }).filter((j) => j.secteur);
  const etiquettesVides = dansBornes
    .filter((j) => j.rdvs.length === 0 && parCle.has(`${j.date}|${j.technicienId}`))
    .map((j) => ({ secteur: normaliserSecteur(String(parCle.get(`${j.date}|${j.technicienId}`)?.grand_secteur || "")) }))
    .filter((e) => e.secteur);

  const besoin = besoinForce ?? besoinParSecteur({ dusParSecteur, journeesAmorcees, etiquettesVides, reglages: d.reglages as never });
  report.besoin = Object.fromEntries(besoin);
  const aPoser = journeesAEtiqueter({ journeesVides, besoin, bornes: d.bornes });
  report.etiquetees = aPoser.map((p) => ({ date: p.date, technicien_id: p.technicienId, secteur: p.secteur }));
  if (dryRun || aPoser.length === 0) return { journeesAmorcees, parCle };
  const { error: insErr } = await admin.from("majordhome_journees_secteur").upsert(
    aPoser.map((p) => ({ org_id: d.coreOrgId, date: p.date, team_member_id: p.technicienId, grand_secteur: p.secteur, origine: "machine" })),
    { onConflict: "org_id,team_member_id,date", ignoreDuplicates: true },
  );
  if (insErr) throw new Error(`étiquettes non écrites : ${sanitizeError(insErr, "")}`);
  return { journeesAmorcees, parCle };
}

// ── Mode ouverture ─────────────────────────────────────────────────────────

async function ouverture(admin: Admin, d: Donnees, dryRun: boolean, report: OrgReport) {
  const dejaInvites = new Set(d.invitationsDuMois.map((i) => i.contract_id));
  const { aInviter, sansEmail, exclus } = contratsAInviter({
    contrats: d.contrats as never, clients: d.clients as never, cartesEnCours: d.cartesEnCours, dejaInvites, mois: d.mois.slice(0, 7), reglages: d.reglages as never,
  });
  report.invitations = { a_inviter: aInviter.length, envoyees: 0, echecs: 0, sans_email: sansEmail.length, exclus };

  // Compteur de relances : invité le mois précédent sans RDV → +1.
  const moisPrec = (() => { const [y, m] = d.mois.split("-").map(Number); const p = new Date(Date.UTC(y, m - 2, 1)); return p.toISOString().slice(0, 10); })();
  const { data: precedentes } = await admin.from("majordhome_auto_rdv_invitations").select("contract_id, relances, booked_at")
    .eq("org_id", d.coreOrgId).eq("mois", moisPrec);
  const relancesPrec = new Map((precedentes ?? []).filter((p) => !p.booked_at).map((p) => [String(p.contract_id), Number(p.relances) || 0]));

  // Gabarit et branding.
  const { data: tpl } = await admin.from("majordhome_mail_campaigns").select("subject, html_body")
    .eq("org_id", d.coreOrgId).eq("key", AUTO_RDV_TEMPLATE_KEY).eq("is_archived", false).maybeSingle();
  const b = orgBranding(d.settings as never);
  const peutEnvoyer = !!tpl && !!b.fromEmail && !!RESEND_API_KEY;
  if (!tpl) report.invitations.template_missing = true;
  const moisLabel = `${MOIS_FR[Number(d.mois.slice(5, 7)) - 1]} ${d.mois.slice(0, 4)}`;
  const exp = expirationLien();

  const lignes: Array<Record<string, unknown>> = [];
  for (const inv of aInviter) {
    const relances = (relancesPrec.get(inv.contractId) ?? -1) + 1;
    if (!peutEnvoyer || dryRun) {
      if (!dryRun) lignes.push({ org_id: d.coreOrgId, contract_id: inv.contractId, client_id: inv.clientId, mois: d.mois, raison: inv.raison, outcome: "phone", relances });
      continue;
    }
    try {
      const token = await signer(inv.contractId, exp);
      const valeurs: Record<string, string> = {
        "{{PRENOM}}": capitaliserPrenom(inv.prenom || "") || "",
        "{{NOM}}": inv.nom || "",
        "{{EQUIPEMENTS}}": (d.equipementsParContrat.get(inv.contractId) ?? []).join(", ").toLowerCase() || "équipement",
        "{{MOIS}}": moisLabel,
        "{{LIEN_RDV}}": `${APP_URL}/rdv/${token}`,
      };
      const html = Object.fromEntries(Object.entries(valeurs).map(([k, v]) => [k, k === "{{LIEN_RDV}}" ? v : escapeHtml(v)]));
      const subject = applyPlaceholders(String(tpl!.subject || ""), { ...brandingReplacements(b), ...valeurs });
      const body = applyPlaceholders(wrapWithSkeleton(b, String(tpl!.html_body || "")), { ...brandingReplacements(b), ...html });
      const res = await sendResendEmail(RESEND_API_KEY, {
        from: b.fromName ? `${b.fromName} <${b.fromEmail}>` : b.fromEmail, to: [inv.email], replyTo: b.replyTo || undefined, subject, html: body,
      });
      const logId = await insertMailingLog(admin, {
        client_id: inv.clientId, org_id: d.coreOrgId, campaign_name: AUTO_RDV_TEMPLATE_KEY, subject, email_to: inv.email,
        status: res.ok ? "sent" : "failed", provider_id: res.id ?? null, error_message: res.ok ? null : (res.message || `resend_${res.status}`),
      } as never);
      if (res.ok) {
        report.invitations.envoyees += 1;
        lignes.push({ org_id: d.coreOrgId, contract_id: inv.contractId, client_id: inv.clientId, mois: d.mois, raison: inv.raison, sent_at: new Date().toISOString(), email_to: inv.email, mailing_log_id: logId, relances });
      } else {
        report.invitations.echecs += 1;
        console.error(`[auto-rdv-cron] mail non envoyé contrat ${inv.contractId} :`, res.message);
      }
    } catch (e) {
      report.invitations.echecs += 1;
      console.error(`[auto-rdv-cron] contrat ${inv.contractId} :`, e);
    }
  }
  for (const s of sansEmail) {
    if (dryRun) continue;
    lignes.push({ org_id: d.coreOrgId, contract_id: s.contractId, client_id: s.clientId, mois: d.mois, raison: s.raison, outcome: "phone", relances: (relancesPrec.get(s.contractId) ?? -1) + 1 });
  }
  if (lignes.length > 0) {
    const { error } = await admin.from("majordhome_auto_rdv_invitations").upsert(lignes, { onConflict: "org_id,contract_id,mois", ignoreDuplicates: true });
    if (error) throw new Error(`invitations non écrites : ${sanitizeError(error, "")}`);
  }

  // Étiquetage : besoin = tous les contrats dus du mois (mail ET téléphone), par secteur.
  const dusParSecteur = new Map<string, number>();
  for (const x of [...aInviter, ...sansEmail]) {
    const c = d.contrats.find((k) => k.id === x.contractId);
    const s = c ? secteurDuContrat(d, c as never) : null;
    if (!s) continue;
    dusParSecteur.set(s, (dusParSecteur.get(s) || 0) + 1);
  }
  await etiqueter(admin, d, dusParSecteur, dryRun, report);
}

// ── Mode relances ──────────────────────────────────────────────────────────

async function relances(admin: Admin, d: Donnees, dryRun: boolean, report: OrgReport) {
  report.relances = { sms: 0, sms_skipped: 0, appel: 0, expire: 0 };
  const sms = d.settings.sms as SmsSettings | undefined;
  const smsActifs = sms?.enabled === true;
  const brand = String(d.settings.brand_name || "");
  // Invitations du mois ET du mois précédent (expiration).
  const moisPrec = (() => { const [y, m] = d.mois.split("-").map(Number); return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10); })();
  const { data: invs, error } = await admin.from("majordhome_auto_rdv_invitations")
    .select("id, contract_id, client_id, mois, sent_at, booked_at, sms_relance_at, escalade_appel_at, outcome")
    .eq("org_id", d.coreOrgId).in("mois", [d.mois, moisPrec]).is("booked_at", null);
  if (error) throw new Error(`invitations illisibles : ${sanitizeError(error, "")}`);
  for (const inv of invs ?? []) {
    const etape = etapeRelance(inv as never, d.aujourdhui, d.reglages as never);
    if (!etape) continue;
    if (etape === "expire") {
      report.relances.expire += 1;
      if (!dryRun) await admin.from("majordhome_auto_rdv_invitations").update({ outcome: "expired" }).eq("id", inv.id);
      continue;
    }
    if (etape === "appel") {
      report.relances.appel += 1;
      if (!dryRun) await admin.from("majordhome_auto_rdv_invitations").update({ escalade_appel_at: new Date().toISOString() }).eq("id", inv.id);
      continue;
    }
    // sms
    const cl = d.clients.get(String(inv.client_id));
    const phone = String(cl?.phone ?? "").trim();
    if (!smsActifs || !isMobileFR(phone)) { report.relances.sms_skipped += 1; continue; }
    if (dryRun) { report.relances.sms += 1; continue; }
    const res = await sendCampaignSms(admin, {
      orgId: d.coreOrgId, sms: sms!, campaign: SMS_CAMPAIGN, phone, clientId: String(inv.client_id),
      vars: { first_name: capitaliserPrenom(String(cl?.first_name ?? "")), entreprise: brand },
    });
    if (res.ok) {
      report.relances.sms += 1;
      await admin.from("majordhome_auto_rdv_invitations").update({ sms_relance_at: new Date().toISOString() }).eq("id", inv.id);
    } else {
      report.relances.sms_skipped += 1;
      if (res.error !== "campaign_template_missing") console.error(`[auto-rdv-cron] SMS relance ${inv.id} :`, res.error);
    }
  }

  // Étiquettes déduites + réouverture des secteurs saturés.
  const { journeesAmorcees, parCle } = await etiqueter(admin, d, new Map(), dryRun, report, new Map());
  const deduites = journeesAmorcees.filter((j) => !parCle.has(`${j.date}|${j.technicienId}`));
  report.deduites = deduites.length;
  if (!dryRun && deduites.length > 0) {
    const { error: dErr } = await admin.from("majordhome_journees_secteur").upsert(
      deduites.map((j) => ({ org_id: d.coreOrgId, date: j.date, team_member_id: j.technicienId, grand_secteur: j.secteur, origine: "deduite" })),
      { onConflict: "org_id,team_member_id,date", ignoreDuplicates: true },
    );
    if (dErr) console.error("[auto-rdv-cron] étiquettes déduites :", dErr);
  }
  const etiquetees = journeesAmorcees.filter((j) => { const e = parCle.get(`${j.date}|${j.technicienId}`); return e && e.origine !== "deduite"; });
  const satures = secteursAReouvrir({ journeesEtiquetees: etiquetees, reglages: d.reglages as never });
  if (satures.length > 0) {
    await etiqueter(admin, d, new Map(), dryRun, report, new Map(satures.map((s) => [s, 1])));
  }
}

// ── Point d'entrée ────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: buildCorsHeaders(req) });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, req);
  const authError = requireSharedSecret(req, MDH_CRON_SECRET, "MDH_CRON_SECRET");
  if (authError) return authError;

  let body: Record<string, unknown> = {};
  try { const t = await req.text(); body = t ? JSON.parse(t) : {}; } catch { return jsonResponse({ error: "invalid_json" }, 400, req); }
  const mode = body.mode === "relances" ? "relances" : body.mode === "ouverture" ? "ouverture" : null;
  if (!mode) return jsonResponse({ error: "mode requis : ouverture | relances" }, 400, req);
  const dryRun = body.dry_run === true;
  const onlyOrgId = typeof body.org_id === "string" ? body.org_id : null;
  const aujourdhui = typeof body.aujourdhui === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.aujourdhui) ? body.aujourdhui : isoLocal();
  const job = mode === "ouverture" ? "auto-rdv-ouverture" : "auto-rdv-relances";

  try {
    const admin = getAdminClient();
    let orgQuery = admin.schema("core").from("organizations").select("id, name, settings");
    if (onlyOrgId) orgQuery = orgQuery.eq("id", onlyOrgId);
    const { data: orgs, error: orgErr } = await orgQuery;
    if (orgErr) return jsonResponse({ error: sanitizeError(orgErr, "organizations unreadable") }, 500, req);

    const reports: OrgReport[] = [];
    const durees = new Map<string, number>();
    for (const org of (orgs ?? []) as Array<{ id: string; name: string | null; settings: Record<string, unknown> | null }>) {
      const debut = Date.now();
      const report: OrgReport = { org_id: org.id, name: org.name };
      const { data: mdhOrg } = await admin.from("majordhome_organizations").select("id").eq("core_org_id", org.id).maybeSingle();
      if (!mdhOrg) { if (onlyOrgId) reports.push({ ...report, skipped: "org_majordhome_introuvable" }); continue; }
      const reglages = construireReglages(org.settings ?? {}) as { auto_rdv: { enabled?: boolean } };
      if (reglages.auto_rdv?.enabled !== true) { reports.push({ ...report, skipped: "auto_rdv_off" }); durees.set(org.id, Date.now() - debut); continue; }
      if (!siegeDepuis(org.settings ?? {})) { reports.push({ ...report, skipped: "siege_non_configure" }); durees.set(org.id, Date.now() - debut); continue; }
      reports.push(report);
      try {
        const d = await chargerDonnees(admin, { id: org.id, settings: org.settings ?? {} }, mdhOrg.id, aujourdhui);
        if ("error" in d) { report.error = d.error; continue; }
        if (mode === "ouverture") await ouverture(admin, d, dryRun, report);
        else await relances(admin, d, dryRun, report);
      } catch (e) {
        report.error = sanitizeError(e, "org en échec");
        console.error(`[auto-rdv-cron] ${org.id} :`, e);
      } finally {
        durees.set(org.id, Date.now() - debut);
      }
    }

    if (reports.length > 0) {
      const { error: journalErr } = await admin.from("majordhome_planification_runs").insert(reports.map((r) => ({
        org_id: r.org_id, job, dry_run: dryRun,
        rapport: { skipped: r.skipped ?? null, invitations: r.invitations ?? null, etiquetees: r.etiquetees ?? [], besoin: r.besoin ?? null, relances: r.relances ?? null, deduites: r.deduites ?? null },
        duree_ms: durees.get(r.org_id) ?? null, erreur: r.error ?? null,
      })));
      if (journalErr) {
        console.error("[auto-rdv-cron] journal non écrit :", journalErr);
        return jsonResponse({ aujourdhui, mode, dry_run: dryRun, orgs: reports, journal_error: sanitizeError(journalErr, "planification_runs insert failed") }, 500, req);
      }
    }
    return jsonResponse({ aujourdhui, mode, dry_run: dryRun, orgs: reports }, 200, req);
  } catch (e) {
    return jsonResponse({ error: sanitizeError(e, "auto-rdv-cron failed") }, 500, req);
  }
});
