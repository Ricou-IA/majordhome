# Documents CSTB : règles chiffrées pour le moteur de métré (granulés, ventouse, inserts)

Lu sur le Reef le 2026-11-28. Synthèse reformulée : aucun passage recopié, citations de moins de 15 mots. Les valeurs chiffrées sont exactes. Quand une valeur n'existe que dans une figure, la figure a été regardée et c'est indiqué. Rien n'a été deviné : ce qui manque est signalé.

Abréviations : **AT** = Avis Technique (ou Document Technique d'Application) du système de conduit ; **notice** = notice de l'appareil ; **CPT** = Cahier 3708_V4.

---

## 1. Cahier 3708_V4 (e-Cahiers du CSTB, avril 2026) : CPT des systèmes étanches sous AT raccordés à des appareils à granulés

### 1.1 Domaine et configurations admises

**R-3708-1. Domaine** (§ 1 et 2.1)
- Une installation « étanche » = appareil étanche + système (concentrique ou séparé) sous AT, qui prend l'air comburant dehors. Le CPT ne couvre pas : un appareil qui prend l'air dans la pièce, un appareil étanche raccordé à un conduit traditionnel avec prise d'air directe, un appareil non étanche avec buselot raccordé en air. Ces trois cas relèvent du NF DTU 24.1.
- Puissance utile totale ≤ **70 kW** par local. France métropolitaine et outre-mer.
- Les dispositions de l'AT complètent le CPT et **l'emportent sur lui**.
- Gabarits : G6 (cœur), G1/G4 en granulés étanche.
- Contrôlable : **oui**, avec puissance de l'appareil (kW) et type d'amenée d'air (pièce / directe / concentrique).

**R-3708-2. Configurations admises, tableau 1** (§ 2.1)
- Terminal **concentrique horizontal** : admis, **sauf en bâtiment neuf et en ERP**. Au sens du CPT, un bâtiment est neuf s'il a **moins de 3 ans**.
- Terminal concentrique vertical : admis (conduit neuf, concentrique dans un conduit existant, ou réutilisation d'un conduit existant tubé avec l'air dans l'espace annulaire).
- Terminaux **séparés horizontaux : INTERDITS**.
- Terminaux séparés verticaux : admis. Seul un conduit **isolé** est admis pour les fumées. Un concentrique dont la lame d'air n'est pas reliée à l'appareil ne l'est pas (résistance thermique trop faible). Le débouché vertical séparé doit respecter l'arrêté du 22 octobre 1969 (zone 1).
- Gabarits : G6 (horizontal), G1/G4 étanche (vertical).
- Contrôlable : **oui**, avec l'âge du bâtiment (≥ 3 ans), son type (maison / collectif / ERP) et la configuration (concentrique / séparée, horizontale / verticale). Pour G6, bloquer si le bâtiment a moins de 3 ans ou est un ERP.

**R-3708-3. Classe d'étanchéité de l'appareil selon la sortie** (§ 2.2)
- Combustible : granulés certifiés A1 (ISO 17225-2 : ENplus A1, DINplus ou NF). Tout autre combustible est hors champ.
- Appareil sans AT, marqué CE EN 16510-2-6 :
  - classe **CA, CM ou CC** : débouché **vertical** seulement ;
  - classe **CM50 ou CC50** : débouché **horizontal ou vertical**.
- Période transitoire jusqu'au **9 novembre 2027** : un appareil marqué CE sur la base d'une AoP reste admis s'il prouve une fuite **< 3 m³/h sous 50 Pa** (rapport d'un laboratoire accrédité EN ISO 17025). Le caractère étanche doit figurer sur la notice et sur la plaque.
- Appareil sous AT (poêle, insert, cuisinière) : fuite **≤ 3 m³/h sous 50 Pa**, horizontal ou vertical.
- Chaudière sous AT : **≤ 2 m³/h sous 10 Pa** pour le vertical seul ; **≤ 3 m³/h sous 50 Pa** pour l'horizontal ou le vertical.
- Depuis le **9 novembre 2025**, tout appareil à granulés neuf mis sur le marché est marqué CE selon l'EN 16510-2-6 (fin de l'EN 14785).
- Gabarits : G6 surtout.
- Contrôlable : **oui**, si le relevé (ou la fiche du modèle) porte la classe d'étanchéité déclarée (CA / CM / CC / CM50 / CC50, ou « AT + débit de fuite »). Règle : ventouse horizontale ⇒ CM50 ou CC50 (ou AT ≤ 3 m³/h à 50 Pa). Classe inconnue ⇒ « à vérifier », jamais « conforme ».

**R-3708-4. Ce que la notice ou l'AT de l'appareil doit fournir** (§ 2.2.1, 2.2.2.3) : renvoi au fabricant
- Longueurs **minimale et maximale par diamètre**, en horizontal et en vertical. Nombre de coudes (§ 3.5.1).
- Perte de charge maximale admise sur l'amenée d'air (configuration séparée).
- Données de dimensionnement EN 13384-1 aux puissances nominale et réduite : Pw, Tw, débit massique (ou CO2 + rendement + puissance), CO2.
- Le fabricant peut déclarer **Pw = 0 Pa** (appareil à ventilateur).
- Taux de recirculation moyen des terminaux concentriques de l'AT : **≤ 10 %**, sauf mention contraire de l'AT.
- Contrôlable : **partiellement**. Le moteur peut comparer la longueur développée et le nombre de coudes du relevé aux limites de la notice, **à condition d'avoir ces limites** (champ à saisir ou fiche modèle). Sans elles : « limites de la notice à vérifier ».

### 1.2 Conception générale

**R-3708-5. Classes minimales des composants** (§ 3)
- Conduit de fumée isolé ou concentrique : **Vm(C2) ou V2**.
- Tubage : **Vm(C2) ou V2**. Un tubage flexible doit être **double peau, intérieur lisse**.
- Raccordement simple paroi : **Vm(C1) ou V2**.
- Tous les composants : **N1** et **G**. Classe de température ≥ température maximale des fumées déclarée au marquage CE.
- Gabarits : G1, G3, G4, G4F, G5, G6.
- Contrôlable : **oui** côté catalogue (attributs des articles : classe de corrosion, N1, G, Txxx, flexible double peau). Il faut la température des fumées de l'appareil.

**R-3708-6. Dimensionnement EN 13384-1** (§ 3.1)
- Calcul obligatoire avec les données de la notice et/ou de l'AT.
- Marquage CE EN 14785 : la température des fumées déclarée est **majorée de 20 %**, sauf si c'est déjà Tw (à la buse). Marquage CE EN 16510-2-6 : on prend la température déclarée à la buse.
- Températures extérieures minimales admises pour la vérification condensation / gel (zones de l'arrêté du 26 octobre 2010) : H1a **−3,5 °C** · H1b **−6,2 °C** · H1c **−6,6 °C** · H2a **−2,2 °C** · H2b **−3,6 °C** · H2c **−2,7 °C** · H2d **−4,5 °C** · H3 **+2,6 °C**. Au-dessus de **200 m** d'altitude, retirer **1 °C par 100 m** supplémentaires. (La carte des zones, figure 3, n'a pas été relevée.)
- Pression due au vent à retenir, **PL = 0 Pa**, puisque les débouchés respectent les positions des § 3.2 et 3.3.
- La notice ou l'AT dit si la condensation est autorisée à puissance nominale.
- Contrôlable : **non** par le métré seul (calcul thermo-aéraulique). Les températures par zone et la correction d'altitude se tabulent si un calcul EN 13384-1 est ajouté un jour.

### 1.3 Position des terminaux : la « zone 3 » (G6) et le vertical hors zone 1

Toutes les cotes partent du **centre du débouché des fumées** (§ 3.3.1).

**R-3708-7. Restrictions générales** (§ 3.3.1)
- Habitat collectif : terminaux **verticaux seulement**, en zone 1 (arrêté du 22 octobre 1969).
- Maison individuelle : horizontal seulement dans une maison existante de **plus de 3 ans**. S'il existe un conduit de fumée, il faut le privilégier après un diagnostic favorable (NF DTU 24.1).
- Chaudières à granulés (§ 3.3.2) : mêmes distances. En ERP (toutes catégories) : vertical seulement.
- Gabarits : G6.
- Contrôlable : **oui**, avec : type de logement (individuel / collectif / ERP), âge, présence d'un conduit existant exploitable. Le dernier point donne un **avertissement**, pas un blocage : c'est une préférence et un diagnostic.

**R-3708-8. Ventouse en façade (terminal concentrique horizontal) : distances** (§ 3.3.1.3, figures vues)

| Contrôle | Valeur | Donnée du relevé |
|---|---|---|
| Hauteur du débouché au-dessus du sol extérieur | **> 2 m** | hauteur du centre du terminal / sol fini extérieur |
| Saillie du terminal hors façade | **40 cm** (figure : « > 40 cm ») | longueur de terminal hors mur (souvent fixée par l'article) |
| Débord de toit, balcon ou autre partie de construction au-dessus | zone interdite sous le débord : profondeur **d** = avancée du débord, hauteur **d** sous lui (figure, aucune valeur fixe) | avancée du débord ; distance verticale terminal → sous-face du débord |
| Ouvrant ou entrée d'air dans le plan de la façade, ou en toiture à **moins de 1 m** de l'aplomb de la façade | interdit entre le sol et **0,5 m** au-dessus de l'ouvrant, sur une bande de **2 m** de chaque côté | pour chaque ouvrant : distance horizontale, et position verticale du terminal par rapport au haut de l'ouvrant |
| Latéralement, tout ouvrant ou entrée d'air | **≥ 2 m** | distance horizontale terminal → bord de l'ouvrant |
| Plusieurs ouvrants sur la façade | la règle vaut pour **chacun** | liste des ouvrants |
| Angle rentrant | **≥ 1 m** de l'angle | distance terminal → angle rentrant |
| Mur adjacent (angle rentrant) qui porte un ouvrant ou une entrée d'air de la même maison | **≥ 4 m** à l'horizontale entre l'extrémité du terminal et cet ouvrant | distance horizontale |
| Obstacle en face, plus haut que le terminal (mur…) | **≥ 3 m** | distance au premier obstacle face au terminal, et sa hauteur |
| Façade voisine **sans** ouvrant ni entrée d'air, ou limite de propriété **avec** maison voisine | **> 3 m** | distance à la limite de propriété ; présence d'une maison voisine ; ouvrants de sa façade |
| Façade voisine **avec** ouvrant ou entrée d'air, ou limite de propriété **sans** maison voisine | **> 6 m** | idem |
| Maisons accolées ou en bande | **> 3 m** de la limite de propriété, et **> 4 m** d'un ouvrant ou d'une entrée d'air d'une maison voisine | type de maison (isolée / accolée / en bande) |
| Débouché sur une circulation extérieure **hors** de la propriété (trottoir, chemin, passage public) | **interdit** | booléen « le terminal donne sur un passage public » |
| Terminal dans une **cour fermée** | **interdit** | booléen « cour fermée » |

Notes :
- La figure de l'angle rentrant porte « 1 m » sur les deux murs : la bande interdite fait 1 m de chaque côté de l'angle.
- La notice ou l'AT de l'appareil peut exiger une hauteur minimale de conduit plus grande (tirage) : renvoi au fabricant.
- Ce sont des positions admises par le GS 14.2 « pour le moment », sans texte réglementaire derrière : elles peuvent changer.
- Contrôlable : **oui, entièrement**, à condition d'ajouter au relevé G6 un bloc « environnement du terminal » : hauteur au-dessus du sol, saillie, débord au-dessus (avancée et écart vertical), liste des ouvrants ou entrées d'air de la façade (écart horizontal, et le terminal est-il au-dessus ou au-dessous de leur haut +0,5 m), angle rentrant (distance, ouvrant sur le mur adjacent), obstacle en face (distance, plus haut ou non), limite de propriété (distance, maison voisine oui / non, ouvrants sur sa façade oui / non), type de maison (isolée / accolée / en bande), passage public, cour fermée, âge du bâtiment, ERP ou collectif. Une mesure absente doit donner « non vérifié », jamais « conforme ».

**R-3708-9. Terminal concentrique vertical hors zone 1** (§ 3.3.1.2, figures vues)
- Bande interdite : du bas de la toiture jusqu'à **0,5 m** au-dessus de tout ouvrant ou entrée d'air (fenêtre de toit, lucarne), sur **2 m** de part et d'autre.
- Face à un ouvrant ou une entrée d'air de la même maison : **> 4 m**.
- Près d'un mur adjacent (pignon) de la maison sans ouvrant ni entrée d'air : **> 1 m**.
- Limite de propriété : **> 3 m**. Portée à **> 6 m** si la façade voisine a un ouvrant ou une entrée d'air, ou s'il n'y a pas de maison voisine.
- Gabarits : G1 et G4 en granulés étanche concentrique, débouché hors zone 1.
- Contrôlable : **oui**, avec la position du débouché par rapport aux ouvrants de toiture, au pignon et à la limite de propriété.

**R-3708-10. Configuration séparée** (§ 3.2, 3.5.2)
- Débouché vertical en zone 1 (arrêté 1969, et le NF DTU 24.1 s'applique). Débouché équipé d'un **dispositif anti-volatile**.
- Prise d'air comburant en façade : manchon étanche dans la traversée du mur ; protection contre oiseaux et rongeurs ; grille démontable de maille **≥ 3 mm**, à compter dans la section d'air.
- Contrôlable : **partiellement** (nomenclature : grille, manchon, anti-volatile ; zone 1 contrôlée par les règles DTU).

### 1.4 Règles de tracé des conduits concentriques

**R-3708-11. Dévoiements en concentrique** (§ 3.5.1)
- Au plus **4 coudes à 45°** : **2** dans le local de l'appareil, **2** hors du local. La notice peut être plus restrictive, et le dimensionnement doit être vérifié.
- Contrôlable : **oui** : nombre et angle des coudes, ventilés « dans le local / hors local ».

**R-3708-12. Concentrique horizontal (G6) : tracé** (§ 3.5.1.2)
- **Aucun dévoiement**, en dehors du **té en pied** et d'**un coude à 90°** pour traverser le mur au niveau du terminal.
- Tout le conduit reste dans le local de l'appareil. Il doit rester démontable (entretien, dépose de l'appareil). Un coffrage éventuel est démontable et ventilé par **2 orifices de 50 cm² minimum** chacun.
- Simple paroi admis entre la buse (et le buselot d'air) et le concentrique, aussi court que possible.
- Traversée du mur : respecter la distance aux matériaux combustibles. L'isolant combustible est retiré et remplacé par le système de traversée prévu dans l'AT.
- Partie verticale minimale avant le coude (§ 4.2.1) : celle de l'AT de l'appareil ; pour un appareil sans AT, celle de la notice, **au moins 1,50 m**. Cette hauteur peut être réduite du tube vertical intérieur d'un appareil à sortie par le dessus (la valeur figure alors dans la notice).
- Gabarits : G6.
- Contrôlable : **oui** : hauteur verticale entre la buse (ou le té) et le coude de traversée ≥ max(1,50 m, valeur de la notice), avec la réduction « sortie dessus » si la notice la donne ; un seul coude à 90° ; pas d'autre dévoiement ; présence du té en pied.

**R-3708-13. Concentrique vertical (G1 étanche)** (§ 3.5.1.1)
- Prise d'air comburant à **≥ 30 cm au-dessus du toit**.
- Dans les pièces habitables traversées : coffrage de protection, **50 °C maximum** sur le coffrage en fonctionnement normal, coffrage au moins **A2-s2, d0** s'il respecte la distance de sécurité. Combles non habitables : protection mécanique inutile, protection thermique si la paroi dépasse **80 °C**.
- Distance de sécurité du concentrique : donnée par l'AT (renvoi).
- Débouché avec **anti-volatile**.
- Contrôlable : **partiellement** (hauteur de la prise d'air au-dessus du toit, coffrages et anti-volatile en nomenclature ; la distance de sécurité vient de l'AT).

**R-3708-14. Réutilisation d'un conduit existant, air dans l'espace annulaire** (§ 3.5.1.3 et 3.5.2.2)
- Le conduit existant naît dans le local de l'appareil, ou dans un local voisin s'il est adossé ou accolé à la paroi commune (raccordement direct à travers la paroi). L'AT peut admettre d'autres cas.
- **Section intérieure minimale du conduit existant** selon le diamètre du conduit de fumées (rigide simple paroi ou flexible double peau non isolé) :

| Ø fumées (mm) | Conduit existant minimal (mm) |
|---|---|
| 80 | 140 × 140 ou Ø 140 |
| 100 | 160 × 160 ou Ø 160 |
| 130 | 190 × 190 ou Ø 190 |
| 150 | 210 × 210 ou Ø 210 |

- Tubage flexible **d'un seul tenant**.
- Variante séparée (prise d'air sur une paroi du conduit existant) : prise à **plus de 50 cm** du terminal des fumées. Si elle est sur la souche : **≥ 30 cm au-dessus du toit**. L'espace annulaire est fermé au niveau du débouché.
- Montage d'un concentrique **dans** un conduit existant (§ 3.5.1.4) : espace entre l'existant et le concentrique ventilé **20 cm² en bas, 5 cm² en haut**.
- Gabarits : G4 en granulés étanche.
- Contrôlable : **oui** : section intérieure du boisseau (côtés a × b ou Ø) comparée au Ø des fumées ; flexible d'un seul tenant (longueur ≤ un rouleau, pas de manchon) ; local d'origine du conduit.

**R-3708-15. Habitat collectif** (§ 3.6.1) : gaine technique propre au conduit, coupe-feu **½ h** ; trappe d'accès coupe-feu **¼ h** si sa surface est ≤ **0,25 m²**, **½ h** au-delà ; gaine ventilée en bas (depuis le local) et en haut (vers l'extérieur), **50 cm²** utiles. Pas de gaine si le conduit ne dessert que le dernier niveau sans traverser de paroi coupe-feu. Hors de nos gabarits courants ; à signaler seulement.

**R-3708-16. Système monté à l'extérieur du bâtiment** (§ 3.7) : conduit métallique isolé seulement, **Ru ≥ 0,4 m²·K/W** (calcul NF DTU 24.1). Gabarits : G3 granulés étanche. Contrôlable : **oui** (Ru de l'article).

### 1.5 Mise en œuvre

**R-3708-17. Assemblage** (§ 4.2.1)
- Emboîtement mâle des fumées **vers le bas**.
- Base du conduit : **té à 90° visitable**, garde (boîte à suie) **≥ 50 mm**. Ramonage par le té ou une trappe.
- Raccordement direct par le dessus admis si le tube vertical interne de l'appareil a une boîte à suie de section ≥ celle du tube et de **hauteur ≥ 50 mm** (ou volume équivalent). Sinon, té en pied à l'extérieur de l'appareil.
- Chaudière à condensation : coude de pied incliné à **3°** vers la chaudière, ou té avec évacuation des condensats ; accès en pied obligatoire.
- Distances de sécurité : raccordement simple paroi au moins celle du NF DTU 24.1 ; composite au moins celle du NF DTU 24.1 ; concentrique selon l'AT.
- Contrôlable : **oui** pour le té, la boîte à suie et la nomenclature ; les distances sont reprises du DTU.

**R-3708-18. Raccordement à l'appareil** (§ 4.2.2) : buse accessible de l'extérieur de l'appareil ; pièces de raccordement fournies par le fabricant du conduit (sauf disposition de la notice). Insert à granulés : âtrerie selon le **NF DTU 24.2**, sauf les sections minimales du conduit. Gabarits : G4F, G5.

**R-3708-19. Conduit existant réutilisé** (§ 4.3) : vérifier la stabilité, la vacuité et l'état, ramoner, et vérifier l'étanchéité s'il sert d'amenée d'air. Le débouché doit respecter les § 3.2 / 3.3. Contrôlable : **partiellement** (cases de diagnostic du relevé).

**R-3708-20. Plaque signalétique** (§ 4.4) : fabricant, système et n° d'AT, configuration et désignation (NF EN 1443:2003), mention « Conduit pour appareil à granulés de bois », installateur, date. Article de nomenclature.

---

## 2. Guide pratique CSTB « Poêles et inserts à granulés » (septembre 2021)

Note : ce guide cite encore le CPT **3708_V2**. Le 3708_V4 ci-dessus le remplace pour l'étanche.

### 2.1 Air comburant (chapitre 4)

**R-GP-1. Débit** : **3 à 4 m³/h par kW**, en plus du débit d'hygiène du logement. Information seulement.

**R-GP-2. Prise d'air indirecte (dans la pièce)** : permanente, section réelle de passage :
- poêle : **50 cm²**, quelle que soit la puissance ;
- insert : **50 cm²** si P ≤ **8 kW** ; **70 cm²** si 8 < P ≤ **16 kW** ; **100 cm²** si P > **16 kW**.
- Une prise obturable n'est pas admise si l'appareil peut s'allumer sans l'usager (programmation, allumage à distance), ce qui est le cas courant en granulés.
- Vide sanitaire « ventilé » : section libre totale (cm²) ≥ **5 ×** surface au sol (m²).
- Gabarits : G1, G3, G4, G5 en granulés non étanche ; G4F.
- Contrôlable : **oui**, avec puissance, type d'appareil, section de la grille posée.

**R-GP-3. Prise d'air directe** : section au moins celle du fabricant, vérifiée par EN 13384-1 ; à systématiser en construction RT 2012 / RE 2020. Contrôlable : **partiellement** (Ø de l'amenée ≥ Ø du buselot, au minimum).

### 2.2 Débouché et zones (chapitre 5 § 2, chapitre 2 § 2.3)

**R-GP-4. Zone 1** : débouché à **≥ 0,40 m** au-dessus de toute partie de construction située à **moins de 8 m**. Toit-terrasse ou pente **< 15°** : **≥ 1,20 m** au-dessus du point de sortie, et **≥ 1 m** au-dessus de l'acrotère si celui-ci dépasse **20 cm**. La hauteur du terminal au-dessus de la sortie des fumées ne compte pas.
- « Zone 1 élargie » : sous les 40 cm du faîtage mais hors surpression, déterminée par NF EN 15287-1 art. 4.3.18 et NF EN 13384-1 art. 5.10.4. Dans les AT, elle s'appelle « zone 2 hors zone de surpression ».
- **Zones 2 et 3** (surpression due au vent) : installation non traditionnelle, **étanche**, appareil **et** conduit sous AT. Pression du vent admise par convention : **40 Pa** au plus ; **conduits concentriques seulement** ; appareil ≤ **3 m³/h à 50 Pa** ; conduit **N1**.
- **Zone 3 interdite en construction neuve**, admise en rénovation seulement.
- Gabarits : G1, G3 (zone 1), G6 (zone 3).
- Contrôlable : **oui** pour la zone 1 (déjà dans le moteur). Règle croisée utile : débouché hors zone 1 ⇒ granulés étanche + concentrique + AT obligatoires.

### 2.3 Composants et désignation (chapitre 5 § 3-4)

**R-GP-5. Désignation minimale de l'ouvrage pour granulés** (tableau 1, image lue) : Txxx ≥ température des fumées à l'allure nominale ; **N1** (P1, P2, M1, M2, H1, H2 possibles ; N2 si maçonné) ; **W2/W3** (corrosion 2 ou 3, dimensionnement « sec » à la puissance nominale, condensation tolérée à l'allure réduite) ; **G(xx)**, O interdit, xx = la distance la plus défavorable des composants et du DTU.
- Classes de température normalisées : T080, T100, T120, T140, T160, T200, T250, T300, T400, T450. Exemple du guide : 153 °C ⇒ **T160** au minimum.
- Métal : au minimum **N1 W Vm(C2) G** pour le conduit, **N1 W Vm(C1) G** pour le raccordement.
- Correspondance Vm (tableau 2, image lue) : C3 = L70 (1.4539, 904L) ; C2 = L60 (1.4432, 316L), L50 (1.4404 316L / 1.4571 316Ti), L40 (1.4401, 316) ; C1 = L80 (acier émaillé deux faces), L30 (1.4307, 304L), L20 (1.4301, 304).
- Contrôlable : **oui** (attributs des articles + température des fumées de l'appareil ⇒ classe T minimale = la première classe ≥ Tfumées).

**R-GP-6. Distance de sécurité d'un conduit composite métallique selon Ru** (tableau 3, image lue) : Ru **≤ 0,4** ⇒ **interdit** ; **0,4 < Ru ≤ 0,6** ⇒ **8 cm** ; Ru **> 0,6** ⇒ **5 cm**. On retient le maximum de cette valeur et de celle de la désignation du produit.
- Ru à défaut du fabricant : formule du guide (rayons extérieur et intérieur, conductivité de l'isolant à 200 °C). Sert seulement à la distance de sécurité.
- Gabarits : G1, G3, G4 (tubage isolé).
- Contrôlable : **oui** si le relevé donne la distance réelle aux combustibles et l'article son Ru.

**R-GP-7. Concentrique** : obligatoire en zones 2 et 3 et sous AT ; peu isolé, il refroidit les fumées, donc dimensionnement rigoureux. **Triple paroi isolé** : utilisable en zone 1, zone 1 élargie, et en zone 2 seulement s'il a un AT pour cet usage. Information, sans valeur.

### 2.4 Dimensionnement (chapitre 6)

**R-GP-8.** Calcul EN 13384-1 aux allures nominale **et** réduite. Valeurs par défaut de la norme si le fabricant ne donne rien pour l'allure réduite : débit massique réduit de **70 %**, température réduite de **50 %**. Pw = **0 Pa** admis. Poêle et insert à granulés : conduit **toujours en dépression** ; **pas de condensation à l'allure nominale**, condensation admise à l'allure réduite. Condensation quasi systématique ⇒ collecte et évacuation des condensats obligatoires (NF DTU 24.1 § 5.4.4.1.3).
- **Point clé : les abaques et logiciels « forfaitaires » ne sont « pas pertinents » pour les appareils à granulés**, il faut un logiciel EN 13384-1 avec les données réelles (§ 6.2).
- Contrôlable : **non** par le métré.

### 2.5 Mise en œuvre (chapitre 7)

**R-GP-9. Raccordement** (§ 3.1)
- Le raccordement ne traverse pas un autre local, sauf si le conduit est adossé à une paroi du local.
- Ø du raccordement **≥** Ø de la buse.
- Insert : **2 dévoiements au plus** (une seule partie non verticale), **45° maximum**. Conduit maçonné avec départ au sol : **un coude à 90°** admis, **té obligatoire**. Poêle à granulés : coudes en cumul **≤ 180°** (NF DTU 24.1).
- Boîte à suie obligatoire, **≥ 50 mm**. Sortie dessus : elle est dans l'appareil. Sortie arrière avec raccordement au plafond : té + tampon démontable sur la buse. Sortie arrière dans un conduit à départ au sol : boîte en pied, trappe.
- Variation de section : pièce de forme, **≤ 45°**. Le haut de la réduction est en pied de conduit (poêle) ; dans la hotte, à **< 10 cm** sous le faux plafond ou dans son volume (insert).
- Buses courantes en granulés : **80 à 100 mm**.
- Distance de sécurité du raccordement simple paroi : max(valeur du fabricant ; **3 × Ø**, au moins **375 mm**). Réduite de moitié (**1,5 × Ø**, au moins **200 mm**) avec un écran incombustible et une lame d'air d'au moins **2 cm**.
- Gabarits : G5, G1, G3, G4, G4F.
- Contrôlable : **oui** : somme des angles des coudes (≤ 180° poêle) ; nombre de dévoiements et angle (insert) ; Ø ; distance aux combustibles.

**R-GP-10. Conduit métallique neuf** (§ 3.2)
- Granulés ⇒ classe W ⇒ conduit neuf **métallique**.
- Le premier élément débouche **de toute sa section** dans le local de l'appareil ; aucune jonction dans l'épaisseur d'un plancher.
- Traversées : plaques de distance ajourées du fabricant obligatoires ; pas de « rebouchage » sur chantier. Coffrage si la paroi dépasse **50 °C** en zone habitable, **80 °C** en zone non habitée.
- Dévoiement : **2 au plus** (une partie non verticale), **≤ 45°** de la verticale, quelle que soit la hauteur.
- Gabarits : G1, G3.
- Contrôlable : **oui** (déjà proche des règles DTU du moteur).

**R-GP-11. Tubage** (§ 3.3)
- Réhabilitation pour granulés : **tubage rigide, ou flexible double peau intérieur lisse**, seulement.
- Tuber **toute** la longueur (pas de tubage partiel). Ramoner, mieux débistrer, avant ; si l'on ne peut pas nettoyer, ne pas tuber.
- Dévoiement du boisseau **jusqu'à 45°** admis si un gabarit passe (NF DTU 24.1 § 15.3.3).
- Concentrique sur conduit existant : l'air vient de l'extérieur du bâtiment, **jamais des combles**.
- Tubage isolé ou remplissage isolant : sous AT.
- Gabarits : G4, G4R, G4P, G4K, G4F.
- Contrôlable : **oui** pour longueur tubée = longueur du conduit, angle de dévoiement ≤ 45°, origine de l'air ≠ combles.

**R-GP-12. Insert à granulés : âtrerie** (§ 2)
- Convection : **400 cm²** en bas, **500 cm²** en haut au minimum.
- Lame d'air de **10 mm** minimum entre l'insert et l'isolant de l'habillage.
- Grilles de hotte : **≥ 500 cm²**, aussi haut que possible mais **≥ 30 cm** sous le plafond.
- Faux plafond (déflecteur) à **30 cm** du plafond, vide isolé et ventilé par **2 orifices de 20 cm²**.
- Surfaces de l'habillage à **85 °C** au plus.
- Isolant d'adossement : A1 (ou M0 / A2-s1,d0), tenue à **400 °C**, R **0,7 m²·K/W à 50 °C** (ou **0,4 à 200 °C**), par exemple **30 mm** de fibreux < **100 kg/m³** avec feuille d'aluminium, ou silicate de calcium.
- Gabarits : G4F (et G5 insert).
- Contrôlable : **oui** si le relevé porte les sections des grilles et la cote du faux plafond (sinon, ligne de nomenclature « grilles 500 cm² »).

**R-GP-13. Distribution d'air chaud** : transfert **≥ 130 cm²** portes fermées ; filtre F5 / M5 ; soufflage **≤ 100 °C**. Hors métré.

---

## 3. Cahier 3590 (février 2007) : abaques de dimensionnement EN 13384-1

**Ce que c'est** : des courbes tirées d'un logiciel EN 13384-1 (partenariat ACEF/APCIM, CERIB, CTTB, ADEME, CSTB…) pour dimensionner « au forfait » les configurations courantes.

**Domaine général** (§ 2.2.1) :
- appareils **non étanches** seulement, puissance ≤ **70 kW** (foyers ouverts : ouverture ≤ **2 m²**) ;
- conduit de **30 m** au plus ;
- conduit **intérieur**, tirage naturel, souche de **1 m**, **1,5 m** dans des combles non isolés ;
- air pris dans un local ventilé naturellement (dépression ≤ **3 Pa**) ;
- altitude ≤ **400 m**.

**Familles utiles pour nous** :
- **Foyers ouverts** (Bois 1 à 5) : x = hauteur du conduit (3 à 12 m), y = ouverture du foyer (m²), une courbe maximale par Dh et une courbe « ouverture mini » (fonctionnement sec). Tfumées ≥ **120 °C** ; pas de dévoiement ; ζ total ≤ **1,60** ; air direct ≥ **200 cm²**. Sans température connue : calcul par logiciel à **80 °C** par défaut.
- **Inserts à bûches** (Bois 6 à 10) : Tnominale ≥ **350 °C**, Tralentie ≥ **200 °C** ; raccordement simple paroi de **1,5 m** (non compté dans H) ; pas de dévoiement ; ζ total ≤ **1,60** ; tubage avec lame d'air ventilée **5 cm²** en haut / **20 cm²** en bas. x = hauteur du conduit depuis le haut du raccordement (2 à 12 m ; tubé 2 à 10 m), y = puissance (kW). Pour chaque diamètre : une **puissance maximale** (palier horizontal) et une courbe de **puissance minimale** (sec). Abaques : Bois 6 métallique isolé R ≥ 0,4 ; Bois 7 maçonné non isolé R ≥ 0,1 avec souche isolée R ≥ 0,38 ; Bois 8 maçonné isolé R ≥ 0,38 ; Bois 9 maçonné isolé R ≥ 0,65 ; Bois 10 maçonné **tubé**.
- **Plafonds de puissance des inserts**, valables quel que soit le calcul (utilisation, encrassement) : Dh **150 mm** (métal) ou **160 mm** (maçonné) ⇒ **12 kW** au plus ; Dh **180 mm** ⇒ **15 kW** ; Dh **≥ 200 mm** ⇒ **18 kW**. Insert qui peut fonctionner porte ouverte : vérifier **aussi** l'abaque des foyers ouverts. Conduit très haut : vérifier le tirage excessif avec le fabricant. Modérateur de tirage prescrit : dimensionnement spécifique.
- **Chaudières automatiques à granulés** (Bois 16 à 20) : Tnominale ≥ **180 °C**, Tmini **120 °C** ; dimensionnement « sec » imposé ; raccordement horizontal de **1 m** avec **1 coude à 90°** ; ζ total ≤ **1,90**. **Aucun abaque pour les poêles ou inserts à granulés.**
- Diamètre hydraulique d'un conduit rectangulaire : Dh = 2ab / (a + b) (formule standard ; dans le Cahier elle est en image, non relue). Le Cahier donne aussi un tableau de correspondances entre boisseaux courants et Dh (non relevé).

**Utilisable par le moteur ?**
- **Les plafonds de puissance des inserts** (12 / 15 / 18 kW selon le Dh) sont des **règles franches**, à coder tout de suite pour **G4F / G4 bûches** : puissance nominale de l'insert + Ø du tubage ou Dh du boisseau ⇒ refus ou alerte.
- **Les courbes** ne sont que des **images** : pas de tableau de valeurs dans le document. Les coder supposerait de numériser les courbes à la main (lecture approximative, interpolation) : déconseillé, risque de faux « conforme ».
- **Hors domaine pour tout le granulés** : poêles et inserts à granulés n'ont pas d'abaque, les températures sont trop basses (le guide 2021 dit les abaques non pertinents), et l'étanche est exclu. Pour G6 et le granulés, le moteur doit renvoyer à une note de calcul EN 13384-1 (fabricant du conduit ou logiciel), pas à un abaque.
- Les hypothèses (ζ ≤ 1,60, aucun dévoiement, souche 1 m, altitude ≤ 400 m, conduit intérieur) excluent la plupart des cas réels avec dévoiement, et G3 (conduit extérieur).

---

## 4. Guide pratique CSTB « Construction d'une cheminée » (octobre 2020) : raccordement des inserts (bûches)

**R-CH-1. Raccordement** (chapitre 8)
- Ne traverse aucun autre local (sauf conduit adossé à la paroi).
- Ø ≥ Ø de la buse (ou du manchon). Mâle vers le bas.
- **2 dévoiements au plus**, **≤ 45°**. Conduit maçonné avec départ au sol : **un coude à 90°** admis.
- Poêle à bois : le NF DTU 24.1 permet **deux coudes à 90°** dans le tracé (le guide granulés 2021 dit « cumul ≤ 180° », même valeur).
- Té avec boîte à suie obligatoire, **sauf** âtre, foyer ouvert, insert et poêle à sortie dessus quand les suies se récupèrent dans l'appareil.
- Variation de section : pièce de forme **≤ 45°**, haut de la pièce à **< 10 cm** sous le faux plafond de la hotte ou dans son volume.
- Distance de sécurité du simple paroi : max(**3 × Ø**, au moins **375 mm** ; valeur CE). Moitié (**1,5 × Ø**, au moins **200 mm**) avec un écran incombustible ventilé ; écran minimal = **30 mm** de fibreux ≥ **100 kg/m³** avec feuille d'aluminium. (Ici la masse volumique est donnée en **minimum**, alors que pour l'isolant d'adossement elle est donnée en **maximum**, < 100 kg/m³ : deux usages distincts.)
- Modérateur de tirage : té de même Ø sur le raccordement, visible et accessible dans la hotte, compris dans le calcul EN 13384-1.
- Gabarits : G4F, G5.
- Contrôlable : **oui** (dévoiements, Ø, distance aux combustibles, modérateur en nomenclature).

**R-CH-2. Raccordement au tubage** (chapitre 12 § 4)
- **Direct** (insert) : le flexible se raccorde sur la buse ou le manchon de l'insert. Une manchette de raccordement peut assurer l'étanchéité. Le direct ne s'applique pas au poêle.
- **Indirect** (insert) : un rigide entre le tubage et la buse. La pièce de jonction tronconique est **sous le débouché bas** du conduit.
- Poêle : jonction possible dans le premier boisseau, à condition qu'elle reste **contrôlable** (ramonage). Le raccord à griffe porte la variation de section éventuelle.
- Tubage : sur toute la longueur ; pas de raccord rendu inaccessible ; débouché protégé de la pluie. Si l'on ne peut pas nettoyer, ne pas tuber. Remplissage isolant ou tubage isolé : sous AT.
- Conduit en briques : distance de sécurité > **16 cm** moins l'épaisseur du conduit, **2 cm** au minimum.
- Chemisage : contrôle caméra avant ; essai d'étanchéité tous les **3 ans**.
- Gabarits : G4F (direct), G4 (indirect).
- Contrôlable : **oui** : mode de raccordement direct / indirect ⇒ articles (manchette, raccord à griffe, réduction tronconique) ; flexible sans manchon intermédiaire.

**R-CH-3. Âtrerie d'un insert** (chapitre 5)
- Convection : **400 cm²** en entrée basse, **500 cm²** en sortie haute minimum.
- Grilles de hotte : **≥ 500 cm²**, **≥ 30 cm** sous le plafond.
- Faux plafond à **30 cm** du plafond, vide isolé et ventilé par 2 orifices.
- Isolant : R **0,7 m²·K/W à 50 °C** ou **0,4 à 200 °C**.
- Insert dans une cheminée existante : seulement si elle est conforme à la réglementation. Linteau bois protégé.
- Gabarits : G4F.

**R-CH-4. Air comburant des inserts** (chapitre 7)
- Indirect : **50 cm²** si P ≤ 8 kW ; **70 cm²** si 8 < P ≤ 16 kW ; **100 cm²** si P > 16 kW ; **200 cm²** pour un insert qui peut fonctionner porte ouverte. Et dans tous les cas **≥ ¼ de la section du conduit de fumée**.
- Poêle à bois : **50 cm²** si P ≤ **25 kW** ; **70 cm²** de 25 à **35 kW**.
- Âtre / foyer ouvert : **200 cm²** et ≥ ¼ de la section du conduit.
- Prise protégée par une grille. Traversée d'un mur doublé : **fourreau étanche**. Prise en sous-sol pollué : canalisation reliée à une bouche extérieure.
- Gabarits : G4F, G5, G1, G4 bûches.
- Contrôlable : **oui** (puissance, porte ouverte oui / non, section de la grille, section du conduit).

---

## 5. Ce qu'il faut ajouter au relevé pour fermer le trou « zone 3 » (G6)

Données minimales, toutes en mètres sauf mention :
1. Hauteur du centre du terminal au-dessus du sol extérieur (> 2).
2. Saillie du terminal hors façade (40 cm).
3. Débord de toit ou balcon au-dessus : avancée **d** et écart vertical terminal → sous-face (zone interdite d × d).
4. Pour chaque ouvrant ou entrée d'air de la façade, ou de la toiture à moins de 1 m de l'aplomb : écart horizontal (≥ 2) et position verticale par rapport à son haut + 0,5.
5. Angle rentrant : distance (≥ 1) ; ouvrant sur le mur adjacent : distance horizontale (≥ 4).
6. Obstacle plus haut que le terminal en face : distance (≥ 3).
7. Limite de propriété : distance ; maison voisine oui / non ; ouvrant ou entrée d'air sur sa façade oui / non (seuils 3 / 6 ; 3 / 4 en maisons accolées ou en bande).
8. Booléens : donne sur un passage public ; cour fermée ; ERP ; habitat collectif ; bâtiment de moins de 3 ans ; conduit existant exploitable.
9. Appareil : classe d'étanchéité (CM50 / CC50, ou AT ≤ 3 m³/h à 50 Pa) ; hauteur verticale minimale de la notice (au moins 1,50 m sans AT) ; longueurs min / max par diamètre et nombre de coudes de la notice.
10. Tracé : hauteur verticale du té au coude de traversée ; nombre de coudes (un seul à 90°).

Toute donnée absente ⇒ ligne « non vérifié » dans le résultat, jamais « conforme ».

## 6. Renvois à l'Avis Technique ou à la notice (le moteur ne peut pas trancher seul)

- Longueurs min / max par diamètre et coudes admis (notice ou AT de l'appareil).
- Hauteur verticale minimale avant la ventouse (AT de l'appareil ; notice, au moins 1,50 m, si pas d'AT).
- Hauteur minimale du conduit pour le tirage (notice ou AT).
- Distance de sécurité du concentrique, système de traversée de mur et de plancher (AT du conduit).
- Terminal concentrique à utiliser et taux de recirculation (AT ; ≤ 10 % par défaut).
- Perte de charge maximale de l'amenée d'air séparée (notice).
- Condensation admise ou non à l'allure nominale (notice ou AT).
- Autres configurations de réutilisation d'un conduit existant (AT).

## 7. Valeurs non relevées ou incertaines

- Débord de toit (3708 § 3.3.1.3) : la figure ne donne **aucune valeur numérique**, la zone vaut d × d avec d = avancée du débord. Lecture de la figure, à confirmer.
- Carte des zones climatiques H (3708, figure 3) : non relevée.
- Tableau des correspondances boisseaux ↔ Dh (Cahier 3590 § 2.2.2) : en image, non relu.
- Courbes des abaques 3590 : lues seulement pour leur forme et leurs axes ; aucune valeur intermédiaire relevée.
