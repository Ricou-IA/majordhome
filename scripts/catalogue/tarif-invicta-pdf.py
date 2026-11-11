# scripts/catalogue/tarif-invicta-pdf.py
# Transcrit un tarif NET Invicta (PDF « DISTRIBUTEUR Invicta Net », « ATRIERS Invicta Net ») en JSON, par PyMuPDF.
#   python -I scripts/catalogue/tarif-invicta-pdf.py "<tarif.pdf>" scripts/catalogue/data/invicta-tarif-AAAA-MM.json
# Colonnes du PDF : désignation · [Exc / Ex / F / N…] · REF · GTIN · D3E € HT · PMCB € HT · Tarif BRUT HT · R1 (remise)
# · Tarif de Vente Net HT · Prix Publics Indicatifs **TVA 20 %** (donc TTC).
# ⚠ Le prix public du PDF est TTC : le prix public HT est le Tarif BRUT HT (brut × 1,2 = public TTC, à l'euro près).
#   L'import de mars 2026 avait rangé ce TTC comme prix de vente HT (160 lignes fausses, corrigées le 2026-11-11).
# Le JSON est ensuite contrôlé par scripts/catalogue/invicta-tarif.js (test pinné) : ce script ne fait que lire.
import json
import re
import sys

import fitz

REF = re.compile(r"^[PC]\d{5,6}[A-Z]?$")
GTIN = re.compile(r"^\d{13}$")
EURO = re.compile(r"^-?[\d\s  ]+(,\d+)?\s*€$")
PCT = re.compile(r"^\d{1,2}(,\d+)?\s*%$")
NOMBRE = re.compile(r"^\d+(,\d+)?$")
MARQUEURS = {"Exc", "Ex", "F", "N", "PN", "F/N", "(", "Mois"}


def montant(t):
    return float(re.sub(r"[^\d,.-]", "", t).replace(",", "."))


def main():
    pdf, sortie = sys.argv[1], sys.argv[2]
    doc = fitz.open(pdf)
    lignes = []
    for page in doc:
        lignes += [l.strip() for l in page.get_text().split("\n")]
    entete = " ".join(lignes[:6])
    validite = re.search(r"Valable du\s+(\d{2}/\d{2}/\d{4})\s+jusqu'au\s+(\d{2}/\d{2}/\d{4})", " ".join(lignes))
    # Une section = la ligne de texte qui précède un en-tête de colonnes « REF ».
    sections = {}
    for i, l in enumerate(lignes):
        if l != "REF":
            continue
        k = i - 1
        while k > 0 and (lignes[k] in MARQUEURS or lignes[k] == ""):
            k -= 1
        sections[i] = lignes[k]
    articles = []
    section = None
    for i, l in enumerate(lignes):
        if i in sections:
            section = sections[i]
        if not REF.match(l):
            continue
        k = i - 1
        marqueurs = []
        while k > 0 and lignes[k] in MARQUEURS:
            marqueurs.append(lignes[k])
            k -= 1
        nom = lignes[k]
        suite = []
        for j in range(i + 1, min(i + 12, len(lignes))):
            if REF.match(lignes[j]):
                break
            suite.append(lignes[j])
        euros = [montant(s) for s in suite if EURO.match(s)]
        pct = [montant(s.replace("%", "")) for s in suite if PCT.match(s)]
        gtin = next((s for s in suite if GTIN.match(s)), None)
        # D3E / PMCB : les nombres nus placés entre le GTIN et le premier montant en euros
        taxes = []
        for s in suite:
            if EURO.match(s):
                break
            if NOMBRE.match(s) and not GTIN.match(s):
                taxes.append(montant(s))
        if len(euros) != 3 or len(pct) > 1:
            raise SystemExit(f"Ligne illisible pour {l} ({nom}) : montants {euros}, remise {pct}")
        # Quelques lignes « prix net » n'impriment pas leur remise : elle est déduite du brut et du net.
        remise_deduite = not pct
        if remise_deduite:
            pct = [round((1 - euros[1] / euros[0]) * 100, 2)]
        articles.append({
            "reference": l, "name": nom, "gamme": section, "ean": gtin, "marqueurs": sorted(set(marqueurs)),
            "taxes": taxes, "brut_ht": euros[0], "remise_pct": pct[0], "remise_deduite": remise_deduite,
            "net_ht": euros[1], "public_ttc": euros[2],
        })
    data = {
        "source": pdf.replace("\\", "/").split("/")[-1], "titre": re.sub(r"\s+", " ", entete)[:80],
        "valable_du": validite.group(1) if validite else None, "valable_au": validite.group(2) if validite else None,
        "articles": articles,
    }
    with open(sortie, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    print(f"{len(articles)} lignes, {len(set(a['reference'] for a in articles))} références, "
          f"{len(set(a['gamme'] for a in articles))} gammes → {sortie}")


if __name__ == "__main__":
    main()
