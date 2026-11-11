# Lien MonsieurDPE sur la fiche client — conception

> 2026-11-11 · chantier 1 sur 2. Le chantier 2 (outil de prospection sur la base clients) aura son propre document.

## 1. Intention

Majord'home connaît l'adresse de ses clients. MonsieurDPE (dépôt `C:\Dev\DPE`, site `monsieurdpe.fr`) détient le corpus complet des DPE de l'ADEME (17,4 M de dossiers, entrées de calcul comprises) et vend une analyse complète du logement : le « rapport complet ».

Eric veut **relier les deux** : depuis la fiche d'un client, retrouver son DPE dans le corpus, enregistrer ce lien, et ouvrir l'analyse complète MonsieurDPE. Cette analyse, payante pour le public, est **comprise avec Majord'home**.

Le but métier est d'améliorer le conseil au client. Le lien enregistré sert aussi de fondation au chantier 2.

## 2. Décisions d'Eric

- Le chantier 1 se limite au **lien**. Majord'home n'affiche pas le détail du DPE : l'analyse reste chez MonsieurDPE.
- L'analyse complète MonsieurDPE est **accessible depuis Majord'home sans paiement**.
- Les accès émis depuis Majord'home sont **illimités**, et **journalisés** par organisation (pour pouvoir facturer ou plafonner plus tard).
- **Le rapport est transmissible au client** : l'artisan peut lui envoyer le lien.
- En conséquence, **un rapport ouvert par un accès Majord'home ne montre pas les entreprises RGE du secteur** (ce sont les concurrents de l'artisan) et ne compte aucune apparition pour les partenaires RGE abonnés.
- Le chantier 2 (prospection, marketing direct sur un échantillon de clients) vient après.

## 3. Objectifs, hors-champ, échecs à éviter

**Objectifs**

1. Depuis la fiche client, retrouver les DPE du bâtiment à l'adresse du client.
2. Faire confirmer par un humain le DPE du client, et l'enregistrer.
3. Ouvrir le rapport complet MonsieurDPE de ce DPE, d'un clic, sans compte ni paiement.
4. Tracer chaque accès émis, par organisation.

**Hors-champ**

- Tout balayage de la base clients, toute liste, tout score : chantier 2.
- L'affichage du dossier détaillé (parois, générateurs), la simulation de travaux, les jumeaux, les aides dans Majord'home.
- Le retrait ou la refonte du bouton « Investiguer » existant.
- Toute facturation ou plafond des accès.

**Ce qui ferait de la livraison un échec, même si elle fonctionne**

- **Rattacher d'office un DPE à un client.** Le DPE du voisin présenté comme celui du client est le piège déjà vécu sur « Investiguer ». Un humain confirme toujours.
- **Exposer le secret du corpus au navigateur**, ou relayer la route SQL libre du corpus (`POST /requete`).
- **Ouvrir le parc entier.** Un accès émis ouvre un dossier, jamais plusieurs.
- **Un échec silencieux.** Corpus injoignable, adresse non rattachée, accès refusé : chaque cas s'affiche en clair.

## 4. Ce qui existe déjà

**Côté Majord'home**

- Colonne `clients.dpe_number`, champ « N° DPE ADEME » du bloc Logement de `ClientDetail` (`clients.service.js` l'écrit déjà).
- Bouton « Investiguer » : BAN puis API publique ADEME, en direct depuis le navigateur, sans écriture (`src/lib/dpeApi.js`, cf. CLAUDE.md § Module Investigation bâtiment).
- Conventions d'edge function : `_shared/auth.ts` (`requireOrgMembership`), activation par module (`src/lib/modules.js`, `ModuleGate`, edge `baikal-admin`).

**Côté MonsieurDPE**

- API du corpus sur le VPS `https://srv1916527.hstgr.cloud`, en-tête `x-corpus-secret`, réponses `{ data, error }`.
  - `GET /dossier-batiment?adresse=…` (ou `cle_ban=…`) : géocode l'adresse, rend `{ adresse: { cle_ban, libelle }, batiment, dpe: [...] }`. Les DPE sont rattachés au bâtiment par la clé d'adresse BAN via la BDNB, triés du plus récent au plus ancien. Dégradation gracieuse : adresse inconnue ⇒ `dpe: []`, jamais une erreur.
  - `GET /dossier/{numero}` : le dossier complet d'un numéro (404 si absent). Sert ici à **vérifier** un numéro saisi à la main.
- Rapport complet : `monsieurdpe.fr/rapport/{numero}/complet?acces={jeton}`. Le jeton (UUID v4) vit dans `dpe.achat.jeton` ; le contrôle porte sur le couple (jeton, `numero_dpe`), avec `produit = 'rapport_detaille'` et `statut = 'paye'` (`site/lib/rapport/acces.ts`). Le lien est transmissible par conception et n'ouvre qu'un dossier.
- `dpe.achat` exige `email`, `montant_cents >= 0` et `stripe_session_id` non nul et unique.

**Limites mesurées, à connaître**

- 20,6 % des clés BAN de DPE n'ont pas de bâtiment dans la BDNB (mesure du 22/08/2026, CLAUDE.md du dépôt DPE).
- La vue bâtiment se reconstruit à la main à chaque millésime BDNB : un DPE récent peut y manquer.

## 5. Le parcours

1. **Chercher.** Sur la fiche, bloc Logement, un bouton lance la recherche avec l'adresse du client (adresse, code postal, ville). Sans adresse complète, le bouton est désactivé avec la raison.
2. **Lire le résultat.** L'écran affiche l'adresse retenue par le géocodage (toujours, pour que l'humain compare) et la liste des DPE du bâtiment : numéro, date, étiquette, type de logement, surface, et tout champ qui aide à distinguer deux logements d'un immeuble.
3. **Confirmer.** L'utilisateur choisit un DPE. Aucun n'est présélectionné, même s'il est seul. Le numéro s'enregistre dans `clients.dpe_number`.
4. **Repli.** Aucun DPE trouvé ⇒ message clair, et deux sorties : le bouton « Investiguer » existant, ou la saisie manuelle du numéro. Un numéro saisi ou déjà présent est vérifié dans le corpus (`/dossier/{numero}`) ; absent du corpus ⇒ on le dit, on ne propose pas l'analyse.
5. **Ouvrir l'analyse.** Dès qu'un numéro présent dans le corpus est enregistré, un bouton « Analyse MonsieurDPE » ouvre le rapport complet dans un nouvel onglet. Le premier clic émet l'accès, les suivants le réutilisent.
   À côté, « Copier le lien » met le lien du rapport dans le presse-papiers pour l'envoyer au client (même émission au premier usage). Aucun envoi d'e-mail ou de SMS depuis Majord'home dans ce chantier.
6. **Changer.** L'utilisateur peut remplacer le DPE rattaché (nouvelle recherche ou saisie). L'accès du nouveau numéro s'émet au premier clic.

## 6. Architecture

```
Fiche client (navigateur)
   │  JWT utilisateur
   ▼
Edge function Majord'home « dpe-lien »          secrets : MDH_DPE_CORPUS_URL, MDH_DPE_CORPUS_SECRET,
   │  requireOrgMembership + module actif                  MDH_DPE_SITE_URL, MDH_DPE_PARTENAIRE_SECRET
   ├── action « chercher »  ──►  corpus  GET /dossier-batiment
   ├── action « verifier »  ──►  corpus  GET /dossier/{numero}
   └── action « ouvrir »    ──►  monsieurdpe.fr  porte partenaire  ──►  dpe.achat (jeton)
```

### 6.1 Edge function Majord'home

- `verify_jwt: true`, `requireOrgMembership`, refus si le module n'est pas actif pour l'organisation.
- Trois actions fermées. **Aucun relais générique** : l'URL du corpus se compose côté serveur, la route `/requete` n'est jamais appelée.
- L'action « ouvrir » prend un `client_id`, relit `dpe_number` **en base** (jamais depuis le corps de la requête) après avoir vérifié que le client appartient à l'organisation de l'appelant.
- Chaque écriture lit son `{ error }` ; une indisponibilité du corpus ou de la porte partenaire répond une erreur explicite, traduite en français côté écran.

### 6.2 Porte partenaire MonsieurDPE

Nouveau point d'entrée côté MonsieurDPE, protégé par un secret partagé dédié (distinct du secret du corpus).

- Entrée : numéro de DPE, identifiant de l'organisation Majord'home, libellé de l'organisation.
- Effet : rend le jeton d'accès au rapport complet de ce numéro. **Idempotent** : même organisation et même numéro ⇒ même jeton, une seule ligne.
- Trace : la ligne porte l'origine « Majord'home » et l'organisation, montant 0, hors Stripe. Elle doit rester distinguable d'un achat réel dans les lectures financières de Baikal.
- Refuse un numéro mal formé ou absent du corpus.

### 6.2 bis Page du rapport complet (site MonsieurDPE)

La page `site/app/rapport/[numero]/complet/page.tsx` lit l'origine de l'accès. Pour un accès d'origine Majord'home : la bande des artisans RGE du secteur n'est pas rendue, `citerArtisans` n'est pas appelé (aucune apparition comptée), et aucune demande de devis vers un tiers n'est proposée. Le reste du rapport est identique. Couvert par les tests du site. Cette règle vaut pour le lien transmis au client comme pour l'ouverture par l'artisan.

### 6.3 Stockage côté Majord'home

- Le lien : `clients.dpe_number` (existant).
- L'accès émis : une table `majordhome.dpe_report_accesses` (org, client, numéro, jeton, émis par, émis le), une ligne par (org, numéro). Elle sert de journal par organisation et évite de rappeler MonsieurDPE à chaque clic.
- Règles de la charte : RLS scopée org, vue publique `security_invoker`, `REVOKE … FROM PUBLIC, anon`, écriture par la seule edge function (service_role). Le jeton n'est lisible que par les membres de l'organisation.

### 6.4 Activation

Un module `dpe` dans le catalogue de `src/lib/modules.js`, fermé par défaut, ouvert pour Mayer par Baikal. Bloc masqué quand le module est fermé. Pas de page de réglage dans ce chantier : il n'y a rien à régler.

## 7. Choix faits par le rédacteur (à vérifier par Eric en relisant)

- **Porte partenaire = route du site MonsieurDPE** (Next, Vercel), pas une edge function Supabase : le projet Supabase qui porte le schéma `dpe` a atteint son plafond de 100 fonctions, et le site a déjà la clé de service.
- **Trace = une ligne `dpe.achat`** avec un identifiant de session synthétique (du type `majordhome:{org}:{numero}`) qui porte l'idempotence, montant 0, e-mail technique, et une **colonne d'origine** (obligatoire : la page du rapport et Baikal la lisent). Le contrôle du jeton reste celui d'aujourd'hui.
- **Lecture du jeton côté Majord'home** : tout membre de l'organisation (le lien est fait pour circuler) ; l'émission reste réservée à `clients.edit`.
- **Lecture Baikal** : une ligne Majord'home n'est pas une vente. Elle porte une colonne d'origine, sort de l'entonnoir B2C et des comptages de ventes (`baikal_*`), et se lit à part comme un accès partenaire, par organisation. Un simple e-mail technique ne suffit pas : il créerait un faux dossier client portant tous les rapports.
- **La route `/dossier-batiment` du corpus peut être enrichie** (Python, VPS, troisième surface de livraison) si la mesure du §9 montre que ses champs ne suffisent pas à distinguer deux logements d'un immeuble ou à comparer l'adresse : étage et complément d'adresse par DPE, libellé et score du géocodage. Ajouts seulement, aucun champ retiré (le site la consomme).
- **Droit d'usage** : tout membre qui peut modifier la fiche client (`clients.edit`) peut chercher, rattacher et ouvrir. Pas de nouvelle ressource dans le registre des droits.
- **Un seul DPE par client.** Un client à plusieurs logements n'est pas traité.
- **Aucune écriture d'adresse côté MonsieurDPE** : la porte partenaire ne reçoit que le numéro. La promesse « adresse jamais conservée » du site reste vraie.
- **« Investiguer » inchangé**, y compris son propre remplissage éventuel du numéro.

## 8. Contraintes

- **Deux dépôts, deux jeux de règles.** Dépôt DPE : code et commentaires en français, `npm run verifier` avant commit, jamais de push sans accord explicite d'Eric, la migration s'applique avant le code qui l'utilise. Dépôt Majord'home : charte multi-tenant de `CLAUDE.md`.
- **Deux projets Supabase distincts** : Majord'home (`ejqqqwudmizqisdkxohw`) et le projet qui porte `dpe` (`odspcxgafcqxjzrarsqf`). Aucun accès direct d'une base à l'autre : tout passe par HTTP.
- **Open3CL (GPL)** n'est pas concerné : rien n'est recalculé ici.
- Ordre de livraison : porte partenaire d'abord (dépôt DPE), puis edge function et écran (Majord'home).

## 9. Première étape du plan : mesurer

Avant d'écrire l'écran, mesurer sur un échantillon de clients Mayer (une cinquantaine, adresses réelles, lecture seule) :

- la part d'adresses que `/dossier-batiment` rattache à un bâtiment ;
- la part qui rend au moins un DPE, et combien en rendent plusieurs ;
- les champs réellement rendus par DPE (pour dessiner la liste de confirmation) ;
- le temps de réponse.

La mesure est lancée par le constructeur, depuis le poste d'Eric : l'URL et le secret du corpus sont dans `C:\Dev\DPE\site\.env.local` (ne jamais afficher la valeur), les adresses se lisent en base Majord'home en lecture seule. Les adresses ne sont écrites nulle part.

Si le taux de rattachement est faible, le repli (§5.4) devient le chemin principal et l'écran se dessine en conséquence. Le résultat de la mesure est rapporté à Eric avant de continuer.

## 10. Laissé au constructeur

- Nom définitif de l'edge function, des secrets et de la table.
- Forme exacte de l'écran (panneau dans le bloc Logement ou fenêtre), dans les composants existants.
- Champs affichés par DPE, d'après la mesure du §9.
- Tests : module pur pour la mise en forme des résultats et la traduction des erreurs, assertions du harnais de répétition pour la migration.

## 11. Critères de réussite

- Sur une fiche Mayer dont l'adresse est connue de la BDNB : recherche, confirmation, enregistrement, puis ouverture du rapport complet MonsieurDPE sans compte ni paiement.
- Un second clic sur « Analyse MonsieurDPE » n'émet rien de nouveau (une seule ligne des deux côtés).
- Le lien obtenu n'ouvre aucun autre dossier.
- Le rapport ouvert par ce lien ne montre aucune entreprise RGE et ne compte aucune apparition ; un rapport acheté par le public reste inchangé.
- Module fermé : aucun bloc, et l'edge function refuse.
- Un membre d'une autre organisation ne peut ni lire le jeton ni émettre un accès pour ce client.
- Corpus coupé : message clair à l'écran, rien d'enregistré.
