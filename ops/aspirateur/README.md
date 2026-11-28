# Service de l'aspirateur de sites fournisseurs (VPS KVM 2)

Programme Node 22 + Playwright (Chromium) qui apprend la structure d'un site fournisseur (agent) puis en rejoue la
**recette** (programme sans IA) pour lire produits, prix, fiches techniques PDF et caractéristiques.
Spec : `docs/superpowers/specs/2026-11-28-aspirateur-sites-fournisseurs-recettes-communes-design.md`.
Plan : `docs/superpowers/plans/2026-11-28-aspirateur-tranche-1.md`.

```
écran → edge fournisseur-aspirer ──POST /travaux──▶ Traefik ▶ ce service (172.18.0.1:8645)
                                                        │  navigateur borné au site du fournisseur
                                                        ├──▶ edge fournisseur-aspirer-modele (appels au modèle, clé Claude)
                                                        └──▶ edge fournisseur-aspirer-retour (lots, recette, fin)
```

## Ce qui protège quoi

- **Aucune clé** de la base ni de l'API Claude sur cette machine : seulement `MDH_ASPIRATEUR_KEY`, partagée avec les
  trois edges.
- **Accès au compte fournisseur** : reçus dans `POST /travaux`, gardés en mémoire le temps du travail, jamais écrits.
  Le modèle ne les voit pas (`se_connecter` remplit le formulaire lui-même) ; tout texte qui sort du navigateur et tout
  journal passent par `masquerSecrets`.
- **Navigateur borné** : toute requête hors du domaine enregistrable du site est interrompue (`navigateur.mjs`).
- **Politesse** : 1 s au moins entre deux requêtes ; un travail à la fois par site, deux au plus en tout.
- **Captcha ou page de défi** : arrêt `site_protege`, jamais de contournement.
- **Hermes n'est pas touché** : autre utilisateur Unix, autre unité, autre port. Ne rien modifier au profil, au relais ni
  aux services d'Hermes.
- **Connexion** : les accès ne sont tapés que par `seConnecter`, dans un vrai formulaire de connexion de l'hôte EXACT
  du site (champ mot de passe, même formulaire, envoi vers ce même hôte, preuve invisible avant connexion).
- **Bac à sable de Chromium** : activé par défaut. Si l'AppArmor d'Ubuntu 24.04 empêche son démarrage pour un
  utilisateur non privilégié, `ASPIRATEUR_SANS_BAC_A_SABLE=1` le coupe — à éviter : le filtrage sortant ci-dessous
  devient alors le seul verrou système.
- **Filtrage sortant (recommandé à l'installation, relecture I3)** : l'utilisateur `aspirateur` ne doit joindre que
  HTTPS sortant et jamais le réseau privé, par exemple :
  `iptables -A OUTPUT -m owner --uid-owner aspirateur -d 10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,127.0.0.0/8,169.254.0.0/16 -j REJECT`
  puis `iptables -A OUTPUT -m owner --uid-owner aspirateur -p tcp ! --dport 443 -j REJECT` (DNS sortant à autoriser
  avant). Le bornage du navigateur reste le premier verrou ; celui-ci tient si une page piégée le contourne.

## Installation (sur le oui d'Eric)

```bash
# 1. Utilisateur dédié
sudo useradd --create-home --shell /usr/sbin/nologin aspirateur
sudo loginctl enable-linger aspirateur

# 2. Code (copie de ops/aspirateur, sans node_modules)
sudo -u aspirateur mkdir -p ~aspirateur/aspirateur ~aspirateur/.config/aspirateur ~aspirateur/.config/systemd/user
#   (copier les fichiers par scp puis) :
sudo -u aspirateur bash -lc 'cd ~/aspirateur && npm ci --omit=dev && npx playwright install chromium'
sudo npx --prefix ~aspirateur/aspirateur playwright install-deps chromium   # bibliothèques système, une fois

# 3. Configuration (mode 600)
sudo -u aspirateur tee ~aspirateur/.config/aspirateur/env >/dev/null <<'ENV'
MDH_ASPIRATEUR_KEY=<même valeur que le secret Supabase MDH_ASPIRATEUR_KEY, 32 caractères au moins>
ASPIRATEUR_URL_RETOUR=https://<projet>.supabase.co/functions/v1/fournisseur-aspirer-retour
ASPIRATEUR_URL_MODELE=https://<projet>.supabase.co/functions/v1/fournisseur-aspirer-modele
ASPIRATEUR_PORT=8645
ASPIRATEUR_ECOUTE=172.18.0.1
ENV
sudo chmod 600 ~aspirateur/.config/aspirateur/env

# 4. Unité systemd utilisateur
sudo cp aspirateur-majordhome.service ~aspirateur/.config/systemd/user/
sudo -u aspirateur XDG_RUNTIME_DIR=/run/user/$(id -u aspirateur) systemctl --user daemon-reload
sudo -u aspirateur XDG_RUNTIME_DIR=/run/user/$(id -u aspirateur) systemctl --user enable --now aspirateur-majordhome

# 5. Route Traefik : traefik-aspirateur.yml → /root/traefik-dynamic/aspirateur-majordhome.yml
#    (entryPoints et certResolver alignés sur hermes-majordhome.yml)

# 6. Vérification
curl -s https://aspirateur.srv1102213.hstgr.cloud/sante          # {"ok":true}
curl -s -o /dev/null -w '%{http_code}\n' https://aspirateur.srv1102213.hstgr.cloud/autre   # 404
```

Côté Supabase : secret `MDH_ASPIRATEUR_KEY` (même valeur), `MDH_ASPIRATEUR_URL=https://aspirateur.srv1102213.hstgr.cloud/travaux`.

## Mise à jour du code partagé

Les règles pures viennent de `src/lib/aspirateur/` : `node scripts/sync-aspirateur.mjs` les recopie dans `lib/`
(le test `scripts/aspirateur/edges.test.mjs` échoue si une copie diverge). Ne jamais éditer `lib/`.

## Tests

```bash
cd ops/aspirateur && npm ci && npx playwright install chromium && npm test
```

Site factice local (`test/fixtures/site-exemple.mjs`) et modèles factices : aucun appel réseau sortant.
