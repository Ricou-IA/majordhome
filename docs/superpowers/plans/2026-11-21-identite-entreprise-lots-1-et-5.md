# Identité de l'entreprise — lots 1 et 5 (Majord'home) — plan de construction

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Une seule définition des règles de l'identité d'une entreprise dans Majord'home, et un onglet Identité qui se remplit depuis l'annuaire des entreprises.

**Architecture:** Deux modules purs sous `src/lib/organisation/` (règles, lecture de l'annuaire) testés par `node --test` ; un appel réseau séparé ; les onglets Identité et Coordonnées ne gardent que le dessin. Aucune migration, aucune edge, rien dans HésiaSun.

**Tech Stack:** React 18, Vite, Tailwind, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-21-identite-entreprise-saisie-unique-hesiasun-design.md` (§ 5.1, 5.2, 5.5, 7 bis tranché le 2026-11-21 : « Oui, annuaire »).

## Global Constraints

- Modules purs : aucun import React, Supabase ni alias (`@/…`) ; JSDoc sur chaque export.
- Quinze champs : `brand_name` (obligatoire), `legal_name`, `legal_form`, `capital`, `siret`, `tva_intra`, `rcs`, `insurance`, `address`, `postal_code`, `city`, `phone`, `website_url`, `signatory_name`, `signatory_role`.
- Ce que Majord'home enregistre ne change pas de forme : SIRET « 100 288 224 00015 », TVA « FR 06 449776916 », téléphone par paires.
- Raison sociale, SIRET, forme juridique viennent de l'annuaire ; la TVA est calculée du SIREN ; saisie à la main seulement après « Entreprise introuvable ? Saisir à la main ».
- Rien n'est enregistré avant « Enregistrer ». Aucun nom d'entreprise en dur dans un message ou un exemple.
- Tests ajoutés à `audit:quality` ; aucun nouveau warning ESLint.

## Review Focus

1. Organisation existante au SIRET saisi à la main (Mayer) : l'onglet s'ouvre sans être « modifié », rien ne change tant qu'on ne touche à rien.
2. Annuaire injoignable ou sans résultat : la saisie à la main reste possible, le dire.
3. Établissement fermé dans l'annuaire : avertir, ne pas bloquer.
4. Nature juridique sans correspondance sûre : forme juridique vidée et à choisir, jamais celle de l'entreprise précédente.
5. Onglet Coordonnées en cours de saisie quand l'annuaire remplit l'adresse depuis Identité : la saisie en cours n'est pas écrasée.

---

### Task 1 : règles de l'identité

**Files:** Create `src/lib/organisation/identite.js`, `scripts/organisation-identite.test.mjs` ; Modify `package.json` (`audit:quality`).

**Produces:**
- `VERSION_IDENTITE: number` (1), `LEGAL_FORMS: string[]`, `CHAMPS_IDENTITE: {cle, libelle, max?}[]`, `CLES_IDENTITE`, `CLES_COORDONNEES`
- `formatSiret(brut)`, `formatTva(brut)`, `formatTelephone(brut)`, `prefixerHttps(url)`
- `tvaDepuisSiret(siret) → string` (« FRkkSSSSSSSSS » ou `''`), clé = (12 + 3 × (SIREN mod 97)) mod 97
- `validerSaisie(valeurs, cles) → Record<cle, message>` (règles actuelles des deux onglets)
- `formaterPourSaisie(cle, valeur)`, `identitePourEnvoi(settings) → { version, identite }`, `validerEnvoi(identite) → Record<cle, message>`

- [ ] Tests : SIRET 100 288 224 00015 → TVA `FR75100288224` ; formats par groupes ; `validerSaisie` rend « Obligatoire » pour `brand_name` vide et pour adresse / code postal / ville / téléphone vides ; `validerEnvoi` accepte des coordonnées vides, refuse un SIRET de 13 chiffres ; `identitePourEnvoi` retire les espaces et rend les quinze clés ; `formaterPourSaisie(cle, identitePourEnvoi(x).identite[cle])` redonne la forme enregistrée.
- [ ] Écrire le module, tests verts, commit.

### Task 2 : lecture de l'annuaire

**Files:** Create `src/lib/organisation/annuaire.js`, `src/lib/organisation/annuaireClient.js`, `scripts/organisation-annuaire.test.mjs`.

**Produces:**
- `formeJuridiqueDepuisNature(code) → string|null` (1000 EI, 5498 EURL, 5499 SARL, 5505–5599 SA, 5710 SAS, 5720 SAS à associé unique, 6540 SCI)
- `signataireDepuisDirigeants(dirigeants) → {nom, fonction}|null`
- `lireSuggestions(reponse, requete) → Entreprise[]` (`siret, siren, raison_sociale, forme_juridique, nature_juridique, adresse, code_postal, ville, etat, signataire`)
- `identiteEnregistree(settings) → boolean`
- `appliquerEntreprise(form, entreprise) → { form, siege, detail, avertissement }` : raison sociale, SIRET, forme remplacés (forme vidée si non traduite) ; nom commercial et signataire remplis seulement s'ils sont vides ; `siege` = `{address, postal_code, city}` ou `null`
- `chercherEntreprises(requete, signal) → Promise<Entreprise[]>` (client : moins de 3 caractères ⇒ `[]` sans appel, 404 ⇒ `[]`, délai 8 s, 6 propositions)

- [ ] Tests sur une réponse d'annuaire écrite à la main (SAS avec président personne physique ; holding présidente ⇒ signataire `null` ; SIRET tapé d'un établissement secondaire ; nature 9220 ⇒ forme `null` ; établissement fermé) et sur `appliquerEntreprise` (les cinq points du Review Focus qui relèvent du module).
- [ ] Écrire les modules, tests verts, commit.

### Task 3 : onglets branchés

**Files:** Create `src/apps/artisan/pages/settings/organization/components/EntrepriseSearch.jsx` ; Modify `IdentityTab.jsx`, `ContactTab.jsx`.

- [ ] `ContactTab` : formats et contrôles du module, plus aucune règle locale.
- [ ] `IdentityTab` : recherche « Retrouver votre entreprise » (repliée en une ligne « nom · SIRET — Changer d'entreprise » quand l'identité est enregistrée) ; raison sociale, SIRET, forme juridique en lecture seule hors saisie à la main (forme à choisir si vide) ; TVA affichée calculée dès que le SIRET est complet et enregistrée telle quelle ; bandeau « Rempli : … Vérifiez puis enregistrez. » ; l'adresse du siège trouvée part avec l'enregistrement de l'onglet.
- [ ] `npx eslint` sur les fichiers touchés, `npm run audit:quality`, `npx vite build`, commit et push.

## Hors de ce plan

Lots 2 et 3 (HésiaSun, liaison, envoi) : plan à part, après accord d'Eric étape par étape côté HésiaSun. La copie du module vers HésiaSun (`sync:identite`) se fait avec le lot 2.
