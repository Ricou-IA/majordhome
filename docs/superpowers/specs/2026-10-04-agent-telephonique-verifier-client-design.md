# Agent téléphonique — outil `verifier_client` (edge function)

> Statut : **TRANCHE 1 LIVRÉE** (2026-10-04) — migration `20261004_1` en prod, edge
> `agent-verifier-client` déployée. Reste à faire par Eric : secret, identifiant d'agent dans
> Settings, outil déclaré sur l'agent + prompt v8 (cf. §11).
> Agent ElevenLabs `agent_3101m42037pbepbvh52d81h8nn8w` (« Claire », Mayer Énergie), prompt v7.
> Décision Eric 2026-10-04 : les outils de l'agent passent par une **edge function Supabase**, pas par N8N.

## 1. Objectif

Permettre à l'agent de reconnaître un client existant **sans jamais lui donner accès à la fiche**.
L'agent transmet ce que l'appelant a dit ; la comparaison se fait côté serveur ; l'agent reçoit
un verdict et, seulement si le client est vérifié, de quoi personnaliser l'appel (équipements,
dernier entretien, contrat actif).

Critère de succès : un appel test où l'appelant donne le nom, la commune, l'adresse et le numéro
d'un client réel → l'agent cite son équipement ; le même appel avec un numéro faux → l'agent le
traite comme un nouveau client sans rien révéler. Les deux tentatives tracées en base.

## 2. Principe : la fiche ne quitte jamais le serveur

| | Fiche renvoyée à l'agent (écarté) | Verdict côté serveur (retenu) |
|---|---|---|
| Ce que voit le modèle | adresse, téléphone, homonymes | `verifie: oui/non` |
| Règle RGPD / anti-usurpation | tenue par le prompt (contournable) | tenue par construction |
| Homonymes | l'agent sait qu'ils existent | invisibles |
| Transcriptions ElevenLabs | contiennent les données de la fiche | ne contiennent que ce que l'appelant a dit |

Conséquence : **aucun « oracle »**. Un échec ne dit jamais pourquoi (nom inconnu, adresse fausse,
téléphone faux) — sinon un appelant malveillant pourrait deviner les champs un par un.

## 3. Flux d'appel (changement de prompt associé)

Aujourd'hui (v7) : nom → recherche → adresse → téléphone → comparaison par l'agent.
Cible : l'agent collecte **nom, commune, adresse, téléphone**, puis appelle l'outil **une seule
fois** avec les quatre. Plus de branche « plusieurs fiches portent le même nom, demande la
commune » : le serveur départage seul.

- `verifie: true` → l'agent peut confirmer l'équipement et le dernier entretien.
- `verifie: false` → l'agent continue comme pour un nouveau client, sans commentaire.
- Outil en erreur / délai dépassé → idem `false` (l'appel ne doit jamais bloquer).

Le prompt v8 correspondant sera soumis à part, une fois l'edge en place.

## 4. Mesures en base (Mayer, 2026-10-04)

- 3 486 clients actifs ; 89 sans téléphone, 92 sans adresse → jamais vérifiables par l'agent (traités en nouveaux clients).
- **296 noms de famille partagés**, jusqu'à **67 fiches pour un même nom** → le nom seul ne départage pas ; nom + commune réduit à une poignée de candidats.
- Formats de téléphone hétérogènes en base : `+33 6 …`, `06 12 34 56 78`, `612345678` (zéro perdu à l'import), `0612345678` → normalisation obligatoire.
- `pg_trgm` absent ; `unaccent` et `fuzzystrmatch` (levenshtein) présents.

## 5. Contrat de l'outil

**Edge** : `agent-verifier-client`, `verify_jwt: false` (appelée par ElevenLabs, pas par un utilisateur).

**Entrée** (corps JSON, rempli par l'agent) :
```json
{ "nom": "Pudebat", "commune": "Gaillac", "adresse": "7 bis route des Bardis", "telephone": "06 86 26 98 09" }
```
+ deux valeurs injectées par la plateforme (variables système, pas par le modèle) :
`conversation_id` (`{{system__conversation_id}}`), `agent_id` (`{{system__agent_id}}`).

**Sortie** :
```json
{ "verifie": true,
  "equipements": ["chaudière à granulés Okofen"],
  "dernier_entretien": "2026-04-08",
  "contrat_actif": true }
```
ou `{ "verifie": false }`. Jamais d'identifiant client, jamais d'adresse ni de téléphone en sortie.

## 6. Règle de correspondance (module PUR testé)

Module `src/lib/agentTelephonique.js` (pur, JSDoc, copié pour Deno par `npm run sync:tournee-engine`
→ `_shared/agentTelephonique.js`), testé `node --test scripts/agent-telephonique.test.mjs` (dans
`audit:quality`).

**Changement à l'implémentation : les candidats sont cherchés par TÉLÉPHONE, pas par nom + commune.**
Mesure en prod : un numéro est porté par au plus **5 fiches** (53 numéros partagés : couples,
doublons), contre 67 fiches pour un même nom. Le téléphone est la clé la plus discriminante, et
la comparaison se fait en SQL sur des chiffres, sans dépendre d'`unaccent` dans la RPC.

1. **Candidats** (RPC) : clients non archivés de l'org dont `phone` **ou** `phone_secondary`,
   normalisé en 10 chiffres (`+33`/`0033` → `0`, 9 chiffres → `0` préfixé), égale le numéro dit.
2. **Nom** : égal une fois normalisé (accents, casse, tirets), ou à une lettre près à partir de
   5 lettres. **Commune** : idem, avec « St » ≡ « Saint » et tirets ignorés.
3. **Adresse** : normalisée (abréviations `rte`/`av`/`bd`/`ch`/`imp`…, `bis`/`ter`, accents).
   Correspond si le **numéro de voie est identique** et que le **nom de voie** est proche
   (levenshtein relatif ≤ 20 %). Exemple réel : « route des Bardis » (dit) ↔ « Route des Bardys » (base).
4. **Vérifié** si un et **un seul** candidat passe téléphone **et** adresse. Deux candidats qui
   passent (doublon de fiche) → `false` (on ne choisit pas au hasard ; trace en base pour nettoyage).

## 7. Sécurité (charte multi-tenant)

- **Secret dédié** `MDH_VOICE_AGENT_SECRET` (pas `MDH_CRON_SECRET` : une fuite de l'un n'ouvre pas
  l'autre), envoyé par ElevenLabs en `Authorization: Bearer …` (secret stocké côté ElevenLabs),
  vérifié par `requireSharedSecret` de `_shared/auth.ts`.
- **L'org n'est jamais lue dans le corps de la requête.** Elle est résolue côté serveur depuis
  `agent_id` : `core.organizations.settings.telephonie.elevenlabs_agent_id`. Un agent_id inconnu → 403.
  Règle « pas de config sans UI » : ajouter le champ dans Settings → Communication avant de le
  consommer (petit onglet « Agent téléphonique »).
- **RPC** `public.agent_verifier_client_candidats(p_org_id, p_conversation_id, p_telephone)` et
  `public.agent_verification_enregistrer(...)` SECURITY DEFINER,
  `SET search_path = majordhome, public`, `REVOKE … FROM PUBLIC, anon, authenticated` (prend `org_id`
  en paramètre → service_role only), effet vérifié par `has_function_privilege`.
- **Limite de tentatives** : 3 appels par `conversation_id` ; au-delà → `false` sans calcul.
- **Pas de SQL dynamique**, pas de passage par le workflow N8N « SQL Proxy - Claude ».

## 8. Traçabilité

Table `majordhome.agent_verifications` : `id, org_id, conversation_id, agent_id, verifie,
client_id (NULL si non vérifié), nb_candidats, motif_echec (texte interne : nom_inconnu |
telephone | adresse | doublon | limite), created_at`. RLS activée, SELECT `org_admin` seul,
aucune écriture front (écrite par l'edge en service_role). `motif_echec` reste en base et ne
remonte **jamais** à l'agent.

Elle sert à : la limite de tentatives, le rattachement futur du journal d'appel au client, et la
mesure du taux de reconnaissance pendant les tests.

## 9. Performance

Une requête RPC + un calcul en mémoire, cible < 500 ms. Au-delà de 4 s, ElevenLabs bascule sur le
modèle de secours (constaté en test le 2026-10-04) : l'outil doit rester très en dessous.

## 10. Hors périmètre de cette tranche (signalé, pas oublié)

- **Webhook d'initiation d'appel** (Twilio) : injecte l'heure de Paris (le réglage `system__timezone`
  est ignoré par ElevenLabs) et le numéro appelant. Nécessite le numéro Twilio → tranche 2.
- **Journal d'appel + création de la demande dans Majord'home** : aujourd'hui, ce que l'agent
  collecte **ne va nulle part** — le « l'équipe vous rappelle » n'est tenu par rien. Webhook
  post-appel ElevenLabs → edge → lead / tâche de rappel. **C'est le vrai prérequis production**
  avec cet outil → tranche 3, à cadrer juste après.
- `proposer_creneaux` / `reserver` : dépendent du moteur de tournées (`slots-propose`), plus tard.
- Liste des communes par org (aujourd'hui figée Mayer dans le prompt et l'ASR).

## 11. Livraison

1. ✅ Migration `20261004_1` (table + RPC + REVOKE), répétée (`assert-agent-verifier-client.sql`),
   appliquée en prod ; droits effectifs vérifiés par `has_function_privilege` (anon/authenticated
   refusés, service_role autorisé).
2. ✅ Module pur + 8 tests.
3. ✅ Edge `agent-verifier-client` déployée (`verify_jwt = false`, `config.toml`) ; sans secret elle
   répond 500 « MDH_VOICE_AGENT_SECRET not configured » (fermée par défaut).
4. ✅ Écran Settings → Communication → Agent téléphonique (`/settings/telephonie`).
5. ⏳ Secret `MDH_VOICE_AGENT_SECRET` (Eric, console Supabase + secret ElevenLabs).
6. ⏳ Identifiant d'agent saisi dans l'écran (Eric).
7. ⏳ Outil webhook déclaré sur l'agent ElevenLabs + prompt v8 (soumis à validation).
8. ⏳ Appels tests : client réel vérifié / numéro faux / numéro partagé / adresse mal transcrite.
