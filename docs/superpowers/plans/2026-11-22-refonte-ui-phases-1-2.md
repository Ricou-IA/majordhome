# Refonte UI — phases 1 et 2 (jetons, polices, coquille, composants de base) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Faire passer toute l'application à la direction artistique « atelier chaleureux » (cuivre, pierre chaude, Bricolage Grotesque / Figtree) puis poser la coquille et les composants de base, sans aucune perte de fonction.

**Architecture:** Les échelles Tailwind `primary` (bleu ciel) et `secondary` (ardoise) sont réécrites en cuivre et pierre chaude : la couleur de toute l'app change sans toucher aux 5 500 usages. Des balayages mécaniques ciblés (bouton d'action, gris codés en dur) et un contrôle anti-régression complètent. La phase 2 ajoute des composants dans `src/components/ui/`, chacun livré avec un consommateur réel.

**Tech Stack:** React 18, Vite 5, Tailwind 3.4, Radix UI, lucide-react, `@fontsource-variable/*` (5.3.0), `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-22-refonte-ui-ux-direction-artistique-design.md` (références : `docs/ux/references/DA.md`, `docs/ux/references/brief-grok-ui.md`).

**Périmètre :** phases 1 et 2 de la spec. Les phases 3 (écrans du quotidien), 4 (commerce et terrain) et 5 (finitions) feront chacune l'objet d'un plan écrit au moment de les commencer, sur la boîte à composants livrée ici. Le protocole de mesure (phase 0) ne bloque rien et sera écrit avant le premier passage, après la phase 3.

## Global Constraints

- Aucun fichier sous `supabase/`, `sql/` ni `scripts/migration-rehearsal/` dans le diff (`git diff --stat` le prouve à chaque commit).
- Aucune requête, aucune RPC, aucune règle métier modifiée ; aucune URL renommée.
- Texte blanc sur la couleur principale : `bg-primary-600` (`#C2532B`, 4,60:1), survol `hover:bg-primary-700`. `#C2532B` est une valeur fixe, jamais interpolée.
- Cuivre = action, sélection, « vous êtes ici » seulement ; jamais un statut.
- Planning : un RDV garde la couleur de la personne (`team_members.calendar_color`), violet `#6D28D9` réservé à « facturé » — rien dans ce plan ne touche aux couleurs de blocs.
- Les hex codés en dur dans le JS (Recharts, PDF react-pdf, `orgBranding.js` dont le repli neutre `#64748b`, `pagePublique.js`, `mailHabillage.js`) ne sont pas touchés.
- Tout composant partagé créé est consommé dans le même commit (règle anti-code mort de `CLAUDE.md`).
- Toute clé `localStorage` suffixée `:${userId}` ou `:${orgId}`.
- Après chaque tâche : `npx vite build` vert, `npm run lint` sans nouvel avertissement, `npm run audit:quality` vert. Pas d'aperçu navigateur : la vérification visuelle est la recette d'Eric.
- Travail sur `main`, commit par pathspec (`git commit -- <fichiers>`), `git pull --rebase --autostash` avant push.

## Review Focus

1. **Texte secondaire sur fond papier** : `text-secondary-500` posé sur `bg-secondary-50` doit rester ≥ 4,5:1 (le `n-500` de la DA, `#7D7468`, ne fait que 4,19:1 sur `#F7F5F1`). Épinglé par `contraste secondary-500 sur secondary-50` (Tâche 1).
2. **Codemod des gris qui mord hors des classes** : une chaîne comme `"gray-matter"`, un nom de couleur dans une donnée ou un hex ne doit pas changer. Épinglé par les tests de `remplacerGris` (Tâche 4).
3. **Ancien appel du `Button`** : les `variant="default" | "outline" | "destructive"` et `size="default" | "lg"` existants doivent continuer à rendre un bouton stylé. Épinglé par `alias de variantes` (Tâche 8).
4. **Menu replié d'un autre utilisateur** : l'état replié ne doit pas fuir d'un compte à l'autre sur le même navigateur. Épinglé par `cleMenuReplie` (Tâche 11).
5. **Statut inconnu ou vide** : `toneFor` reçoit une valeur absente du tableau (statut Pennylane futur, `null`) et doit rendre `neutre`, jamais lever. Épinglé dans la Tâche 7.

---

## PHASE 1 — Jetons et polices

### Task 1: Échelles de couleurs, variables CSS, jetons nommés

**Files:**
- Modify: `tailwind.config.js` (blocs `primary`, `secondary`, ajout `st`, `act`, `fontFamily`, `fontSize`, `boxShadow`)
- Modify: `src/index.css` (`:root`, lignes 10-44)
- Test: `scripts/design-tokens.test.mjs` (à ajouter au script `audit:quality` de `package.json`)

**Interfaces:**
- Produces: classes `primary-{50…950}` (cuivre), `secondary-{25,50…950}` (pierre), `st-{neutre,info,ok,attente,alerte}` et `st-*-bg`, `act-{pose,visite,entretien,sav}` et `act-*-bg`, `font-display`, `text-{caption,label,body-sm,cell,body,section,count,title,kpi}`, `shadow-{xs,sm,md,lg,ring}`.

- [ ] **Step 1: Write the failing test** — `scripts/design-tokens.test.mjs` importe `tailwind.config.js` et contient une fonction locale `contraste(hexA, hexB)` (luminance relative WCAG 2.x). Assertions :

```js
const { primary, secondary, st } = config.theme.extend.colors;
assert.equal(primary[600], '#C2532B');
assert.equal(primary[700], '#A0421F');
assert.equal(secondary[50], '#F7F5F1');
assert.equal(secondary[500], '#736A5F');
assert.ok(contraste('#FFFFFF', primary[600]) >= 4.5);        // bouton d'action
assert.ok(contraste(secondary[500], secondary[50]) >= 4.5);  // Review Focus 1
assert.ok(contraste(secondary[500], '#FFFFFF') >= 4.5);
for (const ton of ['neutre', 'info', 'ok', 'attente', 'alerte'])
  assert.ok(contraste(st[ton], st[`${ton}-bg`]) >= 4.5, ton);
```

- [ ] **Step 2: Run it** — `node --test scripts/design-tokens.test.mjs` → FAIL (`'#0284c7' !== '#C2532B'`).

- [ ] **Step 3: Écrire les valeurs.**
  - `primary` (garder `DEFAULT` / `foreground` en `hsl(var(--primary…))`) : `50 #FDF3EE, 100 #F9E1D5, 200 #F2C2AB, 300 #E9A07D, 400 #DE8257, 500 #D4693C, 600 #C2532B, 700 #A0421F, 800 #7D3318, 900 #5A2410, 950 #3A170A`.
  - `secondary` (garder `DEFAULT` / `foreground`) : `25 #FCFBF9, 50 #F7F5F1, 100 #F0EDE7, 200 #E8E4DC, 300 #DDD7CD, 400 #A39A8E, 500 #736A5F, 600 #5E564C, 700 #443E36, 800 #2C2823, 900 #1C1915, 950 #110F0C`. (`500` assombri par rapport au `n-500` de la DA pour tenir 4,5:1 sur le fond papier.)
  - `st` et `act` : valeurs exactes du § 1.1 du brief (`docs/ux/references/brief-grok-ui.md`), clés `neutre`, `neutre-bg`, etc.
  - `fontFamily` : `display: ['"Bricolage Grotesque Variable"', 'ui-sans-serif', 'system-ui', 'sans-serif']`, `sans: ['"Figtree Variable"', 'ui-sans-serif', 'system-ui', 'sans-serif']`, `mono: ['"Geist Mono"', 'ui-monospace', 'monospace']`.
  - `fontSize` : les 9 tailles nommées du § 1.2 du brief, valeurs exactes. Ne pas redéfinir `xs`, `sm`, `base`…
  - `boxShadow` : `xs`, `sm`, `md`, `lg` = `--sh-*` du brief (teinte `rgba(28,25,21,…)`), `ring: '0 0 0 3px rgba(194,83,43,.22)'`. **Ne pas redéfinir `borderRadius`** (changerait tous les `rounded-lg` existants ; les rayons de la DA viennent avec les composants de la phase 2).
  - `src/index.css` `:root` : `--background` = `#F7F5F1`, `--foreground` = `#1C1915`, `--primary` = `#C2532B`, `--secondary` / `--muted` / `--accent` = `#F0EDE7`, `--secondary-foreground` / `--accent-foreground` = `#1C1915`, `--muted-foreground` = `#736A5F`, `--border` / `--input` = `#E8E4DC`, `--ring` = `#C2532B`, `--destructive` = `#BE3328`, convertis en `H S% L%` ; commentaires mis à jour (contraste 4,60:1 sur 600).

- [ ] **Step 4: Run it** — `node --test scripts/design-tokens.test.mjs` → PASS ; `npx vite build` → OK.

- [ ] **Step 5: Commit** — `git commit -m "feat(ui): palettes cuivre et pierre chaude, jetons de la direction artistique" -- tailwind.config.js src/index.css scripts/design-tokens.test.mjs package.json`

### Task 2: Polices auto-hébergées

**Files:**
- Modify: `package.json` (dépendances `@fontsource-variable/bricolage-grotesque`, `@fontsource-variable/figtree`, `@fontsource/geist-mono`, toutes en `^5.3.0`)
- Modify: `src/main.jsx` (imports en tête)
- Modify: `src/index.css` (`body` : `font-size: 15px; line-height: 22px;` ; `h1, h2, h3` : `font-display`)

- [ ] **Step 1:** `npm install @fontsource-variable/bricolage-grotesque@^5.3.0 @fontsource-variable/figtree@^5.3.0 @fontsource/geist-mono@^5.3.0`.
- [ ] **Step 2:** imports `@fontsource-variable/bricolage-grotesque`, `@fontsource-variable/figtree`, `@fontsource/geist-mono/400.css` dans `main.jsx`. Aucune URL `fonts.googleapis.com` nulle part (`grep -r googleapis src index.html` → vide).
- [ ] **Step 3:** `npx vite build` → OK, les `.woff2` apparaissent dans `dist/assets`.
- [ ] **Step 4:** Vérifier que `src/lib/deviceViewport.js` règle `html[data-device-class="phone"]` à 16 px sur les champs : la règle `max(16px, 1em)` de `index.css` reste au-dessus de la taille du `body`.
- [ ] **Step 5: Commit** — `feat(ui): polices Bricolage Grotesque, Figtree et Geist Mono auto-hébergées`.

### Task 3: Bouton d'action sur `primary-600`, boutons bleus alignés

**Files:**
- Create: `scripts/codemods/bouton-action.mjs` (script à usage unique, gardé dans `scripts/`)
- Test: `scripts/codemods/bouton-action.test.mjs`
- Modify: les fichiers `src/**/*.jsx` touchés (≈ 114 `bg-primary-700`, 82 `hover:bg-primary-800`), `src/index.css` (`.btn-primary`), `src/components/ui/button.jsx` (`hover:bg-primary/90` → `hover:bg-primary-700`), `CLAUDE.md` § Composants (règle du texte blanc)

**Interfaces:**
- Produces: `export function remplacerBoutonAction(source: string): string` dans `scripts/codemods/bouton-action.mjs`.

- [ ] **Step 1: Write the failing test** — `remplacerBoutonAction` :

```js
assert.equal(remplacerBoutonAction('className="bg-primary-700 text-white hover:bg-primary-800"'),
  'className="bg-primary-600 text-white hover:bg-primary-700"');
assert.equal(remplacerBoutonAction('className="bg-blue-600 text-white hover:bg-blue-700"'),
  'className="bg-primary-600 text-white hover:bg-primary-700"');
assert.equal(remplacerBoutonAction('className="bg-indigo-500 px-3 text-white"'),
  'className="bg-primary-600 px-3 text-white"');
// pas de texte blanc sur la même chaîne de classes : badge ou fond, on ne touche pas
assert.equal(remplacerBoutonAction('className="bg-blue-50 text-blue-700"'), 'className="bg-blue-50 text-blue-700"');
assert.equal(remplacerBoutonAction('className="bg-primary-700"'), 'className="bg-primary-700"');
```

- [ ] **Step 2:** `node --test scripts/codemods/bouton-action.test.mjs` → FAIL (module absent).
- [ ] **Step 3:** Implémenter `remplacerBoutonAction` : travaille chaîne de classes par chaîne de classes (contenu d'un littéral `"…"`, `'…'` ou `` `…` ``) ; ne remplace que si la chaîne contient `text-white` ; `bg-(primary-700|blue-(500|600|700)|indigo-(500|600|700)|sky-(500|600|700))` → `bg-primary-600`, `hover:bg-(primary-800|blue-(600|700|800)|indigo-(600|700|800)|sky-(600|700|800))` → `hover:bg-primary-700`. Le script principal parcourt `src/**/*.{jsx,js}` hors `src/lib/` et écrit en place.
- [ ] **Step 4:** Test → PASS ; lancer le script ; `grep -rEn "bg-primary-700[^/]" src --include=*.jsx | grep text-white` → vide ; relire le diff (`git diff --stat`, échantillon de 10 fichiers).
- [ ] **Step 5:** `.btn-primary` et `button.jsx` alignés ; `CLAUDE.md` : la règle « Texte blanc sur la couleur principale = `bg-primary-700` » devient `bg-primary-600` (`#C2532B`, 4,60:1), survol `primary-700`, raison (cuivre, 2026-11-22).
- [ ] **Step 6: Commit** — `feat(ui): bouton d'action cuivre, boutons bleus alignés`.

### Task 4: Gris codés en dur → échelle `secondary`

**Files:**
- Create: `scripts/codemods/gris.mjs`, Test: `scripts/codemods/gris.test.mjs`
- Modify: fichiers `src/**/*.{jsx,js}` touchés (≈ 2 400 occurrences dans ≈ 200 fichiers)

**Interfaces:**
- Produces: `export function remplacerGris(source: string): string`.

- [ ] **Step 1: Write the failing test**

```js
assert.equal(remplacerGris('className="bg-gray-100 text-slate-500 hover:border-gray-200"'),
  'className="bg-secondary-100 text-secondary-500 hover:border-secondary-200"');
assert.equal(remplacerGris('className="divide-slate-100 ring-gray-300/50 from-slate-50"'),
  'className="divide-secondary-100 ring-secondary-300/50 from-secondary-50"');
assert.equal(remplacerGris("import x from 'gray-matter'"), "import x from 'gray-matter'");   // Review Focus 2
assert.equal(remplacerGris("const c = '#64748b'"), "const c = '#64748b'");
assert.equal(remplacerGris("label: 'slate-500'"), "label: 'slate-500'");                    // sans préfixe utilitaire
```

- [ ] **Step 2:** → FAIL.
- [ ] **Step 3:** Implémenter : motif `((?:[a-z-]+:)*(?:bg|text|border|ring|divide|from|via|to|placeholder|fill|stroke|outline|shadow|decoration|accent|caret)(?:-[trblxyse])?)-(?:gray|slate)-(50|100|200|300|400|500|600|700|800|900|950)\b` → `$1-secondary-$2`. Script principal : `src/**/*.{jsx,js}` hors `src/lib/orgBranding.js`, `src/lib/pagePublique.js`, `src/lib/mailHabillage.js` et tout fichier `*PDF*.jsx` / `pdf*.jsx` (react-pdf n'utilise pas Tailwind mais certains contiennent des chaînes).
- [ ] **Step 4:** Test → PASS ; lancer ; `grep -rEn "(bg|text|border)-(gray|slate)-[0-9]" src --include=*.jsx | wc -l` → 0 ; `npx vite build` OK.
- [ ] **Step 5: Commit** — `refactor(ui): gris codés en dur repris par l'échelle secondary`.

### Task 5: Contrôle anti-régression `audit-ui`

**Files:**
- Create: `scripts/audit-ui.mjs`, `scripts/audit-ui-baseline.json`, Test: `scripts/audit-ui.test.mjs`
- Modify: `package.json` (`audit:quality` lance `node scripts/audit-ui.mjs` et le test)

**Interfaces:**
- Produces: `export function compterMotifs(texte: string): { petitTexte: number, couleurEnDur: number, ancienBleu: number, emoji: number }` et `export const ECRANS_GEOMETRIE_FIXE: string[]` (préfixes de chemin) dans `scripts/audit-ui.mjs`.

- [ ] **Step 1: Write the failing test**

```js
assert.deepEqual(compterMotifs('<p className="text-[10px] text-blue-600">🔥</p>'),
  { petitTexte: 1, couleurEnDur: 1, ancienBleu: 0, emoji: 1 });
assert.equal(compterMotifs('color: "#0369a1"').ancienBleu, 1);
assert.equal(compterMotifs('className="text-[12px] text-st-info"').petitTexte, 0);
assert.equal(compterMotifs('className="bg-sky-100 text-indigo-700 border-slate-200"').couleurEnDur, 3);
```

- [ ] **Step 2:** → FAIL.
- [ ] **Step 3:** Motifs : `petitTexte` = `text-\[(8|9|10|11)(\.\d+)?px\]` ; `couleurEnDur` = `\b(?:[a-z-]+:)*[a-z]+-(blue|sky|indigo|slate|gray)-\d{2,3}\b` ; `ancienBleu` = `#0369a1` (insensible à la casse) ; `emoji` = `\p{Extended_Pictographic}` (flag `u`). Le script parcourt `src/**/*.jsx`, exclut pour `petitTexte` les chemins de `ECRANS_GEOMETRIE_FIXE` (dossiers du planning, des tournées, de l'aperçu du modèle de devis, `src/apps/solaire`, `src/apps/thermique`, GeoGrid, borne de maintenance — les retrouver avec `grep -rl "text-\[10px\]"`), compare les totaux à `audit-ui-baseline.json` et sort en échec si un total augmente ; `--update` réécrit la ligne de base (à utiliser seulement quand un total baisse).
- [ ] **Step 4:** Test → PASS ; `node scripts/audit-ui.mjs --update` puis `node scripts/audit-ui.mjs` → exit 0 ; ajouter un `text-[10px]` temporaire hors liste blanche → exit 1, le retirer.
- [ ] **Step 5: Commit** — `chore(ui): contrôle anti-régression des tailles, couleurs en dur et emojis`.

### Task 6: Cuivre retiré des statuts sur les écrans du quotidien, recette de phase 1

**Files:**
- Modify: sous `src/apps/artisan/pages/` et `src/apps/artisan/components/{dashboard,clients,pipeline,planning,chantiers,entretiens}/`, `src/pages/Dashboard.jsx`, `src/layouts/AppLayout.jsx` (pastilles de rôle `bg-blue-100` etc.).
- Create: `docs/recette-refonte-phase-1.md`

- [ ] **Step 1:** Lister les usages `bg-primary-(50|100) … text-primary-(600|700|800)` et `text-primary-*` isolés dans ces dossiers (`grep -rEn "primary-(50|100)" …`). Pour chacun, trancher : action / lien / onglet actif / sélection / focus → reste cuivre ; information ou statut (pastille, compteur informatif, badge « Planifié »…) → `bg-st-info-bg text-st-info`. Noter le décompte dans le message de commit.
- [ ] **Step 2:** `npx vite build`, `npm run lint`, `npm run audit:quality` → verts ; `node scripts/audit-ui.mjs --update` si un total a baissé.
- [ ] **Step 3:** Écrire `docs/recette-refonte-phase-1.md` (format de `docs/recette-2026-11.md`) : Accueil, Clients, Fiche client, Pipeline (Kanban : hauteur uniforme des cartes), Planning (vignettes 30 min / 1 h / journée sans ligne coupée, en-tête de jour sans saut de hauteur, lignes de charge, blocs hachurés, violet facturé), Chantiers, Entretiens, Réglages, une page publique `/pv/:token`, un PDF de devis (inchangé attendu) ; à 1440 px, sur tablette, sur téléphone.
- [ ] **Step 4: Commit et mise en ligne** — commit `feat(ui): cuivre réservé à l'action sur les écrans du quotidien` ; `git pull --rebase --autostash && git push` ; suivre le déploiement Vercel jusqu'à « Ready » ; transmettre la recette à Eric. **Fin de phase 1 : attendre la recette avant la phase 2.**

---

## PHASE 2 — Coquille et composants de base

### Task 7: Tons de statut `toneFor`

**Files:**
- Create: `src/lib/tonsStatut.js`, Test: `scripts/tons-statut.test.mjs` (ajouté à `audit:quality`)

**Interfaces:**
- Produces: `export const TONS = ['neutre','info','ok','attente','alerte']` ; `export function toneFor(domaine: 'lead'|'devis'|'chantier'|'contrat'|'entretien', valeur: string|null, contexte?: { joursSansRelance?: number }): 'neutre'|'info'|'ok'|'attente'|'alerte'`.

- [ ] **Step 1: Write the failing test** (valeurs du § 3 du brief) :

```js
assert.equal(toneFor('lead', 'nouveau'), 'neutre');
assert.equal(toneFor('lead', 'contacte'), 'info');
assert.equal(toneFor('lead', 'rdv_planifie'), 'info');
assert.equal(toneFor('lead', 'devis_envoye'), 'attente');
assert.equal(toneFor('lead', 'gagne'), 'ok');
assert.equal(toneFor('lead', 'perdu'), 'alerte');
assert.equal(toneFor('devis', 'pending'), 'info');
assert.equal(toneFor('devis', 'pending', { joursSansRelance: 22 }), 'attente');
assert.equal(toneFor('devis', 'expired'), 'alerte');
assert.equal(toneFor('devis', 'accepted'), 'ok');
assert.equal(toneFor('devis', 'invoiced'), 'ok');
assert.equal(toneFor('devis', 'denied'), 'alerte');
assert.equal(toneFor('chantier', 'gagne'), 'attente');
assert.equal(toneFor('chantier', 'commande_a_faire'), 'attente');
assert.equal(toneFor('chantier', 'commande_recue'), 'attente');
assert.equal(toneFor('chantier', 'planification'), 'info');
assert.equal(toneFor('chantier', 'realise'), 'ok');
assert.equal(toneFor('chantier', 'facture'), 'ok');
assert.equal(toneFor('contrat', 'active'), 'ok');
assert.equal(toneFor('contrat', 'expired'), 'alerte');
assert.equal(toneFor('lead', 'statut_inconnu'), 'neutre');   // Review Focus 5
assert.equal(toneFor('devis', null), 'neutre');
assert.equal(toneFor('domaine_inconnu', 'x'), 'neutre');
```

- [ ] **Step 2:** → FAIL.
- [ ] **Step 3:** Implémenter par tables figées. Devis : `draft` neutre ; `pending` info, attente si `joursSansRelance > 21` ; `expired` alerte ; `accepted`/`invoiced` ok ; `refused`/`denied`/`canceled` alerte. Contrat : lire les valeurs réelles de `contracts.status` dans `src/shared/services/contracts.service.js` (active → ok, à renouveler → attente, expiré / résilié → alerte, en attente / aucun → neutre). Entretien : lire les clés de `workflow_status` (`a_planifier`, `planifie`, `realise`… dans `src/apps/artisan/components/entretiens/`) et appliquer le § 3 du brief (Demande SAV / urgent → alerte ; devis envoyé, pièces commandées → attente ; à planifier, planifié, certificat à faire → info ; réalisé, facturé → ok). Ajouter au test une assertion par clé entretien et contrat ainsi trouvée.
- [ ] **Step 4:** → PASS.
- [ ] **Step 5: Commit** — `feat(ui): tons de statut centralisés (toneFor)`.

### Task 8: `Button` réécrit, avec alias des anciennes variantes

**Files:**
- Modify: `src/components/ui/button.jsx`
- Test: `scripts/button-variants.test.mjs` (exporter `buttonVariants` ; le test l'importe via `cva`)

**Interfaces:**
- Produces: `buttonVariants({ variant: 'primary'|'secondary'|'ghost'|'link'|'danger', size: 'md'|'sm'|'icon' })` ; alias acceptés : `default`→`primary`, `outline`→`secondary`, `destructive`→`danger`, size `default`/`lg`→`md`.

- [ ] **Step 1: Write the failing test** (« alias de variantes », Review Focus 3) :

```js
assert.equal(buttonVariants({ variant: 'default' }), buttonVariants({ variant: 'primary' }));
assert.equal(buttonVariants({ variant: 'outline' }), buttonVariants({ variant: 'secondary' }));
assert.equal(buttonVariants({ variant: 'destructive' }), buttonVariants({ variant: 'danger' }));
assert.match(buttonVariants({ variant: 'primary' }), /bg-primary-600/);
assert.match(buttonVariants({ variant: 'primary' }), /hover:bg-primary-700/);
assert.match(buttonVariants({ size: 'md' }), /h-\[38px\]/);
assert.match(buttonVariants({ size: 'sm' }), /h-8/);
assert.match(buttonVariants({ variant: 'danger' }), /text-st-alerte/);
```

- [ ] **Step 2:** → FAIL.
- [ ] **Step 3:** Styles de la DA § 6 : primary `bg-primary-600 text-white hover:bg-primary-700 shadow-xs` ; secondary `bg-white border border-secondary-300 text-secondary-800 shadow-xs hover:bg-secondary-50` ; ghost `text-secondary-600 hover:bg-secondary-100` ; link `text-primary-700 font-semibold hover:underline` ; danger `bg-white border border-secondary-300 text-st-alerte hover:bg-st-alerte-bg`. Base : `rounded-lg` (8 px), `font-semibold text-body-sm`, focus `focus-visible:shadow-ring focus-visible:outline-none`, icônes `[&_svg]:size-4`. Le test devant importer un `.jsx`, sortir `buttonVariants` dans `src/components/ui/buttonVariants.js` (imports relatifs ou de `node_modules` seulement, aucun alias `@…`, pour que `node --test` le charge) et le réimporter dans `button.jsx`. Ajouter le test à `audit:quality`.
- [ ] **Step 4:** → PASS ; `npx vite build` OK (tous les consommateurs existants compilent).
- [ ] **Step 5: Commit** — `feat(ui): bouton aux variantes de la direction artistique`.

### Task 9: `StatusPill`, `Tag`, `Avatar`

**Files:**
- Create: `src/components/ui/status-pill.jsx`, `src/components/ui/tag.jsx`, `src/components/ui/avatar.jsx`, `src/lib/avatarCouleur.js`, Test: `scripts/avatar-couleur.test.mjs`
- Modify (consommateurs) : la pastille de contrat de la carte client (`src/apps/artisan/components/clients/ClientCard.jsx`) et la pastille d'urgence SAV (`src/lib/savUrgency.js` côté rendu, composant qui l'affiche dans `components/entretiens/`)

**Interfaces:**
- Consumes: `toneFor`, `TONS` (Task 7).
- Produces: `<StatusPill tone={'neutre'|'info'|'ok'|'attente'|'alerte'}>mot</StatusPill>` (24 px, point 6 px, 12,5 px gras, rayon plein) ; `<Tag>` (22 px, rayon 6 px, `bg-secondary-100 text-secondary-600`) ; `<Avatar nom="…" couleur?="#hex" id?="…" taille={24|32|56} />` ; `export const PALETTE_AVATAR: string[]` et `export function couleurAvatar(id: string): string` (6 teintes fixes : `#C2532B #2D5BC7 #1E7A4C #7A4BB8 #A86A0E #0E7490`, choix déterministe par hachage de l'id) et `export function initiales(nom: string): string`.

- [ ] **Step 1: Write the failing test**

```js
assert.equal(couleurAvatar('abc'), couleurAvatar('abc'));
assert.ok(PALETTE_AVATAR.includes(couleurAvatar('x-1')));
assert.equal(initiales('Philippe Mayer'), 'PM');
assert.equal(initiales('  eric  '), 'E');
assert.equal(initiales(''), '?');
```

- [ ] **Step 2:** → FAIL. **Step 3:** implémenter (`Avatar` prend `couleur` quand fournie — couleur de la personne au planning — sinon `couleurAvatar(id)`). **Step 4:** → PASS, build OK.
- [ ] **Step 5:** Brancher les deux consommateurs (mot entier, jamais abrégé). **Commit** — `feat(ui): pastille de statut, étiquette et avatar`.

### Task 10: `PageHeader`, `Card`, `KpiCard`, `EmptyState`, `InfoTip`, `SegmentedControl`

**Files:**
- Create: `src/components/ui/page-header.jsx`, `card.jsx`, `kpi-card.jsx`, `empty-state.jsx`, `info-tip.jsx` (sur `@radix-ui/react-popover`, déjà installé), `segmented-control.jsx`
- Modify (consommateurs) : `src/pages/Dashboard.jsx` (`PageHeader` + `KpiCard` à la place des cartes de chiffres actuelles, mêmes chiffres, 4 au plus) ; `src/apps/artisan/pages/Clients.jsx` (`PageHeader`, `EmptyState` de liste vide) ; Planning (`SegmentedControl` Jour / Semaine / Mois dans `CalendarToolbar.jsx`, mêmes vues)

**Interfaces:**
- Produces:
  - `<PageHeader title subtitle? breadcrumb? actions={[{ label, onClick|to, variant, icon? }]} />` — rend les actions dans l'ordre, l'unique `variant: 'primary'` en dernier à droite ; plus d'un primary ⇒ `logger.warn('PageHeader : plusieurs actions principales')` en développement.
  - `<Card>` (`bg-white rounded-2xl shadow-sm border border-secondary-200`), `<CardHeader title actions? />` (titre `font-display text-section`).
  - `<KpiCard label icon? value context? delta?={{ valeur, sens: 'hausse'|'baisse' }} />` (valeur `font-display text-kpi tabular-nums`). Une valeur `null`/`undefined` affiche « — », jamais 0 (règle de l'accueil : chiffre inconnu non affiché).
  - `<EmptyState icon message action?={{ label, onClick }} />`.
  - `<InfoTip>texte</InfoTip>`.
  - `<SegmentedControl value onChange options={[{ value, label, count? }]} />` (fond `secondary-100`, segment actif blanc + `shadow-sm`, rayon 6 px).

- [ ] **Step 1:** Créer les composants avec les mesures de la DA § 4 et § 7.
- [ ] **Step 2:** Brancher les trois consommateurs ; aucun chiffre ni comportement ne change (comparer le JSX avant / après : mêmes hooks, mêmes valeurs).
- [ ] **Step 3:** `npx vite build`, `npm run lint`, `npm run audit:quality` → verts.
- [ ] **Step 4: Commit** — `feat(ui): en-tête de page, cartes, chiffres clés, état vide, info-bulle, contrôle segmenté`.

### Task 11: Menu latéral restylé, libellés, menu replié

**Files:**
- Modify: `src/layouts/AppLayout.jsx` (tableau `navigation`, lignes 51-72 ; rendu de la barre latérale), `src/lib/menuGroupes.js`, `scripts/menu-groupes.test.mjs`, `src/components/navigation/{MenuCreer,RechercheGlobale,BarreDuBas}.jsx` (restyle seulement)

**Interfaces:**
- Produces: `export function cleMenuReplie(userId: string): string` dans `src/lib/menuGroupes.js` → `mdh-menu-replie:${userId}`.

- [ ] **Step 1: Write the failing test** (ajouter à `scripts/menu-groupes.test.mjs`) :

```js
assert.equal(cleMenuReplie('u-1'), 'mdh-menu-replie:u-1');            // Review Focus 4
assert.notEqual(cleMenuReplie('u-1'), cleMenuReplie('u-2'));
assert.deepEqual(GROUPES_MENU.map((g) => g.cle),
  ['quotidien', 'ventes', 'terrain', 'outils', 'developpement', 'etudes']);
assert.equal(GROUPES_MENU.find((g) => g.cle === 'outils').titre, 'Outils');
```

- [ ] **Step 2:** → FAIL.
- [ ] **Step 3:** `menuGroupes.js` : le groupe `marketing` devient `outils` (titre « Outils », replié par défaut) ; ajouter `cleMenuReplie`. `AppLayout` : libellés `Dashboard`→`Accueil`, `Pipeline`→`Leads`, `Territoire`→`Carte` (groupe `outils`), `GeoGrid`→`Visibilité locale`, `Meta Ads`→`Publicité`, `Webshop`→`Boutique`, `Mailing`→`Messages`. Groupes : `Carte`, `Visibilité locale`, `Publicité` → `outils` ; `Messages` et `Boutique` → `ventes` ; le reste inchangé. **`href` inchangés**. Rendu : fond `bg-secondary-25`, entrée active `bg-white shadow-sm` + icône `text-primary-600`, inactive icône `text-secondary-400`, libellé `text-cell text-secondary-600` ; bouton de repli en pied (64 px, icônes seules + infobulle), état lu / écrit sous `cleMenuReplie(user.id)`. Restyle de `MenuCreer`, `RechercheGlobale`, `BarreDuBas` aux jetons (pas de changement de comportement).
- [ ] **Step 4:** → PASS ; build, lint, audit verts. Vérifier que `tuileVisible` / `ROUTES_PAR_MODULE` ne dépendent pas des libellés (`grep -rn "'Pipeline'\|'Dashboard'" src`).
- [ ] **Step 5: Commit** — `feat(ui): menu latéral à la direction artistique, libellés par tâche, menu repliable`.

### Task 12: `PageHeader` sur les pages du menu, recette de phase 2

**Files:**
- Modify: les pages d'entrée de `Planning`, `Leads` (`Pipeline`), `Chantiers`, `Entretiens`, `Contrats`, `Devis`, `Messages` (`Mailing`), `Carte` (`Territoire`), `Réglages` (`Settings.jsx`)
- Create: `docs/recette-refonte-phase-2.md`

- [ ] **Step 1:** Remplacer le titre de chaque page par `PageHeader` : titre = libellé du menu ; sous-titre d'une ligne, un chiffre déjà calculé par la page (jamais une nouvelle requête ; aucun chiffre disponible ⇒ pas de sous-titre) ; actions existantes reprises, une seule `primary`, en dernier. Retirer les sous-titres explicatifs listés au § 5 du brief pour ces pages (« Suivi post-vente : … », « Gérez les paramètres… »).
- [ ] **Step 2:** Build, lint, audit verts ; `git diff --stat` sans `supabase/` ni `sql/`.
- [ ] **Step 3:** `docs/recette-refonte-phase-2.md` : menu (libellés, groupes, repli conservé après rechargement, repli propre à chaque compte), « Créer » et Ctrl K, barre du bas sur téléphone, en-têtes de page (une action principale à droite), bouton d'action de chaque page, Accueil (chiffres identiques à avant).
- [ ] **Step 4: Commit et mise en ligne** — `feat(ui): en-tête de page commun aux pages du menu` ; push, suivi Vercel, recette transmise à Eric. Mettre à jour `CLAUDE.md` (§ Composants : boîte `components/ui`, `toneFor`, `PageHeader`) et la mémoire du projet.
