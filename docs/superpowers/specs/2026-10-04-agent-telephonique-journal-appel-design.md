# Agent téléphonique — journal d'appel et demande de rappel

> Statut : **SPEC À VALIDER** (2026-10-04). Aucun code écrit.
> Suite de `2026-10-04-agent-telephonique-verifier-client-design.md` (livré) et
> `2026-10-04-agent-telephonique-creneaux-design.md` (livré).
> Agent ElevenLabs `agent_3101m42037pbepbvh52d81h8nn8w` (« Claire », Mayer Énergie), prompt v9.

## 1. Le problème

L'agent conclut chaque appel par « l'équipe vous rappelle » — pour une panne, un devis, un
entretien non réservé, un nouveau client. **Rien ne tient cette promesse** : ce que l'agent a
collecté reste dans l'historique ElevenLabs, que personne chez Mayer ne consulte. Seul un
entretien réservé par `reserver_creneau` arrive dans Majord'home (RDV au planning).

Critère de succès : après un appel test « panne, nouveau client », une ligne apparaît dans
Majord'home en moins d'une minute, avec le motif, le nom, la commune, le numéro de rappel, un
résumé lisible, marquée « à rappeler » et prioritaire ; quelqu'un la traite (« rappelé ») et la
trace reste. Le même appel rejoué (webhook renvoyé deux fois) ne crée pas de doublon.

## 2. Principe : le journal EST la boîte de réception

| | Créer directement leads / tâches / cartes SAV (écarté) | Journal d'appel à traiter (retenu) |
|---|---|---|
| Qui décide de la suite | la machine, sur la foi d'une transcription | un humain, d'un clic |
| Doublons | risque réel (cf. DURAND / GOTTARDI, 2026-09-16) | aucun : rien n'est créé sans geste |
| Appel raccroché à mi-chemin | données partielles injectées partout | une ligne « incomplet », visible |
| Ce qui reste à construire | 3 intégrations (leads, tâches, SAV) | 1 table, 1 écran, 1 edge |

**Conflit surfacé, tranché** : CLAUDE.md pose « un flux serveur ne crée JAMAIS de lead » (Eric,
2026-09-16). Un devis demandé à l'agent ne crée donc **pas** de lead : il arrive dans le journal,
et le bouton « Créer le lead » passe par le filet `findPotentialDuplicates` comme toute création
depuis l'UI. Même logique pour la panne (« Créer la carte SAV ») — en V2, pas en V1.

## 3. Flux

1. L'appel se termine (raccroché, fin normale, coupure).
2. ElevenLabs envoie le **webhook post-appel** (`post_call_transcription`) à l'edge
   `agent-appel-termine`, avec l'analyse de l'appel (résumé, champs extraits — § 4).
3. L'edge vérifie la signature, résout l'org depuis l'`agent_id`, enregistre une ligne
   `majordhome.agent_appels` (idempotent sur `conversation_id`) et la rattache à ce que l'appel a
   déjà produit en base : client vérifié (`agent_verifications`), RDV posé (`auto_rdv:agent`).
4. Statut initial calculé :
   - entretien **réservé** pendant l'appel → `traite` (rien à faire, la ligne sert de trace) ;
   - appel sans numéro de rappel ni nom (raccroché d'emblée, test) → `sans_suite` ;
   - tout le reste → `a_rappeler`, **prioritaire** si motif = panne.
5. Notification (si réglée) : e-mail à l'adresse de l'org pour chaque `a_rappeler` prioritaire
   (panne), via `_shared/mail.ts` (§ 8).
6. Écran « Appels » : liste à traiter, un humain rappelle, note, clôt.

Pas d'outil supplémentaire pendant l'appel : le webhook post-appel part même quand l'appelant
raccroche avant la fin, ce qu'un outil `enregistrer_demande` appelé par le modèle ne garantit pas
(il dépend du modèle et d'une fin d'appel propre). Aucun ajout de latence en ligne.

## 4. Ce que l'agent extrait (« data collection » ElevenLabs)

Champs déclarés sur l'agent (`platform_settings.data_collection`, vide aujourd'hui), extraits
APRÈS l'appel par le modèle d'analyse (`analysis_llm` = gemini-2.5-flash, non facturé) à partir
de la transcription :

| Champ | Type | Description donnée au modèle |
|---|---|---|
| `motif` | enum `entretien` `panne` `devis` `autre` | catégorie retenue à l'étape 1 |
| `nom` | string | nom de famille, orthographe épelée |
| `prenom` | string | si donné |
| `commune` | string | |
| `adresse` | string | numéro et voie ou lieu-dit |
| `telephone_rappel` | string | chiffres seuls, tel que confirmé |
| `equipement` | string | mots du client |
| `combustible` | string | chaudière seulement |
| `sans_chauffage` | boolean | panne : logement sans chauffage ou sans eau chaude |
| `code_erreur` | string | panne |
| `projet` | string | devis : installation / remplacement / autre |
| `creneau_souhaite` | string | entretien non réservé : jour et demi-journée en toutes lettres |
| `demande_libre` | string | motif « autre », ou toute demande annexe (déplacer un RDV…) |

Plus, fournis par ElevenLabs sans configuration : `transcript_summary` (résumé), `call_summary_title`,
`call_successful`, `metadata.call_duration_secs`, `metadata.termination_reason`, et le numéro
appelant quand l'appel vient de Twilio (`metadata.phone_call`, absent des tests web actuels).

⚠️ L'extraction est faite par un modèle : un champ peut être faux ou vide. L'écran affiche donc
toujours le **résumé** à côté des champs, et le **lien vers l'enregistrement** ElevenLabs pour
lever un doute. Le numéro appelant Twilio (quand il existe) est affiché à côté du numéro extrait.

## 5. Changements base

### Table `majordhome.agent_appels`
`id, org_id (core), conversation_id UNIQUE, agent_id, debut_at, duree_secondes, fin_raison,
numero_appelant (Twilio, NULL sinon), motif, prioritaire bool, donnees jsonb (champs § 4),
resume text, titre text, client_id NULL (seulement si vérifié DANS l'appel), appointment_id NULL
(RDV posé par l'agent dans l'appel), statut (a_rappeler | en_cours | traite | sans_suite),
traite_par uuid NULL, traite_at NULL, note_traitement text, created_at, updated_at`.

- RLS activée. Lecture : membres ayant `role_can(org, 'appels', 'view')`. Aucune écriture directe.
- `GRANT SELECT … TO service_role` (vue `security_invoker`, règle CLAUDE.md).
- Vue `public.majordhome_agent_appels` (`security_invoker=true`), lecture seule.
- `org_id` = org **CORE** (comme `agent_verifications`).

### RPC
- `public.agent_appel_enregistrer(p_org_id, p_payload jsonb)` — SECURITY DEFINER,
  `REVOKE FROM PUBLIC, anon, authenticated` (prend `org_id`), `INSERT … ON CONFLICT
  (conversation_id) DO NOTHING`, rattache `client_id` depuis `agent_verifications`
  (dernière `verifie = true` de la conversation) et `appointment_id` (RDV `source = 'auto_rdv:agent'`
  posé pendant l'appel — cf. § 10, question du lien).
- `public.agent_appel_traiter(p_appel_id, p_statut, p_note)` — SECURITY DEFINER, garde POSITIVE
  `IF auth.uid() IS NULL THEN refuser` puis `IF majordhome.role_can(org, 'appels', 'edit') IS NOT TRUE
  THEN refuser`, `REVOKE FROM PUBLIC, anon`. Écrit `traite_par = auth.uid()`, `traite_at`.

### Droits
Nouvelle ressource `appels` dans `src/lib/permissionsRegistry.js` (view / edit), défauts régénérés
(`gen-app-role-permissions-sql.mjs`), proposition : `team_leader` et `Commercial` view+edit,
technicien rien. Mesuré par `permissions-coherence.mjs`.

Migration versionnée, répétée sur `scripts/migration-rehearsal/` (étendre `snapshot.mjs` à la
nouvelle table), droits vérifiés par `has_function_privilege` / `has_table_privilege`.

## 6. Edge `agent-appel-termine`

- `verify_jwt = false` (`config.toml`) : webhook TIERS légitime → **vérification de signature
  ElevenLabs** (en-tête `ElevenLabs-Signature: t=…,v0=…`, HMAC-SHA256 de `"{t}.{corps brut}"`,
  comparaison `timingSafeEqual`, horodatage refusé au-delà de 30 min), secret
  `MDH_ELEVENLABS_WEBHOOK_SECRET` (distinct de `MDH_VOICE_AGENT_SECRET`). À confirmer sur la doc
  ElevenLabs au moment du code : format exact de l'en-tête.
- Org résolue depuis `agent_id` (`_shared/agentOrg.ts`), jamais du corps. Agent inconnu → 200
  sans écriture + log (un 4xx ferait réessayer ElevenLabs indéfiniment).
- Ne garde du payload QUE le § 4 + métadonnées : **la transcription complète n'est pas stockée**
  dans Majord'home (elle reste chez ElevenLabs, sous leur rétention — § 9).
- Lit `{ error }` de chaque écriture, répond 5xx si l'enregistrement échoue (ElevenLabs réessaie ;
  l'idempotence absorbe le doublon).
- Statut initial et priorité calculés par un **module pur** `src/lib/agentAppels.js`
  (`statutInitial(donnees, { rdvPose })`, `estPrioritaire(donnees)`), copié pour Deno par
  `sync:tournee-engine`, testé `node --test scripts/agent-appels.test.mjs` (dans `audit:quality`).

Côté ElevenLabs : webhook post-appel déclaré au niveau du workspace (aujourd'hui
`workspace_overrides.webhooks.events = ["transcript"]`, destination à vérifier) et rattaché à
l'agent. **Modification de config de l'agent → soumise à Eric avant application.**

## 7. Écran « Appels »

Route `/appels` (RouteGuard `resource="appels"`), entrée de sidebar avec pastille du nombre
`a_rappeler` (prioritaires en ambre — palette sans rouge/vert).

- Liste : date/heure (Paris), motif, nom + commune, numéro (cliquable `tel:`), titre, badge
  « client reconnu » / « RDV posé », statut. Filtre par défaut : à rappeler + en cours.
- Détail (tiroir) : résumé, champs extraits, lien « écouter l'appel » (ElevenLabs), fiche client
  liée si vérifié ; sinon **fiches portant ce numéro** (lecture humaine, pas d'auto-rattachement —
  l'agent n'a pas pu vérifier, un humain peut).
- Actions : « En cours », « Traité » (+ note), « Sans suite ». V1 seulement. V2 : « Créer le
  lead » (filet doublons), « Créer la carte SAV », « Rattacher à la fiche ».
- Hooks/services conformes (cache key `agentAppelKeys.all(orgId)`, `unwrapResult` sur les
  mutations).

## 8. Notification

Réglage `settings.telephonie.notification = { email: '…', motifs: ['panne'] }`, édité dans
Settings → Communication → Agent téléphonique (écran existant `/settings/telephonie`). Vide = aucune
notification. E-mail sobre (motif, nom, commune, numéro, résumé, lien vers l'appel dans
Majord'home) via `_shared/mail.ts`, gate `moduleActif(settings, 'communication')`. Un échec
d'envoi est journalisé, n'empêche jamais l'enregistrement.

## 9. RGPD

- Le premier message annonce l'enregistrement (déjà en place).
- Majord'home ne stocke ni audio ni transcription : résumé + champs.
- ElevenLabs conserve aujourd'hui **sans limite** (`retention_days: -1`) : passer à 90 jours
  (déjà noté comme point ouvert) — **modification de config, à valider par Eric**.
- Purge des lignes `sans_suite` / `traite` au-delà de N mois : à décider (proposition : 24 mois,
  aligné sur la prescription commerciale courante) — hors V1.

## 10. Questions ouvertes (à trancher par Eric)

1. **Où arrive la demande** : journal dédié (proposé) ou tâches existantes (`/tasks`, 17 lignes,
   peu utilisées, sans champs structurés ni lien client) ?
2. **Qui voit les appels** : défauts proposés team_leader + Commercial ; un technicien d'astreinte
   devrait-il voir les pannes ?
3. **Notification** : e-mail pour les pannes seulement, ou pour toute demande ? Un SMS vers un
   portable d'astreinte pour une panne « sans chauffage » ?
4. **Lien RDV ↔ appel** : `auto_rdv_poser` n'enregistre pas la conversation. Rattacher par
   « RDV `auto_rdv:agent` du client vérifié, créé pendant l'appel » (pas de migration de la RPC),
   ou ajouter `p_conversation_id` à la pose (plus sûr, re-signature de la RPC) ?
5. **Appels « sans suite »** : seuil (pas de numéro ET pas de nom ? durée < 20 s ?).

## 11. Hors périmètre

- Création automatique de lead / carte SAV / tâche (cf. § 2) — boutons humains en V2.
- Webhook de DÉBUT d'appel (heure de Paris, numéro appelant injecté au modèle) — avec Twilio.
- Rappel sortant automatique, SMS de confirmation au client.
- Communes par org (toujours figées Mayer dans le prompt et l'ASR).

## 12. Livraison (après validation)

1. Migration table + vue + RPC + droits, répétée, appliquée, droits vérifiés.
2. Module pur + tests ; edge `agent-appel-termine` ; `config.toml`.
3. Écran `/appels` + sidebar + réglage notification.
4. Secret `MDH_ELEVENLABS_WEBHOOK_SECRET` (Eric) ; data collection + webhook post-appel déclarés
   sur l'agent (soumis à Eric).
5. Test : rejouer le webhook d'une conversation existante (sans crédit d'appel) avec un payload
   signé localement, puis un appel réel quand les crédits le permettront.
