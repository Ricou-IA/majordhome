# Spec — SMS de rappel d'entretien (fenêtre Programmation)

> **Date** : 2026-06-16
> **Statut** : Design validé (en attente relecture Eric avant plan d'implémentation)
> **Module** : Entretiens & SAV → onglet Programmation (`SectorGroupView`)

## 1. Contexte & objectif

Mayer dispose déjà d'un SMS **post-entretien** (demande d'avis, campagne `avis_j1`) déclenché depuis la carte Kanban d'un entretien *réalisé*. Cette mécanique est fiable et sert de modèle.

**Nouvel usage** : envoyer un SMS **proactif** aux clients **sous contrat** pour les prévenir que leur entretien annuel doit être programmé. Le SMS se déclenche depuis l'onglet **Programmation** (`SectorGroupView.jsx`), au niveau de chaque contrat « à planifier ».

**Critères de succès :**
- Une bulle SMS apparaît sur chaque ligne contrat **uniquement** quand l'entretien est « à planifier » (les lignes grisées — planifiées ou effectuées — n'ont **pas** de bulle).
- Au clic, le SMS part ; l'icône change (`MessageSquare` → `Check` vert) et reste « envoyé ».
- Aucun conflit avec la campagne `avis_j1` (campagne dédiée `rappel_entretien`).
- L'état « envoyé » se **réinitialise chaque 1er janvier** (l'entretien étant annuel).

## 2. Décisions validées (avec Eric, 2026-06-16)

| Sujet | Décision |
|-------|----------|
| Persistance de l'état « envoyé » | **Option A** : dérivée de `sms_logs` (pas de migration, pas de colonne) |
| Canal | **SMS seul** (la vue `majordhome_contracts` n'expose qu'un mobile `client_phone`) |
| Ré-envoi | **1×/an**, réactivation au **01/01/N** |
| Périmètre | **Par ligne** uniquement (pas de « Rappeler le secteur » en V1) |
| Permission | Même droit que « Planifier » : `can('entretiens', 'create')` (team_leader+) |
| Moteur d'envoi | **N8N** (cohérence avec l'avis), nouveau webhook + workflow |
| Message | Composé côté N8N (branding + civilité), brouillon §6 |

## 3. Architecture — découpage code / N8N

```
SectorGroupView (bulle SMS)
   └─ onSendReminder(contract)  ──►  savService.sendEntretienReminder()
                                         └─ POST  VITE_N8N_WEBHOOK_SMS_RAPPEL
                                                     │
                                              [ N8N — côté Eric ]
                                                     ├─ envoi SMS (provider)
                                                     └─ INSERT sms_logs (campaign_name='rappel_entretien')
                                                                 │
   Entretiens.jsx ◄── remindedClientIds (query sms_logs année courante) ◄┘
```

- **Code (cette spec)** : UI bulle + service d'appel webhook + détection « déjà envoyé ».
- **N8N (dépendance Eric)** : workflow d'envoi + **log obligatoire dans `sms_logs`** (c'est ce log qui fait fonctionner l'Option A). Je fournis le contrat de payload (§5).

## 4. Détail Frontend

### 4.1 `src/lib/phoneUtils.js` — extraire `isMobileFR`
La validation mobile FR est aujourd'hui une closure locale dans `sav.service.js::sendAvisRequest`. L'extraire en helper partagé et la réutiliser dans les deux méthodes (DRY) :
```js
// Mobile FR : 06/07 en national ou international (+33/0033/33)
export function isMobileFR(phone) {
  if (!phone) return false;
  const cleaned = String(phone).replace(/[\s.-]/g, '');
  return /^0[67]\d{8}$/.test(cleaned) || /^(?:\+33|0033|33)[67]\d{8}$/.test(cleaned);
}
```
`sendAvisRequest` est mis à jour pour consommer ce helper (pas de changement de comportement).

### 4.2 `src/shared/services/sav.service.js` — `sendEntretienReminder()`
Nouvelle méthode calquée sur `sendAvisRequest`, **mono-destinataire** (un seul mobile) :
```js
async sendEntretienReminder({ contractId, clientId, clientFirstName, clientName, clientPhone, orgId }) {
  const webhookUrl = import.meta.env.VITE_N8N_WEBHOOK_SMS_RAPPEL;
  if (!webhookUrl) return { data: null, error: new Error('Webhook SMS rappel non configuré') };
  if (!isMobileFR(clientPhone))
    return { data: null, error: new Error('Aucun numéro mobile (06/07) pour ce client') };

  // POST avec AbortController 15s ; timeout = succès (N8N traite en background)
  // payload : voir §5
  // retour : { data: { success, ... }, error }
}
```
- Même gestion timeout/erreur que `sendAvisRequest`.
- Envoie `client_first_name` **et** `client_name` bruts (composition du salut côté N8N).

### 4.3 `src/shared/hooks/cacheKeys.js` — clé dédiée
Ajouter à `smsKeys` :
```js
remindedClients: (orgId, year) => [...smsKeys.all(orgId), 'reminded-clients', year],
```

### 4.4 `src/apps/artisan/pages/Entretiens.jsx` — détection « déjà rappelé »
Nouvelle query (miroir de `plannedContractIds`), filtrée org + campagne + année courante :
```js
const { data: remindedClientIds } = useQuery({
  queryKey: smsKeys.remindedClients(orgId, currentYear),
  queryFn: async () => {
    const yearStart = new Date(currentYear, 0, 1).toISOString();
    const { data } = await supabase
      .from('majordhome_sms_logs')
      .select('client_id')
      .eq('org_id', orgId)
      .eq('campaign_name', 'rappel_entretien')
      .gte('sent_at', yearStart);
    return new Set((data || []).map(r => r.client_id).filter(Boolean));
  },
  enabled: !!orgId,
  staleTime: 30_000,
});
```
Handler passé à `SectorGroupView` (renvoie `{ data, error }`, invalide la query après succès) :
```js
const handleSendReminder = useCallback(async (contract) => {
  const res = await savService.sendEntretienReminder({
    contractId: contract.id,
    clientId: contract.client_id,
    clientFirstName: contract.client_first_name,
    clientName: contract.client_name,
    clientPhone: contract.client_phone,
    orgId,
  });
  if (!res.error) {
    queryClient.invalidateQueries({ queryKey: smsKeys.remindedClients(orgId, currentYear) });
  }
  return res;
}, [orgId, currentYear, queryClient]);
```
Props ajoutées au `<SectorGroupView>` : `remindedClientIds`, `onSendReminder`, `canSendReminder={canCreateContract}`.

### 4.5 `src/apps/artisan/components/entretiens/SectorGroupView.jsx` — la bulle
- **Extraire un sous-composant `ContractRow`** depuis le `.map()` inline de `SectorContracts`, pour héberger proprement l'état SMS par ligne (`smsLoading`, `smsSent` initialisé via `remindedClientIds.has(contract.client_id)`). Mirroir du pattern auto-contenu de `EntretienSAVCard`.
- **Condition d'affichage de la bulle** = exactement la condition du bouton « Planifier » :
  `canSendReminder && !isAlreadyPlanned && visitStatus !== 'completed'`
  (donc jamais sur une ligne grisée).
- **Placement** : juste à gauche du bouton « Planifier ».
- **États visuels** (repris de l'avis) :
  | État | Icône | Style | Actif |
  |------|-------|-------|-------|
  | Idle | `MessageSquare` | bordure grise, hover teal | oui |
  | Envoi | `Loader2` (spin) | — | non |
  | Envoyé | `Check` | bordure/texte/bg verts | non (disabled) |
- **Tooltips** : « Envoyer un rappel d'entretien par SMS » / « Rappel déjà envoyé cette année ».
- **Au clic** : `onSendReminder(contract)` → `setSmsLoading` → toast succès/erreur → `setSmsSent(true)` si OK. Pas de mobile / erreur webhook → `toast.error` (la bulle reste cliquable pour réessayer).

### 4.6 Variable d'environnement
`VITE_N8N_WEBHOOK_SMS_RAPPEL` à ajouter dans `.env` (et provisioning Vercel). Tant qu'absente : la méthode renvoie une erreur propre (toast), pas de crash.

## 5. Contrat N8N (dépendance Eric)

### 5.1 Payload reçu (POST JSON)
```json
{
  "contract_id": "uuid",
  "client_id": "uuid",
  "client_first_name": "CÉDRIC",
  "client_name": "CHAZAL",
  "client_phone": "06xxxxxxxx",
  "org_id": "uuid"
}
```

### 5.2 Log obligatoire dans `sms_logs` (clé de voûte de l'Option A)
À chaque envoi, **insérer une ligne** avec **au minimum** :
| Colonne | Valeur |
|---------|--------|
| `org_id` | payload `org_id` |
| `client_id` | payload `client_id` |
| `phone_to` | mobile utilisé |
| `message` | texte envoyé |
| `campaign_name` | **`rappel_entretien`** (impératif — distinct de `avis_j1`) |
| `channel` | `sms` |
| `status` | `sent` (ou statut provider) |
| `sent_at` | `now()` |

> Sans ce log, le front ne saura jamais qu'un rappel a été envoyé (la bulle ne se figera pas et autorisera des doublons).

### 5.3 Message (composé côté N8N)
- Salutation à partir de `client_first_name` + `client_name` (gérer les cas « civilité dans le prénom » type « MME », données en majuscules → title-case recommandé).
- Branding via settings org (multi-tenant).

## 6. Message — brouillon validé
> Bonjour {Prénom} {Nom}, l'entretien annuel de votre équipement approche. Vous recevrez un appel dans les prochains jours pour fixer votre rendez-vous ; vous pouvez aussi nous appeler au 05 63 33 23 14 pour définir le meilleur créneau. Mayer Energie - Econhome

(Message de service lié au contrat → a priori dispensé du « STOP » marketing. Longueur > 160 caractères = SMS multi-segments, OK fonctionnellement, à garder en tête côté coût.)

## 7. Edge cases & gotchas

- **Client multi-contrats** : l'état « rappelé » est indexé par `client_id` (sms_logs n'a pas de `contract_id`). Un client avec 2 contrats verra ses 2 lignes marquées « rappelé » après un seul envoi. Acceptable en V1 (contrats < clients chez Mayer). À documenter ; si besoin futur de granularité contrat → Option B (colonne + writeback).
- **Latence N8N** : le POST peut « timeout = succès » et le log `sms_logs` arriver en différé. → l'icône se fige via l'**état local** de la ligne pour la session ; la query `remindedClients` assure la persistance au rechargement (consistance éventuelle).
- **Multi-tenant** : la query `remindedClients` filtre explicitement `org_id` (défense en profondeur).
- **Réinitialisation annuelle** : bornée par `sent_at >= 1er janvier de l'année courante` (`new Date(currentYear,0,1)`).
- **Pas d'interpolation d'input utilisateur** dans la query (campagne en dur) → pas besoin d'`escapePostgrestSearchTerm`.

## 8. Hors scope (V1)
- Bouton « Rappeler tout le secteur » (bulk) — ajoutable plus tard comme `onPlanSector`.
- WhatsApp / multi-destinataires (Mr + Mme).
- Renvoi manuel forcé dans l'année (le ré-envoi est annuel).
- Granularité par contrat (Option B).
- Construction/maintenance du workflow N8N (côté Eric).

## 9. Validation
- `npx vite build` doit passer (pas de preview tools — serveur de dev géré par Eric).
- Vérif manuelle Eric : bulle présente uniquement sur lignes « à planifier », envoi → `Check` vert, rechargement conserve l'état, ligne grisée sans bulle, `sms_logs` reçoit bien `rappel_entretien`.

## 10. Fichiers touchés (récap)
| Fichier | Nature |
|---------|--------|
| `src/lib/phoneUtils.js` | + `isMobileFR` (extraction) |
| `src/shared/services/sav.service.js` | + `sendEntretienReminder`, refactor `sendAvisRequest` (helper) |
| `src/shared/hooks/cacheKeys.js` | + `smsKeys.remindedClients` |
| `src/apps/artisan/pages/Entretiens.jsx` | + query `remindedClientIds` + handler + props |
| `src/apps/artisan/components/entretiens/SectorGroupView.jsx` | + `ContractRow`, bulle SMS |
| `.env` (+ Vercel) | + `VITE_N8N_WEBHOOK_SMS_RAPPEL` |
