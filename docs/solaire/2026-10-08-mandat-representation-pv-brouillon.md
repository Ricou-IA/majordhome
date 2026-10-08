# Mandat de représentation — démarches administratives PV (brouillon à valider)

> Brouillon rédigé le 2026-10-08 à partir de deux modèles publics :
> - **APEM Énergie, « Mandat spécial PV » v27** (mandat combiné urbanisme + raccordement, tripartite mandant / mandataire / installateur) — https://api.rexel.fr/dam/media/content/1/74251091/11750663?format=DOCUMENTS
> - **Enedis-FOR-RAC_02E v5 (02/12/2019)** « Mandat de représentation pour le raccordement d'un ou plusieurs sites au Réseau Public de Distribution d'électricité » — modèle officiel recommandé par Enedis, à produire avec toute demande de raccordement ; Enedis autorise le mandataire à le mettre sous sa propre identité visuelle — https://www.monkitsolaire.fr/img/cms/pdf-admin/MANDAT%20ENEDIS.pdf (exemplaire rempli par un installateur) et v4 https://www.raccordement-entreprise-enedis.fr/Asset/Documents/DOC_6_mandat.pdf
>
> Base légale du dépôt par mandataire : art. R.423-1 du Code de l'urbanisme (déclaration préalable déposée par le propriétaire, **son mandataire**, ou une personne autorisée à exécuter les travaux). Limite : le mandataire ne peut pas former de recours contre un refus de la mairie (le client doit agir lui-même).
>
> Adaptations faites : bipartite (le mandataire EST l'installateur, pas de tiers APEM) ; valeurs d'org via `buildCompanyInfo(settings)` ({{…}}) ; **condition d'effet = acceptation du devis** (signé à l'offre, utilisé plus tard) ; pouvoir de règlement Enedis inclus (Mayer avance et refacture).

---

## Mandat spécial de représentation
### pour les démarches administratives relatives à l'installation photovoltaïque et au raccordement du site au Réseau Public de Distribution d'électricité

### Désignation des parties

**Entre les soussignés :**

M. / Mme **{{declarant.civilite}} {{declarant.prenom}} {{declarant.nom}}**, né(e) le {{declarant.date_naissance}} à {{declarant.naissance_commune}} ({{declarant.naissance_departement}}), domicilié(e) {{declarant.adresse}},
ci-après désigné(e) « **le Mandant** », d'une part,

**et**

La société **{{company.legal_name}}** ({{company.legal_form}}, capital de {{company.capital}}), dont le siège est {{company.address}}, {{company.postal_code}} {{company.city}}, immatriculée au RCS de {{company.rcs}}, n° SIRET {{company.siret}}, représentée par {{signataire_societe.nom}} en qualité de {{signataire_societe.fonction}}, dûment habilité(e) à cet effet,
ci-après désignée « **le Mandataire** », d'autre part.

Le Mandant et le Mandataire sont désignés individuellement « Partie » et collectivement « Parties ».

### Désignation du site et du projet

- Adresse du site : **{{site.adresse}}**, {{site.code_postal}} {{site.commune}}
- Références cadastrales : {{cadastre.parcelles}} (commune INSEE {{cadastre.commune_insee}})
- Nature des opérations : **raccordement de logement individuel d'une installation de production photovoltaïque en toiture**, puissance crête {{projet.puissance_kwc}} kWc, {{projet.mode_valorisation_libelle}} (autoconsommation {{avec vente du surplus | sans injection}})
- Devis de référence : n° {{devis.numero}} du {{devis.date}}

### Article 1 — Objet du mandat

Par le présent mandat, le Mandant donne pouvoir au Mandataire, et à lui seul, pour réaliser en son nom et pour son compte, en lien avec le projet désigné ci-dessus, les démarches, éditions de documents et signatures nécessaires auprès des administrations compétentes pour :

☑ **la déclaration préalable de travaux** auprès de la mairie de {{site.commune}} (établissement du dossier, dépôt en mairie ou par le guichet numérique, réponse aux demandes de pièces complémentaires, adaptation du projet aux prescriptions éventuelles de l'Architecte des Bâtiments de France) ;

☑ **la demande de raccordement** de l'installation auprès d'Enedis, gestionnaire du Réseau Public de Distribution d'électricité, ou, selon le mode de valorisation retenu, **la convention d'autoconsommation sans injection (CACSI)**, ainsi que la mise en service de l'installation.

### Article 2 — Pouvoirs du Mandataire auprès d'Enedis

*(rédaction alignée sur le modèle Enedis-FOR-RAC_02E, pour que le document soit recevable par Enedis)*

Le Mandataire devient l'interlocuteur d'Enedis pour toutes les étapes du raccordement. À ce titre, il est seul destinataire des documents relatifs au déroulement de l'opération de raccordement ; Enedis se réserve toutefois le droit de prévenir le Mandant en cas de risque de sortie de file d'attente, en particulier à l'approche de l'échéance de l'offre de raccordement.

Dans le cadre de ce mandat, le Mandant donne pouvoir au Mandataire, pour le site désigné ci-dessus, de :

☑ signer en son nom et pour son compte tout document contractuel relatif au raccordement : Proposition de Raccordement (PDR), Proposition Technico-Financière, Convention de Raccordement, Convention de Raccordement Directe, Convention d'Autoconsommation Sans Injection (CACSI), ainsi que, pour une installation de production de puissance de raccordement inférieure ou égale à 36 kVA, le Contrat d'Accès au réseau et d'Exploitation (CAE). Ces documents demeurent rédigés au nom du Mandant ; le Mandataire prend toute disposition pour assurer la pleine information du Mandant sur les clauses particulières afférentes au projet ;

☑ procéder en son nom et pour son compte aux règlements financiers relatifs au raccordement. À ce titre, Enedis adressera tous documents financiers (factures, relances…) au Mandataire, étant entendu que ceux-ci demeureront émis au nom du Mandant. *(Les frais ainsi avancés sont refacturés au Mandant selon les conditions du devis.)*

☐ en cas de recours à l'article L.342-2 du Code de l'énergie, exécuter le contrat de mandat et ses annexes au nom et pour le compte du Mandant. *(non coché par défaut — réseau à étendre, cas rare en résidentiel)*

En considération du présent mandat, le Mandataire pourra notamment :
- demander auprès des services compétents d'Enedis la communication de toute information confidentielle concernant le Mandant, au sens de l'article R.111-26 du Code de l'énergie, relatif à la confidentialité des informations détenues par les gestionnaires de réseaux publics de transport ou de distribution d'électricité. Les informations communiquées ne peuvent concerner que les seules informations utiles à l'étude et à la réalisation du raccordement du site désigné, à l'exclusion de toute autre utilisation ;
- mettre fin à l'affaire de raccordement, en accord avec le Mandant.

### Article 3 — Obligations qui restent à la charge du Mandant

Le Mandant est informé qu'il reste lui-même responsable des obligations annexes à sa demande d'autorisation d'urbanisme, et notamment :
- de **l'affichage sur le terrain** de l'autorisation obtenue, visible depuis la voie publique, pendant toute la durée du chantier et jusqu'à la fin du délai de recours des tiers ;
- de **l'envoi de la déclaration attestant l'achèvement et la conformité des travaux (DAACT)** à la mairie à l'issue des travaux ;
- de la signature du contrat d'achat de l'électricité (obligation d'achat) lorsque le projet prévoit la vente du surplus ;
- de la transmission immédiate au Mandataire de tout courrier ou toute demande de pièces reçus directement des administrations concernées.

Le Mandant déclare être propriétaire du site ou disposer des droits nécessaires pour y réaliser les travaux. *(En copropriété ou en lotissement : il déclare avoir obtenu les accords requis.)*

### Article 4 — Protection des données

Le Mandataire utilise les informations personnelles du Mandant aux seules fins pour lesquelles elles lui ont été communiquées et ne les transmet qu'aux organismes et administrations auxquels elles sont destinées par l'objet même du mandat. Le Mandataire s'engage à respecter la réglementation relative à la protection des données personnelles (RGPD). *(lien vers la politique de confidentialité de l'org si elle existe : {{company.website_url}})*

### Article 5 — Prise d'effet, durée et fin du mandat

Le présent mandat est donné pour le seul site désigné ci-dessus.

Il est signé à l'occasion de la remise de l'offre et **ne produit effet qu'à compter de l'acceptation par le Mandant du devis n° {{devis.numero}}** (ou de tout devis qui s'y substituerait pour le même site). À défaut d'acceptation du devis dans un délai de **douze mois** à compter de sa signature, il est caduc de plein droit.

Il est valable pour les demandes exprimées dans l'année qui suit sa prise d'effet et prend fin lors de la mise en service de l'installation de production, ou de la modification de sa puissance de raccordement, ou de la mise à disposition par Enedis des ouvrages de raccordement.

Le Mandant peut y mettre fin à tout moment par écrit ; en cas de changement de mandataire en cours de traitement d'une demande de raccordement, il en informe Enedis par écrit.

### Article 6 — Responsabilité

Le Mandataire ne peut être tenu pour responsable des délais de réponse et d'exécution des administrations et organismes impliqués (mairie, Architecte des Bâtiments de France, Enedis ou ses prestataires, Consuel, acheteur obligé), ni des conséquences d'informations erronées qui lui auraient été communiquées, ni du tarif d'achat appliqué par l'acheteur obligé à l'électricité produite, celui-ci étant seul décisionnaire en la matière.

Le présent mandat n'emporte pas pouvoir de représenter le Mandant en justice ni de former un recours contre une décision administrative.

### Signatures

Fait en deux exemplaires originaux, dont un est remis à chacune des Parties, qui reconnaît en avoir reçu communication.

| Le Mandant | Le Mandataire |
|---|---|
| {{declarant.prenom}} {{declarant.nom}} | {{company.legal_name}}, représentée par {{signataire_societe.nom}} |
| À {{consent.signature_lieu}}, le {{consent.signed_at}} | À {{company.city}}, le {{consent.signed_at}} |
| *(signature manuscrite tablette — `consent.signature_path`)* | *(signature + cachet de l'org — image à paramétrer dans Settings)* |

---

## Notes d'intégration (pour la spec)

- **Source des champs** : déclarant = `pv_dossiers.declarant` (déjà collecté pour le CERFA : nom, prénom, date et lieu de naissance) ; site = `location` + `cadastre` ; projet = scénario sélectionné + `mode_valorisation` (nouveau champ Démarches) ; société = `buildCompanyInfo(settings)` ; **signature et date = `pv_dossiers.consent`** (déjà recueillis sur tablette, un seul geste de signature pour le CERFA et le mandat).
- **Manque côté org** : nom et fonction du signataire société, image de signature/cachet → 2 nouveaux champs `settings` à exposer dans Settings → Organisation → Identité (règle « pas de config sans UI »).
- **Manque côté dossier** : numéro et date du devis de référence (lien Pennylane, ou saisie libre tant que les devis natifs ne sont pas livrés).
- Les textes de `consentItems.js` (`dp_depot`, `enedis_raccordement`) deviennent le **résumé** affiché à l'écran avant signature ; le mandat complet est le document généré (`MandatPDF.jsx`), assemblé dans le dossier après le CERFA.
- Enedis exige **les deux signatures** (mandant et mandataire) : la signature de l'org doit être apposée sur le PDF à la génération.
