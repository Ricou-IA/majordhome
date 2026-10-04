# Agent téléphonique — proposer et poser un créneau d'entretien

> Statut : **SPEC À VALIDER** (2026-10-04). Aucun code écrit.
> Suite de `2026-10-04-agent-telephonique-verifier-client-design.md` (outil `verifier_client`, livré).
> Décisions Eric 2026-10-04 : (1) ouvrir un créneau à la date demandée, au-delà du mois et sur
> une journée sans secteur — OK ; (2) synchro Google Agenda — pas prioritaire (« ils utilisent
> Majord'home ») ; (3) verrou contre deux poses simultanées — « on n'en est pas là ».

## 1. Objectif

Un client reconnu par `verifier_client`, sous contrat actif, qui appelle pour son entretien,
repart avec un RDV **posé dans le planning** :
1. l'agent propose d'abord **ce qui arrange nos tournées** (2-3 demi-journées) ;
2. si rien ne convient, il demande une date au client et **ouvre un créneau** ce jour-là ;
3. le choix du client est posé dans le planning, la carte d'entretien passe « Planifié ».

Critère de succès : appel test d'un client sous contrat sans RDV → RDV visible au planning
(bon technicien, bonne demi-journée, carte « Planifié », source « agent ») ; même appel en
demandant une date hors propositions → RDV posé à cette date ; appel d'un client non reconnu →
aucun outil de créneau n'aboutit.

## 2. Principe : réutiliser le moteur de la page client, pas en écrire un troisième

| | Page client `/rdv/:token` (existant) | Agent (cible) |
|---|---|---|
| Accès | jeton HMAC par contrat | secret `MDH_VOICE_AGENT_SECRET` + client vérifié DANS l'appel |
| Proposition | `creneauxPourContrat` (demi-journées, journées à secteur) | idem |
| Fenêtre | J+`delai_min_jours` → fin du mois (prolongée) | idem ; **date demandée : jusqu'à `horizon_ouverture_jours` (45)** |
| Journée sans secteur | jamais proposée | **proposée uniquement sur date demandée** |
| Pose | RPC `auto_rdv_poser` | même RPC, source `auto_rdv:agent`, borne de date élargie |

Moteur pur = `src/lib/tournee/auto-rdv.js` (copié pour Deno). Le **chargement du contexte**
(`charger`, `trajetPour`, `rdvDejaPris` de `supabase/functions/auto-rdv/index.ts`) est extrait
dans `_shared/autoRdvContexte.ts` et importé par les deux edges — pas de copie.

## 3. Sécurité : l'agent ne désigne jamais le client

- Les outils ne prennent **aucun identifiant client ni contrat** du modèle. L'edge relit
  `majordhome.agent_verifications` : dernière tentative `verifie = true` pour
  (`org_id`, `conversation_id`). Aucune → refus `client_non_verifie`.
- Org résolue depuis `agent_id` comme pour `verifier_client` (jamais du corps).
- Contrat = contrat **actif** du client (un par client, `contracts_client_id_key`). Aucun →
  `pas_de_contrat` : l'agent repasse en « l'équipe vous rappelle ».
- RDV déjà à venir (`rdvDejaPris`) → `rdv_existant` : pas de second RDV posé par l'agent.

## 4. Outils de l'agent

### `proposer_creneaux`
Entrée (modèle) : `date_souhaitee` optionnelle (AAAA-MM-JJ), `periode` optionnelle
(`matin` | `apres_midi`). Injectés : `conversation_id`, `agent_id`.
- **Sans date** : propositions du moteur sur la fenêtre de la page client, les 3 meilleures,
  présentées dans l'ordre chronologique.
- **Avec date** : uniquement ce jour-là, journées à secteur **et** journée vide d'un technicien
  compétent (`techniciensEligibles`, rôle `entretien`) ; refus si la date est hors
  [J+`delai_min_jours`, J+`horizon_ouverture_jours`], un dimanche ou une journée figée.
Sortie : `{ creneaux: [{ id, jour: "jeudi 15 octobre", demi: "matin", plage: "entre 8 h et 12 h" }] }`
ou `{ creneaux: [], raison: "aucun_creneau" | "date_hors_horizon" | ... }`. L'`id` est opaque :
l'edge garde le détail (date, technicien, empreinte, décalages) côté serveur (§6).

### `reserver_creneau`
Entrée : `creneau_id` (renvoyé par `proposer_creneaux` dans le même appel).
L'edge relit la proposition, **recalcule** le placement (`placerParSequencement`) et appelle
`auto_rdv_poser` (empreinte, décalages). Sortie : `{ reserve: true, jour, demi, plage }` ou
`{ reserve: false, raison }` (`journee_modifiee` → l'agent repropose).

## 5. Changements base

- `auto_rdv_poser` : nouveau paramètre `p_date_max date DEFAULT NULL`. NULL = borne actuelle
  (fin du mois prolongée, page client inchangée) ; renseigné (agent seulement, service_role)
  = borne maximale imposée par l'edge (J+45). Signature remplacée proprement (DROP de
  l'ancienne + CREATE), droits re-posés et vérifiés par `has_function_privilege`.
- `majordhome.agent_propositions` (id opaque, org, conversation, contrat, détail jsonb,
  expire_at 30 min) : les créneaux proposés vivent côté serveur, l'agent ne manipule qu'un id.
  RLS, aucun accès front, service_role seul.

## 6. Prompt (v9, soumis à part)

- Après `verifie: true` : si `prochain_rdv` existe, le citer (« Je vois un entretien prévu
  vendredi 16 octobre vers 8 h 30, c'est à ce sujet ? ») et ne rien poser.
- Entretien + contrat actif + pas de RDV : `proposer_creneaux` sans date → lire 2-3 créneaux
  → si refus, demander une date (et matin/après-midi) → `proposer_creneaux` avec date →
  confirmation → `reserver_creneau` → récapitulatif « c'est réservé ».
- Échec ou hors périmètre : comportement actuel (« l'équipe vous rappelle »).

## 7. Hors périmètre (signalé)

- Synchro Google Agenda des RDV posés par le serveur (page client ET agent) — décision Eric : pas prioritaire.
- Verrou contre deux poses simultanées sur la même journée — décision Eric : plus tard.
- Pannes / devis / nouveaux clients : journal d'appel + demande de rappel (tranche suivante).
- Webhook de début d'appel (heure de Paris, numéro appelant) — avec le numéro Twilio.
