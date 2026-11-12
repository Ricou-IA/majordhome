# Relais à forme fixe devant Hermes

Petit programme Python (bibliothèque standard seule, Python 3.11+) installé sur le VPS devant l'API d'Hermes.
Pourquoi : la clé de l'API d'Hermes permet, par des champs supplémentaires du corps de `POST /v1/runs`
(`hosted_room_dispatch`, `_room_execution_policy`), de remplacer la liste d'outils de l'agent (spec du
2026-11-11, § 11). Le relais est la seule chose joignable de l'extérieur et ne laisse passer qu'une forme fixe.

```
écran → edge function → reverse proxy (TLS, limite de débit) → relais → API d'Hermes (127.0.0.1) → web
```

## Ce que fait le relais

| Requête                  | Clé du relais | Ce qui part vers Hermes                                              |
|--------------------------|---------------|----------------------------------------------------------------------|
| `GET /health`            | non           | rien ; réponse `200 {"ok": true}`                                    |
| `POST /v1/runs`          | oui           | `POST /v1/runs` avec **uniquement** `{"input", "session_id"}`        |
| `GET /v1/runs/{run_id}`  | oui           | `GET /v1/runs/{run_id}` sans corps                                   |
| tout le reste            | —             | rien ; réponse `404` (même avec une bonne clé, sans dire si elle l'est) |

- Le corps envoyé à Hermes est **reconstruit** : `input` (texte non vide, 12 000 caractères au plus, transmis tel
  quel) et `session_id` (UUID). Tout autre champ reçu est ignoré.
- Aucun en-tête reçu n'est transmis. Vers Hermes partent seulement : `Authorization: Bearer <HERMES_CLE>`,
  `Accept`, `User-Agent: relais-majordhome`, et pour `POST` `Content-Type` et `Idempotency-Key` (l'en-tête reçu
  s'il est un UUID, sinon `session_id`) ; s'y ajoutent ceux que la bibliothèque standard (`urllib` /
  `http.client`) pose d'elle-même : `Host`, `Accept-Encoding: identity`, `Connection: close`, et pour `POST`
  `Content-Length`. Liste complète : `Host`, `Accept-Encoding`, `Authorization`, `Accept`, `User-Agent`,
  `Connection`, plus `Content-Type`, `Content-Length` et `Idempotency-Key` pour `POST`.
- `run_id` accepté : `run_` suivi de 1 à 80 caractères `[A-Za-z0-9_-]`. Toute cible contenant `?`, `#`, `%`, `;`
  ou `\` répond 404.
- La réponse d'Hermes est filtrée : seuls `run_id`, `status`, `output`, `usage`, `created_at`, `updated_at`
  ressortent, avec le statut d'Hermes s'il est entre 200 et 499 (hors 3xx et 401).
- Codes rendus : `401 non_autorise` (clé absente ou fausse) ; `400` `corps_trop_grand` (plus de 20 000 octets
  annoncés, la suite n'est pas lue), `json_invalide`, `forme_invalide` (forme, `Content-Length` absent ou douteux,
  `Transfer-Encoding` présent) ; `502 amont_indisponible` (Hermes injoignable, plus de `RELAIS_DELAI` secondes pour
  l'appel entier, redirection, 5xx, 401 d'Hermes, réponse non JSON ou de plus de 2 Mo) ; `503 sature` (plus de
  8 requêtes en cours).
- Le plafond de 8 requêtes ne compte qu'à partir de la lecture des en-têtes terminée : la phase de lecture de la
  ligne de requête et des en-têtes n'est pas bornée par ce plafond (chaque connexion a seulement son délai de
  socket). La protection contre un client lent ou une avalanche de connexions est le **reverse proxy** (délais,
  limite de débit) : le relais ne doit jamais être exposé sans lui.
- Journal (stdout, donc `journalctl --user`) : une ligne par requête — horodatage, méthode, nom de route
  (`sante`, `lancer`, `suivre`, `inconnue`), statut, durée, et pour un 502 la raison (`amont=delai`,
  `amont=cle_hermes_refusee`…). Jamais la cible brute, le corps, le texte de la recherche, une clé ni un en-tête.

## Variables (fichier `~/.config/hermes-relais/env`)

| Variable       | Défaut                  | Rôle                                                                     |
|----------------|-------------------------|--------------------------------------------------------------------------|
| `RELAIS_CLE`   | — (obligatoire)         | clé que présentent les appelants (le secret `MDH_HERMES_KEY` de Supabase) |
| `HERMES_CLE`   | — (obligatoire)         | clé de l'API d'Hermes ; ne quitte jamais le VPS                          |
| `RELAIS_HOTE`  | `172.18.0.1`            | adresse d'écoute (privée, joignable par le reverse proxy seulement)      |
| `RELAIS_PORT`  | `8644`                  | port d'écoute                                                            |
| `HERMES_AMONT` | `http://127.0.0.1:8643` | API d'Hermes ; seules `http://127.0.0.1:<port>` et `http://localhost:<port>` sont admises |
| `RELAIS_DELAI` | `15`                    | délai de l'appel entier à Hermes, en secondes (1 à 60)                   |

Le relais refuse de démarrer (code de sortie 2, message sur stderr qui nomme la variable sans jamais citer sa
valeur) si une clé est vide ou contient autre chose que de l'ASCII visible, si les deux clés sont identiques, si
`HERMES_AMONT` sort de la boucle locale, ou si un nombre est invalide.

Le fichier est lu par `EnvironmentFile` de systemd, qui **interprète** certains caractères : une clé contenant
`\`, `"` ou `$` arriverait modifiée au relais (qui verrait alors une autre clé que celle de Supabase). Générer la
clé du relais par `openssl rand -hex 32` (hexadécimal seul) ; si la clé d'Hermes contient un de ces caractères,
la régénérer côté Hermes plutôt que de l'échapper à la main.

## Installation (utilisateur `hermes` sur le VPS)

```sh
mkdir -p ~/hermes-relais ~/.config/hermes-relais ~/.config/systemd/user
cp relais.py ~/hermes-relais/relais.py
cp hermes-relais-majordhome.service ~/.config/systemd/user/

# Fichier des variables, lisible par hermes seul. Clé du relais neuve et distincte de celle d'Hermes,
# en hexadécimal (aucun caractère interprété par EnvironmentFile) :
#   openssl rand -hex 32
install -m 600 /dev/null ~/.config/hermes-relais/env
"${EDITOR:-nano}" ~/.config/hermes-relais/env      # RELAIS_CLE=…  HERMES_CLE=…  (une variable par ligne)

# AVANT systemctl --user, une fois, par un administrateur : sans « linger », le gestionnaire utilisateur de hermes
# n'existe que pendant une session ouverte, et l'unité s'arrêterait à la déconnexion.
loginctl enable-linger hermes

systemctl --user daemon-reload
systemctl --user enable --now hermes-relais-majordhome.service
```

Durcissement de l'unité : seul `NoNewPrivileges=yes` s'applique réellement. Constaté sur le VPS (Ubuntu 24.04,
unité utilisateur, AppArmor restreint les espaces de noms non privilégiés) : `PrivateTmp`, `ProtectSystem` et
`ProtectHome` sont acceptés mais **ignorés sans message**. Ils restent dans l'unité pour le jour où elle deviendrait
une unité système ; d'ici là, le relais n'a ni `/tmp` privé ni système de fichiers en lecture seule, et rien ne doit
supposer le contraire.

Puis : l'API d'Hermes n'écoute plus que sur `127.0.0.1` ; le reverse proxy expose le relais (TLS, limite de
débit) ; les secrets Supabase `MDH_HERMES_URL` et `MDH_HERMES_KEY` désignent le relais et sa clé.

## Redémarrage et suivi

```sh
systemctl --user restart hermes-relais-majordhome.service    # après toute modification de relais.py ou de env
systemctl --user status hermes-relais-majordhome.service
journalctl --user -u hermes-relais-majordhome.service -n 50
```

## Preuves à rejouer après toute modification

1. Tests, depuis la racine du dépôt (aucun réseau extérieur) :
   `python -m unittest ops/hermes-relais/test_relais.py -v` puis `python -W error -m unittest ops/hermes-relais/test_relais.py`.
   Ils prouvent notamment qu'un corps piégé (`hosted_room_dispatch`, `_room_execution_policy`, `model`,
   `instructions`…) arrive chez un faux Hermes réduit à `{"input", "session_id"}`, avec la clé d'Hermes et non
   celle du relais, et qu'aucun en-tête de l'appelant ne passe.
2. Sur le VPS, une fois le relais lancé (`R=https://<adresse publique du relais>`, clé lue dans le fichier env,
   jamais collée dans un ticket ni un historique partagé) :
   - `curl -s $R/health` → `{"ok": true}` ;
   - `curl -s -o /dev/null -w '%{http_code}' -X POST $R/v1/runs` → `401` ;
   - `curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $RELAIS_CLE" $R/v1/toolsets` → `404` ;
   - `curl -s -H "Authorization: Bearer $HERMES_CLE" $R/v1/runs/run_x` → `401` (la clé d'Hermes n'ouvre pas le relais) ;
   - depuis un conteneur du VPS, `http://127.0.0.1:8643` et l'adresse de l'hôte sur le port d'Hermes ne répondent pas ;
   - `journalctl --user -u hermes-relais-majordhome.service` ne contient ni texte de recherche ni clé.
3. Tout changement de `TERMINAL_ENV=none` (`.env` du profil) ou de `terminal.backend: none` (`config.yaml`)
   impose de rejouer aussi les preuves d'Hermes (spec § 11.2).
