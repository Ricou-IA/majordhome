# SPEC — Module « Consentement & signature » (dossier PV)

> **Date** : 2026-07-11 · **Statut** : validé avec Eric (brainstorming) — à relire avant plan d'implémentation
> **Prérequis** : tranche 1 dossier PV livrée (`docs/superpowers/specs/2026-07-06-solaire-chainage-dossier-pv-tranche1-design.md` — socle `pv_dossiers`, CERFA 16702*03, notice). Prolonge la chaîne administrative.

---

## 1. Objectif & principe directeur

Capturer **une seule fois, sur la tablette avec le client**, sa **signature manuscrite** et ses **consentements explicites**, puis réutiliser ces éléments sur toute la chaîne administrative de **la même installation** : le CERFA de déclaration préalable maintenant, le mandat de raccordement ENEDIS en tranche 4.

**Portée = le projet/dossier, jamais au-delà** (décision Eric). Une signature n'est **pas réutilisable** d'un projet à l'autre — chaque installation engage le client dans son propre contexte. La réutilisation est donc strictement *interne au dossier* (DP + ENEDIS de la même installation).

Write-once : la signature et les consentements se saisissent une fois dans le flux de vente, puis les documents (CERFA, mandat ENEDIS) les **lisent** sans re-demander.

---

## 2. Modèle de données

Nouvelle colonne `consent jsonb` sur `majordhome.pv_dossiers` (bloc fonctionnel, même convention que `cadastre`/`declarant`/`documents`).

```jsonc
consent: {
  signataire_nom: "Eric Pudebat",
  lieu: "Rebigue",                       // pré-rempli depuis l'adresse
  signed_at: "2026-07-11T09:30:00.000Z",
  signature_path: "3c68…/solaire/dossiers/<id>/signature.png",  // Storage product-documents
  items: {
    dp_depot:            { accepted: true, at: "2026-07-11T09:30:00.000Z" },
    enedis_raccordement: { accepted: true, at: "2026-07-11T09:30:00.000Z" }
  }
}
```

- **Signature** : image PNG (trimmée) dans le Storage `product-documents` sous préfixe `${orgId}/solaire/dossiers/${dossierId}/signature.png` ; le **chemin** est stocké dans `consent.signature_path` (pas l'image en base64 → rows légères, réutilisable via URL signée, même pattern que les annexes de l'étude).
- **Consentements** : dictionnaire par clé, chaque item horodaté à l'acceptation. v1 = `dp_depot` + `enedis_raccordement` (texte légal adaptable ultérieurement — cf. §6).

**Migration** (à appliquer en prod par Eric — checkpoint) :
```sql
ALTER TABLE majordhome.pv_dossiers ADD COLUMN IF NOT EXISTS consent jsonb;
```
La vue publique `majordhome_pv_dossiers` étant `SELECT *` mono-table (auto-updatable), la nouvelle colonne y apparaît sans recréation. Aucune RLS/GRANT nouveaux : `pv_dossiers` est déjà en RLS owner-or-admin + `GRANT SELECT service_role`. **⚠️ `CREATE OR REPLACE VIEW` interdit ici** — la colonne ajoutée en fin de table remonte automatiquement dans `SELECT *` ; ne pas toucher à la vue.

---

## 3. Composant `ConsentSignatureModal`

Modale plein flux (pattern `ValidateDossierModal` / `SaveSimulationModal`), générique et pilotée par une liste de consentements.

**Entrées (props)** : `open`, `onClose`, `onSubmit(consentBlock, signatureDataUrl)`, `isSubmitting`, `consentItems` (liste `[{ key, label, legalText, required }]`), `initialConsent` (bloc existant pour ré-édition), `signataireDefaut` (nom état civil), `lieuDefaut` (localité adresse).

**Contenu** :
1. **Cases de consentement** — une par item, avec son `legalText` affiché (case + texte légal). Les items `required` doivent être cochés pour valider.
2. **Signataire** — champ nom, pré-rempli depuis l'état civil déclarant (éditable : le signataire peut différer, ex. co-propriétaire).
3. **Lieu + date** — lieu pré-rempli (localité), date = jour (affichée, non éditable).
4. **Pad de signature** — réutilise `CertificatSignaturePad` (`react-signature-canvas`, sortie base64 PNG via `getTrimmedCanvas().toDataURL`, optimisé tablette). `disclaimerText` = rappel « le client signe la présente déclaration et les consentements ci-dessus ».

**Sortie** : à la validation (tous `required` cochés + signature tracée + nom présent), `onSubmit` renvoie le bloc `consent` (sans `signature_path`, posé par le caller après upload) + le `signatureDataUrl`.

**Réutilisabilité** : le composant ne connaît PAS le CERFA ni l'ENEDIS — il collecte une liste de consentements + une signature. Il vit dans `src/apps/solaire/components/dossier/` (usage PV pour l'instant) mais est écrit sans dépendance au CERFA (extractible vers `shared/` si un autre domaine en a besoin).

---

## 4. Intégration dans le panneau Dossier

Dans `DossierDrawer` :
- **Checklist** : nouvelle ligne « Consentement & signature » (✓ si `consent.signature_path` présent + items requis acceptés).
- **Étape** : après l'état civil déclarant. Un bouton « Recueillir le consentement & la signature » ouvre `ConsentSignatureModal`.
- **Gate génération** : le CTA « Constituer le dossier PV » / la génération du CERFA **exige** la signature (une DP sans signature est incomplète). Ordre logique : cadastre → déclarant → **consentement+signature** → génération.

**Orchestration à la validation du consentement** :
1. `ConsentSignatureModal.onSubmit(block, dataUrl)`.
2. Upload de la signature : `dataUrl` → Blob PNG → `storageService.uploadFile('product-documents', `${orgId}/solaire/dossiers/${id}/signature.png`, blob, { upsert:true, contentType:'image/png' })`.
3. `patchBlock({ id, patch: { consent: { ...block, signature_path } } })`.
4. Échec upload → stop + toast (fail-loud, jamais de consentement enregistré sans signature).

---

## 5. Usage dans le CERFA (cadre 7 « Engagement du déclarant »)

À la génération (`DossierDrawer.generate` / `fillCerfa`) :
- **Date + lieu** : `E1D_date` = `consent.signed_at` (JJMMAAAA), `E1L_lieu` = `consent.lieu` — remplacent l'usage actuel de « aujourd'hui » / localité d'adresse quand un consentement existe.
- **Signature image** : au lieu de laisser `E1S_signature` (champ texte) vide, on **appose l'image** :
  1. lire le PNG (URL signée `signature_path` → fetch → bytes),
  2. `pdfDoc.embedPng(bytes)`,
  3. récupérer le **rectangle du widget** `E1S_signature` (page + x/y/w/h, comme l'inspection faite pour l'email) et `page.drawImage(png, { x, y, width, height })` contenu dans le rect (ratio préservé, marge),
  4. le champ texte `E1S_signature` reste vide → `form.flatten()` le fait disparaître, l'image reste sur la page.
- **Ordre** : embed image **avant** `form.flatten()` ; le rect du widget est lu avant flatten (après, le champ n'existe plus).

Si `consent` absent (dossier non signé) : comportement actuel conservé (date/lieu depuis aujourd'hui/adresse, signature vide) — la génération n'est pas cassée, mais le gate UI (§4) empêche normalement d'y arriver.

---

## 6. Consentements v1 (texte adaptable)

| Clé | Requis | Libellé / texte légal (1er jet, à faire valider par Eric) |
|---|---|---|
| `dp_depot` | oui | « J'autorise [Société] à établir et à déposer en mon nom la déclaration préalable de travaux relative à l'installation photovoltaïque décrite, auprès de la mairie compétente. » |
| `enedis_raccordement` | oui | « J'autorise [Société] à réaliser en mon nom les démarches de raccordement de l'installation au réseau public de distribution d'électricité (ENEDIS), y compris la demande de raccordement. » |

- `[Société]` = `buildCompanyInfo(settings).name` (branding multi-tenant, jamais « Mayer » en dur).
- La liste `CONSENT_ITEMS` est une **constante** (`src/apps/solaire/lib/consentItems.js`) → texte ajustable sans toucher au composant. Les deux sont `required` en v1.
- Extensible : ajouter un item = une entrée dans la constante (RGPD, accès toiture, etc.) — hors périmètre v1.

---

## 7. Architecture & fichiers

```
sql/migration_pv_dossiers_consent.sql          # NEW : ALTER ADD COLUMN consent jsonb
src/apps/solaire/lib/consentItems.js           # NEW : CONSENT_ITEMS (pur, brandé via param)
src/apps/solaire/components/dossier/
  ├── ConsentSignatureModal.jsx                # NEW : consentements + pad + signataire/lieu/date
  └── DossierDrawer.jsx                         # MODIFY : étape + checklist + gate + orchestration
src/apps/solaire/lib/fillCerfa.js              # MODIFY : embedPng + drawImage signature (cadre 7)
src/apps/solaire/lib/cerfa16702.js             # MODIFY (éventuel) : date/lieu depuis consent
```

- Réutilise `react-signature-canvas` (déjà installé, via `CertificatSignaturePad`), `pdf-lib` (`embedPng`, `drawImage`, widget rect), `storageService`.
- Conventions : composant < 500 LOC, logique hors JSX, Tailwind (palette solaire deutan pour le wrapper ; le pad certificat conserve ses boutons d'action verts/rouges = couleurs d'**action** valider/effacer, pas d'encodage d'information), toasts sonner, retour service `{ data, error }`, cache keys inchangées (le bloc `consent` passe par `patchBlock` existant).

---

## 8. Sécurité multi-tenant

- Écriture du bloc `consent` via `patchBlock` existant (vue updatable, `.eq('org_id', orgId)` explicite). `status` jamais touché.
- Signature PNG sous préfixe `${orgId}/…` (bucket `product-documents`, policies `(storage.foldername(name))[1]::uuid`).
- Aucune nouvelle RLS/RPC/edge : `pv_dossiers` déjà scellé (RLS owner-or-admin, GRANT service_role).
- Donnée personnelle (signature manuscrite) : reste dans le Storage org-scopé, jamais dans une URL/param ; URL signée courte durée à la lecture.

---

## 9. Risques & points ouverts

1. **Rect du widget `E1S_signature`** : à mesurer sur le gabarit (page + coordonnées) comme pour l'email. Le champ est multiline sans maxLen — le rect couvre la zone signature du cadre 7. Contenir l'image dans ce rect (ratio préservé). *Sonde d'inspection au démarrage de l'implémentation.*
2. **Texte légal des consentements** : 1er jet §6 à faire valider (Eric / conseil). N'engage pas l'architecture (constante éditable).
3. **Signataire ≠ déclarant** : champ éditable (co-propriété) — mais le CERFA cadre 1 reste au nom du déclarant. Cohérent : le signataire signe le cadre 7.
4. **Base64 vs Storage** : on stocke le PNG dans le Storage (rows légères, réutilisable ENEDIS) ; la génération refait un fetch d'URL signée (pattern annexes éprouvé). Si latence gênante un jour → cache mémoire, pas de refonte.

---

## 10. Critères de succès (vérifiables)

- Le bouton « Recueillir le consentement & la signature » ouvre la modale ; sans les 2 consentements requis cochés + signature + nom, « Valider » est désactivé.
- À la validation : signature uploadée sous `${orgId}/…`, bloc `consent` persisté, checklist « Consentement & signature » ✓.
- Le CERFA généré porte, dans le cadre 7 : **l'image de signature**, le lieu et la date du consentement.
- Un dossier sans signature ne peut pas générer le CERFA (gate UI) ; la génération reste techniquement non cassée si `consent` absent.
- `npx vite build` OK ; `npm run lint:errors` sans nouvelle erreur ; pas de fuite cross-org (org_id + préfixe Storage).

---

## Hors périmètre (tranches ultérieures)
- Mandat de représentation ENEDIS (document PDF) = **tranche 4** ; il relira le même bloc `consent` (`enedis_raccordement` + signature).
- Envoi à distance de la signature (lien client) — v1 = tablette uniquement (décision Eric).
- Consentements additionnels (RGPD, accès toiture…) — ajout ultérieur dans `CONSENT_ITEMS`.
