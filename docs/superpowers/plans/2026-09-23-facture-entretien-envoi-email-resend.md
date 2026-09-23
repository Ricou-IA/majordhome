# Envoi de la facture d'entretien par e-mail (Resend) avec certificats — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Depuis la modale « Facturer » (et depuis la carte facturée), envoyer au client par e-mail la facture d'entretien + les certificats d'entretien cochés, via Resend, sous le domaine de l'org, si le module Communication est ouvert.

**Architecture:** Gate pur `moduleActif(settings, 'communication')` dans `src/lib/modules.js`. Un modèle pur `src/lib/invoiceEmailModel.js` décide de la disponibilité (visible / activée / raison) et met en forme la liste des certificats joignables. Une nouvelle edge `invoice-send` (JWT + membership + module) relit intervention, facture (Pennylane ou hub), certificats et gabarit côté serveur, télécharge les PDF, envoie via un helper `_shared/mail.ts` (Resend + pièces jointes + placeholders + `mailing_logs`). Côté front : `InvoiceEmailOptions` (présentationnel) monté dans `FacturerEntretienDialog` (envoi après création) et dans `SendInvoiceEmailDialog` (bouton « Envoyer par e-mail » de la carte facturée). Gabarit par défaut créé d'un clic dans Settings → Communication → Emails. Aucune migration.

**Tech Stack:** JS pur + `node --test`, React 18 / Tailwind, Supabase Edge (Deno) + Resend API, `supabase.functions.invoke`.

**Spec:** `docs/superpowers/specs/2026-09-23-facture-entretien-envoi-email-resend-design.md`.

## Global Constraints

- Rien n'apparaît sans `settings.modules.communication === true` (composants ET bouton de carte). `moduleActif(settings, 'socle')` est toujours vrai.
- Coche visible mais grisée avec raison quand : pas d'e-mail client (`no_email`), mode brouillon (`draft_mode`), `from_email` absent (`no_from_email`), domaine Resend non vérifié `settings.resend.status !== 'verified'` (`resend_not_verified`), facture absente sur la carte (`no_invoice`, dialogue de renvoi seulement).
- Certificat joignable = `pdf_storage_path` non nul ; coché par défaut ; non signé (`statut !== 'signe'`) = cochable, marqué « non signé » ; sans PDF = grisé « PDF non généré ».
- L'envoi ne se déclenche qu'APRÈS une création réussie et **jamais** pour un brouillon Pennylane. Un échec d'envoi ne défait rien : toast d'erreur + renvoi depuis la carte.
- Edge : `verify_jwt: true`, `requireOrgMembership(req, { orgId, requiredRole: 'team_leader', orgSettingsFilter: (s) => s.modules?.communication === true })`. Tout objet relu filtré `org_id` ; ids de certificats acceptés seulement s'ils appartiennent à l'intervention ou à ses enfants (`parent_id`). `{ error }` lu sur chaque écriture. Codes d'erreur : `module_communication_inactif` (403), `intervention_not_found` (404), `invoice_missing`, `invoice_is_draft`, `invoice_pdf_missing`, `certificate_not_allowed`, `certificate_pdf_missing`, `template_missing`, `client_email_missing` (409), `attachments_too_large` (413), `resend_failed` (502).
- Log `majordhome_mailing_logs` : `org_id` = org CORE, `client_id`, `campaign_name: 'facture_entretien'`, `subject`, `email_to`, `status sent|failed`, `provider_id`, `error_message` — écrit dans les deux cas (succès et échec Resend).
- Gabarit = `majordhome_mail_campaigns` `key = 'facture_entretien'`, `is_transactional = true`, non archivé. Défaut = `DEFAULT_INVOICE_EMAIL` de `src/lib/invoiceEmailTemplate.js` (pur), créé depuis Settings → Communication → Emails. Placeholders `{{CLIENT_NAME}} {{INVOICE_NUMBER}} {{INVOICE_AMOUNT}} {{INVOICE_DATE}} {{EQUIPMENTS}} {{ATTACHMENTS}}` + marque (`{{BRAND_NAME}} {{ORG_EMAIL}} {{ORG_PHONE}} {{ORG_ADDRESS}} {{ORG_POSTAL_CODE}} {{ORG_CITY}} {{ORG_WEBSITE_URL}} {{ACCENT_COLOR}} {{SECONDARY_COLOR}} {{EMAIL_TAGLINE}} {{LOGO_URL}}`), habillage `settings.email_skeleton_html` avec `{{EMAIL_BODY}}` comme `contract-signed-notify`.
- Modules purs sans import React/Supabase ; tests `node --test` ; 0 warning ESLint ; `npm run audit:quality && npm run lint && npx vite build` verts ; `deno check` vert sur l'edge. Commits terminés par `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Pas de preview tools, pas de push, pas de déploiement (le contrôleur déploie).

---

### Task 1: Modules purs, services et hooks

**Files:**
- Modify: `src/lib/modules.js` (+ `moduleActif`) · Test: `scripts/modules.test.mjs`
- Create: `src/lib/invoiceEmailModel.js` · Test: `scripts/invoice-email-model.test.mjs` (à ajouter dans le script `audit:quality` de `package.json`, à côté des autres `node --test`)
- Create: `src/lib/invoiceEmailTemplate.js`
- Modify: `src/shared/services/certificats.service.js` (+ `listForInterventionTree`), `src/shared/hooks/cacheKeys.js` (+ `certificatKeys.tree`), `src/shared/hooks/useCertificats.js` (+ `useInterventionCertificats`)
- Modify: `src/shared/services/invoices.service.js` (+ `sendByEmail`), `src/shared/hooks/useInvoices.js` (+ `useSendInvoiceEmail`)

**Interfaces:**
- Produces: `moduleActif(settings, key) → boolean` ; `invoiceEmailAvailability({ settings, mode, clientEmail, hasInvoice, isDraftInvoice }) → { visible, enabled, reason }` ; `certificateAttachmentRows(certificats) → [{ id, label, sublabel, attachable, defaultChecked, badge }]` ; `INVOICE_EMAIL_ERROR_MESSAGES` ; `invoiceEmailErrorMessage(err)` ; `INVOICE_EMAIL_TEMPLATE_KEY`, `DEFAULT_INVOICE_EMAIL`, `INVOICE_EMAIL_PLACEHOLDERS` ; `certificatsService.listForInterventionTree(orgId, interventionId) → { data: Certificat[], error }` ; `useInterventionCertificats(orgId, interventionId, { enabled })` ; `invoicesService.sendByEmail(orgId, { interventionId, certificateIds, to }) → { data: { providerId, to, attachments }, error }` ; `useSendInvoiceEmail(orgId)` (mutation, `unwrapResult`).

- [ ] **Step 1: Tests**

`scripts/modules.test.mjs` — ajouter `moduleActif` à l'import et :
```js
test('moduleActif : socle toujours ouvert ; un module n’est ouvert que par settings.modules[key] === true', () => {
  assert.equal(moduleActif({}, 'socle'), true);
  assert.equal(moduleActif(null, 'socle'), true);
  assert.equal(moduleActif({}, 'communication'), false);
  assert.equal(moduleActif({ modules: { communication: true } }, 'communication'), true);
  assert.equal(moduleActif({ modules: { communication: 'true' } }, 'communication'), false);
  assert.equal(moduleActif({ modules: { communication: true } }, 'solaire'), false);
});
```

`scripts/invoice-email-model.test.mjs` (nouveau) :
```js
// scripts/invoice-email-model.test.mjs — envoi de la facture d'entretien par e-mail (src/lib/invoiceEmailModel.js)
// node --test scripts/invoice-email-model.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invoiceEmailAvailability, certificateAttachmentRows, invoiceEmailErrorMessage, INVOICE_EMAIL_ERROR_MESSAGES } from '../src/lib/invoiceEmailModel.js';
import { DEFAULT_INVOICE_EMAIL, INVOICE_EMAIL_TEMPLATE_KEY, INVOICE_EMAIL_PLACEHOLDERS } from '../src/lib/invoiceEmailTemplate.js';

const OK = { modules: { communication: true }, from_email: 'contact@mayer-energie.fr', resend: { status: 'verified' } };

test('invoiceEmailAvailability : invisible sans module, sinon activée seulement si e-mail + from_email + domaine vérifié + facture non brouillon', () => {
  assert.deepEqual(invoiceEmailAvailability({ settings: {}, mode: 'final', clientEmail: 'a@b.fr' }), { visible: false, enabled: false, reason: 'module_off' });
  assert.deepEqual(invoiceEmailAvailability({ settings: OK, mode: 'final', clientEmail: 'a@b.fr' }), { visible: true, enabled: true, reason: null });
  assert.deepEqual(invoiceEmailAvailability({ settings: OK, mode: 'hub', clientEmail: 'a@b.fr' }), { visible: true, enabled: true, reason: null });
  assert.equal(invoiceEmailAvailability({ settings: OK, mode: 'draft', clientEmail: 'a@b.fr' }).reason, 'draft_mode');
  assert.equal(invoiceEmailAvailability({ settings: OK, mode: 'final', clientEmail: '' }).reason, 'no_email');
  assert.equal(invoiceEmailAvailability({ settings: { ...OK, from_email: '' }, mode: 'final', clientEmail: 'a@b.fr' }).reason, 'no_from_email');
  assert.equal(invoiceEmailAvailability({ settings: { ...OK, resend: { status: 'pending' } }, mode: 'final', clientEmail: 'a@b.fr' }).reason, 'resend_not_verified');
  // renvoi depuis la carte : la facture doit exister et ne pas être un brouillon Pennylane
  assert.equal(invoiceEmailAvailability({ settings: OK, mode: 'final', clientEmail: 'a@b.fr', hasInvoice: false }).reason, 'no_invoice');
  assert.equal(invoiceEmailAvailability({ settings: OK, mode: 'draft', clientEmail: 'a@b.fr', hasInvoice: true, isDraftInvoice: false }).enabled, true, 'une facture Pennylane déjà finalisée se renvoie même si le mode courant est brouillon');
  assert.equal(invoiceEmailAvailability({ settings: OK, mode: 'final', clientEmail: 'a@b.fr', hasInvoice: true, isDraftInvoice: true }).reason, 'draft_invoice');
  // ordre des raisons : module, puis e-mail, puis expéditeur, puis domaine, puis facture
  assert.equal(invoiceEmailAvailability({ settings: { modules: { communication: true } }, mode: 'draft', clientEmail: '' }).reason, 'no_email');
});

test('certificateAttachmentRows : PDF requis pour être joignable, cochés par défaut, non signé marqué, libellé depuis l’équipement', () => {
  const rows = certificateAttachmentRows([
    { id: 'c1', equipement_type: 'poele', equipement_marque: 'MCZ', equipement_modele: 'Ego', statut: 'signe', pdf_storage_path: 'x/1.pdf', reference: 'CERT-1' },
    { id: 'c2', equipement_type: 'pac_air_air', equipement_marque: null, equipement_modele: null, statut: 'brouillon', pdf_storage_path: 'x/2.pdf', reference: null },
    { id: 'c3', equipement_type: null, statut: 'brouillon', pdf_storage_path: null, reference: null },
  ]);
  assert.deepEqual(rows.map((r) => [r.id, r.attachable, r.defaultChecked, r.badge]), [['c1', true, true, null], ['c2', true, true, 'non signé'], ['c3', false, false, 'PDF non généré']]);
  assert.equal(rows[0].label, 'Certificat CERT-1');
  assert.equal(rows[0].sublabel, 'poele · MCZ · Ego');
  assert.equal(rows[1].label, 'Certificat d’entretien');
  assert.equal(rows[1].sublabel, 'pac_air_air');
  assert.equal(rows[2].sublabel, '');
  assert.deepEqual(certificateAttachmentRows(null), []);
});

test('messages d’erreur : chaque code de l’edge a un message FR, détail ajouté, inconnu → fallback', () => {
  for (const code of ['module_communication_inactif', 'intervention_not_found', 'invoice_missing', 'invoice_is_draft', 'invoice_pdf_missing', 'certificate_not_allowed', 'certificate_pdf_missing', 'template_missing', 'client_email_missing', 'attachments_too_large', 'resend_failed']) {
    assert.ok(INVOICE_EMAIL_ERROR_MESSAGES[code], `message manquant pour ${code}`);
  }
  assert.equal(invoiceEmailErrorMessage({ code: 'template_missing' }), INVOICE_EMAIL_ERROR_MESSAGES.template_missing);
  assert.equal(invoiceEmailErrorMessage({ code: 'resend_failed', detail: 'HTTP 422' }), `${INVOICE_EMAIL_ERROR_MESSAGES.resend_failed} (HTTP 422)`);
  assert.equal(invoiceEmailErrorMessage({ message: 'boom' }), 'boom');
  assert.equal(invoiceEmailErrorMessage(null), 'L’e-mail n’a pas pu être envoyé.');
});

test('gabarit par défaut : clé, transactionnel, variables présentes dans le corps', () => {
  assert.equal(INVOICE_EMAIL_TEMPLATE_KEY, 'facture_entretien');
  assert.equal(DEFAULT_INVOICE_EMAIL.key, 'facture_entretien');
  assert.equal(DEFAULT_INVOICE_EMAIL.is_transactional, true);
  for (const p of ['{{CLIENT_NAME}}', '{{INVOICE_NUMBER}}', '{{INVOICE_AMOUNT}}', '{{ATTACHMENTS}}', '{{BRAND_NAME}}']) {
    assert.ok(DEFAULT_INVOICE_EMAIL.html_body.includes(p) || DEFAULT_INVOICE_EMAIL.subject.includes(p), `${p} absent du gabarit`);
    assert.ok(INVOICE_EMAIL_PLACEHOLDERS.includes(p));
  }
  assert.ok(!/<html|<body/i.test(DEFAULT_INVOICE_EMAIL.html_body), 'corps sans <html> : il est habillé par le squelette de l’org');
});
```

- [ ] **Step 2: Lancer, vérifier l'échec** — `node --test scripts/modules.test.mjs scripts/invoice-email-model.test.mjs`.

- [ ] **Step 3: Implémenter**

`src/lib/modules.js` (à la fin) :
```js
/**
 * Un module est-il ouvert pour l'org ? Source : `core.organizations.settings.modules[key] === true`,
 * posé en base par nous (décision commerciale, pas un réglage de l'org_admin). Le socle est
 * toujours ouvert. Premier consommateur : l'envoi de la facture par e-mail (module
 * `communication`, Eric 2026-09-23) ; la sidebar et la page Paramètres s'y brancheront.
 * @param {object|null|undefined} settings
 * @param {string} key
 */
export function moduleActif(settings, key) {
  if (key === 'socle') return true;
  return settings?.modules?.[key] === true;
}
```

`src/lib/invoiceEmailTemplate.js` :
```js
// src/lib/invoiceEmailTemplate.js
// ============================================================================
// Gabarit PAR DÉFAUT de l'e-mail « Facture d'entretien » (module Communication).
// Créé d'un clic dans Settings → Communication → Emails comme campagne
// transactionnelle `facture_entretien` de l'org, puis éditable dans Mailing → Éditeur.
// Module PUR. Le corps est habillé par le squelette d'e-mail de l'org (pas de <html>).
// ============================================================================
export const INVOICE_EMAIL_TEMPLATE_KEY = 'facture_entretien';

export const INVOICE_EMAIL_PLACEHOLDERS = Object.freeze([
  '{{CLIENT_NAME}}', '{{INVOICE_NUMBER}}', '{{INVOICE_AMOUNT}}', '{{INVOICE_DATE}}', '{{EQUIPMENTS}}', '{{ATTACHMENTS}}',
  '{{BRAND_NAME}}', '{{ORG_EMAIL}}', '{{ORG_PHONE}}', '{{ORG_ADDRESS}}', '{{ORG_POSTAL_CODE}}', '{{ORG_CITY}}', '{{ORG_WEBSITE_URL}}',
]);

export const DEFAULT_INVOICE_EMAIL = Object.freeze({
  key: INVOICE_EMAIL_TEMPLATE_KEY,
  label: 'Facture d’entretien (envoi au client)',
  subject: 'Votre facture {{INVOICE_NUMBER}} — {{BRAND_NAME}}',
  html_body: [
    '<p>Bonjour {{CLIENT_NAME}},</p>',
    '<p>Veuillez trouver ci-joint votre facture <strong>{{INVOICE_NUMBER}}</strong> du {{INVOICE_DATE}}, d’un montant de <strong>{{INVOICE_AMOUNT}}</strong>, relative à l’entretien de : {{EQUIPMENTS}}.</p>',
    '<p>Pièces jointes : {{ATTACHMENTS}}</p>',
    '<p>Nous vous remercions de votre confiance et restons à votre disposition au {{ORG_PHONE}} ou par e-mail à {{ORG_EMAIL}}.</p>',
    '<p>{{BRAND_NAME}}<br>{{ORG_ADDRESS}}, {{ORG_POSTAL_CODE}} {{ORG_CITY}}</p>',
  ].join('\n'),
  is_transactional: true,
});
```

`src/lib/invoiceEmailModel.js` :
```js
// src/lib/invoiceEmailModel.js
// ============================================================================
// Envoi de la facture d'entretien par e-mail (Resend) — modèle PUR (spec
// 2026-09-23-facture-entretien-envoi-email-resend-design.md) : disponibilité de
// l'option (module Communication, prérequis), lignes de certificats joignables,
// messages d'erreur de l'edge `invoice-send`. Aucun import React / Supabase.
// ============================================================================
import { moduleActif } from './modules.js';

/**
 * @param {object} p
 * @param {object} p.settings  settings de l'org
 * @param {'draft'|'final'|'hub'} p.mode  mode de création (pennylaneInvoiceSettings)
 * @param {string|null|undefined} p.clientEmail
 * @param {boolean} [p.hasInvoice=true]  renvoi depuis la carte : la carte porte-t-elle une facture ?
 * @param {boolean} [p.isDraftInvoice]  renvoi : la facture Pennylane est-elle encore un brouillon ? (si connu)
 * @returns {{ visible: boolean, enabled: boolean, reason: null|'module_off'|'no_email'|'no_from_email'|'resend_not_verified'|'draft_mode'|'no_invoice'|'draft_invoice' }}
 */
export function invoiceEmailAvailability({ settings, mode, clientEmail, hasInvoice = true, isDraftInvoice }) {
  if (!moduleActif(settings, 'communication')) return { visible: false, enabled: false, reason: 'module_off' };
  const off = (reason) => ({ visible: true, enabled: false, reason });
  if (!(clientEmail || '').trim()) return off('no_email');
  if (!(settings?.from_email || '').trim()) return off('no_from_email');
  if (settings?.resend?.status !== 'verified') return off('resend_not_verified');
  if (!hasInvoice) return off('no_invoice');
  if (isDraftInvoice === true) return off('draft_invoice');
  if (isDraftInvoice == null && mode === 'draft') return off('draft_mode');
  return { visible: true, enabled: true, reason: null };
}

export const INVOICE_EMAIL_REASONS = Object.freeze({
  no_email: 'Le client n’a pas d’adresse e-mail (fiche client).',
  no_from_email: 'Aucun e-mail expéditeur : Paramètres → Communication → Emails.',
  resend_not_verified: 'Le domaine d’envoi n’est pas vérifié : Paramètres → Communication → Emails.',
  draft_mode: 'Brouillon Pennylane : à envoyer depuis Pennylane après finalisation.',
  no_invoice: 'Aucune facture sur cette carte.',
  draft_invoice: 'La facture est encore un brouillon dans Pennylane : finalisez-la d’abord.',
});

/**
 * Certificats de l'intervention → lignes cochables. Joignable = PDF archivé.
 * @param {Array<{ id, reference?, equipement_type?, equipement_marque?, equipement_modele?, statut?, pdf_storage_path? }>|null} certificats
 */
export function certificateAttachmentRows(certificats) {
  return (certificats || []).map((c) => {
    const attachable = Boolean(c.pdf_storage_path);
    const signed = c.statut === 'signe';
    return {
      id: c.id,
      label: c.reference ? `Certificat ${c.reference}` : 'Certificat d’entretien',
      sublabel: [c.equipement_type, c.equipement_marque, c.equipement_modele].filter(Boolean).join(' · '),
      attachable,
      defaultChecked: attachable,
      badge: !attachable ? 'PDF non généré' : !signed ? 'non signé' : null,
    };
  });
}

export const INVOICE_EMAIL_ERROR_MESSAGES = Object.freeze({
  module_communication_inactif: 'Le module Communication n’est pas ouvert pour cette organisation.',
  intervention_not_found: 'Intervention introuvable.',
  invoice_missing: 'Cette carte n’a pas de facture à envoyer.',
  invoice_is_draft: 'La facture est encore un brouillon dans Pennylane : finalisez-la d’abord.',
  invoice_pdf_missing: 'Le PDF de la facture n’est pas disponible (Pennylane ne l’a pas encore produit, ou l’archive du hub manque).',
  certificate_not_allowed: 'Un certificat sélectionné n’appartient pas à cette intervention.',
  certificate_pdf_missing: 'Un certificat sélectionné n’a pas de PDF généré : ouvrez-le et générez le PDF.',
  template_missing: 'Gabarit « Facture d’entretien » absent : créez-le dans Paramètres → Communication → Emails.',
  client_email_missing: 'Le client n’a pas d’adresse e-mail.',
  attachments_too_large: 'Pièces jointes trop volumineuses (plus de 35 Mo) : retirez des certificats.',
  resend_failed: 'Resend a refusé l’envoi.',
});

const FALLBACK = 'L’e-mail n’a pas pu être envoyé.';

/** @param {{ code?: string, detail?: string, message?: string }|null|undefined} err */
export function invoiceEmailErrorMessage(err) {
  if (!err) return FALLBACK;
  const base = err.code && INVOICE_EMAIL_ERROR_MESSAGES[err.code];
  if (base) return err.detail ? `${base} (${String(err.detail).slice(0, 300)})` : base;
  return err.message || FALLBACK;
}
```

`src/shared/services/certificats.service.js` — ajouter :
```js
  /**
   * Certificats de l'intervention ET de ses interventions enfants (1 par équipement,
   * `parent_id`) — liste des pièces joignables à l'e-mail de facture (module Communication).
   * @param {string} orgId  org core
   * @param {string} interventionId
   */
  async listForInterventionTree(orgId, interventionId) {
    try {
      const { data: children, error: childErr } = await supabase
        .from('majordhome_interventions').select('id').eq('parent_id', interventionId);
      if (childErr) return { data: null, error: childErr };
      const ids = [interventionId, ...(children || []).map((c) => c.id)];
      const { data, error } = await supabase
        .from('majordhome_certificats')
        .select('id, intervention_id, equipment_id, reference, equipement_type, equipement_marque, equipement_modele, statut, signed_at, pdf_storage_path, pdf_generated_at')
        .eq('org_id', orgId)
        .in('intervention_id', ids)
        .order('created_at', { ascending: true });
      if (error) return { data: null, error };
      return { data: data || [], error: null };
    } catch (err) {
      logger.error('[certificats] listForInterventionTree error:', err);
      return { data: null, error: err };
    }
  },
```
(vérifier que le fichier importe `logger` ; sinon utiliser le pattern d'erreur déjà en place dans le fichier — ne pas introduire de `console.*`).

`cacheKeys.js` : `tree: (orgId, interventionId) => [...certificatKeys.all(orgId), 'tree', interventionId],` dans `certificatKeys`.

`useCertificats.js` :
```js
/** Certificats de l'intervention + enfants (pièces joignables à l'e-mail de facture). */
export function useInterventionCertificats(orgId, interventionId, { enabled = true } = {}) {
  const query = useQuery({
    queryKey: certificatKeys.tree(orgId, interventionId),
    queryFn: () => unwrapResult(certificatsService.listForInterventionTree(orgId, interventionId)),
    enabled: !!orgId && !!interventionId && enabled,
    staleTime: 30_000,
  });
  return { certificats: query.data || [], isLoading: query.isLoading, error: query.error };
}
```
(importer `unwrapResult` depuis `@/lib/serviceHelpers` si absent du fichier).

`invoices.service.js` — ajouter, sur le modèle d'`importToPennylane` (même normalisation d'erreur `err.code` / `err.detail` depuis le corps JSON de la réponse edge) :
```js
  /**
   * Envoie la facture de l'intervention au client par e-mail (edge `invoice-send`, Resend),
   * avec les certificats cochés en pièces jointes. Module Communication requis (vérifié serveur).
   * @returns {Promise<{ data: { providerId: string|null, to: string, attachments: string[] }|null, error: object|null }>}
   */
  async sendByEmail(orgId, { interventionId, certificateIds = [], to = null }) { … },
```

`useInvoices.js` :
```js
export function useSendInvoiceEmail(orgId) {
  return useMutation({
    mutationFn: ({ interventionId, certificateIds, to }) =>
      unwrapResult(invoicesService.sendByEmail(orgId, { interventionId, certificateIds, to })),
  });
}
```

- [ ] **Step 4: Tests verts** — `node --test scripts/modules.test.mjs scripts/invoice-email-model.test.mjs` ; ajouter `scripts/invoice-email-model.test.mjs` à la commande `audit:quality` de `package.json` (regarder comment les autres tests y sont listés).

- [ ] **Step 5: Qualité et commit**
```bash
npm run audit:quality && npm run lint
git add src/lib/modules.js src/lib/invoiceEmailModel.js src/lib/invoiceEmailTemplate.js scripts/modules.test.mjs scripts/invoice-email-model.test.mjs src/shared/services/certificats.service.js src/shared/hooks/cacheKeys.js src/shared/hooks/useCertificats.js src/shared/services/invoices.service.js src/shared/hooks/useInvoices.js package.json
git commit -m "feat(facturation): envoi de la facture par e-mail — gate module Communication, modèle pur, gabarit par défaut, services et hooks"
```

---

### Task 2: Edge `invoice-send` + helper `_shared/mail.ts`

**Files:**
- Create: `supabase/functions/_shared/mail.ts`
- Create: `supabase/functions/invoice-send/index.ts`
- Modify: `supabase/config.toml` (+ `[functions.invoice-send] verify_jwt = true`)

**Interfaces:**
- Consumes: `requireOrgMembership`, `jsonResponse`, `buildCorsHeaders`, `sanitizeError` (`../_shared/auth.ts`).
- Produces: `POST { org_id, intervention_id, certificate_ids?: string[], to?: string }` → `201 { ok: true, provider_id, to, attachments: string[] }` ou `{ error: code, detail? }`.

- [ ] **Step 1: `_shared/mail.ts`** — helper Deno sans dépendance à `mailing-send` :
  - `export function arrayBufferToBase64(buf: ArrayBuffer): string` (copie de `contract-signed-notify`).
  - `export function applyPlaceholders(text: string, replacements: Record<string, string>): string` (split/join).
  - `export function sanitizeFilename(s: string): string`.
  - `export function orgBranding(settings: Record<string, unknown>)` → `{ fromName, fromEmail, replyTo, brandName, phone, address, postalCode, city, websiteUrl, accentColor, secondaryColor, emailTagline, logoUrl, skeleton }` — mêmes clés que `loadOrgBranding` de `mailing-send/index.ts:226-251` (lire ce bloc et le reproduire, y compris les défauts de couleur), `fromEmail = settings.from_email || settings.reply_to || ''` (PAS de fallback Mayer : `''` ⇒ l'appelant refuse).
  - `export function brandingReplacements(b)` → `Record<string,string>` des `{{BRAND_NAME}} … {{LOGO_URL}}`.
  - `export function wrapWithSkeleton(b, body: string)` : si `b.skeleton` contient `{{EMAIL_BODY}}` et que `body` n'est pas un HTML complet (`!/<html/i.test(body)`) → remplacement, sinon `body`.
  - `export async function sendResendEmail(apiKey, payload: { from, to: string[], replyTo?, subject, html, attachments?: { filename, content }[] })` → `{ ok: boolean, status: number, id: string|null, message: string|null }` (POST `https://api.resend.com/emails`, JSON, jamais de throw).
  - `export async function insertMailingLog(supabase, row)` → `string|null` (erreur sanitized) — insert sur `majordhome_mailing_logs` (vue publique, comme `contract-signed-notify:251-266`).

- [ ] **Step 2: `invoice-send/index.ts`** — en-tête de commentaire (rôle, spec, codes d'erreur), puis :
  1. OPTIONS/CORS, POST only, body JSON, `org_id` + `intervention_id` requis (400).
  2. `requireOrgMembership(req, { orgId: body.org_id, requiredRole: 'team_leader', orgSettingsFilter: (s) => (s.modules as { communication?: boolean } | undefined)?.communication === true })` — si `!auth.ok` : renvoyer `jsonResponse({ error: 'module_communication_inactif' }, 403, req)` quand la réponse d'auth est un 403 (`auth.response.status === 403`), sinon `auth.response`. `RESEND_API_KEY` absent → 500.
  3. Settings de l'org : `supabase.schema('core').from('organizations').select('settings').eq('id', orgId).maybeSingle()` → `orgBranding(settings)` ; `fromEmail` vide → 409 `no_from_email`.
  4. Carte : `from('majordhome_entretien_sav').select('id, org_id, client_id, client_name, client_email, contract_number, invoice_id, invoiced_at').eq('id', intervention_id).eq('org_id', orgId).maybeSingle()` (cette vue porte l'org CORE, cf. `entretiens.service.js:194-204`) → 404 `intervention_not_found`. `to = body.to || client_email` ; vide → 409 `client_email_missing`. `!invoice_id` → 409 `invoice_missing`.
  5. Facture :
     - `invoice_id` uuid (`/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`) → hub : `from('majordhome_invoices').select('id, number, invoice_date, total_ttc, pdf_path, status').eq('id', invoice_id).eq('org_id', orgId).maybeSingle()` ; `status !== 'issued'` ou `!pdf_path` → 409 `invoice_pdf_missing` ; `supabase.storage.from('invoices').download(pdf_path)`.
     - sinon Pennylane : `from('majordhome_pennylane_sync').select('pennylane_id, pennylane_number, metadata').eq('org_id', orgId).eq('entity_type', 'invoice').eq('local_id', intervention_id).maybeSingle()` ; absent → 409 `invoice_missing` ; `metadata.draft === true` → 409 `invoice_is_draft` ; url = `metadata.public_file_url || metadata.file_url` ; absente → 409 `invoice_pdf_missing` ; `fetch(url)` non-2xx → 409 `invoice_pdf_missing` avec `detail: HTTP …`. Numéro = `pennylane_number || 'sans numéro'`, montant = `metadata.amount`, date = `metadata.date`.
  6. Certificats (`certificate_ids` non vide) : enfants `from('majordhome_interventions').select('id').eq('parent_id', intervention_id)` ; `from('majordhome_certificats').select('id, intervention_id, reference, equipement_type, equipement_marque, equipement_modele, pdf_storage_path').eq('org_id', orgId).in('id', certificate_ids)` ; tout id non retourné ou dont `intervention_id ∉ {intervention_id, enfants}` → 409 `certificate_not_allowed` ; `!pdf_storage_path` → 409 `certificate_pdf_missing` (detail = reference ou id) ; `storage.from('certificats').download(path)`.
  7. Taille : Σ octets > 35 × 1024 × 1024 → 413 `attachments_too_large`.
  8. Gabarit : `from('majordhome_mail_campaigns').select('subject, html_body').eq('org_id', orgId).eq('key', 'facture_entretien').eq('is_archived', false).maybeSingle()` → absent → 409 `template_missing`.
  9. Placeholders : marque + `{{CLIENT_NAME}}` (client_name), `{{INVOICE_NUMBER}}`, `{{INVOICE_AMOUNT}}` (`Number(x).toFixed(2).replace('.', ',') + ' €'`), `{{INVOICE_DATE}}` (`dd/mm/yyyy`), `{{EQUIPMENTS}}` (certificats : `[type, marque, modele].filter(Boolean).join(' ')` joints par « , », sinon « vos équipements »), `{{ATTACHMENTS}}` (noms de fichiers joints par « , »). `subject = applyPlaceholders(template.subject)`, `html = applyPlaceholders(wrapWithSkeleton(branding, template.html_body))`.
  10. Pièces : `Facture_<numéro sanitisé>.pdf` + `Certificat_<reference ou equipement_type ou id>.pdf` (`sanitizeFilename`, base64).
  11. `sendResendEmail(...)` ; `insertMailingLog` dans les deux cas (`status: 'sent'|'failed'`, `campaign_name: 'facture_entretien'`, `client_id`, `org_id: orgId`, `subject`, `email_to: to`, `provider_id`, `error_message`) — l'erreur de log est journalisée (`console.error`) et renvoyée en `log_warning`, jamais bloquante. Resend KO → 502 `resend_failed` avec `detail: message`. OK → 201 `{ ok: true, provider_id, to, attachments: [filenames], log_warning? }`.
  12. `catch` global → 500 `sanitizeError`.

- [ ] **Step 3: `config.toml`** — ajouter à la suite des autres edges :
```toml
[functions.invoice-send]
verify_jwt = true
```

- [ ] **Step 4: Vérifier** — `deno check supabase/functions/invoice-send/index.ts` (vert). Pas de déploiement (contrôleur).

- [ ] **Step 5: Commit**
```bash
git add supabase/functions/_shared/mail.ts supabase/functions/invoice-send/index.ts supabase/config.toml
git commit -m "feat(edge): invoice-send — facture d'entretien + certificats par e-mail via Resend (module Communication)"
```

---

### Task 3: Front — options d'envoi dans la modale Facturer, renvoi depuis la carte, gabarit par défaut

**Files:**
- Create: `src/apps/artisan/components/facturation/InvoiceEmailOptions.jsx`
- Create: `src/apps/artisan/components/facturation/SendInvoiceEmailDialog.jsx`
- Modify: `src/apps/artisan/components/entretiens/FacturerEntretienDialog.jsx`
- Modify: `src/apps/artisan/components/entretiens/EntretienSAVCard.jsx`
- Modify: `src/apps/artisan/pages/settings/communication/EmailsTab.jsx`
- Modify: `.claude/proposed-updates.md`

**Interfaces:**
- Consumes (Task 1) : `invoiceEmailAvailability`, `INVOICE_EMAIL_REASONS`, `certificateAttachmentRows`, `invoiceEmailErrorMessage`, `useInterventionCertificats`, `useSendInvoiceEmail`, `moduleActif`, `DEFAULT_INVOICE_EMAIL`, `INVOICE_EMAIL_TEMPLATE_KEY`, `mailCampaignsService.getByKey/create`.

- [ ] **Step 1: `InvoiceEmailOptions.jsx`** (présentationnel)

Props : `{ availability, email, checked, onCheckedChange, rows, selectedIds, onToggleCertificate, loadingCertificates }`. Rendu :
- si `!availability.visible` → `null` ;
- bloc bordé `mt-3 border border-gray-200 rounded-md p-3 text-sm` : `<label>` avec `<input type="checkbox" checked={checked && availability.enabled} disabled={!availability.enabled} …>` et le texte « Envoyer la facture par e-mail à **{email}** » (ou « au client » si pas d'e-mail) ; si `!availability.enabled` → `<p className="text-xs text-amber-700">{INVOICE_EMAIL_REASONS[availability.reason]}</p>` ;
- sous la coche, quand `availability.enabled && checked` : « Pièces jointes : la facture » + liste des `rows` (checkbox par ligne, `disabled={!row.attachable}`, `checked={selectedIds.has(row.id)}`, libellé, sous-libellé gris, badge ambre `non signé` ou gris `PDF non généré`) ; `loadingCertificates` → « Chargement des certificats… » ; aucune ligne → « Aucun certificat pour cette intervention ».

- [ ] **Step 2: `FacturerEntretienDialog.jsx`**

1. Imports : `invoiceEmailAvailability, certificateAttachmentRows, invoiceEmailErrorMessage` (`@/lib/invoiceEmailModel`), `useInterventionCertificats` (`@hooks/useCertificats`), `useSendInvoiceEmail` (`@hooks/useInvoices`), `InvoiceEmailOptions`.
2. `const emailAvailability = useMemo(() => invoiceEmailAvailability({ settings, mode: invoiceSettings.mode, clientEmail: item.client_email }), [settings, invoiceSettings.mode, item.client_email]);`
3. `const { certificats, isLoading: loadingCerts } = useInterventionCertificats(orgId, item.id, { enabled: open && emailAvailability.visible });` ; `const certRows = useMemo(() => certificateAttachmentRows(certificats), [certificats]);`
4. État : `const [sendEmail, setSendEmail] = useState(true);` `const [selectedCertIds, setSelectedCertIds] = useState(null);` (null = défaut = tous les `defaultChecked`) ; effet de reset sur `[open, item.id]` (comme `edits`) ; `const effectiveCertIds = selectedCertIds ?? new Set(certRows.filter((r) => r.defaultChecked).map((r) => r.id));`
5. `const sendInvoiceEmail = useSendInvoiceEmail(orgId);` et une fonction locale :
```js
  const sendEmailAfterCreation = async () => {
    if (!emailAvailability.enabled || !sendEmail) return;
    try {
      const sent = await sendInvoiceEmail.mutateAsync({ interventionId: item.id, certificateIds: [...effectiveCertIds] });
      toast.success(`Facture envoyée à ${sent.to}${sent.attachments?.length > 1 ? ` (${sent.attachments.length} pièces jointes)` : ''}`);
    } catch (err) {
      toast.error(`${invoiceEmailErrorMessage(err)} La facture est créée : renvoyez l’e-mail depuis la carte.`, { duration: 15000 });
    }
  };
```
   Appel : chemin hub → juste après le `toast.success` d'émission (avant `onOpenChange(false)`) ; chemin Pennylane → après le `toast.success` de création, seulement si `!created.draft` et `!created.alreadyExisted` (une facture déjà existante se renvoie depuis la carte).
6. Rendu : `<InvoiceEmailOptions availability={emailAvailability} email={item.client_email} checked={sendEmail} onCheckedChange={setSendEmail} rows={certRows} selectedIds={effectiveCertIds} onToggleCertificate={(id) => setSelectedCertIds((prev) => { const next = new Set(prev ?? effectiveCertIds); next.has(id) ? next.delete(id) : next.add(id); return next; })} loadingCertificates={loadingCerts} />` placé après le bloc objet/échéance, avant les warnings.
7. Le bouton de confirmation reste inchangé (l'envoi est une suite, jamais un blocage).

- [ ] **Step 3: `SendInvoiceEmailDialog.jsx`** (renvoi depuis la carte)

Props `{ item, orgId, open, onOpenChange }`. `ConfirmDialog` `size="lg"`, titre « Envoyer la facture par e-mail », description « {client} · {contrat} — la facture et les certificats cochés partent par e-mail depuis {from_email}. ». Même mécanique que ci-dessus (`useOrgSettings`, `pennylaneInvoiceSettings(settings).mode`, `invoiceEmailAvailability({ …, hasInvoice: !!item.invoice_id, isDraftInvoice: undefined })`, `useInterventionCertificats`, `InvoiceEmailOptions` avec `checked` forcé à `true` et coche masquée ou désactivée — au choix : garder la coche, cochée et non décochable), `confirmDisabled={!availability.enabled || sending}`, `onConfirm` → `mutateAsync` → toast succès / `toast.error(invoiceEmailErrorMessage(err))`. Note dans le dialogue : « Un brouillon Pennylane ne peut pas être envoyé : l'envoi sera refusé tant que la facture n'est pas finalisée. »

- [ ] **Step 4: `EntretienSAVCard.jsx`**

Bouton « Envoyer par e-mail » (icône `Mail` lucide, style des boutons secondaires de la carte) visible quand `moduleActif(settings, 'communication') && item.invoice_id && type === 'entretien'` (lire `settings` via `useOrgSettings()` s'il n'est pas déjà dans le composant ; vérifier ce qu'il utilise déjà — `pennylaneEnabled` vient peut-être de `usePennylaneEnabled`). Ouvre `SendInvoiceEmailDialog`. Placer à côté du bouton « Avoir » / « Facturée ».

- [ ] **Step 5: `EmailsTab.jsx`** — nouvelle section « Gabarits transactionnels » sous « Identité d'envoi » :
- Charger `mailCampaignsService.getByKey(orgId, INVOICE_EMAIL_TEMPLATE_KEY)` (via `useQuery` clé `mailingKeys`-compatible existante si une famille existe pour les campagnes — sinon `['mail-campaign', orgId, key]` n'est PAS acceptable : utiliser la famille de cache existante des campagnes, cf. `useMailCampaigns`).
- Ligne « Facture d'entretien (envoi au client) » : si absent → bouton « Créer le gabarit par défaut » (`mailCampaignsService.create({ org_id: orgId, ...DEFAULT_INVOICE_EMAIL })`, toast, invalidation) ; si présent → lien « Modifier dans Mailing → Éditeur » (`/mailing`) + rappel des variables `INVOICE_EMAIL_PLACEHOLDERS` en `<code>`.
- Ne rien changer au save des champs `from_email` / `reply_to`.

- [ ] **Step 6: Vérifier** — `npm run audit:quality && npm run lint && npx vite build`. Reporter les LOC de `FacturerEntretienDialog.jsx` et `EntretienSAVCard.jsx`.

- [ ] **Step 7: Proposition CLAUDE.md et commit**

`.claude/proposed-updates.md` : nouvelle entrée PENDING « Envoi de la facture d'entretien par e-mail (Resend, module Communication) » — gate `moduleActif(settings,'communication')` = premier consommateur de `settings.modules` (posé en base, pas d'UI) ; edge `invoice-send` + helper `_shared/mail.ts` (Resend + pièces jointes) ; gabarit `facture_entretien` transactionnel créé depuis Settings → Communication → Emails ; trace = `mailing_logs` `campaign_name='facture_entretien'` ; jamais d'envoi d'un brouillon Pennylane ; `mailing-send` / `contract-signed-notify` non refondus (à signaler). SHAs des trois tâches.
```bash
git add src/apps/artisan/components/facturation/InvoiceEmailOptions.jsx src/apps/artisan/components/facturation/SendInvoiceEmailDialog.jsx src/apps/artisan/components/entretiens/FacturerEntretienDialog.jsx src/apps/artisan/components/entretiens/EntretienSAVCard.jsx src/apps/artisan/pages/settings/communication/EmailsTab.jsx .claude/proposed-updates.md
git commit -m "feat(facturation): envoi de la facture au client par e-mail avec certificats joints — modale Facturer, renvoi depuis la carte, gabarit par défaut"
```

---

## Après les tâches (contrôleur)

- Déployer `invoice-send` (fichiers `index.ts` + `../_shared/auth.ts` + `../_shared/mail.ts`) via MCP, `verify_jwt: true`.
- Ouvrir le module pour Mayer et H&E : `UPDATE core.organizations SET settings = jsonb_set(settings, '{modules}', coalesce(settings->'modules','{}'::jsonb) || '{"communication": true}') WHERE id IN ('3c68193e-…', '65aea930-…')`.
- Revue finale, push, mémoire.

## Vérification (Eric)

Mayer, mode « Finalisée » (ou hub) : Settings → Communication → Emails → « Créer le gabarit par défaut » ; carte entretien Réalisé avec certificat généré → Facturer → coche cochée, certificat listé → créer → e-mail reçu avec 2 PDF ; fiche client → onglet Mailings → ligne `facture_entretien`. Carte facturée → « Envoyer par e-mail » → renvoi. Mode brouillon → coche grisée avec la raison.
