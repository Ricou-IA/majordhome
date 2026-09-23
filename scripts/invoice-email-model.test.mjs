// scripts/invoice-email-model.test.mjs — envoi de la facture d'entretien par e-mail (src/lib/invoiceEmailModel.js)
// node --test scripts/invoice-email-model.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invoiceEmailAvailability, certificateAttachmentRows, invoiceEmailErrorMessage, INVOICE_EMAIL_ERROR_MESSAGES } from '../src/lib/invoiceEmailModel.js';
import { DEFAULT_INVOICE_EMAIL, INVOICE_EMAIL_TEMPLATE_KEY, INVOICE_EMAIL_PLACEHOLDERS } from '../src/lib/invoiceEmailTemplate.js';

const OK = { modules: { communication: true }, from_email: 'contact@mayer-energie.fr', resend: { status: 'verified' } };

test('invoiceEmailAvailability : invisible sans module, sinon activée seulement si e-mail + from_email + domaine vérifié + facture non brouillon', () => {
  assert.deepEqual(invoiceEmailAvailability({ settings: {}, mode: 'final', clientEmail: 'a@b.fr' }), { visible: false, enabled: false, reason: 'module_off' });
  assert.deepEqual(invoiceEmailAvailability({ settings: OK, mode: 'final', clientEmail: 'a@b.fr' }), { visible: true, enabled: true, reason: null });
  assert.deepEqual(invoiceEmailAvailability({ settings: OK, mode: 'hub', clientEmail: 'a@b.fr' }), { visible: true, enabled: true, reason: null });
  assert.equal(invoiceEmailAvailability({ settings: OK, mode: 'draft', clientEmail: 'a@b.fr' }).reason, 'draft_mode');
  assert.equal(invoiceEmailAvailability({ settings: OK, mode: 'final', clientEmail: '' }).reason, 'no_email');
  assert.equal(invoiceEmailAvailability({ settings: { ...OK, from_email: '' }, mode: 'final', clientEmail: 'a@b.fr' }).reason, 'no_from_email');
  assert.equal(invoiceEmailAvailability({ settings: { ...OK, resend: { status: 'pending' } }, mode: 'final', clientEmail: 'a@b.fr' }).reason, 'resend_not_verified');
  // renvoi depuis la carte : la facture doit exister et ne pas être un brouillon Pennylane
  assert.equal(invoiceEmailAvailability({ settings: OK, mode: 'final', clientEmail: 'a@b.fr', hasInvoice: false }).reason, 'no_invoice');
  assert.equal(invoiceEmailAvailability({ settings: OK, mode: 'draft', clientEmail: 'a@b.fr', hasInvoice: true, isDraftInvoice: false }).enabled, true, 'une facture Pennylane déjà finalisée se renvoie même si le mode courant est brouillon');
  assert.equal(invoiceEmailAvailability({ settings: OK, mode: 'final', clientEmail: 'a@b.fr', hasInvoice: true, isDraftInvoice: true }).reason, 'draft_invoice');
  // ordre des raisons : module, puis e-mail, puis expéditeur, puis domaine, puis facture
  assert.equal(invoiceEmailAvailability({ settings: { modules: { communication: true } }, mode: 'draft', clientEmail: '' }).reason, 'no_email');
  // I1 — renvoi (`mode: 'resend'`) : ne déclenche JAMAIS draft_mode, quel que soit le mode de
  // création courant de l'org (une facture déjà émise peut être renvoyée même si l'org crée
  // aujourd'hui en brouillon).
  assert.deepEqual(invoiceEmailAvailability({ settings: OK, mode: 'resend', clientEmail: 'a@b.fr', hasInvoice: true }), { visible: true, enabled: true, reason: null });
});

test('certificateAttachmentRows : PDF requis pour être joignable, cochés par défaut, non signé marqué, libellé depuis l’équipement', () => {
  const rows = certificateAttachmentRows([
    { id: 'c1', equipement_type: 'poele', equipement_marque: 'MCZ', equipement_modele: 'Ego', statut: 'signe', pdf_storage_path: 'x/1.pdf', reference: 'CERT-1' },
    { id: 'c2', equipement_type: 'pac_air_air', equipement_marque: null, equipement_modele: null, statut: 'brouillon', pdf_storage_path: 'x/2.pdf', reference: null },
    { id: 'c3', equipement_type: null, statut: 'brouillon', pdf_storage_path: null, reference: null },
  ]);
  assert.deepEqual(rows.map((r) => [r.id, r.attachable, r.defaultChecked, r.badge]), [['c1', true, true, null], ['c2', true, true, 'non signé'], ['c3', false, false, 'PDF non généré']]);
  assert.equal(rows[0].label, 'Certificat CERT-1');
  assert.equal(rows[0].sublabel, 'poele · MCZ · Ego');
  assert.equal(rows[1].label, 'Certificat d’entretien');
  assert.equal(rows[1].sublabel, 'pac_air_air');
  assert.equal(rows[2].sublabel, '');
  assert.deepEqual(certificateAttachmentRows(null), []);
});

test('certificateAttachmentRows : I2 — labelByCode traduit le code de catégorie en libellé, sans option le code brut reste affiché', () => {
  const fixture = [{ id: 'c1', equipement_type: 'poele', equipement_marque: 'MCZ', equipement_modele: 'Ego', statut: 'signe', pdf_storage_path: 'x/1.pdf', reference: 'CERT-1' }];
  const rows = certificateAttachmentRows(fixture, { labelByCode: { poele: 'Poêle' } });
  assert.equal(rows[0].sublabel, 'Poêle · MCZ · Ego');
  const rowsNoOption = certificateAttachmentRows(fixture);
  assert.equal(rowsNoOption[0].sublabel, 'poele · MCZ · Ego');
});

test('messages d’erreur : chaque code de l’edge a un message FR, détail ajouté, inconnu → fallback', () => {
  for (const code of ['module_communication_inactif', 'intervention_not_found', 'invoice_missing', 'invoice_is_draft', 'invoice_pdf_missing', 'certificate_not_allowed', 'certificate_pdf_missing', 'template_missing', 'client_email_missing', 'attachments_too_large', 'resend_failed']) {
    assert.ok(INVOICE_EMAIL_ERROR_MESSAGES[code], `message manquant pour ${code}`);
  }
  assert.equal(invoiceEmailErrorMessage({ code: 'template_missing' }), INVOICE_EMAIL_ERROR_MESSAGES.template_missing);
  assert.equal(invoiceEmailErrorMessage({ code: 'resend_failed', detail: 'HTTP 422' }), `${INVOICE_EMAIL_ERROR_MESSAGES.resend_failed} (HTTP 422)`);
  assert.equal(invoiceEmailErrorMessage({ message: 'boom' }), 'boom');
  assert.equal(invoiceEmailErrorMessage(null), 'L’e-mail n’a pas pu être envoyé.');
});

test('gabarit par défaut : clé, transactionnel, variables présentes dans le corps', () => {
  assert.equal(INVOICE_EMAIL_TEMPLATE_KEY, 'facture_entretien');
  assert.equal(DEFAULT_INVOICE_EMAIL.key, 'facture_entretien');
  assert.equal(DEFAULT_INVOICE_EMAIL.is_transactional, true);
  for (const p of ['{{CLIENT_NAME}}', '{{INVOICE_NUMBER}}', '{{INVOICE_AMOUNT}}', '{{ATTACHMENTS}}', '{{BRAND_NAME}}']) {
    assert.ok(DEFAULT_INVOICE_EMAIL.html_body.includes(p) || DEFAULT_INVOICE_EMAIL.subject.includes(p), `${p} absent du gabarit`);
    assert.ok(INVOICE_EMAIL_PLACEHOLDERS.includes(p));
  }
  assert.ok(!/<html|<body/i.test(DEFAULT_INVOICE_EMAIL.html_body), 'corps sans <html> : il est habillé par le squelette de l’org');
});
