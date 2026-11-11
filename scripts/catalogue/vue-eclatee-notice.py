# scripts/catalogue/vue-eclatee-notice.py
# Repère et extrait en image la page « ÉCLATÉ » d'une notice PDF de poêle (PyMuPDF, comme pdf-mots.py).
# Appelé par scripts/catalogue/vues-eclatees-depuis-notices.mjs ; ne fait AUCUN accès réseau.
#   python -I scripts/catalogue/vue-eclatee-notice.py <notice.pdf> <dossier de sortie> [--dpi 150]
# Sortie (stdout) : JSON { "pages": [{ "page": 4, "fichier": "<...>-p4.png", "width": 1240, "height": 1754,
#                                      "role": "vue" | "nomenclature", "traces": 13808, "titre": "ECLATE" }], "nb_pages": 10 }
# La page de NOMENCLATURE qui suit l'éclaté est rendue avec lui : les repères d'une notice ne sont pas ceux du site.
# Une page est retenue si son texte porte un TITRE d'éclaté (« ECLATE », « VUE ECLATEE », « EXPLODED VIEW »…) ET
# qu'elle est un dessin (beaucoup de tracés vectoriels, ou une grande image) : une page qui se contente de citer
# « la vue éclatée » dans une phrase n'est pas retenue. Rien de trouvé = liste vide, jamais une page au hasard.
import json
import os
import re
import sys
import unicodedata

import fitz

TITRE = re.compile(r"\b(VUE[S]? ECLATEE[S]?|ECLATE[S]?|EXPLODED VIEW|ESPLOSO|EXPLOSIONSZEICHNUNG|DESPIECE)\b")
NOMENCLATURE = re.compile(r"\bNOMENCLATURE\b|\bREP(ERE)?S?\W+(NBR?E?|QTE|QUANTITE|DESIGNATION)\b")
SEUIL_MOTS_SANS_TITRE = 40
SEUIL_TRACES = 400      # un éclaté vectoriel compte des milliers de tracés ; une page de texte, quelques dizaines
SEUIL_MOTS = 260         # un éclaté porte des repères, pas des paragraphes
SEUIL_IMAGE = 0.35       # part de la page couverte par une image (éclaté scanné)


def sans_accents(texte):
    return "".join(c for c in unicodedata.normalize("NFD", texte) if unicodedata.category(c) != "Mn")


def part_image(page):
    surface = page.rect.width * page.rect.height
    if not surface:
        return 0.0
    couverte = 0.0
    for info in page.get_image_info():
        r = fitz.Rect(info["bbox"]) & page.rect
        couverte = max(couverte, r.width * r.height / surface)
    return couverte


def rendre(doc, i, base, dossier, dpi, role, titre, traces, mots):
    pix = doc[i].get_pixmap(dpi=dpi, alpha=False)
    fichier = f"{base}-p{i + 1}.png"
    pix.save(os.path.join(dossier, fichier))
    return {"page": i + 1, "fichier": fichier, "width": pix.width, "height": pix.height, "role": role,
            "traces": traces, "titre": titre, "mots": mots}


def main():
    if len(sys.argv) < 3:
        print("usage: vue-eclatee-notice.py <notice.pdf> <dossier> [--dpi N]", file=sys.stderr)
        sys.exit(2)
    pdf, dossier = sys.argv[1], sys.argv[2]
    dpi = int(sys.argv[sys.argv.index("--dpi") + 1]) if "--dpi" in sys.argv else 150
    doc = fitz.open(pdf)
    base = os.path.splitext(os.path.basename(pdf))[0]
    pages = []
    textes = [sans_accents(p.get_text()).upper() for p in doc]
    for i, page in enumerate(doc):
        texte = textes[i]
        mots = len(texte.split())
        traces = len(page.get_drawings())
        image = part_image(page)
        m = TITRE.search(texte)
        if m:
            if mots > SEUIL_MOTS or (traces < SEUIL_TRACES and image < SEUIL_IMAGE):
                continue
            titre = m.group(1)
        else:
            # Éclaté SANS titre (image pleine page, ex. foyer EOS 700) : retenu seulement s'il est suivi de la page
            # de nomenclature (« Rep Nbr Désignation », « NOMENCLATURE »), qui le désigne sans ambiguïté.
            suivante = textes[i + 1] if i + 1 < len(textes) else ""
            if not (mots <= SEUIL_MOTS_SANS_TITRE and image >= SEUIL_IMAGE and NOMENCLATURE.search(suivante)):
                continue
            titre = "(page avant la nomenclature)"
        pages.append(rendre(doc, i, base, dossier, dpi, "vue", titre, traces, mots))
        # La nomenclature de la notice suit l'éclaté : ses repères sont ceux de CETTE vue (pas ceux du site du
        # fabricant, qui renumérote). Elle est rendue avec la vue, sinon la vue seule ne permet pas d'identifier une pièce.
        j = i + 1
        while j < len(doc) and j <= i + 2 and NOMENCLATURE.search(textes[j]) and not TITRE.search(textes[j]):
            pages.append(rendre(doc, j, base, dossier, dpi, "nomenclature", "NOMENCLATURE", len(doc[j].get_drawings()), len(textes[j].split())))
            j += 1
    print(json.dumps({"pages": pages, "nb_pages": len(doc)}))


if __name__ == "__main__":
    main()
