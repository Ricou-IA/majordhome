import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TAILLE_LOT, TAILLE_LOT_RETRAIT, decouperEnLots, messageErreurImport, executerLots, lireReponseRetrait, verifierLigne,
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

test('ligne refusée par la base : numéro de ligne et libellé du champ', () => {
  assert.equal(
    messageErreurImport({ message: 'row_invalid', details: 'ligne 14 : surface', code: '22023' }),
    "Ligne 14 du fichier : la valeur « Surface » est refusée. Aucune fiche de ce lot n'a été créée.",
  );
  assert.equal(
    messageErreurImport({ message: 'row_invalid', details: 'ligne 3 : display_name' }),
    "Ligne 3 du fichier : la valeur « display_name » est refusée. Aucune fiche de ce lot n'a été créée.",
  );
  // Détail sans numéro de ligne : message général
  assert.equal(
    messageErreurImport({ message: 'row_invalid', details: 'import_line' }),
    "Une ligne du fichier n'a pas pu être écrite : aucune fiche de ce lot n'a été créée.",
  );
});

test("délai dépassé, réseau coupé, lignes déjà en cours d'écriture", () => {
  const lent = 'La base a mis trop de temps à répondre. Réessayez dans un instant.';
  assert.equal(messageErreurImport({ code: '57014', message: 'canceling statement due to statement timeout' }), lent);
  assert.equal(messageErreurImport({ code: '55P03', message: 'canceling statement due to lock timeout' }), lent);
  const reseau = 'Connexion interrompue. Vérifiez votre réseau, puis reprenez.';
  assert.equal(messageErreurImport(new TypeError('Failed to fetch')), reseau);
  assert.equal(messageErreurImport({ message: 'TypeError: Failed to fetch' }), reseau);
  assert.equal(messageErreurImport({ message: 'NetworkError when attempting to fetch resource.' }), reseau);
  assert.equal(
    messageErreurImport({ code: '23505', message: 'duplicate key value violates unique constraint "clients_import_line_key"' }),
    "Ces lignes sont déjà en cours d'écriture par un autre envoi. Reprenez dans un instant.",
  );
  assert.equal(messageErreurImport({ code: '23505', message: 'duplicate key value violates unique constraint "autre"' }),
    'duplicate key value violates unique constraint "autre"');
});

test('verifierLigne : ce que clients_import_batch accepte', () => {
  const ok = { import_line: 2, display_name: 'DUPONT Jean', client_category: 'particulier', housing_type: 'maison',
    surface: 85.33, construction_year: 1985, mail_optin: true, sms_optin: null, email: 'a@b.fr', phone: '06 12 34 56 78',
    internal_notes: null, external_ref: 12 };
  assert.equal(verifierLigne(ok), null);
  assert.equal(verifierLigne({ import_line: 2, display_name: 'X' }), null);
  assert.equal(verifierLigne({ import_line: 2, display_name: 'X', surface: '80,5', construction_year: '2001' }), null);
  const refus = [
    [{ ...ok, import_line: 0 }, 'import_line'],
    [{ ...ok, import_line: 2.5 }, 'import_line'],
    [{ ...ok, import_line: '2' }, 'import_line'],
    [{ ...ok, import_line: 1234567890 }, 'import_line'],
    [{ ...ok, display_name: '   ' }, 'display_name'],
    [{ ...ok, display_name: null }, 'display_name'],
    [{ ...ok, client_category: 'Particulier' }, 'client_category'],
    [{ ...ok, housing_type: 'MAISON' }, 'housing_type'],
    [{ ...ok, surface: 85.333333 }, 'surface'],
    [{ ...ok, surface: 33612345678 }, 'surface'],
    [{ ...ok, surface: -1 }, 'surface'],
    [{ ...ok, construction_year: 19800 }, 'construction_year'],
    [{ ...ok, mail_optin: 'oui' }, 'mail_optin'],
    [{ ...ok, sms_optin: 1 }, 'sms_optin'],
    [{ ...ok, phone: true }, 'phone'],
    [{ ...ok, notes: { a: 1 } }, 'notes'],
    [{ ...ok, inconnue: [1] }, 'inconnue'],
  ];
  for (const [ligne, colonne] of refus) assert.equal(verifierLigne(ligne), colonne, JSON.stringify(ligne));
  assert.equal(verifierLigne(null), 'import_line');
});
