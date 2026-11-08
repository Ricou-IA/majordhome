# Veille concurrentielle — ChantierFlow, Interfast, Extrabat

**Date** : 2026-11-08 · **Dernière mise à jour** : 2026-11-08 (décisions, § 10) · **Périmètre** : ce que ChantierFlow fait du DPE, et le chemin qui sépare Majord'home d'Interfast et d'Extrabat en vue d'une commercialisation. Lecture des sites éditeurs et de fiches tierces (Appvizer, Capterra, Les Pépites Tech, Batiweb, CAPEB), plaquette Extrabat Chauffage 2026. Les chiffres éditeurs sont auto-déclarés.

## 1. Résumé

- **ChantierFlow ne fait rien du DPE sur la fiche client.** Le DPE y sert à la **prospection de zone** : un « Radar » croise les passoires E/F/G (ADEME), les ventes récentes (DVF) et la densité d'artisans (SIRENE) par code postal, calcule un score, et exporte en CSV les logements énergivores pour un boîtage. C'est l'exact complément de notre module (qualifier un client existant). Les deux approches ne se recouvrent pas.
- **ChantierFlow est un solopreneur (Clément Madinier, La Jarrie, lancé 2025) à 22,50 € HT/mois pour toute l'équipe**, sans chiffre client publié et deux avis Google. Sa force n'est pas la profondeur mais la **couverture des gestes réglementaires** (attestations à 4 régimes, aides CEE/MPR déduites sous le TTC, TVA réduite guidée, facturation électronique 2026, échéances RGE/décennale/URSSAF) et un **marketing SEO très discipliné** (29 articles en 9 mois, 14 pages métier, pages « alternative à »).
- **Interfast (20 000 pros, 520 avis Google, 0 à 45 €/utilisateur) et Extrabat (41 000 utilisateurs, 50 conseillers, 49 à 99 €/utilisateur)** sont des tout-en-un avec facturation, banque, stock, app mobile native, portail client, bibliothèque fournisseurs nationale, accompagnement humain.
- **Majord'home est en avance sur tout ce qui fait vivre une entreprise d'entretien CVC** : moteur de tournées, auto-RDV client, souplesse horaire, certificats par équipement avec anomalies qui ouvrent un SAV, études Solaire / Thermique / Clim / Fumisterie, Pennylane bidirectionnel, articles multi-fournisseurs au prix d'achat réel, mailing et SMS, GeoGrid. Aucun des trois n'a l'un de ces blocs.
- **Le chemin restant n'est pas fonctionnel métier, il est « produit vendable »** : expérience de composition du devis, aides et TVA guidées sur le devis, inscription et essai sans intervention humaine, abonnement, import de données guidé, site produit, preuve sociale. Et un choix de positionnement à assumer : pas de facturation (décision du 2026-10-10) signifie « cible = entreprises sur Pennylane Essential ou plus ». La signature électronique du devis, d'abord listée ici, est **reportée** (décision du 2026-11-08, § 10) : l'envoi et l'acceptation du devis se font dans Pennylane.

## 2. ChantierFlow

### Profil
- Éditeur : Clément Madinier, entrepreneur individuel, La Jarrie (17). Lancé en 2025. Une personne. Partenaire CAPEB Charente-Maritime, French Tech Poitou-Charentes, Activateur France Num, WinLab' (CCCA-BTP).
- Hébergement : Firebase / Google Cloud. La FAQ admet une **localisation hors Union européenne** (Data Privacy Framework + clauses contractuelles types).
- Offre : **22,50 € HT/mois (27 € TTC), formule unique**, employés illimités, sans engagement, sans frais de mise en service ni de sortie. Essai : 15 devis sur 3 mois sans carte. Réception des factures électroniques gratuite même sans abonnement.
- Preuve sociale : aucun nombre de clients publié ; deux avis Google 5/5 (sept. et oct. 2026) ; 0 avis Appvizer / Capterra.
- Comparatifs publiés par l'éditeur (relevés du 29 oct. 2026) : Gazoleen 35 €/utilisateur, Extrabat 49 €/utilisateur (Éco), Batappli 79 € (formule contrats), ProGBat 29 € + 15 € (maintenance), Obat 39 à 69 €.

### Le DPE chez ChantierFlow = « Radar Prospection »
- Saisie d'un **code postal** → interrogation de trois bases : DPE ADEME (logements **E, F, G**), SIRENE (artisans du bâtiment par métier = concurrence), DVF Cerema (ventes des 5 dernières années, prix médian au m²). Complément : marchés publics BOAMP filtrés par département et métier.
- Sortie : **score d'opportunité 0-100**, volume de logements énergivores, ventes récentes, densité de concurrence, **carte interactive** (artisans + logements + ventes), navigation vers les codes postaux voisins (30 km).
- **Export CSV des logements E/F/G** (adresses du fichier DPE) pour boîtage ou porte-à-porte, réservé aux abonnés. Les DVF restent à l'écran (pas d'export, pas de ciblage : conditions d'usage du Cerema).
- Garde-fous affichés : RGPD sur le boîtage, **interdiction du démarchage téléphonique en rénovation énergétique (loi 2020-901)**, DVF hors Alsace-Moselle et Mayotte, marchés < 100 k€ HT invisibles au BOAMP.
- Angle éditorial : la loi Climat et Résilience (interdiction de louer G en 2025, F en 2028, E en 2034) crée un stock de bailleurs qui doivent rénover. Croisement « zone peu concurrentielle × passoires × marché actif ».
- Ce que le Radar **ne fait pas** : aucun filtre CVC (type de générateur, énergie, âge, clim, ECS), aucun lien avec le parc client, aucune lecture d'un DPE individuel, aucun suivi des prospects boîtés.

### Contrats d'entretien (le module le plus travaillé)
- Création depuis une facture, une intervention terminée ou l'écran contrats. **Plaque signalétique lue sur photo** → équipement mémorisé.
- Rappel **45 jours avant l'échéance** sur la page du jour et le récapitulatif du lundi ; visite en retard persistante ; la visite enregistrée rouvre la période à sa date réelle.
- **« Rien ne part tout seul »** : aucun message automatique au client. ChantierFlow rédige SMS / WhatsApp / e-mail, l'artisan envoie. Choix assumé (opposé au nôtre et à Extrabat).
- **Prise de RDV en ligne** : jusqu'à 6 créneaux libres proposés par lien, le client choisit sans compte, créneau pris disparaît.
- Facturation : « Facturer cette visite » au prix du contrat (« jamais au-dessus du prix signé »), **facturation mensuelle groupée en brouillons**, changement de prix à la période suivante annoncé par le courrier de reconduction.
- **Clients sans contrat** signalés (intervention d'il y a ~1 an, 2 ans pour PAC / clim) pour proposer un contrat.
- **Attestations à 4 régimes** avec référence réglementaire et délai de remise : chaudière 4-400 kW, PAC / clim 4-70 kW, poêle / insert bois ou granulés, ramonage. Datées du jour de la visite, rappel tant que non remise.
- **Fluides** : contrôle d'étanchéité PAC / clim rappelé 45 j avant ; export des clients et équipements au format d'import de l'application officielle « Fluides frigorigènes » (Cerfa 15497 et bilan annuel se font là-bas) ; rappel de la déclaration avant le 31 janvier.
- **Échéances de l'entreprise rappelées 60 j avant** : RGE, décennale, vigilance URSSAF, attestation de capacité fluides, détecteur de fuites, déclaration annuelle.
- Documents : contrat PDF (reconduction tacite, médiateur, rétractation, pénalités entre pros), courrier de reconduction groupé, **carnet d'entretien PDF** par appareil. 11 types d'équipements (chaudière, poêle, conduit, PAC, clim, adoucisseur, VMC, borne, PV, porte automatique, toiture).

### Devis, IA, conformité
- **Assistant IA** : description écrite, dictée ou **photo de notes** → lignes par poste avec quantités et TVA proposée ; jusqu'à 6 questions si une mesure manque ; « Relire mon devis » (5 remarques max) ; priorité au catalogue et au tarif horaire de l'artisan ; **aucun barème national**, l'IA n'apprend pas des devis passés.
- Métré intégré (pièce, ouvertures déduites, non imprimé), remises ligne / lot / devis, **ligne déchets** (décret 2020-1817), mentions particulier, plaquette 10 pages, liste matériaux sans prix, mentions légales depuis le profil.
- **Signature électronique simple** (case + confirmation) avec journal horodaté scellé, export PDF de preuve ; articles 1113, 1366, 1367 du Code civil cités.
- Factures d'acompte et de situation, relances → mise en demeure → **requête en injonction de payer** en PDF, marge par ligne, **retenue de garantie 5 %** avec rappel de restitution à un an.
- **TVA par ligne suggérée avec sa condition** (5,5 % amélioration énergétique, 10 % rénovation, 20 % neuf ; chaudières fossiles exclues depuis mars 2025 ; PV 5,5 % sous 9 kWc, batterie fait basculer à 20 %). Jamais appliquée d'office.
- **Aides CEE / MaPrimeRénov' typées** (organisme, SIREN, n° de dossier), **déduites sous le TTC** sans toucher HT ni TVA, mention automatique, **BT-113 dans le XML**, alerte RGE absente ou expirée, refus des cas incompatibles (acompte, situation, avoir, autoliquidation), deux montants suivis (net à payer / à encaisser), reste à charge estimé sur le devis.
- Export : FEC, archive TRA Cegid, CSV Sage / EBP / Ciel, livre des recettes micro. **Connecteur Pennylane** à sens unique (factures, avoirs, clients ; OAuth ; Essential ou plus ; rattrapage 30 j), partenariats Shine et Cegid.
- **Facturation électronique 2026** : UBL 2.1 EN 16931, plateforme agréée connectée ; e-reporting B2C pas encore ouvert.
- Terrain : bon d'intervention avec photos et chronomètre, **constat avant travaux, compte rendu de visite, attestation après sinistre** (dégât des eaux, effraction, bris de glace), liste de courses matériaux consolidée sur plusieurs devis, checklist de chantier IA, PV de réception.
- Photovoltaïque : modèles pré-chiffrés (3 kWc, borne 7,4 kW, tableau), lot de 17 fournitures, liens Consuel / Enedis / DP. **Admet ne faire ni calepinage ni simulation.**
- **Limites admises** par l'éditeur : pas de stock, pas de paiement en ligne, pas de base de prix nationale, pas de marketplace, hébergement hors UE.

### Marketing
- Blog : 29 articles depuis février 2026 (≈ 3 par mois), modèles de devis par métier, acomptes, TVA, facturation électronique, aides.
- 14 pages métier, pages « alternative à Obat / Tolteck », page « changer de logiciel » (export Batigest / EBP), outils gratuits (calcul métré, marge, TVA), réception e-factures gratuite comme produit d'appel.

## 3. Interfast

- Éditeur : Hedi Marinier, ancien dirigeant d'une entreprise de climatisation (Nanterre). France et Belgique. Chiffres éditeur : **+20 000 professionnels**, 5/5 sur **+520 avis Google**, 15 M d'articles et **130 fournisseurs** dans la bibliothèque, 50 modèles de devis, 200 modèles de rapports. Partenaire CAPEB (−15 % pendant 12 mois).
- **Tarifs par utilisateur et par mois HT, « inchangés depuis 2021 »**, sans engagement, satisfait ou remboursé 30 j, plateforme agréée incluse partout :
  - **Basic 0 €** : devis et factures illimités, bons d'intervention, facturation électronique.
  - **Starter 15 €** : signature électronique, bibliothèque 15 M, CRM, déchets et éco-participation, planning, app mobile, rapports, **portail client**, import d'anciens devis par IA, 1 compte bancaire, accompagnement illimité.
  - **Pro 30 €** (le plus vendu) : WhatsApp chantier, **primes énergétiques**, **maintenance et équipements**, hors ligne mobile, rapprochement bancaire multi-comptes, commandes / achats / notes de frais, pipeline commercial, sync e-mails et agendas, automatisations, export comptable, feuilles d'heures, **stocks**, QR codes.
  - **Business 45 €** : géoloc avancée, **serveur MCP** (Claude / ChatGPT), import DPGF, GMAO avancée, multi-agences, droits par rôle, API.
- IA : devis en langage naturel, import d'anciens devis et factures, OCR des factures fournisseurs → commande, planification automatique, « Copilote » (questions sur ses chiffres), agent IA vocal (témoignage « zéro appel manqué »).
- GMAO : préventif / curatif, visites récurrentes, 90 gammes, équipements, rentabilité ; **Cerfa 15497 et Trackdéchets natifs**. Les pages publiques décrivent peu les contrats (reconduction, attestations, rappels client).
- Portail client : devis, factures, chantiers, bons d'intervention, messagerie. Pas de signature ni de paiement décrits.
- Pas de Pennylane : comptabilité et banque intégrées.
- Pages comparatives face à Codial, Batigest, Graneet, Obat, Organilog.

## 4. Extrabat

- Éditeur historique (Paris), **41 000 utilisateurs**, 50 conseillers, 1 000 formations par an, 4 langues, 6 pays, données hébergées en France. Versions métier : **Chauffage (chauffagistes, cheministes, climaticiens)**, Piscine, Menuiserie, Paysage, Bâtiment.
- 15 modules, « +200 fonctionnalités » (plaquette Chauffage 2026) : CRM (28), gestion commerciale (33 : devis, commandes, BL, factures, avoirs, commandes fournisseurs, remises en banque), générateur de documents (dossier d'offre multi-documents, 30 colonnes de devis), **base articles 120 catalogues fournisseurs + EDI**, comptabilité (option : journaux, lettrage, rapprochement, OCR achats), signature électronique (option, partenaire), agenda (géoloc, **rappel RDV SMS / e-mail à J-1**, glisser-déposer), chantiers (modèles avec tâches), SAV (formulaires, coût du SAV sous garantie, signature hors ligne), **contrats de services (17 : rappel SMS automatique aux échéances avec demande de prise de RDV, planification des récurrences)**, géolocalisation (« gestion et optimisation des tournées »), SMS & e-mailing (relance par cycle d'achat), bibliothèque de notices, **espace client** (messagerie 24/7, documents, équipements, notices), statistiques (200 tableaux, Premium), Extrabat Today (mobile), **C'Fluide** (option Cerfa fluides).
- Argument phare : **« devis signé en 1 clic → 10 automatisations »** (tâches, marge prévisionnelle, heures, espace client, planning, commandes fournisseurs, garanties et n° de série, dossier SAV, campagnes, prévisionnel de facturation).
- Tarifs (relevés tiers, grille non publiée) : **Éco 49 € / Standard 69 € (planning, SAV, contrats) / Premium 99 € par utilisateur et par mois**, options payantes (compta, signature, C'Fluide), démo assistée plutôt qu'essai libre.
- Faiblesses rapportées : prise en main longue (formations), interface vieillissante, changements fréquents, moins de 20 intégrations réelles malgré « 86 », pas d'appels d'offres, conçu pour < 20 salariés.

## 5. Matrice Majord'home / ChantierFlow / Interfast / Extrabat

Légende : ✅ présent · ◐ partiel · ❌ absent · ? non vu dans les sources.

### Commercial et devis
| Critère | Majord'home | ChantierFlow | Interfast | Extrabat |
|---|---|---|---|---|
| Devis paramétrable (familles, chapitres, modèle) | ✅ | ✅ | ✅ 50 modèles | ✅ 30 colonnes |
| IA « description → lignes de devis » | ❌ (IA = métré fumisterie, dimensionnement clim, import d'offre) | ✅ texte, voix, photo | ✅ + import anciens devis | ❌ |
| Bibliothèque de prix | ◐ 7 fournisseurs importés par scripts, prix nets réels | ◐ catalogue perso + import CSV | ✅ 15 M articles, 130 fournisseurs | ✅ 120 catalogues + EDI |
| Signature électronique du devis | ❌ volontaire (contrat ✅, PV ✅, certificat ✅ ; acceptation gérée dans Pennylane, § 10) | ✅ simple + journal | ✅ | ✅ option |
| Aides CEE / MPR sur le devis | ❌ | ✅ typées, sous TTC, BT-113 | ✅ Pro | ? |
| TVA réduite guidée par condition | ◐ taux par famille / ligne | ✅ | ◐ | ? |
| Métré intégré | ◐ fumisterie | ✅ | ◐ DPGF (Business) | ❌ |
| Pipeline commercial | ✅ Kanban piloté par Pennylane | ❌ | ✅ Pro | ✅ |
| Études techniques (PV, thermique, clim, fumisterie) | ✅ | ❌ | ❌ | ❌ |

### Facturation et finance
| Critère | Majord'home | ChantierFlow | Interfast | Extrabat |
|---|---|---|---|---|
| Factures, acomptes, situations, avoirs | ❌ Pennylane (décision 2026-10-10) | ✅ | ✅ dès 0 € | ✅ |
| Facturation électronique 2026 (PA) | ❌ via Pennylane | ✅ | ✅ incluse | ✅ annoncée |
| Relances impayés, injonction | ❌ | ✅ | ✅ auto | ✅ |
| Retenue de garantie 5 % | ❌ | ✅ | ✅ | ? |
| Banque, rapprochement, trésorerie | ❌ Pennylane | ❌ | ✅ Pro | ✅ option |
| Lien comptabilité | ✅ Pennylane bidirectionnel (clients par deltas, devis, factures) | ✅ FEC, Cegid, Shine, Pennylane 1 sens | ✅ exports, accès comptable | ✅ exports, compta intégrée |

### Entretien et SAV
| Critère | Majord'home | ChantierFlow | Interfast | Extrabat |
|---|---|---|---|---|
| Contrats + tarification | ✅ zones × types, dégressivité, forçage | ✅ | ✅ Pro | ✅ Standard |
| Échéances et rappels internes | ✅ programmation, grands secteurs | ✅ 45 j, page du jour | ✅ alertes | ✅ |
| Rappel client automatique (SMS / e-mail) | ✅ rappel entretien, RDV J-1, avis | ❌ volontairement | ✅ | ✅ SMS + demande RDV |
| Prise de RDV en ligne par le client | ✅ /rdv/:token calculée par le moteur | ✅ 6 créneaux sans compte | ✅ | ✅ |
| Tournées optimisées | ✅ moteur, souplesse, journée figée | ◐ « optimisation d'itinéraire » | ◐ géoloc | ◐ géoloc + « optimisation » |
| Attestations entretien / ramonage | ✅ certificat par équipement + attestation | ✅ 4 régimes réglementaires | ✅ 200 modèles | ✅ rapports signés |
| Fluides (Cerfa 15497) | ◐ étape F-gaz du certificat, pas d'export | ◐ export vers l'app officielle + rappels | ✅ natif + Trackdéchets | ✅ option C'Fluide |
| Échéances entreprise (RGE, décennale, URSSAF) | ❌ (certificats RGE déposés, sans alerte) | ✅ 60 j | ? | ? |
| Anomalie de certificat → SAV | ✅ automatique | ❌ | ◐ curatif | ✅ module SAV |
| Documents de l'appareil (notice, vue éclatée, carnet) | ✅ par marque + modèle | ✅ carnet PDF | ◐ | ✅ bibliothèque |
| Clients sans contrat à relancer | ◐ (à vérifier) | ✅ ~1 an, 2 ans PAC | ? | ✅ cycle d'achat |

### Chantiers et terrain
| Critère | Majord'home | ChantierFlow | Interfast | Extrabat |
|---|---|---|---|---|
| Chantier par devis, appros, planning multi-tech | ✅ | ✅ + checklist IA | ✅ | ✅ + 10 automatisations |
| Rapport d'intervention photo + signature sur mobile | ◐ fiche intervention, certificat, mémo vocal | ✅ bon, constat, attestation sinistre | ✅ hors ligne (Pro) | ✅ hors ligne |
| PV de réception signé | ✅ | ✅ | ✅ | ✅ |
| Application mobile native | ❌ PWA, viewport tablette | ❌ web responsive | ✅ | ✅ |
| Stock, bons de commande fournisseur | ❌ (statut d'appros) | ❌ | ✅ Pro | ✅ |
| Déchets (décret 2020-1817, Trackdéchets) | ❌ | ✅ ligne déchets | ✅ Trackdéchets | ? |

### Client, marketing, données
| Critère | Majord'home | ChantierFlow | Interfast | Extrabat |
|---|---|---|---|---|
| Portail client | ❌ (pages à jeton : RDV, signature, PV) | ◐ liens sans compte | ✅ Starter | ✅ + messagerie |
| Mailing / SMS campagnes | ✅ segments, Resend, Twilio | ❌ | ◐ automatisations | ✅ |
| Prospection | ✅ SIRENE B2B, GeoGrid, Meta Ads, Territoire | ✅ Radar DPE × DVF × SIRENE, marchés publics | ◐ pipeline | ✅ CRM |
| DPE | ✅ fiche client (investigation, voisinage, synthèse PDF, équipements) | ✅ zone (E/F/G, export boîtage) | ❌ | ❌ |
| Webshop | ✅ | ❌ | ❌ | ◐ comptoir |
| Journal d'audit | ✅ mouchard | ❌ | ? | ? |

### Plateforme et SaaS
| Critère | Majord'home | ChantierFlow | Interfast | Extrabat |
|---|---|---|---|---|
| Multi-tenant, modules par org, droits par profil | ✅ | ✅ mono-formule | ✅ (Business) | ✅ |
| Inscription et essai sans humain | ❌ | ✅ 15 devis sans CB | ✅ gratuit à vie + 7 j | ◐ démo assistée |
| Abonnement payé en ligne | ❌ | ✅ | ✅ CB, SEPA | ◐ devis |
| Import de données guidé (clients, contrats, prix) | ❌ (Excel à la main) | ✅ CSV / Excel, guide Batigest / EBP | ✅ import IA + accompagnement | ✅ conseillers |
| API / MCP | ◐ edges, Hermes | ❌ | ✅ API + MCP (Business) | ✅ API |
| Hébergement affiché | Supabase (région à vérifier et afficher) | Google Cloud hors UE | Europe | France |
| Site produit, aide, preuve sociale | ❌ (aucun client hors Mayer) | ✅ 29 articles, 14 pages métier, 2 avis | ✅ 520 avis, guides | ✅ 100 ressources, formations |

## 6. Ce que Majord'home a et qu'aucun des trois n'a

1. **Moteur de tournées** : grands secteurs, budget par technicien trajets compris, souplesse horaire, journée pleine figée seule, dépôt / retour par technicien, auto-RDV client calculé à l'instant. Les trois n'ont qu'une géolocalisation ou une promesse d'« optimisation ».
2. **Certificat → anomalie → SAV → devis**, documents de l'appareil par marque et modèle, photo de plaque qui suit la carte SAV.
3. **Études techniques** : Solaire (PVGIS, scénarios, étude PDF, démarches), Thermique (EN 12831, PAC), Climatisation (dimensionnement Solipac), Fumisterie (19 configurations métrées sur tarif réel). ChantierFlow écrit noir sur blanc qu'il ne fait « ni calepinage ni simulation ».
4. **Pennylane dans les deux sens** (fiche client par deltas, devis miroir, rattachement auto au pipeline, import de factures). ChantierFlow ne pousse que des factures.
5. **Articles communs × fournisseurs** au prix d'achat réel lu dans les factures Pennylane, offres fournisseurs PDF lues par IA, prix publics.
6. **DPE sur la fiche client** avec voisinage cartographié, synthèse PDF et brouillons d'équipements.
7. **GeoGrid + Search Console**, **Meta Ads ROI**, mailing segmenté sur le placement Pennylane, webshop, mouchard, profils de droits « maison », agent téléphonique.

Ces blocs sont la raison d'acheter Majord'home plutôt qu'un tout-en-un. Ils doivent rester le cœur du discours ; courir après la facturation ou le stock les diluerait.

## 7. Axes d'amélioration — DPE

Notre module ne fait que montrer la donnée d'un client (spec du 2026-08-12 : « aucune interprétation, aucun ciblage, aucune liste », mesure du taux de réponse d'abord). ChantierFlow a pris la direction opposée : zone, score, liste. Les deux sont légitimes ; les axes ci-dessous les relient sans trahir la spec.

### 7.1 Couche « passoires » sur la carte Territoire (court terme, le plus différenciant)
- Afficher sur `TerritoireMap` les DPE **E/F/G** d'une commune ou d'un secteur, avec **filtres CVC que ChantierFlow n'a pas** : type de générateur (chaudière fioul / gaz, poêle, PAC absente), énergie, âge estimé (`isAgingGenerator`, `extractGeneratorPeriod` existent déjà), présence de clim, type d'ECS. Le champ générateur est renseigné à 98,7 % sur les DPE récents (mesure du 2026-08-12).
- **Croiser avec ce que nous seuls avons** : le parc client (taux de pénétration par rue ou par commune), les grands secteurs d'entretien et les journées de tournée (boîter les rues où le technicien passe déjà = la stratégie ramonage 400 → 800), les zones de tarification.
- Sortie : liste exportable (CSV, étiquettes, courrier) et compteur par secteur. Pas de téléphone : le démarchage téléphonique en rénovation énergétique est interdit (loi 2020-901) ; ChantierFlow l'affiche, nous devons l'afficher aussi.
- Prérequis technique : le volume d'une commune dépasse ce que le navigateur peut appeler à la demande. Il faut une edge function et un cache serveur (table `majordhome.dpe_zone_cache` ou équivalent, par commune, rafraîchi mensuellement, l'ADEME publie en continu). C'est une **décision à prendre** car la spec actuelle interdit toute écriture en base : relire le compteur de réponse de `useClientInvestigation` avant d'investir.
- DVF : optionnel. Le Cerema interdit d'identifier vendeurs et acquéreurs ; un agrégat « ventes récentes par IRIS ou commune » suffit à repérer les quartiers qui bougent. À traiter après les DPE.

### 7.2 Du DPE au devis et à l'étude (moyen terme)
- Depuis la fiche DPE d'un client : « Proposer un remplacement » → lead + devis pré-rempli (famille PAC ou poêle selon `buildRecommendations`), avec les caractéristiques du logement en pièce jointe du devis.
- Pré-remplir l'**étude thermique** depuis le DPE (surface, année, isolation, générateur, émetteurs) : c'est la Phase 2 décidée le 2026-08-06 (brancher l'étude au lead) avec une source de données déjà en place.
- Aides : afficher le reste à charge estimé sur ces devis (voir § 8.1), le DPE E/F/G étant précisément ce qui ouvre MaPrimeRénov' rénovation d'ampleur.

### 7.3 Hygiène du module existant
- Mesurer et afficher le taux de réponse (le compteur existe, aucun chiffre consolidé n'est noté dans la doc).
- Écrire `equipments.category_id` et non `category` dans `buildEquipmentDrafts` avant la migration M2 (déjà signalé dans CLAUDE.md).
- Emprise de bâtiment (BDNB `batiment_groupe`) plutôt que parcelle, si le voisinage est trop ambigu en pavillonnaire.

## 8. Chemin restant vers Interfast et Extrabat

Par ordre de valeur pour la commercialisation, pas par facilité.

### 8.1 Table stakes du devis (quelques semaines)
- **Expérience de composition du devis** (priorité posée par Eric le 2026-11-08, § 10) : l'écran unique de création, l'éditeur de lignes par chapitres, le picker d'articles et la fiche devis sont jugés pénibles à l'usage. À cadrer avec lui à partir d'un devis réel avant tout plan ; c'est le préalable à tout ce qui suit dans ce paragraphe.
- **Signature électronique du devis natif : reportée.** Le pattern existe déjà (`ContractSign` / `PvReceptionSign`, lien à jeton, journal horodaté, PDF), donc coût nul le jour venu, mais l'acceptation du devis vit aujourd'hui dans Pennylane (§ 10). Les trois concurrents l'affichent ; à rouvrir seulement sur demande d'Eric, pour un client qui n'enverrait pas ses devis depuis Pennylane.
- **Aides CEE / MaPrimeRénov' sur le devis** : saisie typée (organisme, SIREN, n° dossier), déduction sous le TTC, reste à charge estimé, mention de réserve, deux montants (net à payer / à encaisser). À faire passer dans Pennylane comme paiement tiers, pas comme remise (la règle BT-113 côté facture est à Pennylane).
- **TVA réduite guidée** : proposer le taux avec sa condition par ligne (5,5 % amélioration énergétique, chaudières fossiles exclues depuis mars 2025, PV sous 9 kWc), jamais appliqué d'office. Nous avons déjà la TVA par famille ; il manque la règle et l'avertissement.
- Ligne déchets (décret 2020-1817) et retenue de garantie : petits, attendus par les artisans qui comparent.

### 8.2 Entretien : combler trois trous visibles
- **Échéances de l'entreprise** (RGE par qualification, décennale, vigilance URSSAF, attestation de capacité fluides, déclaration annuelle fluides) avec rappel à 60 j. Les certificats RGE sont déjà déposés pour l'attestation d'entretien : il manque la date de fin et l'alerte.
- **Fluides** : export des clients et équipements sous contrat au format d'import de l'application officielle (ChantierFlow le fait) ; à terme Cerfa 15497 depuis le certificat (Interfast natif).
- **Clients sans contrat** : liste des clients avec intervention ou installation depuis ~1 an sans contrat actif, avec proposition de contrat en un clic. Vérifier ce que le Dashboard des entretiens couvre déjà avant d'ajouter.

### 8.3 Le produit vendable (le vrai chemin, plusieurs mois)
- **Inscription et essai sans humain** : création d'org, premier admin, modules par défaut, données de démo. Aujourd'hui tout passe par Baikal et des migrations à la main. Interfast offre un plan gratuit à vie, ChantierFlow 15 devis sans carte.
- **Abonnement** : plans, paiement CB / SEPA, factures d'abonnement, relances. Rien n'existe.
- **Import de données guidé** : clients, équipements, contrats, bibliothèque de prix depuis Excel / CSV, avec rapport d'écarts. L'import Mayer de février 2026 a été fait à la main ; ChantierFlow publie un guide « quitter Batigest / EBP », Interfast importe les anciens devis par IA.
- **Site produit, pages métier, aide en ligne, CGV, DPA, région d'hébergement affichée.** Un éditeur seul publie 3 articles par mois ; nous n'avons aucune page publique qui ne soit pas Mayer. La région Supabase doit être connue et écrite (argument contre ChantierFlow, hébergé hors UE).
- **Preuve sociale** : 0 client hors Mayer. Une deuxième entreprise pilote (H&E est déjà en base) et des avis Google sont la première marche.
- **Application mobile** : la PWA tient pour la tablette durcie ; un technicien qui compare verra « pas d'app » sur les stores. Pas prioritaire tant que le hors-ligne n'est pas demandé.

### 8.4 Ce qu'il ne faut pas poursuivre
- **Facturation, banque, trésorerie, stock** : Interfast et Extrabat y ont dix ans d'avance et Eric a tranché (2026-10-10). Assumer le positionnement « votre finance reste dans Pennylane, Majord'home fait le métier », et le dire sur la page produit. Conséquence à accepter : la cible est une entreprise déjà sur Pennylane Essential ou plus, ou prête à y passer.
- **Bibliothèque nationale de prix** : ChantierFlow lui-même refuse le barème national au profit des prix de l'artisan. Notre matrice articles × fournisseurs au prix d'achat facturé est plus juste ; ce qui manque est un **import self-service** d'un tarif fournisseur (CSV, PDF par IA) par l'utilisateur, pas un référentiel national.
- **Multi-métiers tous corps d'état** : rester CVC / énergie (poêle, PAC, clim, PV, ramonage, fumisterie). C'est là que nos moteurs ont du sens et que les trois autres sont génériques.

## 9. Repères de prix (HT, relevés novembre 2026)

| Éditeur | Formule | Prix |
|---|---|---|
| ChantierFlow | unique, équipe illimitée | 22,50 €/mois |
| Interfast | Basic / Starter / Pro / Business | 0 / 15 / 30 / 45 € par utilisateur |
| Extrabat | Éco / Standard / Premium + options | 49 / 69 / 99 € par utilisateur |
| Gazoleen (Nomadia) | base, module fluides | 35 € par utilisateur + 9 € |
| Obat | Pro / Croissance | 39 à 69 €/mois |
| Batappli | formule contrats | 79 €/mois |
| ProGBat | base + maintenance | 29 € + 15 €/mois |

Lecture : une entreprise d'entretien CVC de 4 personnes paie 120 €/mois chez Interfast Pro, 276 €/mois chez Extrabat Standard, 22,50 € chez ChantierFlow. Un positionnement Majord'home entre 30 et 60 € par utilisateur se justifie par les moteurs (tournées, études, auto-RDV), à condition que l'entretien soit le cœur de l'activité du prospect.

## 10. Décisions prises depuis la lecture

### 2026-11-08 — devis : signature reportée, expérience de composition d'abord
- **Flux réel de Mayer aujourd'hui** : le devis est composé dans Majord'home, poussé dans Pennylane, **envoyé au client depuis Pennylane** ; le mail de validation revient, Eric tague « accepté » dans Pennylane, et la synchronisation Pennylane redescend le statut vers la carte Gagné du pipeline et le chantier. En base ce jour : 16 devis natifs à l'état « envoyé », tous poussés dans Pennylane, aucun accepté ni refusé dans Majord'home.
- **Signature électronique du devis : pas maintenant.** La signature maison (contrats, PV de réception, certificats : pad tactile, image + nom + horodatage, PDF régénéré) coûte zéro à réutiliser ; un prestataire eIDAS facturerait 20 à 40 € par utilisateur et par mois, ou 1 à 5 € l'acte. Elle n'est pourtant pas branchée sur les devis tant que l'acceptation se fait dans Pennylane : ce serait un second endroit pour la même décision. Le jour venu, l'API Pennylane permet de refléter une signature prise chez nous (`PUT /quotes/{id}/update_status`, `POST /quotes/{id}/appendices` pour joindre le PDF signé).
- **Priorité : l'expérience de composition du devis** (Eric : « l'UI est un peu pénible mais on va la travailler »). Chantier à cadrer avec lui à partir d'un devis réel, puis design validé avant toute ligne de code. Les briques du § 8.1 (aides, TVA guidée, déchets, retenue) viennent après.
- **Angle mort à garder en tête** : `lead_quote_stats` et le trigger qui crée un chantier ne lisent que les devis Pennylane ; un devis natif accepté dans Majord'home n'alimenterait ni le Kanban Gagné ni un chantier. Sans effet tant que l'acceptation se fait dans Pennylane ; bloquant le jour où un client sans Pennylane signerait chez nous (chantier 1a du plan de distribution).

## 11. Sources

- ChantierFlow : [accueil](https://chantierflow.com/), [tarifs](https://chantierflow.com/tarifs), [Radar de prospection](https://chantierflow.com/trouver-des-chantiers), [article données publiques](https://chantierflow.com/blog/donnees-publiques-trouver-chantiers-artisan), [fonctionnalités devis](https://chantierflow.com/logiciel-devis-artisan), [contrats d'entretien](https://chantierflow.com/logiciel-contrat-entretien), [connecteur Pennylane](https://chantierflow.com/connecteur-pennylane), [chauffagiste](https://chantierflow.com/chauffagiste), [photovoltaïque](https://chantierflow.com/photovoltaique), [devis IA](https://chantierflow.com/devis-ia), [à propos](https://chantierflow.com/a-propos), [FAQ](https://chantierflow.com/faq), [vs Obat](https://chantierflow.com/alternative-obat), [aides CEE / MPR](https://chantierflow.com/blog/prime-cee-maprimerenov-facture-artisan), [blog](https://chantierflow.com/blog) ; fiches [Les Pépites Tech](https://lespepitestech.com/startup-de-la-french-tech/chantierflow), [Appvizer](https://www.appvizer.fr/finance-comptabilite/facturation/chantierflow), [Capterra](https://www.capterra.com/p/10037386/ChantierFlow/).
- Interfast : [accueil](https://inter-fast.fr/), [tarifs](https://inter-fast.fr/ressources/page-pricing), [GMAO](https://inter-fast.fr/fonctionnalites/logiciel-gmao), [chauffagiste](https://inter-fast.fr/metiers/logiciel-chauffagiste), [IA](https://inter-fast.fr/fonctionnalites/ia), [portail client](https://inter-fast.fr/fonctionnalites/logiciel-portail-client) ; [interview Batiweb](https://www.batiweb.com/actualites/numerique-bim/notre-mission-c-est-d-abolir-les-doubles-journees-de-travail-interfast-42048), [CAPEB](https://www.capeb.fr/partenaires-commerciaux/inter-fast), [Appvizer](https://www.appvizer.fr/operations/gestion-commerciale/interfast).
- Extrabat : [plaquette Chauffage 2026](https://www.extrabat.com/wp-content/uploads/2026/07/EXTRABAT-plaquette-chauffage_2026_WEB_compressed-1.pdf) (texte extrait), [Appvizer](https://www.appvizer.fr/construction/btp/extrabat), [logiciels.pro](https://www.logiciels.pro/extrabat/), [independant.io](https://independant.io/alternative-extrabat/), [La Fabrique du Net](https://www.lafabriquedunet.fr/logiciel/extrabat). Le site extrabat.com a refusé la connexion (réinitialisée) à chaque tentative.
- Marché : [Gazoleen (Appvizer)](https://www.appvizer.fr/operations/gestion-des-interventions/gazoleen), [comparatif chauffagistes 2026](https://hackceleration.com/fr/labs/meilleur/logiciel-chauffagiste-climatisation), [tool-advisor](https://tool-advisor.fr/logiciel-facturation/comparatif/logiciel-devis-facture-chauffagiste/), [Qonto](https://qonto.com/fr/blog/gestion-entreprise/btp-construction/logiciel-chauffagiste).
