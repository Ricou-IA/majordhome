# Base de pièces — catalogues des marchands relevés en base, recherche depuis la fiche d'un appareil

> Conception du 2026-11-12, issue de la recette de l'assistant « Trouver une pièce » avec Eric.
> Ce qui vient d'Eric est marqué **(Eric)** ; mes choix sont marqués **(mon choix)** et restent à confirmer.

## 1. Intention

L'assistant « Trouver une pièce » (Hermes) marche, mais la recette en production a montré trois limites **(constats partagés avec Eric)** :

- **Long et payant** : 1 min 30 à 3 min 20 et 0,45 USD en moyenne par recherche. Un essai mesuré (consigne allégée, liste de sites, modèle moins cher, 6 recherches) n'a rien changé de net : le coût vient de la boucle de l'agent, pas de la consigne.
- **Irrégulier** : pour le même poêle (Freepoint Globe Airtight), trois essais ont donné trois bougies.
- **Il redécouvre à chaque fois** ce qu'un marchand publie déjà proprement.

Idée **(Eric)** : « si je trouve un site ou deux pertinents, on peut aspirer la liste des pièces et faire une recherche plutôt type SQL ». Energies Bois Distribution, **fournisseur de Mayer, a donné son accord (Eric)** ; deux ou trois fournisseurs principaux suivront.

Sondage du 2026-11-12 (cinq appels au flux public, rien de copié) : la boutique publie 1 043 produits dont **558 pièces détachées** (264 MCZ, 174 RED, 171 Ecoforest, 143 Cadel, 118 Freepoint…). Chaque fiche porte référence, désignation, prix, stock, marque, catégories, et **la liste des modèles compatibles en texte**. Pour le cas réel de la recette : deux bougies citent « Globe / Globe Airtight » — 4D145181040 (47,70 €) et 4D14513002 (45,00 €, cosses Faston). C'est exactement l'hésitation d'Hermes ; la base l'aurait montrée tout de suite, gratuitement, en disant sur quoi les deux diffèrent.

But : **la base d'abord, Hermes ensuite**. La fenêtre « Trouver une pièce » affiche immédiatement les pièces des catalogues relevés qui citent l'appareil ; la recherche web par Hermes devient le second recours, sur clic.

## 2. Objectifs, non-objectifs, anti-objectifs

**Objectifs**
- Relever chaque nuit le catalogue de pièces d'un marchand qui a donné son accord, par la chaîne de relevé existante.
- Depuis la fiche d'un appareil ou d'une demande SAV, voir en moins d'une seconde les pièces dont la fiche cite ce modèle (ou, à défaut, cette marque), filtrables par un mot (« bougie »), avec référence, prix public TTC, disponibilité au relevé, date du relevé et lien vers la fiche du marchand.
- Dire honnêtement quand plusieurs pièces conviennent et quand rien ne correspond — puis proposer la recherche web.
- Mesurer la part des demandes réelles auxquelles la base répond.

**Non-objectifs (chantiers distincts)**
- Commander, remplir un panier.
- Ajouter la pièce trouvée à un devis SAV. Le passage pièces → devis existe pour Invicta (`PartsToSavQuote`) ; l'y brancher est l'étape suivante naturelle, pas celle-ci.
- Extraire par IA une table « pièce ↔ modèle » : on cherche dans le texte de la fiche tel que le marchand l'écrit.
- Les boutiques qui ne publient pas de flux lisible (PrestaShop sans API, sites protégés) et les autres plateformes (Shopify) : un adaptateur par plateforme, plus tard, marchand par marchand.
- Faire apprendre Hermes : sa mémoire reste coupée.

**Anti-objectifs (ce qui serait un échec même si « ça marche »)**
- Relever un marchand **sans son accord**, ou un site qui refuse les robots. L'accord se note sur la fiche du fournisseur (qui, quand) ; sans lui, pas de relevé automatique.
- Marteler un site : un relevé par nuit, pages espacées, jamais de relevé déclenché par la consultation d'une fiche.
- Présenter un prix ou un stock relevé comme actuel : la date du relevé est toujours visible, et le lien mène à la fiche du marchand.
- Affirmer une compatibilité que la fiche du marchand ne dit pas : « cité pour ce modèle » ne s'affiche que si le nom du modèle figure dans la fiche ; sinon la pièce est rangée sous « même marque, modèle non cité ».
- Dégrader l'existant : le relevé de pièces ne doit ni désactiver le tarif d'un fournisseur, ni faire entrer des pièces dans les chapitres « équipement » des devis, ni casser les relevés Domos / BayWa / Invicta.
- Une recherche web lancée d'office : Hermes reste sur clic.

## 3. Ce que voit l'utilisateur

Dans la fenêtre « Trouver une pièce » (inchangée par ailleurs) :

1. **Dès l'ouverture, sans clic et sans coût** : le bloc « Dans les catalogues de vos fournisseurs ». Il liste les pièces qui citent le modèle de l'appareil, puis, repliées, celles de la même marque dont la fiche ne cite pas le modèle.
2. **Le champ de saisie filtre ce bloc au fil de la frappe** (« bougie », « ventilateur », une référence). Il sert aussi, comme aujourd'hui, de demande pour la recherche web.
3. **Chaque ligne** : désignation, référence, fournisseur, prix public TTC, « en stock / en rupture au relevé du JJ/MM », lien « voir la fiche » (domaine visible), et la mention « cité pour ce modèle » quand c'est le cas. Quand plusieurs pièces de même nature conviennent, elles sont toutes montrées : c'est au technicien de trancher sur la connectique ou les cotes.
4. **En dessous** : « Rien de probant ? Chercher sur le web (environ deux minutes) » — le bouton actuel de recherche par Hermes, et l'historique.
5. **Appareil sans modèle renseigné** : le bloc le dit (« modèle non renseigné : recherche par marque seulement ») ; c'est la première cause de résultats flous.

Dans Paramètres → Fournisseurs, sur la fiche d'un fournisseur connecté : une option « Boutique publique (relevé sans identifiants) », une option « Catalogue de pièces détachées », l'accord du fournisseur (contact, date), et le relevé automatique de nuit comme pour les autres.

## 4. Comment c'est fait — décisions prises

**On réutilise la chaîne de relevé existante (mon choix)** : fournisseur connecté de type `woocommerce`, edge `supplier-catalog-sync` (cron de 04:00 UTC pour les fournisseurs en relevé automatique), adaptateur pur `src/lib/catalogue/woocommerce.js`, écrivain unique en base. Ce qui manque aujourd'hui, constaté dans le code :

| Manque | Décision |
|---|---|
| Le relevé serveur exige des identifiants et passe par la page de connexion | Mode « boutique publique » : lecture du flux `/wp-json/wc/store/v1/products` sans connexion. Une pause entre deux pages. |
| La description longue (où sont les modèles compatibles) est jetée à trois endroits (client de l'edge, allègement du fichier, adaptateur) et l'écrivain ne range pas la colonne `description` | La garder de bout en bout pour un catalogue de pièces, en texte, bornée (20 000 caractères — la liste des modèles compatibles d'une fiche réelle dépasse 13 000 caractères, décision du 2026-11-12 à l'exécution). |
| Aucune cible « pièce détachée » dans la correspondance des rayons : tout tomberait en « photovoltaïque » | Un catalogue déclaré « de pièces » range ses rayons « Pièces détachées … » en `piece_detachee` ; les autres rayons (conduits, poêles, accessoires) ne sont **pas** relevés dans cette étape. |
| La marque est prise au premier mot du nom | Pour un catalogue de pièces : la marque de la fiche (`brands`), sinon celle du rayon (« Pièces détachées FREEPOINT »). Une pièce rangée dans plusieurs rayons de marques (une bougie MCZ vendue aussi pour Freepoint) reste **une** ligne et garde la liste de ses rayons : la recherche par marque regarde aussi cette liste. |
| Le prix du flux est supposé HT et rangé en prix d'achat | Vérifié sur une fiche : le flux donne le prix affiché au public (47,70 € pour la 4D145181040), donc **TTC**. On range le TTC relevé (`specs.canonical.prix_public_ttc`, comme pour Invicta), le prix public HT (`tarif_public` = TTC ÷ 1,2), et le prix d'achat = public HT − remise du fournisseur (`connector_config.pieces.remise_pct`, réglage déjà présent sur la fiche fournisseur, 0 par défaut). |
| Les produits « à variantes » sont exclus (117 sur le site, tous rayons confondus) | Exclus dans cette étape, **comptés et affichés** dans le compte rendu du relevé. |

**Écrivain en base** : `public.supplier_pieces_upsert`, déjà « seul écrivain d'un relevé de pièces » (`CLAUDE.md`), marque par marque. Il garde les corrections humaines, fait suivre le prix de vente au prix public sauf ajustement à la main, et gère la disparition d'une pièce du catalogue. Le constructeur vérifie qu'il convient tel quel à un marchand multi-marques (une pièce commune à deux marques, une référence qui existe déjà au tarif d'un autre fournisseur) ; sinon il l'étend, il ne le contourne pas.

**Recherche** : une vue de lecture sur les lignes `piece_detachee` actives de l'organisation, avec un champ de recherche sans casse ni accents (désignation, référence, marque, rayons, description) et ce qu'il faut pour l'affichage (fournisseur, prix public TTC, stock relevé et sa date, lien de la fiche). Volume attendu : quelques milliers de lignes, donc un simple filtre par mots suffit ; pas d'index plein texte tant que la mesure ne le demande pas.

**Classement** : fonction pure et testée (`src/lib/catalogue/`), sur un extrait réel du flux gardé en jeu d'essai. Entrées : marque et modèle de l'appareil, mots saisis, lignes candidates. Règles :
- le modèle est découpé en mots utiles (« GLOBE AIRTIGHT » → `globe`, `airtight`) ; une ligne est « citée pour ce modèle » si ces mots figurent dans sa fiche à mots entiers, **à la suite et dans l'ordre** (séparateurs et nombres seuls ignorés) — décision du 2026-11-12 à l'exécution : des mots éparpillés dans une longue liste de modèles donnaient de faux « cité » ;
- les mots saisis filtrent (tous doivent figurer) ;
- ordre : citées pour le modèle, puis même marque ; à égalité, en stock d'abord, puis prix croissant ;
- un modèle d'un seul mot très court ou générique (« One », « Evo ») ne suffit pas à dire « cité » : il faut alors aussi la marque.

**Écran** : le bloc est un composant de plus dans `TrouverPieceModal`, alimenté par un service et un hook dédiés (clés de cache centralisées, `orgId` en premier). Il ne dépend pas d'Hermes : si le relais est en panne, la base répond quand même.

**Droits et activation (mon choix)** : la recherche en base suit le module `assistant` et le droit `assistant_pieces.use` déjà en place (même fenêtre). Les réglages du fournisseur restent sous les droits actuels de la page Fournisseurs.

### Précisions après relecture (mes choix)

- **Jeu d'essai** : la première tâche du plan capture un extrait réel du flux (avec l'accord du marchand, acquis) et le range dans `scripts/catalogue/data/` : les rayons « Pièces détachées … », quelques dizaines de fiches dont les quatre bougies du rayon Freepoint, une fiche en rupture, une fiche à variantes, une fiche sans prix. Les nombres épinglés par les tests sont ceux de cet extrait, pas « environ 560 ».
- **Périmètre de la recherche** : seulement les lignes des fournisseurs déclarés « catalogue de pièces relevé ». Les 1 771 pièces Invicta n'y entrent pas : elles n'ont pas de texte de compatibilité et ont déjà leur bloc (vue éclatée et nomenclature).
- **Un relevé = un seul appel à l'écrivain**, sous une marque de relevé unique propre au catalogue du marchand (et non un appel par marque d'appareil) : une pièce absente du relevé suivant est alors désactivée, une pièce commune à plusieurs marques reste une seule ligne. Un relevé qui échoue ne change rien en base. Le constructeur vérifie ce comportement sur le harnais avant de s'y fier.
- **Rattachement à l'appareil** : la marque de l'appareil est comparée, sans casse ni accents, à la marque de la ligne **et** aux noms de ses rayons débarrassés de « Pièces détachées ». Pas de table d'alias entre marques d'un même groupe dans cette étape : ce sont les rayons du marchand qui portent le lien (une bougie MCZ rangée aussi au rayon Freepoint).
- **Ruptures** : une pièce en rupture ou momentanément non commandable est relevée et affichée comme telle ; seules les fiches sans prix ou sans référence sont écartées.
- **Accord du fournisseur = barrière technique** : en mode « boutique publique », le relevé (manuel ou de nuit) est refusé tant que l'accord (contact et date) n'est pas saisi sur la fiche.
- **Droits** : la vue de recherche ne montre que des données publiques du marchand (désignation, référence, prix public, stock, lien) ; ni prix d'achat ni remise. Le droit `assistant_pieces.use` reste tenu par l'écran, comme aujourd'hui ; les lignes de catalogue sont déjà lisibles par tout membre de l'organisation.

## 5. Mesure

Chaque ouverture de la fenêtre ne s'enregistre pas. On mesure à partir de ce qui existe : une recherche web lancée (`assistant_recherches`) après que la base a affiché des pièces « citées pour ce modèle » signale que la base n'a pas suffi. **(mon choix)** : au lancement d'une recherche web, l'écran transmet le nombre de pièces que la base proposait, et la ligne de recherche le garde. C'est un indicateur déclaré par le navigateur, pas une preuve : il suffit pour décider quel marchand relever ensuite. Au bout de quelques semaines : part des demandes où la base suffisait, marques et modèles sans réponse.

## 6. Ordre de construction et critère de réussite

1. **Relevé d'Energies Bois Distribution** en base (fournisseur créé, mode public, catalogue de pièces, premier relevé lancé à la main puis automatique de nuit).
2. **Recherche et classement**, testés sur l'extrait réel.
3. **Bloc dans la fenêtre**, puis mesure.

**Réussi si** : le premier relevé range les quelque 560 pièces (hors variantes, comptées à part) sans toucher aux autres fournisseurs ; pour le Freepoint Globe Airtight et le mot « bougie », le bloc affiche les deux bougies citées (4D145181040 et 4D14513002) avec leur prix du jour du relevé, en moins d'une seconde ; pour un appareil dont la marque n'est pas au catalogue (COLA), le bloc dit qu'il n'a rien et propose la recherche web ; un second relevé le lendemain ne crée aucun doublon ; les relevés Domos et BayWa et les pièces Invicta sont inchangés.

## 7. Laissé au constructeur

- La forme exacte des réglages sur la fiche fournisseur et leur rangement (`connector_config`).
- Le nom de la vue, du service, du hook, de la fonction de classement.
- La pause entre les pages et l'en-tête d'identification du relevé (il doit nommer Majord'home).
- Le choix d'étendre l'edge existante ou d'en isoler le mode public, tant que l'écrivain reste unique.
- La borne de la description et le nettoyage du HTML.

## 8. Questions ouvertes pour Eric

- **Remise** chez Energies Bois Distribution (pour le prix d'achat) ? À défaut : 0, modifiable sur la fiche.
- **Le prix affiché sur leur site est bien TTC** pour toi aussi (pas de tarif professionnel connecté) ?
- **Les deux ou trois autres fournisseurs** : lesquels, et chacun a-t-il donné son accord ? Leur plateforme décide du travail (WooCommerce public : rien de plus ; autre : un adaptateur).

## 9. Risques connus

- **Compatibilité en texte libre** : la qualité dépend de ce que le marchand écrit. Un modèle écrit autrement (« Globe-Globe Airtight », « Globe AT ») peut échapper à « cité pour ce modèle » et tomber sous « même marque ».
- **Couverture** : un seul marchand ne couvre que ses marques (pas de COLA, pas de PAC ni de climatisation). La base complète Hermes, elle ne le remplace pas.
- **Articles créés** : chaque pièce relevée avec un prix reçoit un article du catalogue (règle existante, comme pour les 1 771 pièces Invicta). Les chapitres « équipement » des devis les écartent déjà.
- **Changement du site** : si le marchand change de plateforme ou ferme son flux, le relevé échoue proprement (erreur visible sur la fiche fournisseur) et la base garde le dernier état, daté.
