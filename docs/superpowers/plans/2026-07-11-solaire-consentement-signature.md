# Module « Consentement & signature » (dossier PV) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capturer sur tablette la signature manuscrite du client + ses consentements (dépôt DP, raccordement ENEDIS), une fois par dossier, et apposer l'image de signature + date/lieu dans le cadre 7 du CERFA 16702.

**Architecture:** Nouvelle colonne `pv_dossiers.consent jsonb` (migration). Composant `ConsentSignatureModal` réutilisant `CertificatSignaturePad` (react-signature-canvas, sortie base64 PNG). La signature est uploadée en PNG dans le Storage org-scopé ; le bloc `consent` est persisté via le `patchBlock` existant. Les étapes du panneau Dossier deviennent indépendantes (cadastre → état civil → consentement+signature → génération), chacune persistant son bloc ; la génération lit les blocs et n'est débloquée que si tout est présent.

**Tech Stack:** react-signature-canvas (déjà installé), pdf-lib (`embedPng`/`drawImage`/widget rect), Storage `product-documents`, node --test.

**Spec source:** `docs/superpowers/specs/2026-07-11-solaire-consentement-signature-design.md`.

---

## File Structure

| Fichier | Responsabilité | Action |
|---|---|---|
| `sql/migration_pv_dossiers_consent.sql` | `ALTER TABLE … ADD COLUMN consent jsonb` | Create |
| `src/apps/solaire/lib/consentItems.js` | `buildConsentItems(companyName)` — liste v1 brandée (pur) | Create |
| `scripts/consent-items.test.mjs` | Tests de la constante brandée | Create |
| `src/apps/solaire/lib/cerfa16702.js` | + params `signedAtIso` / `signatureLieu` (date+lieu du cadre 7) | Modify |
| `scripts/cerfa16702.test.mjs` | + tests des 2 params | Modify |
| `src/apps/solaire/lib/fillCerfa.js` | + apposition image signature dans `E1S_signature` (avant flatten) | Modify |
| `src/apps/solaire/components/dossier/ConsentSignatureModal.jsx` | Modale consentements + pad + signataire/lieu/date | Create |
| `src/apps/solaire/components/dossier/DossierDrawer.jsx` | Étapes indépendantes + checklist + gate + orchestration | Modify |

**Dépendances :** Task 1 (migration) = checkpoint Eric (prod), mais Tasks 2-6 (code) peuvent avancer sans (le code lit/écrit `consent` — il restera `null` tant que la colonne n'existe pas, sans casser la lecture). Task 2 et 3 indépendantes. Task 4 dépend de 3. Task 6 consomme 2/4/5.

---

## Task 1 : Migration — colonne `consent`

**Files:** Create `sql/migration_pv_dossiers_consent.sql`

- [ ] **Step 1 : Écrire la migration**

```sql
-- Module consentement & signature (dossier PV) — bloc jsonb par dossier.
-- La vue publique majordhome_pv_dossiers est SELECT * mono-table (auto-updatable) :
-- la colonne ajoutée en fin de table y remonte sans recréation. NE PAS recréer la vue.
ALTER TABLE majordhome.pv_dossiers ADD COLUMN IF NOT EXISTS consent jsonb;
```

- [ ] **Step 2 : CHECKPOINT Eric** — appliquer en prod (MCP `apply_migration` ou Dashboard). Vérifier :

```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema='majordhome' AND table_name='pv_dossiers' AND column_name='consent';
-- attendu : 1 ligne
```
Aucune RLS/GRANT à ajouter (héritées de la table). Ne pas continuer la Task 6 (écriture live) tant que la colonne n'est pas en prod ; Tasks 2-5 (code) peuvent avancer.

- [ ] **Step 3 : Commit**
```bash
git add sql/migration_pv_dossiers_consent.sql
git commit -m "feat(solaire): migration pv_dossiers.consent (bloc consentement & signature)"
```

## Task 2 : `consentItems.js` — liste brandée (TDD)

**Files:** Create `src/apps/solaire/lib/consentItems.js`, `scripts/consent-items.test.mjs`

- [ ] **Step 1 : Test (RED)** — `node --test scripts/consent-items.test.mjs`

```js
// scripts/consent-items.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildConsentItems } from '../src/apps/solaire/lib/consentItems.js';

test('buildConsentItems — 2 items requis, texte brandé du nom de société', () => {
  const items = buildConsentItems('Mayer Énergie');
  assert.equal(items.length, 2);
  assert.deepEqual(items.map((i) => i.key), ['dp_depot', 'enedis_raccordement']);
  assert.ok(items.every((i) => i.required === true));
  assert.match(items[0].legalText, /Mayer Énergie/);
  assert.match(items[0].legalText, /déclaration préalable/i);
  assert.match(items[1].legalText, /ENEDIS/);
});

test('buildConsentItems — nom vide → fallback neutre « Votre entreprise »', () => {
  const items = buildConsentItems('');
  assert.match(items[0].legalText, /Votre entreprise/);
});
```

- [ ] **Step 2 : Vérifier l'échec** — `node --test scripts/consent-items.test.mjs` → FAIL (module absent).

- [ ] **Step 3 : Implémentation (GREEN)**

```js
// src/apps/solaire/lib/consentItems.js
// Consentements recueillis au dossier PV (v1). Texte légal brandé via le nom de société
// (buildCompanyInfo(settings).name — jamais « Mayer » en dur). Constante éditable : ajuster
// le texte ou ajouter un item (RGPD, accès toiture…) sans toucher au composant.
export function buildConsentItems(companyName) {
  const soc = companyName || 'Votre entreprise';
  return [
    {
      key: 'dp_depot',
      required: true,
      label: 'Dépôt de la déclaration préalable',
      legalText: `J'autorise ${soc} à établir et à déposer en mon nom la déclaration préalable de travaux relative à l'installation photovoltaïque décrite, auprès de la mairie compétente.`,
    },
    {
      key: 'enedis_raccordement',
      required: true,
      label: 'Raccordement ENEDIS',
      legalText: `J'autorise ${soc} à réaliser en mon nom les démarches de raccordement de l'installation au réseau public de distribution d'électricité (ENEDIS), y compris la demande de raccordement.`,
    },
  ];
}
```

- [ ] **Step 4 : Vérifier (GREEN)** — `node --test scripts/consent-items.test.mjs` → PASS.
- [ ] **Step 5 : Commit** — `git commit -m "feat(solaire): consentItems — liste v1 brandee (DP + ENEDIS), pur teste"`

## Task 3 : `buildCerfaFields` — date/lieu du cadre 7 depuis le consentement (TDD)

**Files:** Modify `src/apps/solaire/lib/cerfa16702.js`, `scripts/cerfa16702.test.mjs`

- [ ] **Step 1 : Test (RED)** — ajouter à `scripts/cerfa16702.test.mjs`

```js
test('buildCerfaFields — signedAtIso + signatureLieu pilotent E1D_date / E1L_lieu (cadre 7)', () => {
  const { text } = buildCerfaFields({
    declarant: DECLARANT, terrain: TERRAIN, parcelles: [PARCELLES[0]], abf: null,
    description: 'x', todayIso: '2026-07-11',
    signedAtIso: '2026-07-09T10:00:00.000Z', signatureLieu: 'Rebigue',
  });
  assert.equal(text.E1D_date, '09072026'); // date de signature, pas aujourd'hui
  assert.equal(text.E1L_lieu, 'Rebigue');  // lieu de signature
});

test('buildCerfaFields — sans signature → fallback aujourd\'hui + localité déclarant', () => {
  const { text } = buildCerfaFields({
    declarant: DECLARANT, terrain: TERRAIN, parcelles: [PARCELLES[0]], abf: null,
    description: 'x', todayIso: '2026-07-11',
  });
  assert.equal(text.E1D_date, '11072026');
  assert.equal(text.E1L_lieu, 'Gaillac'); // adresse déclarant
});
```

- [ ] **Step 2 : Vérifier l'échec** — `node --test scripts/cerfa16702.test.mjs` → le 1ᵉʳ nouveau test FAIL (params ignorés).

- [ ] **Step 3 : Implémentation (GREEN)** — dans `cerfa16702.js`, signature de `buildCerfaFields` + bloc engagement :

Remplacer la signature :
```js
export function buildCerfaFields({ declarant, terrain, parcelles, abf, description, todayIso, signedAtIso, signatureLieu }) {
```
Remplacer le bloc « --- 7. Engagement du déclarant --- » :
```js
  // --- 7. Engagement du déclarant (lieu + date du consentement si signé, sinon aujourd'hui) ---
  put(text, 'E1L_lieu', signatureLieu || adr.localite);
  put(text, 'E1D_date', toJJMMAAAA(signedAtIso || todayIso));
```

- [ ] **Step 4 : Vérifier (GREEN)** — `node --test scripts/cerfa16702.test.mjs` → PASS (10 tests).
- [ ] **Step 5 : Commit** — `git commit -m "feat(solaire): CERFA cadre 7 — date/lieu depuis le consentement (signedAt/lieu)"`

## Task 4 : `fillCerfa16702` — apposition de l'image de signature

**Files:** Modify `src/apps/solaire/lib/fillCerfa.js`

> Runtime (pdf-lib + image), pas de test unitaire — vérifié par génération réelle (Task 7). Le rect du widget `E1S_signature` (page 11, ~x323 y531 245×54 pt) est lu au runtime (robuste au gabarit), l'image contenue dedans, ratio préservé.

- [ ] **Step 1 : Étendre la signature de `fillCerfa16702`** pour accepter les octets PNG de la signature :

Remplacer l'en-tête de fonction et ajouter l'apposition AVANT `form.flatten()` :
```js
/**
 * @param {{ text, checks }} fields
 * @param {{ signaturePngBytes?: Uint8Array }} [opts]
 */
export async function fillCerfa16702(fields, opts = {}) {
  const res = await fetch(cerfaUrl);
  if (!res.ok) throw new Error(`Chargement du formulaire CERFA impossible (HTTP ${res.status})`);
  const doc = await PDFDocument.load(await res.arrayBuffer());
  const form = doc.getForm();
  const missedFields = [];

  for (const [name, value] of Object.entries(fields.text ?? {})) {
    try {
      const field = form.getTextField(name);
      const safe = sanitizeWinAnsi(value);
      const max = field.getMaxLength();
      field.setText(max != null && safe.length > max ? safe.slice(0, max) : safe);
      if (RIGHT_ALIGNED.has(name)) field.setAlignment(TextAlignment.Right);
    } catch (err) {
      missedFields.push(name);
      logger.warn(`[cerfa] champ texte non rempli : ${name}`, err);
    }
  }
  for (const name of fields.checks ?? []) {
    try {
      form.getCheckBox(name).check();
    } catch (err) {
      missedFields.push(name);
      logger.warn(`[cerfa] case non cochée : ${name}`, err);
    }
  }

  // Signature manuscrite (cadre 7) : apposée AVANT flatten (le rect du widget disparaît ensuite).
  // Le champ texte E1S_signature reste vide → il s'efface au flatten, l'image reste dessinée.
  if (opts.signaturePngBytes) {
    try {
      const png = await doc.embedPng(opts.signaturePngBytes);
      const widget = form.getTextField('E1S_signature').acroField.getWidgets()[0];
      const rect = widget.getRectangle();
      const pageRef = widget.P();
      const page = doc.getPages().find((p) => p.ref === pageRef);
      if (!page) throw new Error('page signature introuvable');
      const m = 4; // marge intérieure (pt)
      const maxW = rect.width - 2 * m;
      const maxH = rect.height - 2 * m;
      const scale = Math.min(maxW / png.width, maxH / png.height);
      const w = png.width * scale;
      const h = png.height * scale;
      page.drawImage(png, {
        x: rect.x + (rect.width - w) / 2,
        y: rect.y + (rect.height - h) / 2,
        width: w,
        height: h,
      });
    } catch (err) {
      missedFields.push('E1S_signature');
      logger.warn('[cerfa] signature non apposée', err);
    }
  }

  form.flatten();
  const bytes = await doc.save();
  return { blob: new Blob([bytes], { type: 'application/pdf' }), missedFields };
}
```

- [ ] **Step 2 : Vérifier le build** — `npx vite build` → OK (import inchangé, `TextAlignment`/`PDFDocument` déjà importés).
- [ ] **Step 3 : Commit** — `git commit -m "feat(solaire): CERFA — appose l image de signature dans le cadre 7 (pdf-lib drawImage)"`

## Task 5 : `ConsentSignatureModal.jsx`

**Files:** Create `src/apps/solaire/components/dossier/ConsentSignatureModal.jsx`

- [ ] **Step 1 : Composant** (< 300 LOC, réutilise `CertificatSignaturePad`)

```jsx
// src/apps/solaire/components/dossier/ConsentSignatureModal.jsx
// Recueil sur tablette du consentement client + signature manuscrite (par dossier PV).
// Générique : piloté par une liste de consentements. Réutilise CertificatSignaturePad
// (react-signature-canvas, sortie base64 PNG). Ne connaît ni le CERFA ni l'ENEDIS.
import { useState, useEffect, useRef } from 'react';
import { X, FileSignature } from 'lucide-react';
import { FormField, inputClass } from '@apps/artisan/components/FormFields';
import { CertificatSignaturePad } from '@apps/artisan/components/certificat/CertificatSignaturePad';

export default function ConsentSignatureModal({
  open, onClose, onSubmit, isSubmitting, consentItems, initialConsent, signataireDefaut, lieuDefaut,
}) {
  const [accepted, setAccepted] = useState({});
  const [signataireNom, setSignataireNom] = useState('');
  const [lieu, setLieu] = useState('');
  const [signatureDataUrl, setSignatureDataUrl] = useState(null);

  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      const init = initialConsent?.items ?? {};
      setAccepted(Object.fromEntries(consentItems.map((c) => [c.key, Boolean(init[c.key]?.accepted)])));
      setSignataireNom(initialConsent?.signataire_nom || signataireDefaut || '');
      setLieu(initialConsent?.lieu || lieuDefaut || '');
      setSignatureDataUrl(null);
    }
    wasOpen.current = open;
  }, [open, initialConsent, consentItems, signataireDefaut, lieuDefaut]);

  if (!open) return null;

  const allRequired = consentItems.filter((c) => c.required).every((c) => accepted[c.key]);
  const canSubmit = allRequired && signataireNom.trim() && lieu.trim() && signatureDataUrl && !isSubmitting;

  const handleSubmit = () => {
    if (!canSubmit) return;
    const now = new Date().toISOString();
    const items = Object.fromEntries(
      consentItems.map((c) => [c.key, { accepted: Boolean(accepted[c.key]), at: accepted[c.key] ? now : null }]),
    );
    onSubmit({ signataire_nom: signataireNom.trim(), lieu: lieu.trim(), signed_at: now, items }, signatureDataUrl);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg p-5 space-y-4 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-secondary-900 flex items-center gap-2">
            <FileSignature className="w-4 h-4" /> Consentement & signature du client
          </h3>
          <button onClick={onClose} className="p-1 rounded-md text-secondary-400 hover:bg-secondary-100">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Consentements */}
        <div className="space-y-2">
          {consentItems.map((c) => (
            <label key={c.key} className="flex items-start gap-2 text-sm text-secondary-700 cursor-pointer border border-secondary-200 rounded-lg p-3">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={Boolean(accepted[c.key])}
                onChange={(e) => setAccepted((a) => ({ ...a, [c.key]: e.target.checked }))}
              />
              <span>
                <span className="font-medium text-secondary-900 block">{c.label}{c.required && <span className="text-[#B45309]"> *</span>}</span>
                <span className="text-xs text-secondary-500">{c.legalText}</span>
              </span>
            </label>
          ))}
        </div>

        <FormField label="Lieu">
          <input className={inputClass} value={lieu} onChange={(e) => setLieu(e.target.value)} placeholder="Commune de signature" />
        </FormField>

        {/* Pad de signature (gère nom + tracé, sortie base64) */}
        <CertificatSignaturePad
          signataireNom={signataireNom}
          onSignataireNomChange={setSignataireNom}
          onSign={setSignatureDataUrl}
          onClear={() => setSignatureDataUrl(null)}
          isSaving={isSubmitting}
          disclaimerText="En signant, le client accepte les autorisations ci-dessus et atteste l'exactitude des informations de la déclaration préalable."
        />

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-secondary-200 text-secondary-700 font-medium hover:bg-secondary-50">
            Annuler
          </button>
          <button onClick={handleSubmit} disabled={!canSubmit} className="btn-primary flex items-center gap-2 disabled:opacity-50">
            <FileSignature className="w-4 h-4" /> Enregistrer le consentement
          </button>
        </div>
      </div>
    </div>
  );
}
```

> Note : `CertificatSignaturePad` n'appelle `onSign(dataUrl)` qu'au clic « Valider la signature » (bouton interne vert). Le bouton « Enregistrer le consentement » de la modale reste désactivé tant que `signatureDataUrl` est null → l'utilisateur valide d'abord la signature dans le pad, puis enregistre.

- [ ] **Step 2 : Build** — `npx vite build` → OK.
- [ ] **Step 3 : Commit** — `git commit -m "feat(solaire): ConsentSignatureModal — consentements + pad signature tablette"`

## Task 6 : `DossierDrawer` — étapes indépendantes, gate, orchestration

**Files:** Modify `src/apps/solaire/components/dossier/DossierDrawer.jsx`

- [ ] **Step 1 : Imports + helper**

Ajouter aux imports :
```js
import { FileSignature } from 'lucide-react'; // (ajouter à l'import lucide existant)
import { buildConsentItems } from '../../lib/consentItems';
import ConsentSignatureModal from './ConsentSignatureModal';
```
Ajouter le helper (haut du fichier, hors composant) :
```js
function dataUrlToBlob(dataUrl) {
  const [head, b64] = dataUrl.split(',');
  const mime = (head.match(/:(.*?);/) || [])[1] || 'image/png';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
```

- [ ] **Step 2 : État + dérivés**

Ajouter les états :
```js
const [showConsent, setShowConsent] = useState(false);
```
Ajouter les dérivés (près de `declarantOk`) :
```js
const consent = dossier?.consent ?? null;
const consentItems = buildConsentItems(buildCompanyInfo(settings).name);
const consentOk = Boolean(
  consent?.signature_path
  && consentItems.filter((c) => c.required).every((c) => consent.items?.[c.key]?.accepted),
);
```

- [ ] **Step 3 : Handlers — persistance par bloc (état civil / consentement) + génération lisant les blocs**

Remplacer l'actuel `generate(declarant)` par TROIS handlers. `saveDeclarant` persiste l'état civil seul ; `saveConsent` upload la signature + persiste le consentement ; `generate()` (sans argument) relit le dossier frais et génère.

```js
// Persiste l'état civil (sans générer) — étape déclarant
const saveDeclarant = async (declarant) => {
  setBusy(true);
  try {
    await patchBlock.mutateAsync({ id: dossier.id, patch: { declarant } });
    setShowValidate(false);
    toast.success('État civil enregistré');
  } catch (err) {
    toast.error(`Échec : ${err.message}`);
  } finally {
    setBusy(false);
  }
};

// Upload signature + persiste le consentement — étape consentement
const saveConsent = async (block, dataUrl) => {
  setBusy(true);
  try {
    const path = `${orgId}/solaire/dossiers/${dossier.id}/signature.png`;
    const up = await storageService.uploadFile('product-documents', path, dataUrlToBlob(dataUrl), {
      upsert: true, contentType: 'image/png',
    });
    if (up.error) throw new Error(`Upload signature : ${up.error.message}`);
    await patchBlock.mutateAsync({ id: dossier.id, patch: { consent: { ...block, signature_path: path } } });
    setShowConsent(false);
    toast.success('Consentement & signature enregistrés');
  } catch (err) {
    toast.error(`Échec : ${err.message}`);
  } finally {
    setBusy(false);
  }
};

// Génère CERFA + notice depuis les blocs déjà persistés (relit le dossier frais)
const generate = async () => {
  setBusy(true);
  try {
    const { data: fresh, error: dErr } = await pvDossierService.getBySimulation(orgId, simulation.id);
    if (dErr || !fresh) throw dErr || new Error('Dossier introuvable');
    const { data: sim, error: simErr } = await pvService.getById(orgId, simulation.id);
    if (simErr || !sim) throw simErr || new Error('Simulation introuvable');

    const config = buildPvConfig(settings);
    const declarant = fresh.declarant;
    const cons = fresh.consent;
    const noticeModel = buildNoticeModel({ dossier: fresh, simulation: sim, config });
    const terrainParsed = parseAddressFR(sim.client_address ?? '');
    const terrain = terrainParsed.localite ? terrainParsed : (declarant?.adresse ?? terrainParsed);
    const fields = buildCerfaFields({
      declarant,
      terrain,
      parcelles: fresh.cadastre?.parcelles ?? [],
      abf: fresh.abf,
      description: noticeModel.projet.description,
      todayIso: new Date().toISOString().slice(0, 10),
      signedAtIso: cons?.signed_at,
      signatureLieu: cons?.lieu,
    });

    // Octets PNG de la signature (URL signée → fetch)
    let signaturePngBytes = null;
    if (cons?.signature_path) {
      const { url } = await storageService.getSignedUrl('product-documents', cons.signature_path);
      if (url) {
        const r = await fetch(url);
        if (r.ok) signaturePngBytes = new Uint8Array(await r.arrayBuffer());
      }
    }

    const { blob: cerfaBlob, missedFields } = await fillCerfa16702(fields, { signaturePngBytes });
    if (missedFields.length) {
      toast.warning(`${missedFields.length} champ(s) CERFA non remplis automatiquement — à vérifier sur le PDF.`);
      logger.warn('[dossier] champs CERFA manqués', missedFields);
    }
    if (fields.overflowParcelles) {
      toast.warning('Le CERFA ne porte que 3 références cadastrales — joindre la fiche complémentaire pour les parcelles restantes (toutes listées dans la notice).');
      logger.warn('[dossier] parcelles au-delà des 3 slots CERFA', fresh.cadastre?.parcelles?.length);
    }
    const company = buildCompanyInfo(settings);
    const noticeBlob = await generateNoticePdfBlob({ model: noticeModel, company, dateLabel: formatDateFR(new Date()) });

    const base = `${orgId}/solaire/dossiers/${dossier.id}`;
    const up1 = await storageService.uploadFile('product-documents', `${base}/cerfa-dp.pdf`, cerfaBlob, { upsert: true, contentType: 'application/pdf' });
    if (up1.error) throw new Error(`Upload CERFA : ${up1.error.message}`);
    const up2 = await storageService.uploadFile('product-documents', `${base}/notice-descriptive.pdf`, noticeBlob, { upsert: true, contentType: 'application/pdf' });
    if (up2.error) throw new Error(`Upload notice : ${up2.error.message}`);

    await patchBlock.mutateAsync({
      id: dossier.id,
      patch: { documents: { cerfa_pdf_path: `${base}/cerfa-dp.pdf`, notice_pdf_path: `${base}/notice-descriptive.pdf`, generated_at: new Date().toISOString() } },
    });
    if (dossier.status === 'offre') {
      await advance.mutateAsync({ id: dossier.id, targetStatus: 'dossier_valide' });
    }
    toast.success('CERFA + notice générés — dossier validé');
  } catch (err) {
    toast.error(`Génération interrompue : ${err.message}`);
  } finally {
    setBusy(false);
  }
};
```
Ajouter l'import service : `import { pvDossierService } from '@services/pvDossier.service';`

- [ ] **Step 4 : Checklist — ligne consentement** (après la ligne « État civil du déclarant »)

```jsx
<ChecklistRow
  ok={consentOk}
  label="Consentement & signature"
  detail={consentOk ? `Signé par ${consent.signataire_nom} — ${formatDateShortFR(consent.signed_at)}` : 'Recueilli sur la tablette avec le client'}
/>
```

- [ ] **Step 5 : Boutons d'étape + gate** — remplacer le bloc CTA (`{!docs?.cerfa_pdf_path ? (…valider…) : (…régénérer…)}`) par des étapes séquentielles :

```jsx
{!docs?.cerfa_pdf_path ? (
  <div className="space-y-2">
    {!declarantOk && (
      <button onClick={() => setShowValidate(true)} disabled={!cadastreOk || busy} className="btn-primary w-full py-3 flex items-center justify-center gap-2 disabled:opacity-50">
        <FileCheck className="w-4 h-4" /> Compléter l'état civil du déclarant
      </button>
    )}
    {declarantOk && !consentOk && (
      <button onClick={() => setShowConsent(true)} disabled={busy} className="btn-primary w-full py-3 flex items-center justify-center gap-2 disabled:opacity-50">
        <FileSignature className="w-4 h-4" /> Recueillir le consentement & la signature
      </button>
    )}
    {declarantOk && consentOk && (
      <button onClick={generate} disabled={!cadastreOk || busy} className="btn-primary w-full py-3 flex items-center justify-center gap-2 disabled:opacity-50">
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileCheck className="w-4 h-4" />} Générer le CERFA + la notice
      </button>
    )}
    {!cadastreOk && (
      <p className="text-xs text-secondary-500 text-center">Les références cadastrales sont requises (étape Localisation).</p>
    )}
  </div>
) : (
  <button onClick={() => (declarantOk && consentOk ? generate() : setShowValidate(true))} disabled={busy} className="w-full py-2.5 flex items-center justify-center gap-2 rounded-lg border border-secondary-200 text-sm font-medium text-secondary-700 hover:bg-secondary-50 disabled:opacity-50">
    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Régénérer les documents
  </button>
)}
```

- [ ] **Step 6 : Câbler les modales** — la modale déclarant appelle `saveDeclarant` (plus `generate`), et monter la modale consentement.

Remplacer `onSubmit={generate}` de `ValidateDossierModal` par `onSubmit={saveDeclarant}`. Ajouter après :
```jsx
<ConsentSignatureModal
  open={showConsent}
  onClose={() => setShowConsent(false)}
  isSubmitting={busy}
  consentItems={consentItems}
  initialConsent={consent}
  signataireDefaut={dossier?.declarant ? `${dossier.declarant.prenom} ${dossier.declarant.nom}` : (simulation.client_name || '')}
  lieuDefaut={parseAddressFR(simulation.client_address ?? '').localite}
  onSubmit={saveConsent}
/>
```

- [ ] **Step 7 : Build + lint** — `npx vite build` OK ; `npm run lint:errors` sans nouvelle erreur.
- [ ] **Step 8 : Commit** — `git commit -m "feat(solaire): dossier — etape consentement & signature, apposee au CERFA (cadre 7)"`

## Task 7 : Preuve end-to-end + revue

- [ ] **Step 1 : Test de génération réel** — script throwaway : `buildCerfaFields` (avec signedAt/lieu) + `fillCerfa16702(fields, { signaturePngBytes })` avec un petit PNG de test → sauver le PDF dans le scratchpad, vérifier (inspection champs + taille) que l'image est intégrée et E1D_date/E1L_lieu renseignés. Supprimer le script.
- [ ] **Step 2 : `node --test scripts/consent-items.test.mjs scripts/cerfa16702.test.mjs`** verts ; `npx vite build` OK ; `npm run lint:errors` clean.
- [ ] **Step 3 : Revue multi-agents** (workflow adversarial : sécurité org_id/Storage, write-once, gate, régressions DossierDrawer/generate) ; fixes.
- [ ] **Step 4 : MàJ mémoire `project_chainage_dossier_pv.md`** + spec statut LIVRÉ. Commit final.

## Hors périmètre (rappel)
Mandat ENEDIS PDF (tranche 4, relira `consent`) ; envoi signature à distance ; consentements additionnels (RGPD…).
