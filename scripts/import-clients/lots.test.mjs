import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TAILLE_LOT, TAILLE_LOT_RETRAIT, decouperEnLots, messageErreurImport, executerLots, lireReponseRetrait,
} from '../../src/lib/importClients/lots.js';

test('découpe en lots sans perdre ni dupliquer', () => {
  const lignes = Array.from({ length: 450 }, (_, i) => ({ import_line: i + 2 }));
  const lots = decouperEnLots(lignes);
  assert.deepEqual(lots.map((l) => l.length), [200, 200, 50]);
  assert.deepEqual(lots.flat(), lignes);
  assert.deepEqual(decouperEnLots([]), []);
  assert.equal(TAILLE_LOT, 200);
  assert.equal(TAILLE_LOT_RETRAIT, 100);
});

test('codes de la base traduits', () => {
  assert.equal(messageErreurImport({ message: 'org_admin_required' }), 'Réservé à l\'administrateur de l\'entreprise.');
  assert.equal(messageErreurImport({ message: 'import_closed' }), 'Cet import est déjà terminé.');
  assert.equal(messageErreurImport({ message: 'rows_invalid' }), 'Une ligne du fichier n\'a pas pu être écrite : aucune fiche de ce lot n\'a été créée.');
  assert.equal(messageErreurImport({ message: 'row_invalid' }), 'Une ligne du fichier n\'a pas pu être écrite : aucune fiche de ce lot n\'a été créée.');
  assert.equal(messageErreurImport({ message: 'file_name_required' }), 'Le nom du fichier est manquant.');
  assert.equal(messageErreurImport({ message: 'removal_incomplete' }), 'Le retrait n\'a pas pu aller au bout : rien n\'a été retiré par cet appel. Réessayez.');
  assert.equal(messageErreurImport({ message: 'import_not_found' }), 'Cet import est introuvable.');
  assert.equal(messageErreurImport({ message: 'unauthenticated' }), 'Votre session a expiré : reconnectez-vous.');
});

test('code reconnu même entouré de texte, mot entier seulement', () => {
  assert.equal(messageErreurImport({ message: 'ERROR: import_closed (55000)' }), 'Cet import est déjà terminé.');
  assert.equal(messageErreurImport({ message: 'not_row_invalid_x' }), 'not_row_invalid_x');
});

test('message inconnu rendu tel quel, vide → Erreur inconnue', () => {
  assert.equal(messageErreurImport({ message: 'autre chose' }), 'autre chose');
  assert.equal(messageErreurImport({}), 'Erreur inconnue');
  assert.equal(messageErreurImport(null), 'Erreur inconnue');
});

const lotsDe = (n) => Array.from({ length: n }, (_, i) => [{ import_line: i }]);

test('tous les lots passent', async () => {
  const vus = [];
  const r = await executerLots({
    lots: lotsDe(3), depuis: 0,
    envoyer: async (lot, i) => { vus.push(i); return { created: 1, skipped: 0 }; },
  });
  assert.deepEqual(vus, [0, 1, 2]);
  assert.deepEqual(r, { created: 3, skipped: 0, faits: 3, prochain: 3, erreur: null });
});

test('le troisième lot échoue puis reprise depuis lui', async () => {
  const echec = new Error('row_invalid');
  const r1 = await executerLots({
    lots: lotsDe(5), depuis: 0,
    envoyer: async (lot, i) => { if (i === 2) throw echec; return { created: 1, skipped: 0 }; },
  });
  assert.equal(r1.prochain, 2);
  assert.equal(r1.faits, 2);
  assert.equal(r1.erreur, echec);
  const vus = [];
  const r2 = await executerLots({
    lots: lotsDe(5), depuis: r1.prochain,
    envoyer: async (lot, i) => { vus.push(i); return { created: 0, skipped: 1 }; },
  });
  assert.deepEqual(vus, [2, 3, 4]);
  assert.deepEqual(r2, { created: 0, skipped: 3, faits: 3, prochain: 5, erreur: null });
});

test('réponse de retrait : valide lue, nulle ou incomplète rejetée', () => {
  assert.deepEqual(lireReponseRetrait({ retirees: 100, conservees: 2, restantes: 5 }), { retirees: 100, conservees: 2, restantes: 5 });
  assert.deepEqual(lireReponseRetrait({ retirees: 0, restantes: 0 }), { retirees: 0, conservees: 0, restantes: 0 });
  assert.throws(() => lireReponseRetrait(null), /n'est pas confirmé/);
  assert.throws(() => lireReponseRetrait({ retirees: 3 }), /n'est pas confirmé/);
  assert.throws(() => lireReponseRetrait({ restantes: 3 }), /n'est pas confirmé/);
});
