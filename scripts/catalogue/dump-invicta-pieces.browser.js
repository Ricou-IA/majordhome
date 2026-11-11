// scripts/catalogue/dump-invicta-pieces.browser.js
// Relevé des PIÈCES DÉTACHÉES du groupe Invicta (https://pieces-detachees.invicta-group.fr) — À COLLER DANS LA CONSOLE
// DU NAVIGATEUR (F12 → Console) sur ce site, une fois CONNECTÉ au compte pro (lecture seule : uniquement des GET).
// Pour chaque rayon de la marque : liste des appareils, puis par appareil sa nomenclature (repère, pièce, quantité,
// prix public HT), sa photo, sa vue éclatée et la liste de ses documents. 4 appels à la fois, courte pause entre lots
// (≈ 1 000 appels pour Invicta, quelques minutes). Le fichier `invicta-pieces-AAAA-MM-JJ.json` n'est téléchargé que si
// le relevé est COMPLET (chaque rayon au compte, aucun appareil en erreur) ; sinon erreur en console, rien n'est écrit.
// Déposer le fichier dans scripts/catalogue/data/ puis :
//   node scripts/catalogue/import-invicta-pieces.mjs --fichier scripts/catalogue/data/invicta-pieces-AAAA-MM-JJ.json
// Autre marque du site : changer MARQUE, PREFIXE et RAYONS (publicId lisibles dans l'adresse des pages : …/ma/<id>
// pour la marque, …/ca/<id> pour un rayon).
// Jamais de relevé depuis un serveur ou un script Node : le site est derrière la session du compte.
// Progression : window.__releveInvicta.progression ; résultat : window.__releveInvicta.releve.
(async () => {
  const MARQUE = 'VdklLfh0Fp'; // Invicta
  const PREFIXE = 'invicta-pieces';
  const RAYONS = ['6rHQ2VQ7V0', '5pTmF26SXD', 'WcBUWh6va6', 'o5eeayGEi7']; // Poêles, Granulés, Foyers, Inserts
  const TELECHARGER = true;
  const API = '/api/1.0.0/';

  // --- Copie de src/lib/catalogue/invictaPiecesReleve.js (source unique, testée) — ne pas éditer ici. ---
  function plusGrandeVariante(image) {
    if (!image) return null;
    const variantes = Array.isArray(image.variants) ? image.variants.filter((v) => v && v.url) : [];
    if (!variantes.length) return image.url ? { url: image.url, fileId: image.fileId || null, width: null, height: null } : null;
    const v = variantes.reduce((a, b) => ((b.width || 0) > (a.width || 0) ? b : a));
    return { url: v.url, fileId: v.fileId || null, width: v.width ?? null, height: v.height ?? null };
  }
  function appareilDepuisApi(produit, documents, categorie) {
    const p = produit || {};
    return {
      id: p.id, publicId: p.publicId, reference: p.reference, name: p.name, categorie,
      lifecycleStage: p.lifecycleStage ?? null,
      photo: plusGrandeVariante(p.image),
      vues_eclatees: ((p.gallery && p.gallery.explodedViews) || []).map(plusGrandeVariante).filter(Boolean),
      documents: (documents || []).map((d) => ({ id: d.id, type: d.type, label: d.label, fileKey: d.fileKey ?? null, publicFileKey: d.publicFileKey ?? null })),
      items: (p.items || []).map((it) => {
        const x = it.item || {};
        const r = x.replacementProduct;
        return {
          repere: it.reference == null ? '' : String(it.reference), quantity: it.quantity ?? 1, notes: it.notes || '',
          piece: {
            publicId: x.publicId, reference: x.reference, name: x.name, price: x.price ?? null, taxRate: x.taxRate ?? null,
            weight: x.weight ?? null, unitCode: x.unitCode ?? null, isPurchasable: x.isPurchasable !== false,
            isBundle: !!x.isBundle, isVirtualKit: !!x.isVirtualKit, onlyAvailableInBundle: !!x.onlyAvailableInBundle,
            lifecycleStage: x.lifecycleStage ?? null, stockAvailable: x.stockAvailable ?? null,
            image_url: (plusGrandeVariante(x.image) || {}).url || null,
            remplacement: r && r.reference ? { reference: r.reference, name: r.name || '' } : null,
          },
        };
      }),
    };
  }
  function controlerReleve(releve) {
    const erreurs = [];
    const appareils = (releve && releve.appareils) || [];
    const categories = (releve && releve.categories) || [];
    if (!categories.length) erreurs.push('Aucun rayon relevé');
    for (const c of categories) {
      const lus = appareils.filter((a) => a.categorie === c.name).length;
      if (lus !== c.total) erreurs.push(`${c.name} : ${lus} / ${c.total} appareils lus`);
    }
    for (const a of appareils) {
      if (a.erreur) erreurs.push(`${a.reference || a.publicId || 'appareil'} : ${a.erreur}`);
      else if (!a.reference) erreurs.push(`${a.publicId || 'appareil'} : sans référence`);
    }
    return { ok: erreurs.length === 0, erreurs };
  }
  // --- fin de la copie ---

  const etat = (window.__releveInvicta = { termine: false, progression: 'démarrage', releve: null, erreur: null });
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const lire = async (chemin) => {
    for (let essai = 1; ; essai++) {
      const r = await fetch(API + chemin, { credentials: 'include' });
      if (r.ok) return r.json();
      if (r.status === 401 || r.status === 403) throw new Error(`HTTP ${r.status} (session expirée ? reconnectez-vous)`);
      if (essai >= 3) throw new Error(`HTTP ${r.status}`);
      await pause(1500 * essai);
    }
  };
  try {
    const marque = await lire(`manufacturers/${MARQUE}`);
    const categories = [];
    const aLire = [];
    for (const rayon of RAYONS) {
      const c = await lire(`categories/${rayon}`);
      const nom = ((c.metadata || []).find((m) => m.languageCode === 'fr-FR') || (c.metadata || [])[0] || {}).name || rayon;
      let total = null;
      for (let offset = 0; ; ) {
        const page = await lire(`products?Category=${rayon}&Limit=100&Offset=${offset}`);
        total = page.totalCount;
        for (const p of page.items) aLire.push({ publicId: p.publicId, reference: p.reference, categorie: nom });
        offset += page.items.length;
        if (!page.hasNextItems || !page.items.length) break;
      }
      categories.push({ publicId: rayon, name: nom, total });
    }
    const appareils = [];
    for (let i = 0; i < aLire.length; i += 4) {
      const lot = await Promise.all(aLire.slice(i, i + 4).map(async (a) => {
        try {
          const p = await lire(`products/${a.publicId}`);
          const docs = await lire(`products/${p.id}/documents`);
          return appareilDepuisApi(p, docs, a.categorie);
        } catch (e) {
          return { publicId: a.publicId, reference: a.reference, categorie: a.categorie, erreur: String(e.message || e) };
        }
      }));
      appareils.push(...lot);
      etat.progression = `${appareils.length} / ${aLire.length} appareils`;
      if (appareils.length % 20 === 0) console.log(`${marque.name} : ${etat.progression}…`);
      await pause(150);
    }
    const releve = {
      source: `${location.origin}${API} (session connectée)`, fetched_at: new Date().toISOString(),
      manufacturer: { publicId: marque.publicId, name: marque.name }, categories, appareils,
    };
    const controle = controlerReleve(releve);
    if (!controle.ok) throw new Error(`Relevé incomplet, rien n'est enregistré : ${controle.erreurs.slice(0, 8).join(' ; ')}`);
    etat.releve = releve;
    if (TELECHARGER) {
      const nom = `${PREFIXE}-${releve.fetched_at.slice(0, 10)}.json`;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(releve)], { type: 'application/json' }));
      a.download = nom;
      document.body.appendChild(a); a.click(); a.remove();
      console.log(`Relevé ${marque.name} téléchargé : ${nom} (${appareils.length} appareils)`);
    }
  } catch (e) {
    etat.erreur = String(e.message || e);
    console.error(etat.erreur);
  } finally {
    etat.termine = true;
  }
})();
