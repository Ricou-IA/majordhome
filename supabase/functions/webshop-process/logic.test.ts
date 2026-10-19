// Tests de la logique pure de l'edge webshop-process.
// deno test supabase/functions/webshop-process/logic.test.ts
import { assertEquals, assertStringIncludes, assert } from "jsr:@std/assert@1";
import {
  construireEmail,
  destinatairesAction,
  estRetour,
  finaliserAction,
  issueAction,
  lireEcrireAgir,
  texteDepuisHtml,
} from "./logic.ts";
import { orgBranding } from "../_shared/mail.ts";
import type { ResendPayload, ResendResult } from "../_shared/mail.ts";

const branding = orgBranding({
  from_email: "boutique@exemple.fr",
  brand_name: "Chauffage & Co",
  phone: "05 00 00 00 00",
  email_skeleton_html: "<html><body><header>{{BRAND_NAME}}</header>{{EMAIL_BODY}}</body></html>",
});

const gabarit = {
  subject: "Commande {{ORDER_NUMBER}} — {{CLIENT_NAME}} — {{BRAND_NAME}}",
  html_body: "<p>Bonjour {{CLIENT_NAME}}</p>{{ITEMS}}",
};

// Valeurs telles que les produit variablesCommande : échappées HTML.
const varsHtml = {
  "{{ORDER_NUMBER}}": "WS-0042",
  "{{CLIENT_NAME}}": "Dupont &amp; Fils &lt;SARL&gt;",
  "{{ITEMS}}": "<ul><li>Granulés &quot;Premium&quot; × 2 — 10 €</li></ul>",
  "{{BRAND_NAME}}": "Chauffage &amp; Co",
};

function fauxResend(result: Partial<ResendResult>) {
  const appels: ResendPayload[] = [];
  const send = (p: ResendPayload): Promise<ResendResult> => {
    appels.push(p);
    return Promise.resolve({ ok: true, status: 200, id: "re_1", message: null, ...result });
  };
  return { appels, send };
}

Deno.test("texteDepuisHtml : désé-chappe et retire les balises, sans double échappement", () => {
  assertEquals(texteDepuisHtml("Dupont &amp; Fils &lt;SARL&gt;"), "Dupont & Fils <SARL>");
  assertEquals(texteDepuisHtml("&amp;amp;"), "&amp;");
  assertEquals(texteDepuisHtml("<ul><li>A &quot;b&quot; &#39;c&#39;</li></ul>"), "A \"b\" 'c'");
});

Deno.test("construireEmail : objet en texte brut, corps échappé et habillé du squelette", () => {
  const { subject, html } = construireEmail(gabarit, branding, varsHtml);
  assertEquals(subject, "Commande WS-0042 — Dupont & Fils <SARL> — Chauffage & Co");
  assertStringIncludes(html, "<html><body><header>Chauffage &amp; Co</header>");
  assertStringIncludes(html, "<p>Bonjour Dupont &amp; Fils &lt;SARL&gt;</p>");
  assertStringIncludes(html, "<li>Granulés &quot;Premium&quot; × 2 — 10 €</li>");
  assert(!html.includes("&amp;amp;"), "double échappement dans le corps");
  assert(!html.includes("{{"), "placeholder non remplacé");
});

Deno.test("construireEmail : marque échappée dans le corps quand variablesCommande ne la fournit pas", () => {
  const { subject, html } = construireEmail(
    { subject: "{{BRAND_NAME}}", html_body: "<p>{{BRAND_NAME}} {{ORG_PHONE}}</p>" },
    branding,
    {},
  );
  assertEquals(subject, "Chauffage & Co");
  assertStringIncludes(html, "<p>Chauffage &amp; Co 05 00 00 00 00</p>");
});

Deno.test("issueAction : Resend OK → sent", async () => {
  const { appels, send } = fauxResend({});
  const r = await issueAction(
    { action: "email_client", template: gabarit, to: ["client@exemple.fr"], cc: [], branding, varsHtml },
    send,
  );
  assertEquals(r.status, "sent");
  assertEquals(r.error_code, null);
  assertEquals(r.recipient, "client@exemple.fr");
  assertEquals(r.provider_id, "re_1");
  assertEquals(appels.length, 1);
  assertEquals(appels[0].to, ["client@exemple.fr"]);
  assertEquals(appels[0].from, "Chauffage & Co <boutique@exemple.fr>");
  assertEquals(appels[0].subject, "Commande WS-0042 — Dupont & Fils <SARL> — Chauffage & Co");
});

Deno.test("issueAction : Resend en erreur → failed / resend_failed", async () => {
  const { send } = fauxResend({ ok: false, status: 422, id: null, message: "Invalid `to` field" });
  const r = await issueAction(
    { action: "email_client", template: gabarit, to: ["client@exemple.fr"], cc: [], branding, varsHtml },
    send,
  );
  assertEquals(r.status, "failed");
  assertEquals(r.error_code, "resend_failed");
  assertEquals(r.error_message, "Invalid `to` field");
  assert(r.attempted);
});

Deno.test("issueAction : gabarit absent → failed / template_missing, rien n'est envoyé", async () => {
  const { appels, send } = fauxResend({});
  const r = await issueAction(
    { action: "email_client", template: null, to: ["client@exemple.fr"], cc: [], branding, varsHtml },
    send,
  );
  assertEquals(r.status, "failed");
  assertEquals(r.error_code, "template_missing");
  assertEquals(appels.length, 0);
  assert(!r.attempted);
});

Deno.test("issueAction : e-mail client vide → skipped / no_email", async () => {
  const { appels, send } = fauxResend({});
  const r = await issueAction(
    { action: "email_client", template: gabarit, to: [], cc: [], branding, varsHtml },
    send,
  );
  assertEquals(r.status, "skipped");
  assertEquals(r.error_code, "no_email");
  assertEquals(appels.length, 0);
});

Deno.test("issueAction : ordre colis sans prestataire → failed / prestataire_missing", async () => {
  const { appels, send } = fauxResend({});
  const r = await issueAction(
    { action: "ordre_colis", template: gabarit, to: [], cc: ["interne@exemple.fr"], branding, varsHtml },
    send,
  );
  assertEquals(r.status, "failed");
  assertEquals(r.error_code, "prestataire_missing");
  assertEquals(appels.length, 0);
});

Deno.test("issueAction : pas d'expéditeur → failed / no_from_email", async () => {
  const { appels, send } = fauxResend({});
  const r = await issueAction(
    { action: "email_client", template: gabarit, to: ["client@exemple.fr"], cc: [], branding: orgBranding({}), varsHtml },
    send,
  );
  assertEquals(r.status, "failed");
  assertEquals(r.error_code, "no_from_email");
  assertEquals(appels.length, 0);
});

Deno.test("issueAction : ordre colis → prestataires en destinataires, interne en copie", async () => {
  const { appels, send } = fauxResend({});
  const r = await issueAction(
    { action: "ordre_colis", template: gabarit, to: ["p1@x.fr", "p2@x.fr"], cc: ["interne@exemple.fr"], branding, varsHtml },
    send,
  );
  assertEquals(r.status, "sent");
  assertEquals(appels[0].to, ["p1@x.fr", "p2@x.fr"]);
  assertEquals(appels[0].cc, ["interne@exemple.fr"]);
  assertEquals(r.recipient, "p1@x.fr, p2@x.fr");
});

Deno.test("destinatairesAction : client = e-mail de la commande ; ordre colis = prestataire + interne en copie", () => {
  const cfg = { colis: { prestataire: { emails: ["p@x.fr"] } }, emails: { interne: ["i@x.fr", "p@x.fr"] } };
  assertEquals(destinatairesAction("email_client", { email: "  c@x.fr " }, cfg), { to: ["c@x.fr"], cc: [] });
  assertEquals(destinatairesAction("email_client", { email: null }, cfg), { to: [], cc: [] });
  assertEquals(destinatairesAction("ordre_colis", { email: "c@x.fr" }, cfg), { to: ["p@x.fr"], cc: ["i@x.fr"] });
  assertEquals(destinatairesAction("ordre_colis", {}, { colis: { prestataire: { emails: [] } }, emails: { interne: ["i@x.fr"] } }), {
    to: [],
    cc: ["i@x.fr"],
  });
});

Deno.test("estRetour : un pas en arrière sur le board ne déclenche pas d'action", () => {
  assertEquals(estRetour("livree", "expediee"), true);
  assertEquals(estRetour("expediee", "confirmee"), true);
  assertEquals(estRetour("confirmee", "expediee"), false);
  assertEquals(estRetour("nouvelle", "confirmee"), false);
});

Deno.test("lireEcrireAgir : une lecture en échec n'écrit rien et n'agit pas", async () => {
  const journal: string[] = [];
  let erreur: unknown = null;
  try {
    await lireEcrireAgir({
      lire: () => { journal.push("lire"); return Promise.reject(new Error("lecture 500")); },
      ecrire: () => { journal.push("ecrire"); return Promise.resolve("ok"); },
      agir: () => { journal.push("agir"); return Promise.resolve([]); },
    });
  } catch (e) {
    erreur = e;
  }
  assert(erreur instanceof Error && erreur.message === "lecture 500");
  assertEquals(journal, ["lire"]);
});

Deno.test("lireEcrireAgir : ordre lire → écrire → agir, contexte transmis", async () => {
  const journal: string[] = [];
  const r = await lireEcrireAgir({
    lire: () => { journal.push("lire"); return Promise.resolve({ n: 2 }); },
    ecrire: (c) => { journal.push(`ecrire ${c.n}`); return Promise.resolve("ligne"); },
    agir: (c, w) => { journal.push(`agir ${c.n} ${w}`); return Promise.resolve(["a1"]); },
  });
  assertEquals(journal, ["lire", "ecrire 2", "agir 2 ligne"]);
  assertEquals(r, { ecrit: "ligne", resultat: ["a1"] });
});

Deno.test("lireEcrireAgir : écriture refusée (null) → on n'agit pas", async () => {
  const journal: string[] = [];
  const r = await lireEcrireAgir({
    lire: () => Promise.resolve(1),
    ecrire: () => Promise.resolve(null),
    agir: () => { journal.push("agir"); return Promise.resolve([]); },
  });
  assertEquals(r, null);
  assertEquals(journal, []);
});

Deno.test("finaliserAction : succès du premier coup", async () => {
  let n = 0;
  const r = await finaliserAction(() => { n++; return Promise.resolve({ error: null }); });
  assertEquals(r, { ok: true, tentatives: 1, erreur: null });
  assertEquals(n, 1);
});

Deno.test("finaliserAction : erreur transitoire → un seul nouvel essai", async () => {
  let n = 0;
  const r = await finaliserAction(() => {
    n++;
    return Promise.resolve({ error: n === 1 ? { message: "connection reset" } : null });
  });
  assertEquals(r, { ok: true, tentatives: 2, erreur: null });
});

Deno.test("finaliserAction : deux échecs (ou exception) → abandon après 2 essais", async () => {
  let n = 0;
  const r = await finaliserAction(() => { n++; return Promise.reject(new Error("timeout")); });
  assertEquals(r.ok, false);
  assertEquals(r.tentatives, 2);
  assertEquals(r.erreur, "timeout");
  assertEquals(n, 2);
});

Deno.test("finaliserAction : not_reserved n'est pas réessayé", async () => {
  let n = 0;
  const r = await finaliserAction(() => { n++; return Promise.resolve({ error: { message: "not_reserved" } }); });
  assertEquals(r, { ok: false, tentatives: 1, erreur: "not_reserved" });
  assertEquals(n, 1);
});
