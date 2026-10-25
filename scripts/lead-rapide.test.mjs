// scripts/lead-rapide.test.mjs
// « Nouveau devis » depuis le Kanban (src/lib/leadRapide.js) : la fiche courte du client avant le devis (demande
// d'Eric, 2026-10-25 : « renseigner les infos clients / leads, ça permet de raccourcir le process »).
// Run : node --test scripts/lead-rapide.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FORMULAIRE_LEAD_VIDE, validerLeadRapide, leadDepuisFormulaire } from '../src/lib/leadRapide.js';

test('validerLeadRapide : nom obligatoire, et un moyen de contact (téléphone ou e-mail) ; e-mail mal formé refusé', () => {
  assert.deepEqual(validerLeadRapide({ ...FORMULAIRE_LEAD_VIDE, last_name: 'Cassagne', phone: '06 88 59 32 57' }), []);
  assert.deepEqual(validerLeadRapide({ ...FORMULAIRE_LEAD_VIDE, last_name: 'Cassagne', email: 'celine@gmail.com' }), []);
  assert.deepEqual(validerLeadRapide({ ...FORMULAIRE_LEAD_VIDE, phone: '0688593257' }), ['Le nom est requis']);
  assert.deepEqual(validerLeadRapide({ ...FORMULAIRE_LEAD_VIDE, last_name: 'Cassagne' }), ['Un téléphone ou un e-mail est requis']);
  assert.deepEqual(validerLeadRapide({ ...FORMULAIRE_LEAD_VIDE, last_name: 'Cassagne', email: 'pas-un-email' }), ['E-mail invalide']);
});

test('leadDepuisFormulaire : champs nettoyés, vides ⇒ null, statut posé, ids de référentiel repris', () => {
  const lead = leadDepuisFormulaire({
    first_name: ' Céline ', last_name: ' Cassagne ', phone: ' 06 88 59 32 57 ', email: ' Celine@Gmail.com ',
    address: '2533 Chemin de Fayence', postal_code: ' 82000 ', city: 'Montauban', commercial_id: 'c1', source_id: '', project_family_key: 'borne_recharge',
  }, { statusId: 's-nouveau' });
  assert.deepEqual(lead, {
    first_name: 'Céline', last_name: 'Cassagne', phone: '06 88 59 32 57', email: 'celine@gmail.com',
    address: '2533 Chemin de Fayence', postal_code: '82000', city: 'Montauban',
    status_id: 's-nouveau', assigned_user_id: 'c1', source_id: null, project_family_key: 'borne_recharge',
  });
});
