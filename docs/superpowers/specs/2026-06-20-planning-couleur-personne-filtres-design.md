# Planning — couleurs par personne + filtres Intervention/Commercial — Design

> Date : 2026-06-20 · Statut : design validé en discussion, spec à relire
> Page concernée : `src/apps/artisan/pages/Planning.jsx` + `src/shared/hooks/useAppointments.js` + `src/shared/services/appointments.service.js`

## 1. Contexte & problème

Le planning superpose tous les RDV (interventions techniciens + visites commerciales) avec des couleurs **par type de RDV**. Résultat : illisible quand les agendas se chevauchent (« fouillis »). On veut pouvoir isoler un agenda et lire d'un coup d'œil **à qui** appartient chaque RDV.

## 2. Objectif

1. Distinguer **2 plannings** — Intervention (technicien) / Commercial (commercial + team leader) — via des **boutons-filtres** (l'un, l'autre, ou les deux ; les deux actifs par défaut = vue globale actuelle).
2. **Filtre équipe en boutons** (chips), même logique de toggle, pour plus de souplesse.
3. **Couleurs par personne** (et non plus par type de RDV).
4. **Violet = intervention facturée** (override qui écrase la couleur personne).

## 3. Décisions (arbitrées avec Eric le 2026-06-20)

| # | Décision |
|---|----------|
| 1 | **Les RDV commerciaux ne sont jamais « facturés »** → on garde `target_invoiced` tel quel (interventions + poses). **Aucune migration de vue.** |
| 2 | Couleurs : Ludovic 🔴, Antoine 🟠, Philippe 🔵 (déjà), Michel 🟦 teal, Eric 🟢 (déjà). Violet réservé au facturé. |
| 3 | Type **« Autre »** : couleur du propriétaire du RDV (résolveur générique), **toujours visible** (non masqué par les 2 toggles). |
| 4 | Couleurs seedées maintenant (migration), **éditeur couleur par personne dans Settings → Équipe en Phase 2**. |

## 4. Modèle « couleur par personne » (fondation)

**Identité humaine unifiée par `profile_key`** = `team_members.user_id` = `commercials.profile_id`.
Vérifié : Philippe (tech `e375271d` + commercial `8113ed48`) et Michel (tech `06dc4781` + commercial `33f79653`) partagent leur `profile_key`.

**Source unique de la couleur** : `team_members.calendar_color` (tous les humains du planning sont des team_members ; les commerciaux Michel/Philippe le sont aussi). Le code actuel lit `m.color` (inexistant) → toujours gris : **bug à corriger en `calendar_color`**.

**Maps construites dans le hook** (à partir de `useTeamMembers` + `useLeadCommercials`, déjà cachés) :
- `colorByProfile` : `user_id → calendar_color`
- `techProfileById` : `team_member.id → user_id`
- `comProfileById` : `commercial.id → profile_id`

**Résolveur (pur, testable)** :
```
resolveAppointmentColor(appt, maps):
  techProfile = appt.technician_ids?.[0] ? techProfileById.get(id) : null
  comProfile  = appt.assigned_commercial_id ? comProfileById.get(id) : null
  preferCom   = COMMERCIAL_TYPES.includes(appt.appointment_type)
  profile     = preferCom ? (comProfile || techProfile) : (techProfile || comProfile)
  base        = colorByProfile.get(profile) || FALLBACK (#94A3B8 slate)
  return appt.target_invoiced === true ? '#6D28D9' (violet) : base
```
- `target_invoiced` est déjà calculé par la vue (intervention `invoiced_at`/`workflow='facture'` ; pose = devis gagnant `invoiced`). On le consomme tel quel — plus de restriction `INVOICEABLE_APPOINTMENT_TYPES` côté front (la vue garantit déjà false pour VT/Autre).
- RDV « Autre » : pas de type-bucket → résolveur générique = couleur du propriétaire (tech ou commercial selon ce qui est renseigné). ✔ décision #3.
- Multi-techniciens : on colore par le **1ᵉʳ technicien** de la liste (cas mono-tech chez Mayer ; à affiner plus tard si besoin).

`appointmentsService.toCalendarEvent(appointment, { color })` accepte la couleur résolue (calculée dans le hook). Seul caller = `useAppointments`.

## 5. Filtres

État `filters` étendu :
```
{
  kinds: { intervention: true, commercial: true },   // 2 toggles
  memberProfileKeys: [],                              // chips équipe (humains)
  appointmentType: null, status: null,               // existant (inchangé)
}
```

**Bucket d'un RDV** (par type) :
- commercial = `COMMERCIAL_TYPES` (`rdv_agency`, `rdv_technical`)
- intervention = `TECHNICIAN_TYPES` (`installation`, `maintenance`, `service`)
- autre = ni l'un ni l'autre → toujours gardé

**Filtre kind** : garder si `(isCom && kinds.commercial) || (isInt && kinds.intervention) || isOther`.

**Filtre équipe** (chips, humains dédupliqués par `profile_key`) : si ≥1 sélectionné, construire `selectedRecordIds` = union des record ids (team_member + commercial) des humains choisis ; garder si `technician_ids ∩ selectedRecordIds` OU `assigned_commercial_id ∈ selectedRecordIds`.

Les 2 filtres se combinent en **ET**.

**`teamList` unifié** (remplace l'actuel qui double Philippe/Michel) :
```
[{ profileKey, displayName, color, recordIds: [...], isTech, isCommercial }]
```

## 6. UI (`CalendarFilters` dans `Planning.jsx`)

- **2 boutons toggle** « Intervention » / « Commercial » (icônes Wrench / Briefcase ; actif = plein, inactif = contour).
- **Chips équipe** : 1 par humain, pastille couleur + prénom, clic = toggle ; bouton « Effacer » reset (kinds → both true, members → []).
- Dropdown multi-select actuel **supprimé**.
- Le filtre « Type » existant : conservé tel quel (orthogonal) — ou retiré si redondant avec les 2 toggles. **À trancher à la relecture** (proposition : le garder, il filtre plus finement).

## 7. Seed couleurs (migration Mayer, one-time)

`UPDATE majordhome.team_members SET calendar_color = … WHERE id = …` (idempotent, par id) :
| Personne | id | Couleur |
|---|---|---|
| Ludovic Robert | `87ba1ecb…` | `#EF4444` |
| Antoine Verloo | `15a68690…` | `#F97316` |
| Philippe Mazel | `e375271d…` | `#3B82F6` |
| Michel Rieutord | `06dc4781…` | `#0D9488` |
| Eric Pudebat | `2db6765f…` | `#10B981` |

(Multi-tenant : seed spécifique Mayer comme le backfill geogrid `'81'`. Les autres orgs définiront via l'éditeur Phase 2.)

## 8. Périmètre

**Inclus (Phase 1)** : hook `useAppointments` (maps + résolveur + filtres), `appointmentsService.toCalendarEvent` (param couleur), `Planning.jsx` (`CalendarFilters` toggles + chips, `teamList` unifié), résolveur pur + test `node --test`, seed migration.

**Phase 2 (séparée)** : éditeur de couleur par personne dans Settings → Équipe (`TeamManagement.jsx` lit/écrit `team_members.calendar_color`).

**Hors périmètre** : `DayResourceGrid` / `SchedulingAssistant` (déjà sur `calendar_color`, à vérifier mais non touchés ici) ; pas de changement de vue/DB hormis le seed.

## 9. Risques / points d'attention

- `toCalendarEvent` : vérifier qu'aucun autre caller que `useAppointments` n'en dépend (grep) avant de changer la signature.
- Ordre `technician_ids` non garanti (pas de tri par rôle `lead`) → couleur du 1ᵉʳ ; acceptable mono-tech.
- Couleur fallback `#94A3B8` si humain sans couleur / RDV sans assignation.
- `memberIds → memberProfileKeys` : changement de sémantique du filtre (humains, pas record ids).
