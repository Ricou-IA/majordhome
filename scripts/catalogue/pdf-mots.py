# scripts/catalogue/pdf-mots.py — mots d'un PDF avec leurs coordonnées (PyMuPDF), en JSON.
# Étape neutre, sans règle métier : les parseurs de factures (scripts/catalogue/facture-*.js, modules purs testés)
# reconstituent ensuite les lignes et colonnes à partir des positions. Sortie :
#   { "fichier": "...", "pages": [ { "num": 1, "width": 595, "height": 840,
#                                    "words": [ { "x0", "y0", "x1", "y1", "t" }, ... ] } ] }
# Usage : python -I scripts/catalogue/pdf-mots.py <fichier.pdf> [<sortie.json>]   (sans sortie → stdout, UTF-8)
import json
import sys

import fitz  # PyMuPDF


def mots(chemin: str) -> dict:
    doc = fitz.open(chemin)
    pages = []
    for i, page in enumerate(doc):
        words = [
            {"x0": round(w[0], 1), "y0": round(w[1], 1), "x1": round(w[2], 1), "y1": round(w[3], 1), "t": w[4]}
            for w in page.get_text("words")
        ]
        pages.append({"num": i + 1, "width": round(page.rect.width, 1), "height": round(page.rect.height, 1), "words": words})
    return {"fichier": chemin, "pages": pages}


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("usage : pdf-mots.py <fichier.pdf> [<sortie.json>]", file=sys.stderr)
        sys.exit(2)
    data = mots(sys.argv[1])
    texte = json.dumps(data, ensure_ascii=False)
    if len(sys.argv) > 2:
        with open(sys.argv[2], "w", encoding="utf-8") as f:
            f.write(texte)
    else:
        sys.stdout.buffer.write(texte.encode("utf-8"))
