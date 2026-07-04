// Parseur de Bibliothèque Parois.txt (export du logiciel Thermique historique).
// Vérifié sur les DEUX exports réels : C:/Thermique (2020, 5 parois) et C:/Thermique2
// (2024, 12 parois) — cf. sourceFiles.js pour la règle de choix de la source.
//
// Format réel du fichier :
//  - lignes 0-1 : préambule ("67,14,3,0", ligne de tabulations vide) ;
//  - lignes 2-3 : DEUX lignes d'en-tête (libellés puis unités). Après avoir retiré uniquement
//    les guillemets englobants (SANS trim, voir plus bas pourquoi) et splitté sur tab, les
//    colonnes sont :
//      [0]="" [1]=Paroi(nom) [2]=Teinte [3]=Code [4]=m [5]=S [6]=Composant [7]=d [8]=?
//      [9]=Rsi et Rse [10]=R [11]=U jour [12]=U nuit [13]=famille (colonne sans libellé
//      propre dans l'en-tête : "Mur Ext.", "Fen. Porte et Porte-fen.", etc. — toujours
//      l'avant-dernière colonne réelle) [14]="" ;
//  - ensuite les blocs paroi (voir ci-dessous) : table tabulaire courte (67 lignes en 2020,
//    ~110 en 2024) ;
//  - puis un gros bloc BINAIRE/sérialisation Excel-VB (tailles de police, couleurs,
//    "#FALSE#"...) SANS AUCUN RAPPORT avec des parois, qui occupe presque tout le fichier
//    (77 Ko en 2020, 208 Ko en 2024) — ce n'est donc pas une bibliothèque de dizaines de
//    parois malgré la taille des fichiers.
//
// ⚠ PIÈGE : unquote() de sourceFiles.js fait un .trim() sur la ligne entière avant de retirer
// les guillemets. Sur les lignes de continuation (nom vide en colonne 1), la chaîne commence
// par plusieurs tabulations qui sont alors AVALÉES par le trim, décalant toutes les colonnes
// suivantes vers la gauche. On retire donc ici uniquement les guillemets englobants, sans trim,
// pour préserver l'alignement des colonnes (indices fixes ci-dessus, vérifiés sur tous les
// blocs réels des deux exports).
//
// Préfixes/noms réellement rencontrés : "ME." (mur extérieur), "FE."/"PF." (fenêtre /
// porte-fenêtre — "PF." n'était pas anticipé par la tâche), "Plan. sur VS." (plancher sur vide
// sanitaire), "Plan. TP, isol. continue." (terre-plein), "Plaf. sous Comble." (plafond sous
// comble), et des noms génériques sans préfixe ("Mur Ext.", "Mur Ent.", "Mur Int.") : ce sont
// de vraies entrées utilisateur de la bibliothèque, conservées telles quelles. Aucun
// MI./PB./PH./PL./TO./PO. dans les fichiers réels.
//
// Un bloc débute par une ligne où col[1] (nom) est non vide, col[3]=code, col[13]=famille.
// Extraction du U : dans chaque bloc, EXACTEMENT UNE ligne de continuation porte un nombre en
// colonne 11 ("U jour" — vérifié sans faux positif sur l'intégralité des deux exports) :
//  - murs/planchers/plafonds : la ligne de totaux [R, U jour, U nuit], libellée "Déphasage
//    thermique de la paroi : ..." ou non libellée (blocs "Plan. sur VS.", "Mur Int.") ; les
//    blocs terre-plein ("Plan. TP") n'ont même PAS de R total, seulement [U jour, U nuit] —
//    d'où l'ancrage sur la COLONNE 11, plus robuste qu'un comptage de nombres en fin de ligne ;
//  - fenêtres complètes (FE., PF.) : la ligne "Coefficients de la fenêtre, (Uw = 1.25),
//    (Uwf = ...), (Ujn = ...) :" porte le Uw en colonne 11 (identique au Uw du texte, vérifié
//    sur les 4 blocs fenêtre réels). NB : col[10] ("R") de la ligne de DÉBUT de bloc fenêtre
//    n'est PAS le U de la fenêtre (valeur de composant annexe : "2.00" alors que Uw=1.25).
// Le texte "(Uw = X)" est tout de même extrait en corroboration quand il est présent : s'il
// contredit la colonne 11, le bloc est rejeté plutôt que de publier une valeur douteuse.
// ⚠ Cette corroboration textuelle ne couvre QUE les blocs fenêtre (FE./PF., texte "Uw = X").
// Pour mur/plancher/plafond, un décalage de colonne qui laisserait un nombre plausible en
// colonne 11 ne serait PAS détecté ici ; seul le garde-fou physique u∈[0.05,8] appliqué en
// aval dans convert-parois-types.mjs sert alors de filet de sécurité.
import { parseFrNumber } from './sourceFiles.js';

const UW_RE = /Coefficients de la fen[eê]tre.*?\(\s*Uw\s*=\s*([\d.,]+)\s*\)/i;

/** Retire uniquement les guillemets englobants d'une ligne (PAS de trim : voir commentaire
 * de tête sur le décalage de colonnes que provoquerait unquote() de sourceFiles.js ici). */
function stripQuotes(rawLine) {
  const m = String(rawLine).match(/^"(.*)"$/s);
  return m ? m[1] : String(rawLine);
}

/**
 * @param {string} text contenu latin1 de Bibliothèque Parois.txt
 * @returns {{parois: {nom:string, code:string|null, famille:string|null, u:number}[], rejects: {nom:string, reason:string}[]}}
 */
export function parseParois(text) {
  const parois = [];
  const rejects = [];
  let current = null;

  const flush = (reason) => {
    if (!current) return;
    if (current.reject) rejects.push({ nom: current.nom, reason: current.reject });
    else if (current.u != null) parois.push({ nom: current.nom, code: current.code, famille: current.famille, u: current.u });
    else rejects.push({ nom: current.nom, reason });
    current = null;
  };

  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const cols = stripQuotes(raw).split('\t');
    const nom = (cols[1] || '').trim();
    const isHeaderLine = nom === 'Paroi';
    const isBlockStart = nom !== '' && !isHeaderLine;

    if (isBlockStart) {
      flush('nouveau bloc démarré avant que le précédent ait produit un U');
      current = {
        nom,
        code: (cols[3] || '').trim() || null,
        famille: (cols[cols.length - 2] || '').trim() || null,
        u: null,
        reject: null,
      };
      continue;
    }

    if (!current || current.reject) continue; // lignes hors bloc (préambule, en-têtes, blob binaire…)

    // U jour = colonne 11 (une seule ligne de continuation par bloc la renseigne, vérifié
    // sans faux positif sur l'intégralité des deux exports).
    if (current.u == null && cols.length >= 13) {
      const uJour = parseFrNumber((cols[11] || '').trim());
      if (uJour != null && uJour > 0) current.u = uJour;
    }

    // Corroboration fenêtres : le Uw du texte "(Uw = X)" doit coïncider avec la colonne 11.
    const uwMatch = raw.match(UW_RE);
    if (uwMatch) {
      const uw = parseFrNumber(uwMatch[1]);
      if (uw != null && (current.u == null || Math.abs(current.u - uw) > 0.005)) {
        current.reject = `Uw du texte (${uw}) ≠ U jour colonne 11 (${current.u}) — valeur douteuse non publiée`;
      }
    }
  }
  flush('fin de fichier avant que le bloc ait produit un U');

  return { parois, rejects };
}
