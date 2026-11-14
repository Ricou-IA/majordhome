# ============================================================================
# Relevé des PIÈCES DÉTACHÉES d'ESC Grossiste (https://www.esc-grossiste.fr/boutique/, PrestaShop).
# Le site n'a pas d'API publique : on lit les pages de RAYONS (listes seulement, aucune fiche produit), sous
# « Pièces détachées » (rayon 182), branches chaudières, poêles et chauffe-eaux. Sanitaire, piscine et spa exclus.
#
# Accord du marchand : acquis (Eric, 2026-11-14). Politesse : GET uniquement, une page par seconde, en-tête qui nomme
# Majord'home, robots.txt respecté (rayons autorisés ; `?n=` et `?orderby=` interdits, jamais utilisés).
# Arrêt après trois échecs de suite (code ≠ 200 ou page de vérification anti-robot) : on ne contourne rien.
#
# Usage (environ 45 minutes pour ~580 pages) :
#   python -I scripts/catalogue/releve-esc-pieces.py --cache <dossier HORS dépôt> --sortie scripts/catalogue/data/esc-pieces-AAAA-MM.json
# Le dossier --cache garde les pages lues : relancer après une coupure ne relit que ce qui manque. Pour un NOUVEAU
# relevé (mise à jour des prix), partir d'un dossier vide.
# Suite : node scripts/catalogue/import-esc-pieces.mjs --fichier <sortie> (voir ce script).
# ============================================================================
import datetime
import html
import json
import os
import re
import subprocess
import sys
import time

BASE = 'https://www.esc-grossiste.fr/boutique/'
UA = "Majordhome-catalogue/1.0 (+Majord'home; releve de pieces detachees avec l'accord du marchand)"
RACINE = ('182-piece-detachees', 'Pièces détachées')
EXCLUS = ['448', '2803', '3120']  # sanitaire, piscine, spa
PAUSE_S = 1.0
MAX_PAGES = 2500
TAILLE_MIN_PAGE = 20000  # une page de rayon pèse au moins 60 Ko ; en dessous, la page en cache est relue


def option(nom):
    return sys.argv[sys.argv.index(nom) + 1] if nom in sys.argv else None


def texte(t):
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', t))).strip()


def lire(url, fichier):
    r = subprocess.run(['curl', '-sS', '-m', '30', '-A', UA, '-H', 'Accept: text/html', '-o', fichier, '-w', '%{http_code}', url],
                       capture_output=True, text=True)
    return (r.stdout or '').strip()


def sous_rayons(s):
    i = s.find('id="subcategories"')
    if i < 0:
        return []
    bloc = s[i:]
    fin = bloc.find('</ul>')
    bloc = bloc[:fin] if fin > 0 else bloc[:200000]
    motif = r'<a href="(' + re.escape(BASE) + r'\d+-[^"#?]*)"[^>]*class="img".*?class="subcategory-name">(.*?)</h3>'
    return [(url[len(BASE):], texte(nom)) for url, nom in re.findall(motif, bloc, re.S)]


def nombre_de_pages(s, slug):
    if s.find('id="pagination"') < 0:
        return 1
    nums = [int(x) for x in re.findall(re.escape(slug) + r'\?p=(\d+)', s)]
    return max(nums) if nums else 1


def cartes(s):
    """Fiches d'une page de rayon : identifiant du site, adresse, nom, marque, prix public TTC, photo."""
    out = []
    for c in s.split('<li itemscope itemtype="https://schema.org/Product"')[1:]:
        c = c[:9000]
        m = re.search(r'class="product-name" href="(' + re.escape(BASE) + r'[^"]*/(\d+)-[^"/]*\.html)"', c)
        if not m:
            continue
        nom = re.search(r'itemprop="name">(.*?)</h2>', c, re.S)
        prix = re.search(r'itemprop="price" content="([0-9.]+)"', c)
        marque = re.search(r'itemprop="brand" content="([^"]*)"', c)
        img = re.search(r'data-src="(' + re.escape(BASE) + r'\d+-home_default/[^"]+)"', c)
        out.append({'id': m.group(2), 'url': m.group(1), 'nom': texte(nom.group(1)) if nom else '',
                    'marque': html.unescape(marque.group(1)).strip() if marque else '',
                    'prix_ttc': float(prix.group(1)) if prix else None, 'image': img.group(1) if img else None})
    return out


def main():
    cache, sortie = option('--cache'), option('--sortie')
    if not cache or not sortie:
        print('Usage : python -I releve-esc-pieces.py --cache <dossier hors dépôt> --sortie <fichier.json>')
        return 2
    os.makedirs(cache, exist_ok=True)
    rayons, pieces = {}, {}
    attente = [(RACINE[0], RACINE[1], None)]
    appels, echecs = 0, 0
    while attente:
        slug, nom, parent = attente.pop(0)
        rid = slug.split('-')[0]
        if rid in rayons or rid in EXCLUS:
            continue
        n_pages, p, enfants, annonce, lues = 1, 1, [], None, 0
        while p <= n_pages:
            fichier = os.path.join(cache, '%s_p%d.html' % (rid, p))
            if not (os.path.exists(fichier) and os.path.getsize(fichier) > TAILLE_MIN_PAGE):
                if appels >= MAX_PAGES:
                    print('ARRÊT : plafond de %d pages atteint, relevé incomplet' % MAX_PAGES)
                    return 1
                code = lire(BASE + slug + ('' if p == 1 else '?p=%d' % p), fichier)
                appels += 1
                time.sleep(PAUSE_S)
            else:
                code = '200'
            s = open(fichier, encoding='utf-8', errors='replace').read() if os.path.exists(fichier) else ''
            if code != '200' or 'challenge-platform' in s or 'Just a moment' in s:
                echecs += 1
                print('ÉCHEC %s sur %s (page %d)' % (code, slug, p), flush=True)
                if os.path.exists(fichier):
                    os.remove(fichier)
                if echecs >= 3:
                    print('ARRÊT : trois échecs de suite, relevé incomplet, aucun fichier écrit')
                    return 1
                time.sleep(10)
                continue  # même page, nouvel essai
            echecs = 0
            if p == 1:
                enfants = sous_rayons(s)
                n_pages = nombre_de_pages(s, slug)
                m = re.search(r'class="nbresultatspag">\s*(\d+)\s+produit', s)
                annonce = int(m.group(1)) if m else None
            for c in cartes(s):
                lues += 1
                piece = pieces.setdefault(c['id'], dict(c, rayons=[]))
                if rid not in piece['rayons']:
                    piece['rayons'].append(rid)
            p += 1
        rayons[rid] = {'id': rid, 'nom': nom, 'parent': parent, 'annonce': annonce, 'lues': lues}
        attente.extend((e_slug, e_nom, rid) for e_slug, e_nom in enfants)
        if len(rayons) % 25 == 0:
            print('rayons : %d | appels : %d | en attente : %d' % (len(rayons), appels, len(attente)), flush=True)

    incomplets = [r for r in rayons.values() if r['annonce'] is not None and r['annonce'] != r['lues']]
    if incomplets:
        print('ARRÊT : %d rayon(s) où le nombre de fiches lues diffère de l\'annonce, aucun fichier écrit : %s'
              % (len(incomplets), [(r['id'], r['annonce'], r['lues']) for r in incomplets[:8]]))
        return 1
    releve = {
        '_note': 'Relevé des pages de rayons « Pièces détachées » d\'ESC Grossiste (listes seulement). Produit par scripts/catalogue/releve-esc-pieces.py.',
        'source': BASE + RACINE[0],
        'fetched_at': datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'racine': RACINE[0].split('-')[0],
        'exclus': EXCLUS,
        'rayons': list(rayons.values()),
        'pieces': list(pieces.values()),
    }
    with open(sortie, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(releve, f, ensure_ascii=False, separators=(',', ':'))
        f.write('\n')
    print('FIN : %d rayons, %d pièces distinctes, %d appels au site, fichier %s' % (len(rayons), len(pieces), appels, sortie))
    return 0


if __name__ == '__main__':
    sys.exit(main())
