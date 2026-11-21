# Créateur de mail sur une page, habillage réglé une fois — plan de construction

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** remplacer l'assistant en trois étapes et l'onglet Envoi par une page unique (destinataires, message, envoi, aperçu fidèle), sans HTML visible, avec une rédaction assistée dans l'application et un habillage d'entreprise réglé une fois.

**Architecture:** quatre modules purs dans `src/lib` portent toutes les règles (habillage, format du texte, rédaction, aperçu) ; trois d'entre eux sont copiés pour Deno, de sorte que l'aperçu et l'envoi exécutent le même code. Les écrans ne font qu'assembler. Aucune donnée ne migre : `mail_campaigns.html_body` reste la donnée, `settings.email_habillage` s'ajoute.

**Tech Stack:** React 18, Vite, Tailwind, TanStack Query v5, Supabase (Postgres, edge functions Deno), Resend, API Claude, tests `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-21-createur-mail-une-page-habillage-design.md` — à lire en entier avant toute tâche ; ce plan n'en recopie pas les raisons.

## Global Constraints

- Règles du dépôt : `CLAUDE.md` (charte multi-tenant, conventions qualité). Travailler sur `main`, sans worktree ; commits par chemin (`git commit … -- <fichiers>`), d'autres sessions partagent la branche.
- Interface en français, vocabulaire d'artisan, jamais le mot « HTML » ni une balise à l'écran.
- Tailwind seul ; aucun composant au-dessus de 500 lignes ; plus de 10 `useState` ⇒ `useReducer`.
- Module pur = aucun import hors modules purs voisins (`./x.js`), JSDoc sur **chaque** export (Deno vérifie les types des copies). Les modules copiés sont à plat dans `src/lib/` et inscrits dans `PARTAGES` de `scripts/sync-tournee-engine.mjs` ; après toute modification : `npm run sync:tournee-engine`. Ne jamais éditer `supabase/functions/_shared/<module>.js`.
- Tout nouveau test s'inscrit dans la commande `audit:quality` de `package.json`.
- Mutations de hook : `unwrapResult()` ; clés de cache de `cacheKeys.js` ; `logger`, jamais `console.*`.
- Vérification d'écran : `npx vite build` (jamais les outils d'aperçu : Eric a son serveur).
- **Aucune edge n'est déployée, aucun secret posé, sans le oui d'Eric** demandé au moment de le faire. Les tâches 3 et 6 s'arrêtent sur cette demande.
- Défauts neutres, valeurs exactes : boutons et liens `#64748b`, bandeau `#334155`, nom d'entreprise vide.
- Marqueur de désabonnement, forme exacte : `mailto:<adresse de l'entreprise>?subject=Désabonnement`.
- Rien d'un client ou d'un prospect n'est envoyé au modèle de rédaction.

## Review Focus

Cas que la conception implique sans les nommer, du plus probable au moins probable ; chacun a son test dans la tâche indiquée.

1. **Texte collé depuis Word ou un site** : il arrive avec polices, couleurs, tableaux. Attendu : seul le texte reste. → tâche 4 (`depuisEditeur`).
2. **Variable tapée à la main qui n'existe pas pour ce mail** (`{{PRENOM}}` dans une campagne) : elle partirait telle quelle chez le client. Attendu : la carte Message la signale, « Lancer » fermé. → tâche 7 (`variablesInconnues`).
3. **Objet ou texte vide** au moment de tester, lancer ou activer l'envoi automatique. Attendu : geste fermé avec la raison, pas une erreur 400 de l'edge. → tâche 9 (`raisonsDeBlocage`).
4. **Réponse du modèle inutilisable** (vide, pas du JSON, une page complète, un lien inventé). Attendu : le texte en place n'est pas touché, un message le dit ; un lien inventé redevient du texte. → tâche 5 (`lireReponse`).
5. **Couleur mal formée dans les réglages** (`orange`, `#12`, `red;}`), posée dans un style : elle casserait l'habillage. Attendu : repli sur le défaut neutre. → tâche 1 (`couleurValide`).

---

## Fichiers

| Fichier | Rôle |
|---|---|
| `src/lib/mailHabillage.js` (copié Deno) | Habillage et valeurs de marque : seule définition, navigateur et edges. |
| `src/lib/mailCorps.js` (copié Deno) | Format du texte : est-il éditable, normalisation, allers-retours avec l'éditeur. |
| `src/lib/mailRedaction.js` (copié Deno) | Rédaction assistée : codes, consigne, schéma de sortie, contrôle de la réponse. |
| `src/lib/mailVariables.js` | Nature d'un mail, variables proposées, libellés, variables manquantes ou inconnues. |
| `src/lib/mailApercu.js` | HTML de l'aperçu : habillage + valeurs de marque + valeurs d'exemple. |
| `src/lib/mailPage.js` | Règles de la page : cartes affichées, blocages, nom verrouillé, clés. |
| `supabase/functions/mailing-rediger/index.ts` | Edge de rédaction assistée. |
| `src/apps/artisan/components/mailing/page/` | `PageMail`, `CarteDestinataires`, `CarteMessage`, `CarteEnvoi`, `ApercuMail`. |
| `src/apps/artisan/components/mailing/editeur/` | `EditeurTexte`, `FenetreLien`. |
| `src/shared/hooks/useEnvoiCampagne.js` | Test et envoi par vagues (logique de `SendTab.jsx`, seule définition). |
| `src/apps/artisan/pages/settings/communication/HabillageSection.jsx` | Écran d'habillage. |

---

## Tranche 1 — Socle d'habillage (aucun écran)

### Task 1 : `mailHabillage.js`

**Files:**
- Create: `src/lib/mailHabillage.js`
- Test: `scripts/mail-habillage.test.mjs`
- Modify: `package.json` (`audit:quality`), `scripts/sync-tournee-engine.mjs` (`PARTAGES` : ajouter `'mailHabillage'`)

**Interfaces:**
- Consumes: `resoudreExpediteur(settings).contactEmail` de `./expediteur.js`.
- Produces:
  - `DEFAUTS_MARQUE = { accent: '#64748b', bandeau: '#334155' }`
  - `HABILLAGE_DEFAUT = { entete: 'logo', pied: { coordonnees: true, certifications: false, site: false } }`
  - `couleurValide(valeur: unknown, repli: string): string` — `#rgb` ou `#rrggbb` seulement, sinon `repli`.
  - `valeursDeMarque(reglages: object|null): Record<string, string>` — clés = exactement `VARIABLES_MARQUE` de `emailsAutomatiques.js` ; couleurs passées par `couleurValide`.
  - `lireHabillage(reglages): { entete, pied } | null` — `null` si `email_habillage` n'est pas un objet ; valeurs inconnues ramenées au défaut.
  - `choixDepuisReglages(reglages): { entete, pied }` — pour préremplir l'écran : `lireHabillage`, sinon `logo_bandeau` avec coordonnées et site si `email_skeleton_html` existe, sinon `HABILLAGE_DEFAUT`.
  - `aDejaDesabonnement(corps: string): boolean` — `/mailto:[^"'\s>]*\?subject=D[eé]sabonnement/i`.
  - `habillerMail(reglages: object|null, corps: string): string` — les quatre cas de la conception § 5.1, dans l'ordre.

- [ ] **Step 1 : écrire les tests**

```js
const S = '<html><body>T{{LOGO_URL}}<div>{{EMAIL_BODY}}</div></body></html>';
test('page complète : rendue telle quelle', () => {
  const page = '<!DOCTYPE html><html><body>x</body></html>';
  assert.equal(habillerMail({ email_habillage: HABILLAGE_DEFAUT }, page), page);
});
test('ancien habillage sans email_habillage : identique à aujourd\'hui', () => {
  assert.equal(habillerMail({ email_skeleton_html: S }, '<p>a</p>'), S.replace('{{EMAIL_BODY}}', '<p>a</p>'));
});
test('email_habillage prime sur l\'ancien habillage ; null y revient', () => {
  assert.ok(!habillerMail({ email_skeleton_html: S, email_habillage: HABILLAGE_DEFAUT }, '<p>a</p>').startsWith('<html><body>T'));
  assert.equal(habillerMail({ email_skeleton_html: S, email_habillage: null }, '<p>a</p>'), S.replace('{{EMAIL_BODY}}', '<p>a</p>'));
});
test('habillage par défaut : un lien de désabonnement, un seul', () => {
  const r = { from_email: 'contact@ex.fr', brand_name: 'Cimaj' };
  assert.equal(habillerMail(r, '<p>a</p>').split('mailto:contact@ex.fr?subject=Désabonnement').length - 1, 1);
  const deja = '<p><a href="mailto:{{ORG_EMAIL}}?subject=Désabonnement">x</a></p>';
  assert.equal(habillerMail(r, deja).split('subject=Désabonnement').length - 1, 1);
});
test('valeurs de marque : clés du registre, défauts neutres, couleur mal formée écartée', () => {
  assert.deepEqual(Object.keys(valeursDeMarque({})).sort(), [...VARIABLES_MARQUE].sort());
  assert.equal(valeursDeMarque({})['{{ACCENT_COLOR}}'], '#64748b');
  assert.equal(valeursDeMarque({})['{{SECONDARY_COLOR}}'], '#334155');
  assert.equal(valeursDeMarque({})['{{BRAND_NAME}}'], '');
  for (const c of ['orange', '#12', 'red;}', '"><script>']) assert.equal(valeursDeMarque({ accent_color: c })['{{ACCENT_COLOR}}'], '#64748b');
});
test('nom de l\'entreprise échappé, logo seulement en https, sans logo le nom', () => {
  const h = habillerMail({ brand_name: '<b>X</b>', logo_url: 'javascript:1' }, '<p>a</p>');
  assert.ok(h.includes('&lt;b&gt;X&lt;/b&gt;') && !h.includes('<img'));
  assert.ok(habillerMail({ brand_name: 'X', logo_url: 'https://ex.fr/l.png' }, '<p>a</p>').includes('<img'));
});
test('bandeau et certifications selon les choix', () => {
  const r = { email_tagline: 'Slogan', rge_certifications: ['QualiBois'], email_habillage: { entete: 'logo_bandeau', pied: { coordonnees: true, certifications: true, site: false } } };
  const h = habillerMail(r, '<p>a</p>');
  assert.ok(h.includes('Slogan') && h.includes('QualiBois') && h.includes('#334155'));
  assert.ok(!habillerMail({ ...r, email_habillage: HABILLAGE_DEFAUT }, '<p>a</p>').includes('Slogan'));
});
```

- [ ] **Step 2 : lancer, constater l'échec** — `node --test scripts/mail-habillage.test.mjs` → échec « Cannot find module ».
- [ ] **Step 3 : écrire le module.** Habillage construit : tableaux, styles en ligne, largeur 600 px, Arial, fond de page `#f1f5f9`, carte blanche ; valeurs posées par le module, échappées (reprendre la structure de `habillageNeutre`, `_shared/mail.ts:131-146`). Le corps est inséré sans être touché.
- [ ] **Step 4 : tests verts**, puis inscrire le test dans `audit:quality` et `mailHabillage` dans `PARTAGES`, lancer `npm run sync:tournee-engine`.
- [ ] **Step 5 : commit** — `feat(mailing): habillage des e-mails en un module pur`.

### Task 2 : les edges délèguent

**Files:**
- Modify: `supabase/functions/_shared/mail.ts` (`OrgBranding`, `orgBranding`, `brandingReplacements`, `wrapWithSkeleton` ; supprimer `habillageNeutre`)
- Modify: `supabase/functions/mailing-send/index.ts` (`loadOrgBranding`, `wrapInSkeleton`, `buildRecipientReplacements`)
- Modify: `supabase/functions/contract-signed-notify/index.ts:140-150, 186-208`
- Modify: `scripts/emails-automatiques.test.mjs:44-48`, `scripts/mail-habillage.test.mjs`

**Interfaces:**
- Consumes: `habillerMail`, `valeursDeMarque` de `../_shared/mailHabillage.js`.
- Produces: `OrgBranding.reglages: Record<string, unknown>` (réglages bruts de l'organisation) ; `wrapWithSkeleton(b, body)` garde sa signature et rend `habillerMail(b.reglages, body)` ; `brandingReplacements(b)` rend `valeursDeMarque(b.reglages)`.

- [ ] **Step 1 : avant de toucher `mailing-send`**, comparer le fichier du dépôt à la version en production (`get_edge_function`) ; s'ils diffèrent, s'arrêter et le signaler (`docs/MODULE_MAILING.md` prévient d'un écart ancien).
- [ ] **Step 2 : tests de source** (dans `scripts/mail-habillage.test.mjs`) : les trois fichiers d'edge ci-dessus ne contiennent plus `email_skeleton_html`, ni `#f97316`, ni `#1E4D8C`, et importent `mailHabillage.js`. Remplacer le test d'alignement de `emails-automatiques.test.mjs` par : `brandingReplacements` de `mail.ts` appelle `valeursDeMarque` (lecture de la source), l'égalité des clés étant tenue par la tâche 1.
- [ ] **Step 3 : modifier les trois edges.** `contract-signed-notify` garde son nom par défaut en passant `{ ...settings, brand_name: brandName }` aux deux fonctions ; ses remplacements deviennent `{ '{{CLIENT_NAME}}': …, ...valeursDeMarque(…) }`. `mailing-send` : mêmes remplacements, plus `{{CLIENT_NAME}}` ; `wrapInSkeleton` supprimée au profit de `habillerMail(branding.reglages, htmlBody)`.
- [ ] **Step 4 : vérifier** — `npm run audit:quality` vert ; si `deno` est installé, `deno check` sur les trois fichiers et `deno test supabase/functions/webshop-process/logic.test.ts`.
- [ ] **Step 5 : commit** — `refactor(emails): un seul habillage et une seule liste de valeurs de marque pour toutes les edges`.

### Task 3 : redéploiement (arrêt : oui d'Eric)

- [ ] **Step 1 :** demander à Eric l'accord de redéployer les douze edges : `auto-rdv`, `auto-rdv-cron`, `chantier-pv`, `contract-signed-notify`, `dpe-lien`, `email-essai`, `invoice-send`, `lead-welcome-email`, `mailing-send`, `maintenance-digest`, `sav-report-send`, `webshop-process`. Lui dire l'effet attendu : rien pour Mayer ; pour Cimaj, boutons en gris ardoise et lien de désabonnement visible.
- [ ] **Step 2 :** après accord, déployer ; « M'envoyer un essai » d'un e-mail automatique depuis Réglages → E-mails & SMS pour Mayer puis Cimaj ; lire les journaux des edges. Mayer : rendu inchangé. Dire à Eric ce qui a été constaté et ce qui ne l'a pas été.

---

## Tranche 2 — Format du texte et rédaction assistée

### Task 4 : `mailCorps.js`

**Files:**
- Create: `src/lib/mailCorps.js` ; Test: `scripts/mail-corps.test.mjs`
- Modify: `package.json`, `scripts/sync-tournee-engine.mjs` (`'mailCorps'`)

**Interfaces — Produces :**
- `estEditable(html: string): boolean`
- `normaliser(html: string, options?: { sansElements?: boolean }): string` — `sansElements` : Titre, Bouton, Encadré ramenés à des paragraphes (mails habillés par le site).
- `versEditeur(html: string, libelles: Record<string, string>): string` — variables → `<span contenteditable="false" data-var="{{X}}" class="variable-mail">Libellé</span>` ; variable-bloc → `<div contenteditable="false" data-var-bloc="{{X}}" class="variable-bloc">Libellé</div>`.
- `depuisEditeur(htmlDuDom: string, options?): string` — inverse, puis `normaliser`.
- `variablesDe(html): string[]`, `texteBrut(html): string`.

Forme enregistrée, valeurs exactes :

| Élément | Enregistré |
|---|---|
| Titre | `<h2 style="margin:24px 0 8px;font-size:18px;line-height:1.3;color:#0f172a">…</h2>` |
| Lien | `<a href="…" style="color:{{ACCENT_COLOR}}">…</a>` |
| Bouton | `<p style="text-align:center;margin:28px 0"><a data-bouton href="…" style="background:{{ACCENT_COLOR}};color:#ffffff;padding:12px 22px;border-radius:6px;text-decoration:none;font-weight:600">…</a></p>` |
| Encadré | `<div data-encadre style="border-left:4px solid {{ACCENT_COLOR}};background:#f8fafc;padding:12px 16px;margin:16px 0">…</div>` |

Adresses de lien acceptées : `https:`, `http:`, `mailto:`, `tel:`, ou une variable seule (`{{LIEN_PV}}`). Analyse par un petit lecteur de balises sur chaînes : pas de DOM.

- [ ] **Step 1 : tests**

```js
test('tous les textes par défaut sont éditables', () => {
  for (const e of [...EMAILS_AUTOMATIQUES, ...SEQUENCES_EMAILS]) assert.ok(estEditable(e.gabarit.html_body), e.gabarit.key);
  for (const g of Object.values(WEBSHOP_EMAIL_DEFAULTS)) assert.ok(estEditable(g.html_body), g.key);
});
test('une page complète, une image, un tableau ne sont pas éditables', () => {
  for (const h of ['<!DOCTYPE html><html><body>x</body></html>', '<p><img src="a"></p>', '<table><tr><td>x</td></tr></table>']) assert.equal(estEditable(h), false);
});
test('normaliser est stable et ne change pas un texte simple', () => {
  const simple = '<p>Bonjour {{CLIENT_NAME}},</p>{{ITEMS}}<p><strong>Merci</strong><br>{{BRAND_NAME}}</p>';
  assert.equal(normaliser(simple), simple);
  for (const e of EMAILS_AUTOMATIQUES) assert.equal(normaliser(normaliser(e.gabarit.html_body)), normaliser(e.gabarit.html_body));
});
test('rien de dangereux ne survit', () => {
  const n = normaliser('<p onclick="x()">a<script>x</script><iframe></iframe><a href="javascript:1">b</a><style>p{}</style></p>');
  for (const interdit of ['onclick', '<script', '<iframe', 'javascript:', '<style']) assert.ok(!n.includes(interdit));
});
test('lecture tolérante : ancien bouton et ancien encadré reconnus', () => {
  assert.ok(normaliser('<p style="text-align:center"><a href="{{LIEN_PV}}" style="background:{{ACCENT_COLOR}};color:#fff">Signer</a></p>').includes('data-bouton'));
  assert.ok(normaliser('<div style="padding:8px">x</div>').includes('data-encadre'));
});
test('variable-bloc : nue à la racine, jamais dans un paragraphe', () => {
  assert.ok(normaliser('<p>a</p>{{LEGAL_INFO}}').endsWith('</p>{{LEGAL_INFO}}'));
  assert.equal(depuisEditeur(versEditeur('<p>a</p>{{ITEMS}}', {})), '<p>a</p>{{ITEMS}}');
});
test('texte collé depuis un traitement de texte : seul le texte reste', () => {
  const colle = '<div><span style="font-family:Calibri;color:red">Bonjour</span><font size="7"> à tous</font></div><table><tr><td>x</td></tr></table>';
  const n = depuisEditeur(colle);
  assert.ok(n.includes('Bonjour') && !/font|span|color:red|<table/.test(n));
});
test('sansElements : titre, bouton et encadré deviennent des paragraphes', () => {
  assert.ok(!/data-bouton|data-encadre|<h2/.test(normaliser('<h2>T</h2><div data-encadre>x</div>', { sansElements: true })));
});
```

- [ ] **Step 2 : échec constaté** ; **Step 3 : module** ; **Step 4 : tests verts**, inscription, synchronisation.
- [ ] **Step 5 : commit** — `feat(mailing): format du texte d'un mail, sans HTML libre`.

### Task 5 : `mailRedaction.js`

**Files:** Create `src/lib/mailRedaction.js` ; Test `scripts/mail-redaction.test.mjs` ; Modify `package.json`, `PARTAGES` (`'mailRedaction'`).

**Interfaces:**
- Consumes: `normaliser`, `variablesDe`, `estEditable` de `./mailCorps.js`.
- Produces:
  - `CONSIGNES = ['rediger', 'court', 'chaleureux', 'reformuler', 'objets']`
  - `REDACTION_CODES` (code → message) : `module_communication_inactif`, `consigne_inconnue`, `intention_requise`, `texte_requis`, `plafond_atteint`, `service_indisponible`, `reponse_illisible` ; `messageErreurRedaction(code): string`.
  - `adressesAutorisees(reglages): string[]` — toutes les valeurs `url` de `reglages.mailing_resources` (parcours récursif) et `website_url`.
  - `validerDemande({ consigne, intention, corps }): string | null` — `rediger` exige une intention ; les autres exigent un texte.
  - `construireConsigne({ consigne, intention, objet, corps, nature, variables, entreprise: { nom, site }, adresses }): { system: string, user: string }`
  - `SCHEMA_REDACTION` — objet JSON Schema, trois champs requis `objet: string`, `objets: string[]`, `corps: string`, aucun type union.
  - `lireReponse(brut: unknown, { consigne, variables, adresses }): { objet: string, objets: string[], corps: string } | null` — `null` si inutilisable.

- [ ] **Step 1 : tests**

```js
const ctx = { consigne: 'rediger', variables: ['{{SALUTATION}}'], adresses: ['https://ex.fr/contact'] };
test('réponse inutilisable : null', () => {
  for (const brut of [null, '', 'pas du json', { objet: 'x' }, { objet: 'x', objets: [], corps: '<!DOCTYPE html><html></html>' }, { objet: '', objets: [], corps: '' }])
    assert.equal(lireReponse(brut, ctx), null);
});
test('lien inventé ramené à du texte, lien du catalogue gardé', () => {
  const r = lireReponse({ objet: 'O', objets: ['a', 'b', 'c'], corps: '<p><a href="https://invente.fr">ici</a> <a href="https://ex.fr/contact">là</a></p>' }, ctx);
  assert.ok(!r.corps.includes('invente.fr') && r.corps.includes('ici') && r.corps.includes('https://ex.fr/contact'));
});
test('variable non proposée retirée', () => {
  const r = lireReponse({ objet: 'O', objets: [], corps: '<p>{{SALUTATION}} {{PRENOM}}</p>' }, ctx);
  assert.deepEqual(variablesDe(r.corps), ['{{SALUTATION}}']);
});
test('consigne objets : le texte en place n\'est pas rendu', () => {
  assert.equal(lireReponse({ objet: 'O', objets: ['a', 'b', 'c'], corps: '<p>x</p>' }, { ...ctx, consigne: 'objets' }).corps, '');
});
test('la consigne ne contient que ce qu\'on lui donne', () => {
  const { system, user } = construireConsigne({ consigne: 'rediger', intention: 'Promo ramonage', objet: '', corps: '', nature: 'manuelle', variables: ['{{SALUTATION}}'], entreprise: { nom: 'Cimaj', site: '' }, adresses: [] });
  assert.ok(user.includes('Promo ramonage') && system.includes('Cimaj') && system.includes('{{SALUTATION}}'));
});
test('schéma sans type union', () => assert.ok(!JSON.stringify(SCHEMA_REDACTION).includes('null')));
test('validerDemande', () => {
  assert.equal(validerDemande({ consigne: 'rediger', intention: ' ', corps: '' }), 'intention_requise');
  assert.equal(validerDemande({ consigne: 'court', intention: '', corps: '' }), 'texte_requis');
  assert.equal(validerDemande({ consigne: 'x', intention: 'a', corps: '' }), 'consigne_inconnue');
});
```

- [ ] **Step 2-4 :** échec, module, tests verts, inscription, synchronisation. La consigne demande : français, vouvoiement, phrases courtes, pas de superlatif ni de point d'exclamation en série, les seules balises du tableau de la tâche 4, les seules variables et adresses fournies, objet de 50 caractères au plus.
- [ ] **Step 5 : commit** — `feat(mailing): règles de la rédaction assistée`.

### Task 6 : plafond, edge `mailing-rediger`, service (arrêt : oui d'Eric)

**Files:**
- Create: `supabase/migrations/<AAAAMMJJ>_<n>_mailing_redaction_quota.sql`, `scripts/migration-rehearsal/assert-mailing-redaction-quota.sql`
- Create: `supabase/functions/mailing-rediger/index.ts` ; Modify: `supabase/config.toml` (`[functions.mailing-rediger] verify_jwt = true`)
- Modify: `src/shared/services/mailCampaigns.service.js`, `scripts/migration-rehearsal/snapshot.mjs` (`FUNCTIONS`)

**Interfaces:**
- Consumes: tâche 5 ; `requireOrgMembership`, `jsonResponse`, `buildCorsHeaders`, `sanitizeError` de `_shared/auth.ts` ; `moduleActif` de `_shared/modules.js`.
- Produces:
  - RPC `public.increment_mailing_redaction_quota(p_user_id uuid, p_org_id uuid, p_daily_limit int DEFAULT 50)` — même forme que `increment_equipment_enrich_quota` (`20261112_5_referentiel_appareils_rpc.sql`), table `majordhome.mailing_redaction_quotas`, RLS activée sans règle, `REVOKE ALL … FROM PUBLIC, anon, authenticated`, `GRANT EXECUTE … TO service_role`, exception `mailing_redaction_quota_exceeded`.
  - Edge : corps `{ org_id, consigne, intention, objet, corps, nature, variables }` ; réponse HTTP 200 `{ data: { objet, objets, corps } | null, error: code | null }`.
  - `mailCampaignsService.rediger(orgId, demande): Promise<{ data, error: { code } | null }>` (même forme que `envoyerEssai`).

- [ ] **Step 1 : migration et son assertion** (existence, `has_function_privilege('anon' | 'authenticated', …)` faux, `service_role` vrai, dépassement refusé) ; répéter sur le harnais.
- [ ] **Step 2 : edge.** Ordre des gardes : membre org_admin → module Communication → `validerDemande` → secrets présents (`ANTHROPIC_API_KEY`) → plafond (`MAILING_REDACTION_DAILY_LIMIT`, défaut 50) → appel. Nom, site et adresses relus en base, jamais pris de la requête. Appel à Claude : charger la compétence `claude-api`, puis reprendre la forme déjà en production dans `supabase/functions/supplier-offer-import/index.ts:80-110` (sortie `json_schema`) ; modèle `ANTHROPIC_MAILING_MODEL`, défaut `claude-sonnet-5-5`. Réponse passée par `lireReponse` ; `null` ⇒ `reponse_illisible`. L'edge n'écrit rien d'autre que le plafond.
- [ ] **Step 3 : méthode de service** et test de correspondance des codes (dans `scripts/mail-redaction.test.mjs` : tout code cité par la source de l'edge est une clé de `REDACTION_CODES`).
- [ ] **Step 4 : `npm run audit:quality`**, commit — `feat(mailing): rédaction assistée côté serveur`.
- [ ] **Step 5 : demander à Eric** l'accord d'appliquer la migration en production et de déployer `mailing-rediger`. Après accord : appliquer, déployer, un appel réel (`rediger` sur une intention d'essai) et lire le journal de l'edge.

---

## Tranche 3 — La page du mail

### Task 7 : `mailVariables.js` et `mailApercu.js`

**Files:** Create `src/lib/mailVariables.js`, `src/lib/mailApercu.js` ; Test `scripts/mail-variables.test.mjs`, `scripts/mail-apercu.test.mjs` ; Modify `src/lib/webshop/emailTemplates.js`, `package.json`.

**Interfaces:**
- Produces (`emailTemplates.js`) : `GABARITS_HABILLES_PAR_LE_SITE = ['webshop_confirmation', 'webshop_feuille_route']`.
- Produces (`mailVariables.js`) :
  - `natureDuMail(campagne): 'manuelle' | 'automatique' | 'sequence' | 'auto_registre' | 'boutique'` — `sequence` si `estSequence(key)` ; `auto_registre` si `emailAutomatique(key)` ; `boutique` si la clé est dans `WEBSHOP_EMAIL_KEYS` ; sinon `automatique` si `is_automated`, sinon `manuelle`. Une campagne `is_transactional` hors registre et hors boutique est traitée comme `boutique` (message seul, pas d'essai).
  - `variablesProposees(campagne): Array<{ nom: string, libelle: string, bloc: boolean, lien: boolean }>`
  - `libelleVariable(nom: string): string` — nom brut sans accolades si inconnu.
  - `variablesManquantes(campagne, html): string[]` (libellés des variables du texte par défaut absentes du texte) ; `variablesInconnues(campagne, html): string[]` (variables du texte ni proposées ni de marque).
  - `elementsPermis(campagne): { titre: boolean, bouton: boolean, encadre: boolean }` — tout faux pour `GABARITS_HABILLES_PAR_LE_SITE`.
- Produces (`mailApercu.js`) : `rendreApercu({ campagne, objet, corps, reglages }): { html: string, objet: string, habilleParLeSite: boolean }` — `habillerMail`, puis `valeursDeMarque`, puis valeurs d'exemple (`exemple` du registre, « Bonjour Jean Dupont, », « Jean Dupont », sinon « [Libellé] »), marqueur de désabonnement remplacé par `#`.

- [ ] **Step 1 : tests** — nature de `sequence_accueil_lead`, `pv_reception`, `webshop_confirmation`, d'une campagne manuelle ; `variablesInconnues(campagneManuelle, '<p>{{PRENOM}}</p>')` rend `['{{PRENOM}}']` et rien pour `{{SALUTATION}}` ; `variablesManquantes` de `webshop_confirmation` sans `{{LEGAL_INFO}}` rend son libellé ; `elementsPermis` faux pour les deux gabarits du site ; `rendreApercu` ne laisse **aucun** `{{…}}` dans `html` pour chaque texte par défaut du registre ; `habilleParLeSite` vrai ⇒ `html` sans l'habillage.
- [ ] **Step 2-4 :** échec, modules, tests verts, inscription. **Step 5 : commit** — `feat(mailing): variables d'un mail et aperçu fidèle`.

### Task 8 : l'éditeur de texte

**Files:** Create `src/apps/artisan/components/mailing/editeur/EditeurTexte.jsx`, `FenetreLien.jsx`.

**Interfaces:**
- Consumes: `versEditeur`, `depuisEditeur` (tâche 4) ; `variablesProposees`, `elementsPermis` (tâche 7).
- Produces: `<EditeurTexte valeur version onChange variables elements disabled />` — `onChange(html)` reçoit toujours un texte normalisé ; `valeur` n'est relue que lorsque `version` change.

- [ ] **Step 1 :** porter `C:\Dev\Frontend-Baikal\src\components\console\mailing\EditeurTexte.jsx` aux classes de l'application (`secondary-*`, `primary-*`), conversions confiées à `mailCorps.js` (plus de conversion dans le composant).
- [ ] **Step 2 :** ajouter Titre, Encadré (bascule du bloc courant), et `FenetreLien` (texte, adresse ou variable de lien) pour Lien et Bouton, à la place de `window.prompt`. Coller = texte seul. Variable-bloc : étiquette pleine largeur, non éditable.
- [ ] **Step 3 :** `npx vite build` sans erreur ; `npm run lint:errors`.
- [ ] **Step 4 : commit** — `feat(mailing): éditeur de texte d'un mail`. (Le composant est consommé par la tâche 9 : livrer les deux dans la même poussée, `audit:dead-code` refuse un fichier jamais importé.)

### Task 9 : la page — message, aperçu, enregistrement

**Files:**
- Create: `src/lib/mailPage.js`, `scripts/mail-page.test.mjs`, `src/apps/artisan/components/mailing/page/{PageMail,CarteMessage,ApercuMail}.jsx`
- Modify: `src/apps/artisan/components/mailing/EditorTab.jsx`, `src/apps/artisan/pages/Mailing.jsx`, `src/shared/services/mailCampaigns.service.js`, `src/shared/hooks/useMailCampaigns.js`, `package.json`

**Interfaces — Produces (`mailPage.js`) :**
- `cartesDuMail(nature, { isOrgAdmin }): { destinataires: 'oui' | 'lecture' | 'non', message: 'oui' | 'lecture', envoi: 'complet' | 'lecture' | 'essai' | 'non' }` — table de la conception § 5.4.
- `cleDepuisLibelle(libelle): string` (règle de `slugifyKey` actuelle) ; `cleDeCopie(cle, clesExistantes): string`.
- `nomVerrouille(nbEnvois: number | undefined): boolean` — `undefined` (journal inconnu) ⇒ vrai.
- `champsAEnregistrer(formulaire, initial): object` — seulement les champs portés par la page (`label`, `subject`, `html_body`, `blocks`, `auto_segment_id`, `is_automated`, `auto_cadence_days`, `auto_time_of_day`, `next_run_at`), et seulement ceux qui ont changé ; `key` et `tracking_type_value` à la création.
- `raisonsDeBlocage({ objet, corps, variablesInconnues, segmentId, nombre, refusExpediteur, envoiEnCours }, geste: 'tester' | 'lancer' | 'automatiser'): string[]` — messages en français, liste vide = geste ouvert.
- `refaireAvecNouvelEditeur(campagne, texteParDefaut | null): { html_body, blocks }` et `revenirALAncien(campagne): { html_body, blocks } | null` (`blocks.ancien_html`).
- Service : `mailCampaignsService.compterEnvois(orgId, libelle): Promise<{ data: number | null, error }>` — `select('id', { count: 'exact', head: true })` sur `majordhome_mailing_logs`, filtres `org_id` et `campaign_name`.

- [ ] **Step 1 : tests de `mailPage.js`** — chaque ligne de la table des cartes ; `raisonsDeBlocage` : objet vide, texte vide, variable inconnue, segment absent, nombre `undefined` et nombre 0 pour `lancer`, refus d'expéditeur, envoi en cours (double clic) ; `nomVerrouille(undefined) === true`, `nomVerrouille(0) === false` ; `refaireAvecNouvelEditeur` garde l'ancien HTML dans `blocks.ancien_html` et `revenirALAncien` le restaure ; `champsAEnregistrer` n'envoie jamais `purpose`, `audience`, `tone`, `notes`.
- [ ] **Step 2 : `PageMail`** (orchestrateur, état en `useReducer`, pleine page à la place de la liste) ouverte par `?mail=<id>` ou `?mail=nouveau`, et par l'ancien `?tab=editor&edit=<clé>` ; « Enregistrer » ; confirmation avant de quitter un mail modifié ; nom verrouillé selon `compterEnvois`.
- [ ] **Step 3 : `CarteMessage`** — intention (`blocks.brief`) et boutons de rédaction (`mailCampaignsService.rediger`, « Annuler » rend le texte d'avant), objet avec « Proposer » et rappel au-delà de 50 caractères, `EditeurTexte`, avertissements `variablesManquantes` et `variablesInconnues`, bandeau « ancien format » avec ses deux gestes.
- [ ] **Step 4 : `ApercuMail`** — De (`resoudreExpediteur`), Objet, « Exemple pour Jean Dupont », bascule ordinateur / téléphone (375 px), `iframe` `sandbox=""` + `srcDoc` de `rendreApercu`, mention « Cet e-mail est habillé par votre site » le cas échéant.
- [ ] **Step 5 :** `EditorTab` : « Éditer » et « Nouvelle campagne » ouvrent la page ; « Dupliquer » sans `window.prompt` (`cleDeCopie`). **L'assistant `CampaignWizard` reste en place et atteignable tant que la tâche 6 n'est pas en production** ; s'il l'est déjà, le retirer ici.
- [ ] **Step 6 :** `npm run audit:quality`, `npx vite build` ; commit — `feat(mailing): page du mail, message et aperçu`.

### Task 10 : destinataires, envoi, retrait de l'ancien

**Files:**
- Create: `src/shared/hooks/useEnvoiCampagne.js`, `src/apps/artisan/components/mailing/page/{CarteDestinataires,CarteEnvoi}.jsx`
- Modify: `PageMail.jsx`, `Mailing.jsx`, `EditorTab.jsx`, `docs/MODULE_MAILING.md`, `CLAUDE.md` (§ Module Mailing)
- Delete: `SendTab.jsx`, `CampaignIdentityPanel.jsx`, `CampaignWizard.jsx` ; dans `resources.js`, `formatResourcesForPrompt` s'il n'a plus d'appelant

**Interfaces:**
- Consumes: `raisonsDeBlocage`, `cartesDuMail` (tâche 9) ; `useSegmentCount`, `useSegmentPreview`, `useMailSegments` ; `SegmentBuilderDrawer` ; `resoudreExpediteur`, `EXPEDITEUR_REFUS`.
- Produces: `useEnvoiCampagne({ orgId }): { tester(args), lancer(args), enCours: boolean, progression: { vague, envoyes, echecs, reste } | null }` où `args = { segmentId, objet, corps, nomCampagne, adresseTest? }` — corps de `sendCampaign` de `SendTab.jsx:146-235` déplacé tel quel (vagues, 40 au plus, reprise sans doublon, messages).

- [ ] **Step 1 : `useEnvoiCampagne`**, puis `CarteDestinataires` (segments Clients / Prospects, nombre du segment choisi avec le nom de la campagne, « Voir des exemples », « Nouveau segment » qui choisit le segment créé ; nombre inconnu ⇒ rien d'affiché).
- [ ] **Step 2 : `CarteEnvoi`** — Une fois / Automatique ; test ; « Lancer » avec `ConfirmDialog` (segment, nombre) ; progression ; cadence en jours et heure, cadence en minutes existante affichée et conservée ; refus d'expéditeur affiché dès l'ouverture avec lien vers `/settings/communication`. « Tester » et « Lancer » enregistrent d'abord un mail modifié. Séquence : cartes en lecture avec lien vers les Réglages.
- [ ] **Step 3 : droits** — non-administrateur : campagnes manuelles seules, message en lecture, segment choisi non enregistré.
- [ ] **Step 4 :** onglets Campagnes / Stats / Segments (onglet par défaut : Campagnes) ; supprimer les trois fichiers ; `npm run audit:quality` (dont `audit:dead-code`) et `npx vite build`.
- [ ] **Step 5 :** mettre à jour `docs/MODULE_MAILING.md` (architecture, éditeur) et `CLAUDE.md` (règles qui mordent : format du texte, habillage rendu à l'envoi, nom verrouillé, rédaction assistée) ; commit — `feat(mailing): destinataires et envoi sur la page du mail, fin de l'assistant et de l'onglet Envoi`.
- [ ] **Step 6 :** dire à Eric ce qui est en production et ce qui n'a pas été vu à l'écran (aucun parcours réel n'aura été fait).

---

## Tranche 4 — Écran d'habillage

### Task 11 : `HabillageSection`

**Files:** Create `src/apps/artisan/pages/settings/communication/HabillageSection.jsx` ; Modify `EmailsTab.jsx` (montage de la section), `CLAUDE.md`, `docs/MODULE_MAILING.md`.

**Interfaces:**
- Consumes: `choixDepuisReglages`, `valeursDeMarque`, `DEFAUTS_MARQUE` (tâche 1) ; `rendreApercu` (tâche 7) ; `useOrgSettings()` ; `contraste(couleur, '#ffffff')` de `src/lib/pagePublique.js` (bouton lisible à partir de 4,5).
- Produces: enregistrement `save({ email_habillage, accent_color, secondary_color, email_tagline })` ; « Revenir à l'ancien habillage » = `save({ email_habillage: null })`, proposé seulement si `email_skeleton_html` existe et qu'un `email_habillage` est enregistré.

- [ ] **Step 1 : test** (ajout à `scripts/mail-habillage.test.mjs`) : `choixDepuisReglages` pour des réglages vides, pour un ancien habillage seul, pour un `email_habillage` enregistré.
- [ ] **Step 2 : section** — réglages de la conception § 5.1 à gauche, aperçu à droite sur un texte d'exemple portant titre, encadré et bouton ; logo en lecture avec lien vers Organisation → Identité ; mention que la couleur des boutons est aussi celle des pages publiques ; avertissement de lisibilité du bouton ; bouton Enregistrer fermé sans changement.
- [ ] **Step 3 :** `npm run audit:quality`, `npx vite build` ; docs ; commit — `feat(reglages): habillage des e-mails réglable par l'entreprise`.
- [ ] **Step 4 :** dire à Eric que l'habillage de Mayer ne change qu'au premier enregistrement de cet écran, et que rien n'a été vu à l'écran.

---

## Auto-relecture (faite à l'écriture)

- Conception § 5.1 → tâches 1, 2, 3, 11 ; § 5.2 → 4 ; § 5.3 → 7, 8 ; § 5.4 → 7, 9, 10 ; § 5.5 → 5, 6 ; § 5.6 → 9, 10 ; § 8 → vérifications de chaque tâche.
- Ordre tenu : 1 → 2 → 3 avant tout aperçu ; 4 avant 5 ; 6 en production avant le retrait de l'assistant (tâche 9, étape 5, et tâche 10).
- Noms croisés vérifiés : `habillerMail`, `valeursDeMarque`, `normaliser`, `depuisEditeur`, `lireReponse`, `rendreApercu`, `raisonsDeBlocage`, `useEnvoiCampagne`.
