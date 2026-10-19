// node --test scripts/webshop-confirmation.test.mjs — blocs de la confirmation de commande (emailTemplates.js, pur)
// Reprend, sans perte, le contenu de l'ancienne confirmation du site Mayer (deliveryBlock + mentions).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  blocsConfirmation, WEBSHOP_CONFIRMATION_TEXTES, WEBSHOP_EMAIL_DEFAULTS, WEBSHOP_EMAIL_PLACEHOLDERS,
} from '../src/lib/webshop/emailTemplates.js';
import { variablesCommande } from '../src/lib/webshop/process.js';

const SITE = 'https://www.mayer-energie.fr';
const PALETTE = { name: 'Palette granulés', qty: 1, shippingKind: 'pallet' };
const COLIS = { name: 'Range-bûches', qty: 1, shippingKind: 'parcel' };
const POINT = { name: 'Gaillac', address: '26 Rue des Pyrénées', openingHours: '8h-18h' };
const base = (o = {}) => ({
  address: '12 Rue des Vignes', postal_code: '31120', city: 'Goyrans', comments: null,
  pallet_delivery_mode: null, parcel_delivery_mode: null, delivery_slot_changed: false, needs_manual_planning: false,
  geocoded_address: null, ...o,
});
const livraisonPalette = (o = {}) => base({ pallet_delivery_mode: 'delivery', geocoded_address: { label: '12 Rue des Vignes 31120 Goyrans' }, ...o });
const blocs = (order, extra = {}) => blocsConfirmation({ order, lines: [PALETTE, COLIS], slot: null, pickupPoint: null, siteUrl: SITE, ...extra });

test('1. CGV et droit de rétractation de 14 jours : toujours présents, lien dérivé du site', () => {
  for (const order of [base({ parcel_delivery_mode: 'delivery' }), livraisonPalette(), base({ pallet_delivery_mode: 'pickup' })]) {
    const { mentionsHtml } = blocs(order);
    assert.match(mentionsHtml, /Conditions générales de vente et droit de rétractation de 14 jours/);
    assert.match(mentionsHtml, /<a href="https:\/\/www\.mayer-energie\.fr\/boutique\/cgv">mayer-energie\.fr\/boutique\/cgv<\/a>/);
  }
  // `/` final retiré ; sans site connu, la mention reste (sans lien).
  assert.match(blocs(base(), { siteUrl: 'https://exemple.fr/' }).mentionsHtml, /href="https:\/\/exemple\.fr\/boutique\/cgv"/);
  const sansSite = blocs(base(), { siteUrl: '' }).mentionsHtml;
  assert.match(sansSite, /droit de rétractation de 14 jours/);
  assert.doesNotMatch(sansSite, /href/);
});

test('2. palette livrée : date indicative et appel du transporteur', () => {
  const { livraisonHtml } = blocs(livraisonPalette(), { slot: { date: '2026-11-03' } });
  assert.match(livraisonHtml, /<strong>Vos palettes<\/strong> : livraison prévue le <strong>mardi 3 novembre 2026<\/strong> \(date indicative\) à l'adresse : 12 Rue des Vignes 31120 Goyrans\./);
  assert.match(livraisonHtml, /Le transporteur vous contactera pour confirmer la date et l'heure de livraison\./);
  assert.doesNotMatch(livraisonHtml, /plus disponible/);
});

test('3. date choisie plus disponible : nouvelle date et « répondez à cet email »', () => {
  const { livraisonHtml } = blocs(livraisonPalette({ delivery_slot_changed: true }), { slot: { date: '2026-11-17' } });
  assert.match(livraisonHtml, /la date que vous aviez choisie n'était plus disponible au moment du paiement\. Livraison prévue le <strong>mardi 17 novembre 2026<\/strong>/);
  assert.match(livraisonHtml, /Si cette date ne vous convient pas, répondez à cet email\./);
});

test('4. planification manuelle : appel sous 48 h ; créneau illisible : date confirmée par email', () => {
  const manuel = blocs(livraisonPalette({ needs_manual_planning: true }), { slot: { date: '2026-11-03' } }).livraisonHtml;
  assert.match(manuel, /Nous vous appelons sous 48 h pour convenir d'une date de livraison à l'adresse : 12 Rue des Vignes 31120 Goyrans\./);
  assert.doesNotMatch(manuel, /novembre/);
  assert.doesNotMatch(manuel, /plus disponible/);
  const manuelChange = blocs(livraisonPalette({ needs_manual_planning: true, delivery_slot_changed: true })).livraisonHtml;
  assert.match(manuelChange, /n'était plus disponible au moment du paiement et aucune autre date n'est ouverte sur votre secteur\. Nous vous appelons sous 48 h/);
  const illisible = blocs(livraisonPalette()).livraisonHtml;
  assert.match(illisible, /<strong>Vos palettes<\/strong> seront livrées à l'adresse : 12 Rue des Vignes 31120 Goyrans\. Votre date de livraison vous sera confirmée par email\./);
  assert.doesNotMatch(illisible, /plus disponible/);
  // Adresse non géocodée : adresse saisie.
  assert.match(blocs(livraisonPalette({ geocoded_address: null })).livraisonHtml, /12 Rue des Vignes, 31120 Goyrans/);
});

test('5. palette livrée : dépôt au chariot élévateur et lien vers la charte ; absent sinon', () => {
  const { mentionsHtml } = blocs(livraisonPalette());
  assert.match(mentionsHtml, /la palette est déposée entière au plus près de votre lieu de stockage par le chariot élévateur du camion/);
  assert.match(mentionsHtml, /<a href="https:\/\/www\.mayer-energie\.fr\/boutique\/livraison\/charte">charte de livraison des palettes<\/a>/);
  assert.doesNotMatch(blocs(base({ pallet_delivery_mode: 'pickup' })).mentionsHtml, /chariot/);
  assert.doesNotMatch(blocs(base({ parcel_delivery_mode: 'delivery' })).mentionsHtml, /chariot/);
});

test('6. retrait palette : point de retrait et appel pour un créneau', () => {
  const { livraisonHtml } = blocs(base({ pallet_delivery_mode: 'pickup' }), { pickupPoint: POINT });
  assert.match(livraisonHtml, /<strong>Vos palettes<\/strong> sont à retirer : Gaillac, 26 Rue des Pyrénées \(8h-18h\)\. Nous vous appelons pour convenir d'un créneau\./);
});

test('7. commande mixte : palettes au retrait ET accessoires livrés, distingués', () => {
  const { livraisonHtml } = blocs(base({ pallet_delivery_mode: 'pickup', parcel_delivery_mode: 'delivery' }), { pickupPoint: POINT });
  assert.match(livraisonHtml, /<strong>Vos palettes<\/strong> sont à retirer : Gaillac/);
  assert.match(livraisonHtml, /<strong>Vos accessoires<\/strong> seront expédiés à : 12 Rue des Vignes, 31120 Goyrans\./);
  const inverse = blocs(livraisonPalette({ parcel_delivery_mode: 'pickup' }), { pickupPoint: POINT, slot: { date: '2026-11-03' } }).livraisonHtml;
  assert.match(inverse, /<strong>Vos palettes<\/strong> : livraison prévue le/);
  assert.match(inverse, /<strong>Vos accessoires<\/strong> sont à retirer : Gaillac, 26 Rue des Pyrénées\./);
});

test('8. commentaire du client repris', () => {
  const { livraisonHtml } = blocs(base({ parcel_delivery_mode: 'delivery', comments: 'Portail bleu' }));
  assert.match(livraisonHtml, /<p><em>Votre commentaire : Portail bleu<\/em><\/p>/);
  assert.doesNotMatch(blocs(base({ parcel_delivery_mode: 'delivery' })).livraisonHtml, /commentaire/);
});

test('9. gabarit par défaut : blocs cités, plus de promesse « à chaque étape »', () => {
  const d = WEBSHOP_EMAIL_DEFAULTS.webshop_confirmation;
  assert.match(d.html_body, /\{\{DELIVERY_INFO\}\}/);
  assert.match(d.html_body, /\{\{LEGAL_INFO\}\}/);
  assert.doesNotMatch(d.html_body, /chaque étape/);
  assert.ok(WEBSHOP_EMAIL_PLACEHOLDERS.webshop_confirmation.includes('{{DELIVERY_INFO}}'));
  assert.ok(WEBSHOP_EMAIL_PLACEHOLDERS.webshop_confirmation.includes('{{LEGAL_INFO}}'));
  assert.ok(Object.isFrozen(WEBSHOP_CONFIRMATION_TEXTES));
});

test('10. pas de « Retrait : » orphelin ; retrait sans point connu dit quand même la suite', () => {
  const sansPoint = blocs(base({ pallet_delivery_mode: 'pickup', parcel_delivery_mode: 'pickup' })).livraisonHtml;
  assert.doesNotMatch(sansPoint, /retirer : [.<]/);
  assert.match(sansPoint, /Nous vous appelons pour convenir d'un créneau/);
  const v = variablesCommande({ order: { order_number: 'WS-1', parcel_delivery_mode: 'pickup' }, lines: [COLIS], envoi: 'colis' });
  assert.equal(v['{{DELIVERY_ADDRESS}}'], '', 'point de retrait inconnu : pas de « Retrait : » vide');
});

test('échappement : aucune valeur injectée telle quelle', () => {
  const piege = '<script>x</script>"\'&';
  const { livraisonHtml, mentionsHtml } = blocsConfirmation({
    order: livraisonPalette({ geocoded_address: { label: piege }, comments: piege, parcel_delivery_mode: 'pickup' }),
    lines: [PALETTE, COLIS], slot: null, pickupPoint: { name: piege, address: piege, openingHours: piege }, siteUrl: 'https://x.fr/"><script>',
  });
  for (const html of [livraisonHtml, mentionsHtml]) {
    assert.doesNotMatch(html, /<script>/);
    assert.doesNotMatch(html, /"><script/);
  }
  assert.match(livraisonHtml, /&lt;script&gt;x&lt;\/script&gt;&quot;&#39;&amp;/);
});

test('variablesCommande : la confirmation envoyée par le Process porte aussi ses blocs', () => {
  const v = variablesCommande({
    order: { order_number: 'WS-1', parcel_delivery_mode: 'delivery', address: '1 rue', postal_code: '81600', city: 'Gaillac' },
    lines: [COLIS], envoi: 'colis', siteUrl: SITE,
  });
  assert.match(v['{{DELIVERY_INFO}}'], /Vos accessoires<\/strong> seront expédiés à : 1 rue, 81600 Gaillac/);
  assert.match(v['{{LEGAL_INFO}}'], /mayer-energie\.fr\/boutique\/cgv/);
});
