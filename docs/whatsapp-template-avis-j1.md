# Template WhatsApp — Avis J+1

## Infos pour soumission Meta

| Champ | Valeur |
|-------|--------|
| **Nom du template** | `avis_post_intervention` |
| **Catégorie** | Marketing |
| **Langue** | Français (fr) |

## Corps du message

```
Bonjour {{1}},

Merci pour votre confiance ! L'équipe Mayer Énergie espère que notre intervention s'est bien passée.

Votre avis compte beaucoup pour nous et nous aide à progresser :
{{2}}

À bientôt !
L'équipe Mayer Énergie
```

### Variables

| Variable | Exemple | Contenu réel |
|----------|---------|--------------|
| `{{1}}` | Prénom | Prénom du client (capitalized) |
| `{{2}}` | https://example.com/avis | Lien redirect tracking → Google Reviews |

## Où le soumettre

1. Console Twilio → Messaging → Content Template Builder
2. Ou Meta Business → WhatsApp Manager → Message Templates
3. Créer un nouveau template avec les infos ci-dessus
4. Validation Meta : quelques heures à 48h

## Sender ID SMS (fallback)

`Mayer - SAV` (11 caractères)
