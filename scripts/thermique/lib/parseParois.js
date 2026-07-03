// Parseur de C:\Thermique\Bibliothèque Parois.txt (export du logiciel Thermique historique).
//
// Format réel du fichier (vérifié sur l'export complet, ~9250 lignes) :
//  - lignes 0-1 : préambule ("67,14,3,0", ligne de tabulations vide) ;
//  - lignes 2-3 : DEUX lignes d'en-tête (libellés puis unités). Après avoir retiré uniquement
//    les guillemets englobants (SANS trim, voir plus bas pourquoi) et splitté sur tab, les
//    colonnes sont :
//      [0]="" [1]=Paroi(nom) [2]=Teinte [3]=Code [4]=m [5]=S [6]=Composant [7]=d [8]=?
//      [9]=Rsi et Rse [10]=R [11]=U jour [12]=U nuit [13]=famille (colonne sans libellé
//      propre dans l'en-tête : "Mur Ext.", "Fen. Porte et Porte-fen.", etc. — toujours
//      l'avant-dernière colonne réelle) [14]="" ;
//  - lignes 4-67 : les blocs paroi eux-mêmes (voir ci-dessous) ;
//  - lignes 68+ : bloc BINAIRE/sérialisation Excel-VB (tailles de police, couleurs, "#FALSE#"...)
//    SANS AUCUN RAPPORT avec des parois. Il n'y a que 5 blocs paroi dans tout le fichier source
//    (confirmé : seulement 2 occurrences de "Déphasage thermique" et 67 lignes multi-tab
//    contiguës au total, lignes 1-67) — ce n'est pas une bibliothèque de dizaines de parois
//    malgré la taille du fichier (77 Ko), qui est presque entièrement occupée par ce blob binaire.
//
// ⚠ PIÈGE : unquote() de sourceFiles.js fait un .trim() sur la ligne entière avant de retirer
// les guillemets. Sur les lignes de continuation (nom vide en colonne 1), la chaîne commence
// par plusieurs tabulations qui sont alors AVALÉES par le trim, décalant toutes les colonnes
// suivantes vers la gauche. On retire donc ici uniquement les guillemets englobants, sans trim,
// pour préserver l'alignement des colonnes (indices fixes ci-dessus, vérifiés sur les 5 blocs
// réels du fichier).
//
// Préfixes de nom réellement rencontrés dans le fichier : "ME." (mur extérieur), "FE." et
// "PF." (fenêtre / porte-fenêtre — "PF." n'était pas anticipé par la tâche), et deux parois
// SANS préfixe à point : "Plan. sur VS." (plancher sur vide sanitaire) et "Plaf. sous Comble."
// (plafond sous comble). Aucun MI./PB./PH./PL./TO./PO. présent dans ce fichier réel.
//
// Un bloc paroi "mur/plancher/plafond" (ME., Plan., Plaf.) débute par une ligne où col[1] (nom)
// est non vide, col[3]=code, col[13]=famille ; les lignes suivantes listent les composants
// (résistances) ; le bloc se termine par une ligne "Déphasage thermique de la paroi : ..." (ou,
// quand ce libellé est absent, une ligne dont les 3 derniers champs non vides sont
// [R, U jour, U nuit] — cas du bloc "Plan. sur VS.") : on ancre donc sur "3 derniers nombres
// positifs en fin de ligne" plutôt que sur le texte du libellé, plus robuste.
//
// Un bloc "fenêtre complète" (FE., PF.) tient sur UNE seule ligne de bloc-début (code, famille)
// mais n'a PAS de ligne "Déphasage thermique". col[10] (R) sur cette ligne n'est PAS le U de la
// fenêtre : c'est la valeur d'un composant annexe (vérifié sur les 2 blocs réels : "2.00"/"4.80"
// alors que le Uw réel de la fenêtre complète est 1.25/1.22). Le vrai Uw est seulement présent,
// plus loin dans le bloc, sur la ligne
// "Coefficients de la fenêtre, (Uw = 1.25), (Uwf = ...), (Ujn = ...), (Sw2 = ...) :" — on
// l'extrait par regex sur le texte brut de la ligne.
import { parseFrNumber } from './sourceFiles.js';

const UW_RE = /Coefficients de la fen[eê]tre.*?\(\s*Uw\s*=\s*([\d.,]+)\s*\)/i;

/** Retire uniquement les guillemets englobants d'une ligne (PAS de trim : voir commentaire
 * de tête sur le décalage de colonnes que provoquerait unquote() de sourceFiles.js ici). */
function stripQuotes(rawLine) {
  const m = String(rawLine).match(/^"(.*)"$/s);
  return m ? m[1] : String(rawLine);
}

function splitCols(rawLine) {
  return stripQuotes(rawLine).split('\t');
}

/** Dernier groupe de nombres positifs consécutifs en fin de ligne : [..., R, Ujour, Unuit]. */
function trailingPositiveNumbers(cols) {
  const nums = [];
  for (let i = cols.length - 1; i >= 0; i -= 1) {
    const n = parseFrNumber(cols[i]);
    if (n == null) {
      if (nums.length > 0) break; // on a déjà commencé la traîne : un trou l'arrête
      continue; // colonnes vides en fin de ligne : on continue à remonter
    }
    if (n <= 0) break;
    nums.unshift(n);
  }
  return nums;
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
    if (current.u != null) parois.push({ nom: current.nom, code: current.code, famille: current.famille, u: current.u });
    else rejects.push({ nom: current.nom, reason });
    current = null;
  };

  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const cols = splitCols(raw);
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
      };
      continue;
    }

    if (!current) continue; // lignes hors bloc (préambule, en-têtes, blob binaire, etc.)

    const uwMatch = raw.match(UW_RE);
    if (uwMatch) {
      const uw = parseFrNumber(uwMatch[1]);
      if (uw != null && uw > 0) current.u = uw;
      continue;
    }

    // Ligne de total ("Déphasage thermique..." ou équivalent) : les 3 derniers nombres positifs
    // en fin de ligne sont [R, U jour, U nuit].
    if (current.u == null) {
      const nums = trailingPositiveNumbers(cols);
      if (nums.length >= 3) current.u = nums[nums.length - 2]; // avant-dernier = U jour
    }
  }
  flush('fin de fichier avant que le bloc ait produit un U');

  return { parois, rejects };
}
