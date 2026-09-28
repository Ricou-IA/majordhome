// src/lib/fumisterie/nomenclature.js
// Nomenclature chiffrée d'une configuration — module PUR. Applique regle_quantite de chaque
// composant sur la géométrie (tronçons composés) et résout les articles. Une ligne sans article
// sort à prix null + alerte `article_manquant` (rien n'est avalé). Prix : vente = tarif_public,
// achat = purchase_price_ht (prix net Mayer).
import { resoudreArticle } from './articles.js';

const r2 = (v) => Math.round(v * 100) / 100;

function ligne(comp, art, quantite, extra = {}) {
  return {
    repere: comp.repere, composant_code: comp.composant_code, libelle: art ? art.name : comp.libelle,
    sous_libelle: extra.sous_libelle || comp.note || null, troncon: comp.troncon, statut: comp.statut,
    article_id: art ? art.id : null, reference: art ? art.reference : null, quantite, unite: art?.unit || 'pièce',
    prix_vente_ht: art ? Number(art.tarif_public ?? art.selling_price_ht) : null,
    prix_achat_ht: art ? Number(art.purchase_price_ht) : null, tva: extra.tva ?? 20,
  };
}

/**
 * @param {{ composants: object[], mapping: object[], articles: object[], geometrie: object, releve: object, reglages: object }} p
 * @returns {{ lignes: object[], alertes: object[] }}
 */
export function construireNomenclature({ composants, mapping, articles, geometrie, releve, reglages }) {
  const lignes = []; const alertes = [];
  const gamme = (comp) => comp.gammes?.[0] || '';
  const manquant = (comp, criteres) => alertes.push({ niveau: 'warn', code: 'article_manquant', source: 'catalogue',
    message: `${comp.libelle} : aucun article ${criteres} au tarif — ligne à chiffrer.` });
  const resoudre = (comp, c) => resoudreArticle(articles, mapping, { composant_code: comp.composant_code, gamme_catalogue: gamme(comp), diametre: releve.diametre, finition: releve.finition, ...c });
  const qte = (m, q) => q * Number(m?.quantite_par_unite ?? 1);

  // Une quantité calculée ≤ 0 n'émet AUCUNE ligne (ni alerte) : createQuote ferait `|| 1` sur un 0.
  const pousser = (comp, article, quantite, criteresManquant, extra) => {
    if (!(quantite > 0)) return;
    if (!article) manquant(comp, criteresManquant);
    lignes.push(ligne(comp, article, quantite, { ...extra, tva: reglages.tva_fournitures }));
  };

  for (const comp of [...composants].sort((a, b) => a.ordre - b.ordre)) {
    const [regle, arg] = String(comp.regle_quantite || 'unitaire').split(':');
    const tr = arg ? geometrie.troncons[arg] : null;
    if (regle === 'unitaire') {
      const pente = comp.composant_code === 'solin' ? releve.pente : null;
      const { article, mapping: m } = resoudre(comp, { pente });
      pousser(comp, article, qte(m, 1), pente != null ? `pour Ø${releve.diametre} et une pente de ${pente}°` : `Ø${releve.diametre}`,
        { sous_libelle: pente != null && article ? `Choisi d'après la pente saisie (${pente}°)` : undefined });
    } else if (regle === 'par_longueur') {
      if (!tr) { alertes.push({ niveau: 'warn', code: 'troncon_inconnu', source: 'gabarit', message: `${comp.libelle} : tronçon ${arg} absent de la géométrie.` }); continue; }
      const comp2 = tr.composition;
      for (const l of reglages.longueurs_elements_mm) {
        if (!comp2.elements[l]) continue;
        const { article, mapping: m } = resoudre(comp, { longueur: l });
        pousser(comp, article, qte(m, comp2.elements[l]), `Lg ${l} Ø${releve.diametre}`, { sous_libelle: `Lg ${l} mm` });
      }
      if (comp2.reglable) {
        const { article, mapping: m } = resoudre(comp, { type_piece: 'element_reglable' });
        pousser(comp, article, qte(m, comp2.reglable.n), `réglable Ø${releve.diametre}`, { sous_libelle: `Réglé à ${comp2.reglable.longueur} mm` });
      }
    } else if (regle === 'par_emboitement') {
      const n = tr ? tr.composition.nb * (reglages.colliers_par_emboitement ?? 1) : 0;
      if (n > 0) {
        const { article, mapping: m } = resoudre(comp, {});
        pousser(comp, article, qte(m, n), `Ø${releve.diametre}`, { sous_libelle: '1 par emboîtement' });
      }
    } else if (regle === 'par_plancher') {
      if (geometrie.planchers > 0) {
        const { article, mapping: m } = resoudre(comp, {});
        pousser(comp, article, qte(m, geometrie.planchers), `Ø${releve.diametre}`, { sous_libelle: '1 par plancher traversé' });
      }
    } else if (regle === 'coudes') {
      if (releve.angle > 0) {
        const { article, mapping: m } = resoudre(comp, { angle: releve.angle });
        pousser(comp, article, qte(m, 2), `${releve.angle}° Ø${releve.diametre}`, { sous_libelle: `Dévoiement ${releve.angle}° : 2 coudes` });
      }
    } else {
      alertes.push({ niveau: 'warn', code: 'regle_inconnue', source: 'nomenclature', message: `${comp.libelle} : règle « ${comp.regle_quantite} » inconnue du moteur.` });
    }
  }
  return { lignes, alertes };
}

/** Totaux (achat / vente / marge) sur les lignes chiffrées, et compteur des lignes à chiffrer. */
export function totaliser(lignes) {
  let vente = 0; let achat = 0; let aChiffrer = 0;
  for (const l of lignes) {
    if (l.prix_vente_ht == null) { aChiffrer++; continue; }
    vente += l.prix_vente_ht * l.quantite; achat += (l.prix_achat_ht ?? 0) * l.quantite;
  }
  return { vente_ht: r2(vente), achat_ht: r2(achat), marge_ht: r2(vente - achat), lignes_a_chiffrer: aChiffrer };
}
