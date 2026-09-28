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
  const ambigu = (comp, criteres, refs) => alertes.push({ niveau: 'warn', code: 'article_ambigu', source: 'catalogue',
    message: `${comp.libelle} : plusieurs articles possibles ${criteres} (${refs.slice(0, 6).join(', ')}${refs.length > 6 ? ` … ${refs.length} au total` : ''}) — ligne à chiffrer, préciser le mapping.` });
  // Le résultat de résolution (article + éventuels candidats ambigus) est mémorisé pour `pousser`.
  let derniersAmbigus = null;
  const resoudre = (comp, c) => {
    const res = resoudreArticle(articles, mapping, { composant_code: comp.composant_code, gamme_catalogue: gamme(comp), diametre: releve.diametre, finition: releve.finition, boisseau: releve.boisseau ?? null, ...c });
    derniersAmbigus = res.ambigus;
    return res;
  };
  const qte = (m, q) => q * Number(m?.quantite_par_unite ?? 1);

  // Une quantité calculée ≤ 0 n'émet AUCUNE ligne (ni alerte) : createQuote ferait `|| 1` sur un 0.
  const pousser = (comp, article, quantite, criteresManquant, extra) => {
    if (!(quantite > 0)) return;
    if (!article) {
      if (derniersAmbigus?.length) ambigu(comp, criteresManquant, derniersAmbigus);
      else manquant(comp, criteresManquant);
    }
    lignes.push(ligne(comp, article, quantite, { ...extra, tva: reglages.tva_fournitures }));
  };

  for (const comp of [...composants].sort((a, b) => a.ordre - b.ordre)) {
    // Alternative (« ou ») : un composant qui porte groupe_alternative + option n'est retenu que si le
    // relevé a choisi cette option. Un groupe sans option (kit RT2012) reste un simple regroupement.
    if (comp.groupe_alternative && comp.option != null && String(releve[comp.groupe_alternative]) !== String(comp.option)) continue;
    const [regle, arg] = String(comp.regle_quantite || 'unitaire').split(':');
    const tr = arg ? geometrie.troncons[arg] : null;
    if (regle === 'unitaire') {
      // La pente du toit ne départage que les pièces à plage de pente (solins, souches) : passée aux
      // autres, elle écarterait tout article sans plage (chapeau, plaque…).
      const typeMap = mapping.find((m) => m.composant_code === comp.composant_code && m.gamme_catalogue === gamme(comp))?.type_piece;
      const pente = (comp.composant_code === 'solin' || typeMap === 'solin' || typeMap === 'souche') && releve.pente != null ? releve.pente : null;
      const { article, mapping: m } = resoudre(comp, { pente });
      pousser(comp, article, qte(m, 1), pente != null ? `pour Ø${releve.diametre} et une pente de ${pente}°` : `Ø${releve.diametre}`,
        { sous_libelle: pente != null && article ? `Choisi d'après la pente saisie (${pente}°)` : undefined });
    } else if (regle === 'par_longueur') {
      if (!tr) { alertes.push({ niveau: 'warn', code: 'troncon_inconnu', source: 'gabarit', message: `${comp.libelle} : tronçon ${arg} absent de la géométrie.` }); continue; }
      const comp2 = tr.composition;
      if (!comp2) { alertes.push({ niveau: 'warn', code: 'troncon_non_compose', source: 'gabarit', message: `${comp.libelle} : le tronçon ${arg} n'est pas composé en éléments (vendu au mètre ?).` }); continue; }
      // Les longueurs sont celles de la composition du tronçon (PRH en 330, émaillé en 250…), pas une liste globale.
      for (const l of Object.keys(comp2.elements).map(Number).sort((a, b) => b - a)) {
        if (!comp2.elements[l]) continue;
        const { article, mapping: m } = resoudre(comp, { longueur: l });
        pousser(comp, article, qte(m, comp2.elements[l]), `Lg ${l} Ø${releve.diametre}`, { sous_libelle: `Lg ${l} mm` });
      }
      if (comp2.reglable) {
        const { article, mapping: m } = resoudre(comp, { type_piece: 'element_reglable' });
        pousser(comp, article, qte(m, comp2.reglable.n), `réglable Ø${releve.diametre}`, { sous_libelle: `Réglé à ${comp2.reglable.longueur} mm` });
      }
    } else if (regle === 'par_longueur_ml') {
      // Article vendu au mètre (flexible) : la quantité est la longueur déjà arrondie par la géométrie.
      if (!tr) { alertes.push({ niveau: 'warn', code: 'troncon_inconnu', source: 'gabarit', message: `${comp.libelle} : tronçon ${arg} absent de la géométrie.` }); continue; }
      if (tr.ml == null) { alertes.push({ niveau: 'warn', code: 'troncon_non_ml', source: 'gabarit', message: `${comp.libelle} : le tronçon ${arg} n'a pas de longueur au mètre.` }); continue; }
      const { article, mapping: m } = resoudre(comp, {});
      pousser(comp, article, qte(m, tr.ml), `au ml Ø${releve.diametre}`, { sous_libelle: `${String(tr.ml).replace('.', ',')} m au mètre linéaire` });
    } else if (regle === 'kit_longueur') {
      // Kit vendu par longueur entière (gaine isolée POLYPERF « N ML ») : un kit, choisi au mètre supérieur.
      if (!tr || tr.ml == null) { alertes.push({ niveau: 'warn', code: 'troncon_non_ml', source: 'gabarit', message: `${comp.libelle} : le tronçon ${arg} n'a pas de longueur au mètre.` }); continue; }
      const ml = Math.ceil(tr.ml - 1e-9);
      const { article, mapping: m } = resoudre(comp, { ml });
      pousser(comp, article, qte(m, 1), `kit ${ml} m Ø${releve.diametre}`, { sous_libelle: `Kit de ${ml} m (${String(tr.ml).replace('.', ',')} m nécessaires)` });
    } else if (regle === 'par_intervalle') {
      // Fixations réparties le long d'un tronçon (supports muraux en façade) : 1 tous les N m, au moins 1.
      if (!tr) { alertes.push({ niveau: 'warn', code: 'troncon_inconnu', source: 'gabarit', message: `${comp.libelle} : tronçon ${arg} absent de la géométrie.` }); continue; }
      const pas = reglages.supports_muraux_tous_les_m > 0 ? reglages.supports_muraux_tous_les_m : 2;
      const n = Math.max(1, Math.ceil(tr.longueur_mm / 1000 / pas - 1e-9));
      const { article, mapping: m } = resoudre(comp, {});
      pousser(comp, article, qte(m, n), `Ø${releve.diametre}`, { sous_libelle: `1 tous les ${String(pas).replace('.', ',')} m` });
    } else if (regle === 'par_emboitement') {
      const n = tr?.composition ? tr.composition.nb * (reglages.colliers_par_emboitement ?? 1) : 0;
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
