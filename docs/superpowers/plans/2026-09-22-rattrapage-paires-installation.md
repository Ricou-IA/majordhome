# Rattrapage des 12 installations en double (un RDV par technicien)

Liste extraite de la prod le 2026-09-22. Pour chaque paire, dans l'app (Planning ou fiche chantier) :

1. Ouvrir le **RDV A** (à garder) → dans « Technicien assigné », **ajouter** la personne de B → Enregistrer (la sync Google crée son événement).
2. Ouvrir le **RDV B** → **Supprimer** (corbeille, org_admin : `deleteAppointment` retire aussi l'événement Google).
3. Si B porte des notes, les recopier sur A avant de supprimer (une seule paire concernée : DJAFOUR, notes « poêle »).

Repère : le bloc A est celui de la personne indiquée en « tech A » ; les deux blocs ont le même horaire, cliquer celui de « tech B » pour le supprimer.

| Date | Client | Tech A (garder son bloc) | Tech B (à ajouter sur A, puis supprimer son bloc) | Notes sur B | Gcal B |
|---|---|---|---|---|---|
| 23/09 | DJAFOUR Ourdia | Antoine Verloo | Ludovic Robert | « poêle » → recopier sur A | oui |
| 24/09 | ASTRUC | Antoine Verloo | Ludovic Robert | — | oui |
| 28/09 | GAUTHIER Laure | Antoine Verloo | Ludovic Robert | — | oui |
| 29/09 | MONAT Olivier et Eliane | Antoine Verloo | Ludovic Robert | — | oui |
| 30/09 | CHENE Alberte | Antoine Verloo | Ludovic Robert | — | oui |
| 05/10 | VIGNEAUX Georges | Antoine Verloo | Ludovic Robert | — | oui |
| 06/10 | DELMAS Evelyne | Ludovic Robert | Antoine Verloo | — | non |
| 13/10 | VEOLIA ENERGIE FRANCE | Ludovic Robert | Mohammed | — | non |
| 14/10 | VEOLIA ENERGIE FRANCE | Ludovic Robert | Mohammed | — | non |
| 15/10 | VEOLIA ENERGIE FRANCE | Ludovic Robert | Mohammed | — | non |
| 21/10 | BERNA Hélène | Antoine Verloo | Ludovic Robert | — | oui |
| 22/10 | BERNA Hélène | Antoine Verloo | Ludovic Robert | — | oui |

Identifiants (RDV A → RDV B) pour contrôle en base :

```
b01652cc-f05d-4663-b871-458c92d87750 → 940c8012-7420-4145-a49d-a57732950a9c  (DJAFOUR 23/09)
8d6dfe19-59a0-4368-a02f-eeb6c6985608 → ac48ba1b-284e-4a18-baa6-a343b056c957  (ASTRUC 24/09)
e7fabede-f6b1-45de-a973-719bfccd4095 → 64f49ab5-0730-42ed-a4eb-a2e4e951a82a  (GAUTHIER 28/09)
8926c66b-7e86-45e6-b82b-f2ea0816d54b → af46ac51-7305-4513-bba4-73a63291d990  (MONAT 29/09)
523323f2-7b4f-422c-95d9-a7cf9ae5a2e4 → 53b34115-6661-4b3d-bc80-d11679f381ba  (CHENE 30/09)
0e98fc92-4484-4d57-b905-b49c1221886d → 9a75e2ae-f26d-4a79-8729-3272de5630a7  (VIGNEAUX 05/10)
59e8d6ed-c904-4ea4-8501-bf06904f1350 → 8dff05c0-a61c-490c-8a01-d5f1c1d3c1dd  (DELMAS 06/10)
da0b352d-351f-4d6a-b917-2f897c465927 → a2a1cc9e-29d8-4e0e-bc67-fb13d26cef3d  (VEOLIA 13/10)
b9daa468-bc09-43f3-ac0e-a1a28f6e59ab → daf697ee-9e31-475d-bde7-5bf7ea451aab  (VEOLIA 14/10)
be3910fa-65d1-4499-b5cf-dd575b5c1e0e → 4c013325-7838-4250-8924-1aee07f1070d  (VEOLIA 15/10)
ff9ef338-78eb-4a8e-aada-fd722c335a74 → cdf559f5-c465-4135-8110-ed2664d39d36  (BERNA 21/10)
ea6d1832-d459-4dab-804b-47c05dc2e1fc → f86b545c-f9ca-4fc7-8b0b-7e07a41cc738  (BERNA 22/10)
```

Vérification finale (SQL, lecture seule) :

```sql
-- doit renvoyer 0 ligne
SELECT lead_id, scheduled_date FROM majordhome.appointments
WHERE status IN ('scheduled','confirmed') AND scheduled_date >= current_date AND appointment_type = 'installation'
GROUP BY 1, 2, scheduled_start HAVING count(*) > 1;

-- doit renvoyer 12 (un RDV multi-techniciens par paire fusionnée)
SELECT count(*) FROM (
  SELECT at.appointment_id FROM majordhome.appointment_technicians at
  JOIN majordhome.appointments a ON a.id = at.appointment_id
  WHERE a.scheduled_date >= current_date AND a.appointment_type = 'installation'
  GROUP BY 1 HAVING count(*) >= 2
) x;
```

Pourquoi pas un script SQL : 8 des 12 RDV B portent un événement Google Calendar réel ; seule la voie service (`deleteAppointment`) le supprime.
