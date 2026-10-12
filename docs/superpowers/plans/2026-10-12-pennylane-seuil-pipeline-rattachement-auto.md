# Seuil pipeline = réglage d'org, rattachement automatique du premier devis (2026-10-12)

Décision Eric (2026-10-12, après l'incident ROZIÈRES) :
- **Seuil = réglage d'org** (`settings.pennylane.pipeline_min_amount_ht`, défaut 500 € HT).
- **Au-dessus = chantier = rattachement automatique à la carte lead active du client.**
- **En dessous = rattachement manuel** (explorateur `/devis`, Rattacher / Écarter), rien n'est fait tout seul.
- **Évolution (plus tard)** : fléchage vers la carte SAV quand la carte SAV portera le lien vers le devis Pennylane.

## Constat

Le cron 15 min `pennylane-sync-quote-status` rattache déjà les devis **suivants** d'un client (étape 5,
`autoAttachNewQuotes`) mais ne considère un client « ponté » que s'il a **déjà un devis rattaché** :
le **premier** devis d'un client n'est jamais traité. Le cron horaire `pennylane-sync-cron` ne regarde
que les clients Pennylane **nouveaux** (absents de `pennylane_sync`) : ROZIÈRES a été ponté à 08:00
sans devis, ses devis de 08:26 et 10:20 sont restés « Non rattaché » 12 h. Dry-run en prod le
2026-10-12 : la nouvelle règle rattacherait exactement ces 2 devis, rien d'autre.

Le seuil 500 existe en 4 copies (`src/lib/constants.js` + 3 edges) ; le cron 15 min ignore les
devis **écartés** (`pennylane_quote_dismissals`).

## Livraison

1. **Migration `20261012_5`** (répétée sur le harnais, `assert-pennylane-auto-attach.sql`) :
   - `majordhome.pl_pipeline_min_amount_ht(org)` : lit le réglage, défaut 500.
   - `majordhome.find_active_lead(org, client_id, email, phone)` : la recherche de carte active
     (email → téléphone → client ponté) sortie d'`upsert_pennylane_lead`, qui l'appelle désormais.
   - `public.pennylane_sync_auto_attach_pending(org, dry_run)` (service_role only) : candidats =
     miroir non disparu, non archivé, statut du périmètre, montant ≥ seuil, **aucune** ligne
     `lead_pennylane_quotes` (éjecté compris), **pas écarté** ; carte = pont par devis déjà rattaché,
     sinon `find_active_lead` (client via `pennylane_sync`, contact via `pennylane_customer_lookup`) ;
     rattache via `pennylane_sync_auto_attach_quote` (existant). Sans carte active : rien (`no_lead`).
   - `pennylane_sync_update_quote_fields` : `p_pipeline_min_ht` NULL ⇒ réglage d'org.
2. **Edge `pennylane-sync-quote-status`** : l'étape 5 appelle la RPC (une requête, zéro boucle),
   avant le retour anticipé « aucun devis rattaché » (sinon la 1ʳᵉ carte d'une org neuve ne
   s'attache jamais). Constante supprimée.
3. **Edges `pennylane-sync-cron` / `pennylane-backfill-quotes`** : seuil lu dans les settings de l'org.
4. **Front** : `pennylanePipelineMinAmountHt(settings)` (`useOrgSettings.js`) consommé par
   `QuoteCandidatesModal` et l'explorateur (`usePennylane.js`) ; champ « Seuil pipeline (€ HT) »
   dans Settings → Facturation Pennylane, section Intégration (objet `pennylane` complet au save).
5. Vérification : harnais vert, `npm run lint:errors`, `npx vite build`, `deno check` des 3 edges,
   migration appliquée en prod, edges déployées, puis `pennylane_sync_auto_attach_pending` en dry-run
   sur Mayer = les 2 devis ROZIÈRES.
