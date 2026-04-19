# Mayer — Lead Bienvenue (Cron 10 min) — Guide d'installation

> Workflow N8n qui, toutes les 10 minutes, détecte les nouveaux leads en statut **Nouveau** avec email, et déclenche l'envoi du mail de bienvenue via le workflow existant `Mayer - Mailing`.

## Principe

- **Source unique** : quelle que soit l'origine du lead (saisie manuelle, formulaire web, Meta), tout lead passé en `Nouveau` avec un email valide reçoit le mail de bienvenue.
- **Déclenchement** : cron toutes les 10 min. Latence max ~10 min entre création lead et envoi mail.
- **Idempotence** : le segment `leads_nouveau` exclut tout lead déjà présent dans `mailing_logs` pour cette campagne → pas de doublon même si le cron tourne plusieurs fois.
- **Skip silencieux** si lead sans email, désinscrit, ou campagne vide (subject/html_body non définis).

## Prérequis

### 1. Segment côté app

Le segment `leads_nouveau` existe dans `src/apps/artisan/components/mailing/segments.js` :

```sql
SELECT l.id, l.first_name, l.last_name, l.first_name AS display_name, l.email
FROM majordhome.leads l
WHERE l.status_id = 'ea926b9a-521c-4012-a60b-85b6f7e5c09c'  -- Nouveau
  AND l.email_unsubscribed_at IS NULL
  AND l.email IS NOT NULL AND l.email != ''
  AND l.id NOT IN (SELECT lead_id FROM majordhome.mailing_logs WHERE lead_id IS NOT NULL AND campaign_name = '{{CAMPAIGN_NAME}}')
ORDER BY l.created_at ASC
```

### 2. Campagne `lead_bienvenue` créée via l'Éditeur

1. Mailing → onglet **Éditeur** → **+ Nouvelle campagne**
2. Étape 1 (Identité) :
   - Libellé : `Bienvenue — Nouveau lead` (clé technique auto : `lead_bienvenue`)
   - Contexte : « Mail d'accueil envoyé automatiquement dès qu'un lead arrive en statut Nouveau, avant le premier appel commercial. Objectif : ferrer le prospect, montrer le sérieux, renvoyer vers les outils/blog. »
   - Ton : **Chaleureux / humain** ou **Premium / soigné**
   - Ciblage technique : cocher **Leads — Nouveau (bienvenue)**
3. Étape 2 (Brief) : ligne éditoriale libre (ex : « Remercier, présenter brièvement Mayer en 3 valeurs, pousser simulateur MaPrimeRénov' + 1-2 articles blog, annoncer un appel du technicien sous 24h, signature chaleureuse »).
4. Étape 3 (Génération) : copier le prompt → Claude → coller le HTML dans la textarea → **Sauvegarder**.

### 3. Credentials N8n

- `Header Auth` « Supabase service_role » :
  - Name: `Authorization`
  - Value: `Bearer <SERVICE_ROLE_KEY>`
- Webhook du workflow `Mayer - Mailing` accessible sur `https://<n8n>/webhook/mayer-mailing`

## Structure du workflow

```
[Schedule Trigger 10 min]
        │
        ▼
[HTTP GET — Fetch campaign]  (REST Supabase : mail_campaigns WHERE key='lead_bienvenue')
        │
        ▼
[Code — Build payload]       (skip si subject/html_body vide, injecte segment_sql)
        │
        ▼
[HTTP POST — Trigger mailing webhook]  (→ Mayer - Mailing)
```

### Noeud 1 : Schedule Trigger

- Type : **Schedule Trigger**
- Intervals : `Every 10 Minutes`

### Noeud 2 : HTTP Request — Fetch campaign

- Type : **HTTP Request**
- Method : `GET`
- URL :
  ```
  https://odspcxgafcqxjzrarsqf.supabase.co/rest/v1/majordhome_mail_campaigns?key=eq.lead_bienvenue&org_id=eq.3c68193e-783b-4aa9-bc0d-fb2ce21e99b1&is_archived=eq.false&select=key,label,subject,html_body
  ```
- Authentication : `Header Auth` → credential « Supabase service_role »
- Send Headers → Add Header :
  - `apikey` = **la service_role JWT en clair** (même valeur que le credential, sans le préfixe `Bearer `). ⚠️ ne PAS utiliser d'expression `{{ $credentials... }}` — l'accès credentials depuis les expressions est bloqué par défaut dans beaucoup d'instances N8n et renvoie vide → Supabase retourne `401 No API key found`.
  - `Accept` = `application/json`
- Response → Response Format : `JSON`
- **On Error** : `Stop Workflow` (on ne veut pas envoyer à vide si la DB est down)

> 💡 Supabase REST exige **deux headers** : `Authorization: Bearer <JWT>` (fourni par le credential Header Auth) **et** `apikey: <JWT>` (à ajouter manuellement, même JWT).

### Noeud 3 : Code — Build payload

```javascript
const input = $input.first().json;
// N8n peut auto-unwrapper le tableau Supabase [{...}] en objet direct — gère les 2 cas
const campaign = Array.isArray(input) ? input[0] : input;

if (!campaign || !campaign.key) { return []; }

const subject = (campaign.subject || '').trim();
const htmlBody = (campaign.html_body || '').trim();

// Skip silencieux si campagne en brouillon (pas encore générée via l'Éditeur)
if (!subject || !htmlBody) { return []; }

const escapedLabel = campaign.label.replace(/'/g, "''");
const segmentSql = `SELECT l.id, l.first_name, l.last_name, l.first_name AS display_name, l.email
FROM majordhome.leads l
WHERE l.status_id = 'ea926b9a-521c-4012-a60b-85b6f7e5c09c'
  AND l.email_unsubscribed_at IS NULL
  AND l.email IS NOT NULL AND l.email != ''
  AND l.id NOT IN (SELECT lead_id FROM majordhome.mailing_logs WHERE lead_id IS NOT NULL AND campaign_name = '${escapedLabel}')
ORDER BY l.created_at ASC
LIMIT 50`;

return [{
  json: {
    subject,
    html_body: htmlBody,
    segment_sql: segmentSql,
    campaign_name: campaign.label,
    org_id: '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1',
    recipient_type: 'lead',
    batch_size: 50,
  },
}];
```

Notes :
- `LIMIT 50` : filet de sécurité — si 500 nouveaux leads qualifient d'un coup (import massif), on n'envoie que 50 par run (sur 10 min). Les autres partent au run suivant.
- `status_id` hard-codé ici (UUID du statut « Nouveau »). Si les statuts changent, mettre à jour les 2 endroits : ce Code node **+** `segments.js`.
- **Auto-unwrap array** : selon la config du noeud HTTP précédent, N8n livre le résultat Supabase soit comme tableau `[{...}]`, soit comme objet direct `{...}`. La double détection `Array.isArray` gère les deux sans avoir à toucher les settings N8n.
- **Mode test** : pour tester sans toucher aux vrais leads, ajouter `test_email: 'ton@email.fr'` dans l'objet `json` retourné. Le workflow `Mayer - Mailing` applique alors `LIMIT 1` + redirige tous les envois vers cette adresse. **⚠️ Retirer avant activation prod.**

### Noeud 4 : HTTP Request — Trigger mailing webhook

- Type : **HTTP Request**
- Method : `POST`
- URL : **la Production URL du webhook du workflow `Mayer - Mailing`**. Pour la récupérer :
  1. Ouvrir le workflow `Mayer - Mailing` dans un autre onglet N8n
  2. Cliquer sur son Webhook trigger (premier noeud)
  3. Copier la **Production URL** (format `https://<ton-n8n>/webhook/mayer-mailing`)
  4. Coller dans ce champ URL
- Body Content Type : `JSON`
- Specify Body : `Using JSON`
- JSON (expression) : `={{ JSON.stringify($json) }}`
- Send Headers : OFF (inutile, le webhook N8n ne valide rien côté header)
- **On Error** : `Continue Regular Output` (si le webhook est down, on log et on réessaie au run suivant)

## Test avant activation

1. Créer la campagne `lead_bienvenue` via l'Éditeur, **avec un subject et un html_body remplis**.
2. Dans N8n, **Execute Workflow** manuellement sur le cron.
3. Vérifier :
   - Noeud 2 retourne bien 1 ligne (`key: lead_bienvenue`)
   - Noeud 3 produit un payload avec `segment_sql` non vide
   - Noeud 4 reçoit un 200 du webhook Mayer - Mailing
4. Vérifier côté DB (remplacer `<LABEL>` par le label réel de la campagne, ex. `Campagne Onboarding Lead`) :
   ```sql
   SELECT lead_id, email_to, campaign_name, status, sent_at
   FROM public.majordhome_mailing_logs
   WHERE campaign_name = '<LABEL>'
   ORDER BY sent_at DESC LIMIT 10;
   ```
5. Vérifier que les leads qui viennent de recevoir n'apparaissent plus dans un 2ᵉ `Execute Workflow` manuel (idempotence).

## Activation

1. Une fois le test OK → **retirer `test_email`** du Code node `Build payload`
2. Toggle **Active** en haut à droite du workflow
3. Le cron tourne toutes les 10 min (premier run immédiat vide le backlog de leads qualifiants)
4. Surveiller les exécutions dans l'onglet **Executions** pendant 24h pour détecter tout échec silencieux

## Troubleshooting (pièges rencontrés)

- **`401 No API key found` sur Fetch campaign** → l'en-tête `apikey` arrive vide. Cause la plus fréquente : l'expression `{{ $credentials.httpHeaderAuth.value.replace('Bearer ', '') }}` ne résout pas (bloquée par config N8n). Fix : coller la service_role JWT en clair dans le header `apikey` (même valeur que dans le credential, sans le préfixe `Bearer `).
- **Code node `Build payload` renvoie `[]` alors que Fetch campaign a des données** → N8n a auto-unwrappé le tableau Supabase `[{...}]` en objet direct. Vérifier que la ligne `const campaign = Array.isArray(input) ? input[0] : input;` est présente (gère les 2 formats).
- **Erreur `getaddrinfo EAI_AGAIN REPLACE_WITH_N8N_HOST`** → l'URL du noeud 4 n'a pas été remplacée par la vraie Production URL du webhook `Mayer - Mailing`. Récupérer l'URL dans l'autre workflow.
- **0 destinataires en boucle** → vérifier que le lead a bien `email IS NOT NULL`, `email_unsubscribed_at IS NULL`, et `status_id` = Nouveau. Vérifier aussi que le label `campaign_name` correspond exactement (case-sensitive) entre `mailing_logs` et la campagne DB.
- **Mail envoyé en double** → probable désynchro `campaign_name` entre cron et campagne. Le filtre `NOT IN (... WHERE campaign_name = '...')` dépend d'une correspondance exacte du label.
- **Opens « instantanés » suspects** dans Resend Dashboard → faux positifs (Apple Mail Privacy Protection, scanners antispam entreprise, Gmail image proxy). Ignorer les opens dans la minute qui suit l'envoi ; regarder ceux > 30 min pour un signal fiable.
- **Leads importés en masse → 50+ attendent** → acceptable, ils partent par batch de 50 toutes les 10 min. Si urgent, faire un `Execute Workflow` manuel en boucle.

## Évolutions possibles

- **Latence 0 min** : remplacer le cron par un DB trigger `pg_net` sur INSERT/UPDATE `leads` quand `status_id` passe à Nouveau. Plus complexe à debugger mais instant.
- **Plusieurs campagnes auto** : si d'autres statuts (Contacté, Devis envoyé, Perdu) doivent aussi déclencher un mail auto, dupliquer le pattern (1 cron par campagne) ou généraliser en lisant une colonne `auto_trigger_enabled` dans `mail_campaigns`.
- **Rotation de contenu** : si on veut varier le mail de bienvenue selon la source (Meta / web / manuel), lire `lead_source_id` dans le segment et brancher vers plusieurs campagnes.
