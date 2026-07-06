import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ajoutePiece, supprimePiece, deplacePiece, redimensionnePiece, renommePiece, basculeChauffee,
  regleThetaInt, ajouteOuverture, supprimeOuverture, ajouteNiveau, dupliqueNiveau, supprimeNiveau,
  regleNord, regleHauteurNiveau, valideDessin,
} from '../../src/apps/thermique/lib/dessinOps.js';

// ── Fixture de référence : 2 niveaux, 3 pièces (adapté de l'idée de maison() du plan 3, Task 6) ──
// RDC (hauteur 250) : séjour 500×400 (chauffée, θ20) + garage 300×400 accolé à l'est (non chauffé).
// Étage (hauteur 250) : chambre 500×400 (chauffée, θ18) posée exactement sur le séjour.
// nord = 0, plancherBasType 'terre-plein', toitureType 'comble'.
function dessinReference() {
  return {
    nord: 0,
    plancherBasType: 'terre-plein',
    toitureType: 'comble',
    niveaux: [
      { id: 'rdc', nom: 'RDC', hauteur: 250 },
      { id: 'etage', nom: 'Étage', hauteur: 250 },
    ],
    pieces: [
      {
        id: 'sejour', niveauId: 'rdc', nom: 'Séjour', typePiece: 'sejour', chauffee: true, thetaInt: 20,
        polygone: [{ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 500, y: 400 }, { x: 0, y: 400 }],
      },
      {
        id: 'garage', niveauId: 'rdc', nom: 'Garage', typePiece: 'garage', chauffee: false, thetaInt: null,
        polygone: [{ x: 500, y: 0 }, { x: 800, y: 0 }, { x: 800, y: 400 }, { x: 500, y: 400 }],
      },
      {
        id: 'chambre', niveauId: 'etage', nom: 'Chambre', typePiece: 'chambre', chauffee: true, thetaInt: 18,
        polygone: [{ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 500, y: 400 }, { x: 0, y: 400 }],
      },
    ],
    ouvertures: [
      { id: 'fen-sejour', pieceId: 'sejour', segmentIndex: 1, type: 'fenetre', largeur: 140, hauteur: 120, position: 180 },
    ],
  };
}

/** Gèle récursivement un objet/tableau (Object.freeze n'est pas profond nativement). */
function gelProfond(valeur) {
  if (valeur !== null && typeof valeur === 'object' && !Object.isFrozen(valeur)) {
    Object.freeze(valeur);
    for (const cle of Object.keys(valeur)) gelProfond(valeur[cle]);
  }
  return valeur;
}

function dessinGele() {
  return gelProfond(dessinReference());
}

// ─────────────────────────────────────────────────────────────────────────────
// ajoutePiece
// ─────────────────────────────────────────────────────────────────────────────

test('ajoutePiece : nominal — ajoute une pièce valide, nouvel objet, entrée non mutée', () => {
  const dessin = dessinGele();
  const nouvelle = {
    id: 'cuisine', niveauId: 'rdc', nom: 'Cuisine', typePiece: 'cuisine', chauffee: true, thetaInt: 20,
    polygone: [{ x: 800, y: 0 }, { x: 1100, y: 0 }, { x: 1100, y: 400 }, { x: 800, y: 400 }],
  };
  const { dessin: resultat, erreurs } = ajoutePiece(dessin, nouvelle);
  assert.deepEqual(erreurs, []);
  assert.notEqual(resultat, dessin);
  assert.equal(resultat.pieces.length, 4);
  assert.ok(resultat.pieces.some((p) => p.id === 'cuisine'));
  assert.equal(dessin.pieces.length, 3); // entrée inchangée
});

test('ajoutePiece : refusée — id déjà existant → même référence + erreurs', () => {
  const dessin = dessinGele();
  const dupliquee = { ...dessin.pieces[0], id: 'sejour' };
  const { dessin: resultat, erreurs } = ajoutePiece(dessin, dupliquee);
  assert.equal(resultat, dessin);
  assert.ok(erreurs.length > 0);
});

test('ajoutePiece : refusée — niveauId inexistant', () => {
  const dessin = dessinGele();
  const piece = { id: 'x', niveauId: 'sous-sol', nom: 'X', typePiece: 'autre', chauffee: true, thetaInt: 20,
    polygone: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }] };
  const { dessin: resultat, erreurs } = ajoutePiece(dessin, piece);
  assert.equal(resultat, dessin);
  assert.ok(erreurs.some((e) => /niveau/.test(e)));
});

test('ajoutePiece : refusée — polygone invalide', () => {
  const dessin = dessinGele();
  const piece = { id: 'x', niveauId: 'rdc', nom: 'X', typePiece: 'autre', chauffee: true, thetaInt: 20,
    polygone: [{ x: 0, y: 0 }, { x: 100, y: 0 }] };
  const { dessin: resultat, erreurs } = ajoutePiece(dessin, piece);
  assert.equal(resultat, dessin);
  assert.ok(erreurs.length > 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// supprimePiece
// ─────────────────────────────────────────────────────────────────────────────

test('supprimePiece : nominal — retire la pièce et ses ouvertures', () => {
  const dessin = dessinGele();
  const { dessin: resultat, erreurs } = supprimePiece(dessin, 'sejour');
  assert.deepEqual(erreurs, []);
  assert.notEqual(resultat, dessin);
  assert.ok(!resultat.pieces.some((p) => p.id === 'sejour'));
  assert.ok(!resultat.ouvertures.some((o) => o.pieceId === 'sejour'));
  assert.equal(dessin.pieces.length, 3); // entrée inchangée
});

test('supprimePiece : refusée — pieceId inconnu', () => {
  const dessin = dessinGele();
  const { dessin: resultat, erreurs } = supprimePiece(dessin, 'inconnue');
  assert.equal(resultat, dessin);
  assert.ok(erreurs.length > 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// deplacePiece
// ─────────────────────────────────────────────────────────────────────────────

test('deplacePiece : nominal — translation snappée grille, ouvertures suivent (relatives au segment)', () => {
  const dessin = dessinGele();
  const { dessin: resultat, erreurs } = deplacePiece(dessin, 'sejour', { dx: 100, dy: -50 });
  assert.deepEqual(erreurs, []);
  const piece = resultat.pieces.find((p) => p.id === 'sejour');
  assert.deepEqual(piece.polygone, [{ x: 100, y: -50 }, { x: 600, y: -50 }, { x: 600, y: 350 }, { x: 100, y: 350 }]);
  // Ouverture inchangée (segment-relative : position/segmentIndex ne bougent pas)
  const ouverture = resultat.ouvertures.find((o) => o.id === 'fen-sejour');
  assert.deepEqual(ouverture, dessin.ouvertures[0]);
});

test('deplacePiece : refusée — dx/dy non multiples de la grille', () => {
  const dessin = dessinGele();
  const { dessin: resultat, erreurs } = deplacePiece(dessin, 'sejour', { dx: 5, dy: 0 });
  assert.equal(resultat, dessin);
  assert.ok(erreurs.some((e) => /grille/.test(e)));
});

test('deplacePiece : refusée — pieceId inconnu', () => {
  const dessin = dessinGele();
  const { dessin: resultat, erreurs } = deplacePiece(dessin, 'inconnue', { dx: 10, dy: 0 });
  assert.equal(resultat, dessin);
  assert.ok(erreurs.length > 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// renommePiece
// ─────────────────────────────────────────────────────────────────────────────

test('renommePiece : nominal — nom trimé', () => {
  const dessin = dessinGele();
  const { dessin: resultat, erreurs } = renommePiece(dessin, 'sejour', '  Salon  ');
  assert.deepEqual(erreurs, []);
  assert.equal(resultat.pieces.find((p) => p.id === 'sejour').nom, 'Salon');
});

test('renommePiece : refusée — nom vide après trim', () => {
  const dessin = dessinGele();
  const { dessin: resultat, erreurs } = renommePiece(dessin, 'sejour', '   ');
  assert.equal(resultat, dessin);
  assert.ok(erreurs.length > 0);
});

test('renommePiece : refusée — pieceId inconnu', () => {
  const dessin = dessinGele();
  const { dessin: resultat, erreurs } = renommePiece(dessin, 'inconnue', 'Salon');
  assert.equal(resultat, dessin);
  assert.ok(erreurs.length > 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// basculeChauffee
// ─────────────────────────────────────────────────────────────────────────────

test('basculeChauffee : nominal — inverse le booléen', () => {
  const dessin = dessinGele();
  const { dessin: resultat, erreurs } = basculeChauffee(dessin, 'garage');
  assert.deepEqual(erreurs, []);
  assert.equal(resultat.pieces.find((p) => p.id === 'garage').chauffee, true);
  const { dessin: resultat2 } = basculeChauffee(resultat, 'garage');
  assert.equal(resultat2.pieces.find((p) => p.id === 'garage').chauffee, false);
});

test('basculeChauffee : refusée — pieceId inconnu', () => {
  const dessin = dessinGele();
  const { dessin: resultat, erreurs } = basculeChauffee(dessin, 'inconnue');
  assert.equal(resultat, dessin);
  assert.ok(erreurs.length > 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// regleThetaInt
// ─────────────────────────────────────────────────────────────────────────────

test('regleThetaInt : nominal — valeur finie dans [5,30]', () => {
  const dessin = dessinGele();
  const { dessin: resultat, erreurs } = regleThetaInt(dessin, 'sejour', 19);
  assert.deepEqual(erreurs, []);
  assert.equal(resultat.pieces.find((p) => p.id === 'sejour').thetaInt, 19);
});

test('regleThetaInt : nominal — null accepté (pièce non chauffée typiquement)', () => {
  const dessin = dessinGele();
  const { dessin: resultat, erreurs } = regleThetaInt(dessin, 'sejour', null);
  assert.deepEqual(erreurs, []);
  assert.equal(resultat.pieces.find((p) => p.id === 'sejour').thetaInt, null);
});

test('regleThetaInt : refusée — hors [5,30]', () => {
  const dessin = dessinGele();
  const { dessin: resultat, erreurs } = regleThetaInt(dessin, 'sejour', 40);
  assert.equal(resultat, dessin);
  assert.ok(erreurs.length > 0);
});

test('regleThetaInt : refusée — non fini (NaN)', () => {
  const dessin = dessinGele();
  const { dessin: resultat, erreurs } = regleThetaInt(dessin, 'sejour', NaN);
  assert.equal(resultat, dessin);
  assert.ok(erreurs.length > 0);
});

test('regleThetaInt : refusée — pieceId inconnu', () => {
  const dessin = dessinGele();
  const { dessin: resultat, erreurs } = regleThetaInt(dessin, 'inconnue', 20);
  assert.equal(resultat, dessin);
  assert.ok(erreurs.length > 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// ajouteOuverture
// ─────────────────────────────────────────────────────────────────────────────

test('ajouteOuverture : nominal — structure valide', () => {
  const dessin = dessinGele();
  const ouverture = { id: 'porte-entree', pieceId: 'sejour', segmentIndex: 3, type: 'porte', largeur: 90, hauteur: 215, position: 200 };
  const { dessin: resultat, erreurs } = ajouteOuverture(dessin, ouverture);
  assert.deepEqual(erreurs, []);
  assert.equal(resultat.ouvertures.length, 2);
  assert.ok(resultat.ouvertures.some((o) => o.id === 'porte-entree'));
});

test('ajouteOuverture : refusée — id déjà existant', () => {
  const dessin = dessinGele();
  const ouverture = { id: 'fen-sejour', pieceId: 'sejour', segmentIndex: 1, type: 'fenetre', largeur: 100, hauteur: 100, position: 0 };
  const { dessin: resultat, erreurs } = ajouteOuverture(dessin, ouverture);
  assert.equal(resultat, dessin);
  assert.ok(erreurs.length > 0);
});

test('ajouteOuverture : refusée — pieceId inconnu', () => {
  const dessin = dessinGele();
  const ouverture = { id: 'x', pieceId: 'inconnue', segmentIndex: 0, type: 'fenetre', largeur: 100, hauteur: 100, position: 0 };
  const { dessin: resultat, erreurs } = ajouteOuverture(dessin, ouverture);
  assert.equal(resultat, dessin);
  assert.ok(erreurs.length > 0);
});

test('ajouteOuverture : refusée — segmentIndex hors bornes du polygone de la pièce', () => {
  const dessin = dessinGele();
  const ouverture = { id: 'x', pieceId: 'sejour', segmentIndex: 9, type: 'fenetre', largeur: 100, hauteur: 100, position: 0 };
  const { dessin: resultat, erreurs } = ajouteOuverture(dessin, ouverture);
  assert.equal(resultat, dessin);
  assert.ok(erreurs.some((e) => /segment/.test(e)));
});

test('ajouteOuverture : refusée — largeur/hauteur non positives', () => {
  const dessin = dessinGele();
  const ouverture = { id: 'x', pieceId: 'sejour', segmentIndex: 0, type: 'fenetre', largeur: 0, hauteur: 100, position: 0 };
  const { dessin: resultat, erreurs } = ajouteOuverture(dessin, ouverture);
  assert.equal(resultat, dessin);
  assert.ok(erreurs.length > 0);
});

test('ajouteOuverture : refusée — position négative', () => {
  const dessin = dessinGele();
  const ouverture = { id: 'x', pieceId: 'sejour', segmentIndex: 0, type: 'fenetre', largeur: 100, hauteur: 100, position: -10 };
  const { dessin: resultat, erreurs } = ajouteOuverture(dessin, ouverture);
  assert.equal(resultat, dessin);
  assert.ok(erreurs.length > 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// supprimeOuverture
// ─────────────────────────────────────────────────────────────────────────────

test('supprimeOuverture : nominal', () => {
  const dessin = dessinGele();
  const { dessin: resultat, erreurs } = supprimeOuverture(dessin, 'fen-sejour');
  assert.deepEqual(erreurs, []);
  assert.equal(resultat.ouvertures.length, 0);
});

test('supprimeOuverture : refusée — ouvertureId inconnu', () => {
  const dessin = dessinGele();
  const { dessin: resultat, erreurs } = supprimeOuverture(dessin, 'inconnue');
  assert.equal(resultat, dessin);
  assert.ok(erreurs.length > 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// ajouteNiveau
// ─────────────────────────────────────────────────────────────────────────────

test('ajouteNiveau : nominal — ajouté au sommet', () => {
  const dessin = dessinGele();
  const { dessin: resultat, erreurs } = ajouteNiveau(dessin, { id: 'combles', nom: 'Combles', hauteur: 200 });
  assert.deepEqual(erreurs, []);
  assert.equal(resultat.niveaux.length, 3);
  assert.equal(resultat.niveaux.at(-1).id, 'combles');
});

test('ajouteNiveau : refusée — id déjà existant', () => {
  const dessin = dessinGele();
  const { dessin: resultat, erreurs } = ajouteNiveau(dessin, { id: 'rdc', nom: 'Dup', hauteur: 200 });
  assert.equal(resultat, dessin);
  assert.ok(erreurs.length > 0);
});

test('ajouteNiveau : refusée — hauteur hors [180,500]', () => {
  const dessin = dessinGele();
  const { dessin: resultat, erreurs } = ajouteNiveau(dessin, { id: 'combles', nom: 'Combles', hauteur: 100 });
  assert.equal(resultat, dessin);
  assert.ok(erreurs.length > 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// dupliqueNiveau
// ─────────────────────────────────────────────────────────────────────────────

test('dupliqueNiveau : nominal — nouveau niveau au sommet, ids frais, géométrie identique, noms suffixés, source inchangée', () => {
  const dessin = dessinGele();
  const { dessin: resultat, erreurs } = dupliqueNiveau(dessin, 'rdc', { nouvelId: 'rdc-2' });
  assert.deepEqual(erreurs, []);
  assert.equal(resultat.niveaux.length, 3);
  assert.equal(resultat.niveaux.at(-1).id, 'rdc-2');
  assert.equal(resultat.niveaux.at(-1).hauteur, 250);
  assert.equal(resultat.niveaux.at(-1).nom, 'RDC (étage)');

  const piecesCopiees = resultat.pieces.filter((p) => p.niveauId === 'rdc-2');
  assert.equal(piecesCopiees.length, 2); // séjour + garage du RDC
  // ids tous nouveaux, déterministes ${ancienId}-copie-${n}
  assert.ok(piecesCopiees.every((p) => /^.+-copie-\d+$/.test(p.id)));
  const idsCopies = new Set(piecesCopiees.map((p) => p.id));
  assert.equal(idsCopies.size, 2); // pas de collision
  // géométrie identique (mêmes polygones que les pièces du RDC source)
  const sejourCopie = piecesCopiees.find((p) => p.nom.startsWith('Séjour'));
  assert.deepEqual(sejourCopie.polygone, dessin.pieces.find((p) => p.id === 'sejour').polygone);
  assert.equal(sejourCopie.nom, 'Séjour (étage)');

  // ouvertures copiées avec pieceId réécrit vers la copie, ids frais
  const ouverturesCopiees = resultat.ouvertures.filter((o) => piecesCopiees.some((p) => p.id === o.pieceId));
  assert.equal(ouverturesCopiees.length, 1);
  assert.notEqual(ouverturesCopiees[0].id, 'fen-sejour');

  // source RDC totalement inchangée
  assert.equal(resultat.pieces.filter((p) => p.niveauId === 'rdc').length, 2);
  assert.deepEqual(dessin.pieces.length, 3); // entrée non mutée
});

test('dupliqueNiveau : suffixe personnalisé et déterminisme (deux appels successifs → ids distincts)', () => {
  const dessin = dessinGele();
  const { dessin: r1 } = dupliqueNiveau(dessin, 'rdc', { nouvelId: 'rdc-2', suffixe: ' (copie)' });
  assert.equal(r1.niveaux.at(-1).nom, 'RDC (copie)');
  const { dessin: r2 } = dupliqueNiveau(r1, 'rdc', { nouvelId: 'rdc-3', suffixe: ' (copie)' });
  assert.equal(r2.niveaux.length, 4);
  const piecesRdc2 = r2.pieces.filter((p) => p.niveauId === 'rdc-2');
  const piecesRdc3 = r2.pieces.filter((p) => p.niveauId === 'rdc-3');
  const idsRdc2 = new Set(piecesRdc2.map((p) => p.id));
  const idsRdc3 = new Set(piecesRdc3.map((p) => p.id));
  // aucune collision entre les deux duplications successives
  assert.equal([...idsRdc2].some((id) => idsRdc3.has(id)), false);
});

test('dupliqueNiveau : refusée — niveauId inconnu', () => {
  const dessin = dessinGele();
  const { dessin: resultat, erreurs } = dupliqueNiveau(dessin, 'inconnu', { nouvelId: 'x' });
  assert.equal(resultat, dessin);
  assert.ok(erreurs.length > 0);
});

test('dupliqueNiveau : refusée — nouvelId déjà existant', () => {
  const dessin = dessinGele();
  const { dessin: resultat, erreurs } = dupliqueNiveau(dessin, 'rdc', { nouvelId: 'etage' });
  assert.equal(resultat, dessin);
  assert.ok(erreurs.length > 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// supprimeNiveau
// ─────────────────────────────────────────────────────────────────────────────

test('supprimeNiveau : nominal — retire le niveau et ses pièces/ouvertures', () => {
  const dessin = dessinGele();
  const { dessin: resultat, erreurs } = supprimeNiveau(dessin, 'etage');
  assert.deepEqual(erreurs, []);
  assert.equal(resultat.niveaux.length, 1);
  assert.ok(!resultat.pieces.some((p) => p.niveauId === 'etage'));
});

test('supprimeNiveau : refusée — dernier niveau restant', () => {
  const dessin = dessinGele();
  const { dessin: intermediaire } = supprimeNiveau(dessin, 'etage');
  const gele = gelProfond(intermediaire);
  const { dessin: resultat, erreurs } = supprimeNiveau(gele, 'rdc');
  assert.equal(resultat, gele);
  assert.ok(erreurs.length > 0);
});

test('supprimeNiveau : refusée — niveauId inconnu', () => {
  const dessin = dessinGele();
  const { dessin: resultat, erreurs } = supprimeNiveau(dessin, 'inconnu');
  assert.equal(resultat, dessin);
  assert.ok(erreurs.length > 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// regleNord
// ─────────────────────────────────────────────────────────────────────────────

test('regleNord : nominal — normalisé dans [0,360) par double-modulo', () => {
  const dessin = dessinGele();
  assert.equal(regleNord(dessin, 45).dessin.nord, 45);
  assert.equal(regleNord(dessin, 400).dessin.nord, 40);
  assert.equal(regleNord(dessin, -30).dessin.nord, 330);
  assert.equal(regleNord(dessin, -400).dessin.nord, 320);
  assert.equal(regleNord(dessin, 720).dessin.nord, 0);
});

test('regleNord : refusée — non fini', () => {
  const dessin = dessinGele();
  const { dessin: resultat, erreurs } = regleNord(dessin, NaN);
  assert.equal(resultat, dessin);
  assert.ok(erreurs.length > 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// regleHauteurNiveau
// ─────────────────────────────────────────────────────────────────────────────

test('regleHauteurNiveau : nominal — dans [180,500]', () => {
  const dessin = dessinGele();
  const { dessin: resultat, erreurs } = regleHauteurNiveau(dessin, 'rdc', 270);
  assert.deepEqual(erreurs, []);
  assert.equal(resultat.niveaux.find((n) => n.id === 'rdc').hauteur, 270);
});

test('regleHauteurNiveau : refusée — hors [180,500]', () => {
  const dessin = dessinGele();
  const { dessin: resultat, erreurs } = regleHauteurNiveau(dessin, 'rdc', 600);
  assert.equal(resultat, dessin);
  assert.ok(erreurs.length > 0);
});

test('regleHauteurNiveau : refusée — niveauId inconnu', () => {
  const dessin = dessinGele();
  const { dessin: resultat, erreurs } = regleHauteurNiveau(dessin, 'inconnu', 250);
  assert.equal(resultat, dessin);
  assert.ok(erreurs.length > 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// Immutabilité : toute tentative de mutation de l'entrée gelée lève (strict mode)
// ─────────────────────────────────────────────────────────────────────────────

test('immutabilité : le dessin gelé en entrée n’est jamais muté par une op qui réussit', () => {
  const dessin = dessinGele();
  ajoutePiece(dessin, {
    id: 'z', niveauId: 'rdc', nom: 'Z', typePiece: 'autre', chauffee: true, thetaInt: 20,
    polygone: [{ x: 800, y: 0 }, { x: 900, y: 0 }, { x: 900, y: 100 }, { x: 800, y: 100 }],
  });
  deplacePiece(dessin, 'sejour', { dx: 10, dy: 0 });
  renommePiece(dessin, 'sejour', 'X');
  basculeChauffee(dessin, 'garage');
  regleNord(dessin, 90);
  regleHauteurNiveau(dessin, 'rdc', 300);
  dupliqueNiveau(dessin, 'rdc', { nouvelId: 'rdc-x' });
  // Aucune assertion supplémentaire nécessaire : si une op avait tenté une mutation directe de
  // `dessin` (objet gelé), l'appel aurait levé en mode strict AVANT d'atteindre cette ligne.
  assert.equal(dessin.pieces.length, 3);
  assert.equal(dessin.niveaux.length, 2);
});

// ─────────────────────────────────────────────────────────────────────────────
// valideDessin
// ─────────────────────────────────────────────────────────────────────────────

test('valideDessin : dessin de référence sain → aucune erreur (avertissements possibles mais aucune erreur)', () => {
  const { erreurs } = valideDessin(dessinGele());
  assert.deepEqual(erreurs, []);
});

test('valideDessin : dessin corrompu — chevauchement géométrique de deux pièces du même niveau → erreur (via deduireParois)', () => {
  const dessin = dessinReference();
  // Fait chevaucher le garage et le séjour (chevauchement de surface au RDC) — aucun id dupliqué
  // ici : ce cas isole la détection géométrique de la détection structurelle (voir test suivant).
  dessin.pieces[1].polygone = [{ x: 400, y: 0 }, { x: 800, y: 0 }, { x: 800, y: 400 }, { x: 400, y: 400 }];
  const gele = gelProfond(dessin);
  const { erreurs } = valideDessin(gele);
  assert.ok(erreurs.some((e) => /chevauch/.test(e)), `attendu une erreur de chevauchement, reçu : ${JSON.stringify(erreurs)}`);
});

test('valideDessin : dessin corrompu — id de pièce dupliqué → erreur structurelle ET deduireParois throw rattrapé (les deux présents)', () => {
  const dessin = dessinReference();
  // Duplique l'id 'sejour' sur la chambre (id dupliqué global) : deduireParois indexe le dessin
  // AVANT toute géométrie et throw 'thermique:' sur ce cas (erreur de programmation à ses yeux) —
  // valideDessin rattrape ce throw et l'ajoute aux erreurs, EN PLUS de sa propre détection
  // structurelle indépendante (les deux checks sont redondants mais chacun est vérifié isolément).
  dessin.pieces[2].id = 'sejour';
  const gele = gelProfond(dessin);
  const { erreurs } = valideDessin(gele);
  assert.ok(erreurs.some((e) => /pièce.*sejour.*dupliqu/.test(e)), `attendu l'erreur structurelle, reçu : ${JSON.stringify(erreurs)}`);
  assert.ok(erreurs.some((e) => /thermique:/.test(e)), `attendu le throw converti de deduireParois, reçu : ${JSON.stringify(erreurs)}`);
});

test('valideDessin : structure — pièce référencant un niveau inconnu → erreur (sans throw)', () => {
  const dessin = dessinReference();
  dessin.pieces[0].niveauId = 'sous-sol-inconnu';
  const gele = gelProfond(dessin);
  const { erreurs } = valideDessin(gele);
  assert.ok(erreurs.some((e) => /niveau/.test(e)));
});

test('valideDessin : structure — hauteur de niveau hors [180,500] → erreur', () => {
  const dessin = dessinReference();
  dessin.niveaux[0].hauteur = 100;
  const gele = gelProfond(dessin);
  const { erreurs } = valideDessin(gele);
  assert.ok(erreurs.some((e) => /hauteur/.test(e)));
});

test('valideDessin : structure — nord non fini → erreur', () => {
  const dessin = dessinReference();
  dessin.nord = NaN;
  const gele = gelProfond(dessin);
  const { erreurs } = valideDessin(gele);
  assert.ok(erreurs.some((e) => /nord/.test(e)));
});

test('valideDessin : structure — id d’ouverture dupliqué → erreur', () => {
  const dessin = dessinReference();
  dessin.ouvertures.push({ ...dessin.ouvertures[0] });
  const gele = gelProfond(dessin);
  const { erreurs } = valideDessin(gele);
  assert.ok(erreurs.some((e) => /dupliqu/.test(e)));
});

test('valideDessin : catch throw thermique de deduireParois (dessin malformé) → converti en erreur, jamais un throw', () => {
  const dessin = dessinReference();
  dessin.pieces[0].niveauId = 'niveau-fantome'; // référence invalide → deduireParois throw thermique
  const gele = gelProfond(dessin);
  assert.doesNotThrow(() => valideDessin(gele));
  const { erreurs } = valideDessin(gele);
  assert.ok(erreurs.length > 0);
});

test('valideDessin : délègue et fusionne les avertissements de deduireParois (ex. niveau sans pièce chauffée)', () => {
  const dessin = dessinReference();
  dessin.pieces.forEach((p) => { p.chauffee = false; p.thetaInt = null; });
  const gele = gelProfond(dessin);
  const { avertissements } = valideDessin(gele);
  assert.ok(avertissements.length > 0);
});

// ── redimensionnePiece (plan 5, A2) — rectangle-only, ancré coin haut-gauche ──
const POLY_400x300 = [{ x: 0, y: 0 }, { x: 0, y: 300 }, { x: 400, y: 300 }, { x: 400, y: 0 }];
const rectDessin = (polygone) => ({
  niveaux: [{ id: 'rdc', nom: 'RDC', hauteur: 250 }],
  pieces: [{ id: 'p1', niveauId: 'rdc', nom: 'P', typePiece: 'autre', chauffee: true, thetaInt: 19, polygone }],
  ouvertures: [], nord: 0, plancherBasType: 'terre-plein', toitureType: 'comble',
});

test('redimensionnePiece : redimensionne, ancré au coin haut-gauche', () => {
  const { dessin, erreurs } = redimensionnePiece(rectDessin(POLY_400x300), 'p1', { largeur: 500, hauteur: 250 });
  assert.deepEqual(erreurs, []);
  const poly = dessin.pieces[0].polygone;
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  assert.equal(Math.min(...xs), 0);
  assert.equal(Math.min(...ys), 0);
  assert.equal(Math.max(...xs), 500);
  assert.equal(Math.max(...ys), 250);
});

test('redimensionnePiece : refuse une dimension hors grille', () => {
  const { erreurs } = redimensionnePiece(rectDessin(POLY_400x300), 'p1', { largeur: 505, hauteur: 250 });
  assert.equal(erreurs.length, 1);
});

test('redimensionnePiece : refuse une dimension ≤ 0', () => {
  const { erreurs } = redimensionnePiece(rectDessin(POLY_400x300), 'p1', { largeur: 0, hauteur: 250 });
  assert.equal(erreurs.length, 1);
});

test('redimensionnePiece : refuse une pièce non rectangulaire (forme en L)', () => {
  const L = [{ x: 0, y: 0 }, { x: 0, y: 300 }, { x: 200, y: 300 }, { x: 200, y: 150 },
    { x: 400, y: 150 }, { x: 400, y: 0 }];
  const { erreurs } = redimensionnePiece(rectDessin(L), 'p1', { largeur: 500, hauteur: 300 });
  assert.equal(erreurs.length, 1);
});

test('redimensionnePiece : refuse un pieceId inconnu', () => {
  const { erreurs } = redimensionnePiece(rectDessin(POLY_400x300), 'inconnu', { largeur: 500, hauteur: 250 });
  assert.equal(erreurs.length, 1);
});
