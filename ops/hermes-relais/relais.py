#!/usr/bin/env python3
"""Relais à forme fixe devant l'API d'Hermes (assistant pièces SAV de Majordhome).

Le relais est la seule chose joignable de l'extérieur. Il accepte exactement :
  - GET  /health            contrôle de vie, sans clé, sans appel amont ;
  - POST /v1/runs           démarrer une recherche ;
  - GET  /v1/runs/{run_id}  lire l'état d'une recherche.
Tout le reste répond 404.

Le corps transmis à Hermes est RECONSTRUIT à partir de deux champs validés (`input`, `session_id`) : aucun autre
champ reçu, aucun en-tête reçu n'atteint Hermes. La clé d'Hermes reste dans ce processus ; les appelants
présentent la clé propre du relais.

Bibliothèque standard seule (Python 3.11+). Lancement : `python3 relais.py`, configuration par l'environnement
(voir README.md).
"""

import hmac
import json
import os
import re
import sys
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

CORPS_MAX = 20_000            # octets du corps reçu
ENTREE_MAX = 12_000           # caractères de `input`
DELAI_AMONT = 15              # secondes, appel entier (connexion + lecture)
CHAMPS_ETAT = ("run_id", "status", "output", "usage", "created_at", "updated_at")

REPONSE_AMONT_MAX = 2 * 1024 * 1024   # octets lus au plus dans une réponse d'Hermes
DELAI_CLIENT = 20                     # secondes : délai de socket des connexions entrantes
SIMULTANES_MAX = 8                    # requêtes traitées en même temps ; au-delà : 503
MORCEAU = 65_536

_UUID = re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")
_RUN_ID = re.compile(r"run_[A-Za-z0-9_-]{1,80}")
_ENTIER = re.compile(r"[0-9]{1,15}")
_CLE_FORME = re.compile(r"[\x21-\x7e]+")
_AMONT = re.compile(r"http://(?:127\.0\.0\.1|localhost):([0-9]{1,5})/?")
_CARACTERES_INTERDITS = frozenset("?#%;\\")
_PREFIXE_SUIVRE = "/v1/runs/"
_METHODES_JOURNAL = frozenset(("GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "TRACE", "CONNECT"))
_INDISPONIBLE = {"error": "amont_indisponible"}


# ---------------------------------------------------------------------------------------------------------------
# Fonctions pures : elles ne lèvent jamais.
# ---------------------------------------------------------------------------------------------------------------

def corps_amont(brut: bytes) -> tuple[dict | None, str | None]:
    """Valide le corps reçu et rend le SEUL objet transmis à Hermes : {"input", "session_id"}.

    Codes de refus : 'corps_trop_grand', 'json_invalide', 'forme_invalide'.
    Une clé en double dans le JSON garde sa dernière valeur (comportement de json.loads) ; comme l'objet transmis
    est reconstruit à partir des deux valeurs validées, aucun doublon ne peut passer jusqu'à Hermes.
    """
    try:
        if not isinstance(brut, (bytes, bytearray)):
            return None, "forme_invalide"
        if len(brut) > CORPS_MAX:
            return None, "corps_trop_grand"
        try:
            objet = json.loads(bytes(brut))
        except (ValueError, RecursionError):
            return None, "json_invalide"
        if not isinstance(objet, dict):
            return None, "forme_invalide"
        entree = objet.get("input")
        session_id = objet.get("session_id")
        if not isinstance(entree, str) or not entree.strip() or len(entree) > ENTREE_MAX:
            return None, "forme_invalide"
        if not isinstance(session_id, str) or not _UUID.fullmatch(session_id):
            return None, "forme_invalide"
        # Le texte est transmis tel quel (non rogné) ; rien d'autre de l'objet reçu n'est repris.
        return {"input": entree, "session_id": session_id}, None
    except Exception:
        return None, "forme_invalide"


def route(methode: str, chemin: str) -> tuple[str, str | None]:
    """Classe la requête d'après la méthode et la cible BRUTE de la ligne de requête. Correspondances exactes."""
    try:
        if not isinstance(methode, str) or not isinstance(chemin, str):
            return "inconnue", None
        if any(c in _CARACTERES_INTERDITS for c in chemin):
            return "inconnue", None
        if methode == "GET" and chemin == "/health":
            return "sante", None
        if methode == "POST" and chemin == "/v1/runs":
            return "lancer", None
        if methode == "GET" and chemin.startswith(_PREFIXE_SUIVRE):
            run_id = chemin[len(_PREFIXE_SUIVRE):]
            if _RUN_ID.fullmatch(run_id):
                return "suivre", run_id
        return "inconnue", None
    except Exception:
        return "inconnue", None


def cle_valide(entete_authorization: str | None, cle: str) -> bool:
    """`Bearer <clé>` exact, comparé en temps constant. Une clé attendue vide ne valide jamais rien."""
    try:
        if not isinstance(entete_authorization, str) or not isinstance(cle, str) or not cle:
            return False
        if not entete_authorization.startswith("Bearer "):
            return False
        fournie = entete_authorization[len("Bearer "):]
        return hmac.compare_digest(fournie.encode("utf-8", "surrogatepass"), cle.encode("utf-8", "surrogatepass"))
    except Exception:
        return False


def etat_filtre(json_amont: object) -> dict:
    """Ne garde de l'état rendu par Hermes que CHAMPS_ETAT."""
    try:
        if not isinstance(json_amont, dict):
            return {}
        return {k: json_amont[k] for k in CHAMPS_ETAT if k in json_amont}
    except Exception:
        return {}


def cle_idempotence(valeur: str | None, session_id: str) -> str:
    """L'en-tête Idempotency-Key reçu s'il est un UUID canonique, sinon l'identifiant de session (déjà validé)."""
    try:
        if isinstance(valeur, str) and _UUID.fullmatch(valeur):
            return valeur
    except Exception:
        pass
    return session_id


def reponse_relayee(statut: int | None, octets: bytes | None) -> tuple[int, dict, str | None]:
    """Traduit la réponse d'Hermes en (statut, corps, motif de journal). Seuls CHAMPS_ETAT ressortent."""
    try:
        if statut is None:
            return 502, dict(_INDISPONIBLE), "amont=injoignable"
        if statut == 401:
            # Notre propre clé Hermes est refusée : c'est notre mauvaise configuration, pas la faute de l'appelant.
            return 502, dict(_INDISPONIBLE), "amont=cle_hermes_refusee"
        if not 200 <= statut <= 499 or 300 <= statut <= 399:
            return 502, dict(_INDISPONIBLE), f"amont=statut_{int(statut)}"
        if octets is None:
            return 502, dict(_INDISPONIBLE), "amont=reponse_trop_grande"
        try:
            objet = json.loads(octets)
        except (ValueError, RecursionError):
            return 502, dict(_INDISPONIBLE), "amont=non_json"
        if not isinstance(objet, dict):
            return 502, dict(_INDISPONIBLE), "amont=non_objet"
        return int(statut), etat_filtre(objet), None
    except Exception:
        return 502, dict(_INDISPONIBLE), "amont=erreur"


def charger_config(env) -> tuple[dict | None, str | None]:
    """Lit la configuration. Les messages de refus nomment la variable, jamais sa valeur."""
    hote = env.get("RELAIS_HOTE", "172.18.0.1")
    if not hote:
        return None, "RELAIS_HOTE est vide : démarrage refusé."
    port = env.get("RELAIS_PORT", "8644")
    if not _ENTIER.fullmatch(port) or int(port) > 65535:
        return None, "RELAIS_PORT invalide (entier de 0 à 65535 attendu) : démarrage refusé."
    amont = env.get("HERMES_AMONT", "http://127.0.0.1:8643")
    trouve = _AMONT.fullmatch(amont)
    if not trouve or not 1 <= int(trouve.group(1)) <= 65535:
        return None, ("HERMES_AMONT doit être de la forme http://127.0.0.1:<port> ou http://localhost:<port> : "
                      "démarrage refusé.")
    cles = {}
    for nom in ("RELAIS_CLE", "HERMES_CLE"):
        valeur = env.get(nom, "")
        if not valeur:
            return None, f"{nom} est absente ou vide : démarrage refusé."
        if not _CLE_FORME.fullmatch(valeur):
            return None, f"{nom} contient des caractères non admis (ASCII visible seulement) : démarrage refusé."
        cles[nom] = valeur
    if hmac.compare_digest(cles["RELAIS_CLE"].encode(), cles["HERMES_CLE"].encode()):
        return None, "RELAIS_CLE et HERMES_CLE sont identiques : la clé du relais doit être distincte. Démarrage refusé."
    delai = DELAI_AMONT
    texte_delai = env.get("RELAIS_DELAI", "")
    if texte_delai:
        if not re.fullmatch(r"[0-9]{1,2}", texte_delai) or not 1 <= int(texte_delai) <= 60:
            return None, "RELAIS_DELAI invalide (entier de 1 à 60 secondes attendu) : démarrage refusé."
        delai = int(texte_delai)
    return {"hote": hote, "port": int(port), "amont": amont.rstrip("/"), "cle_relais": cles["RELAIS_CLE"],
            "cle_hermes": cles["HERMES_CLE"], "delai": delai}, None


# ---------------------------------------------------------------------------------------------------------------
# Appel à Hermes
# ---------------------------------------------------------------------------------------------------------------

def _ouvreur() -> urllib.request.OpenerDirector:
    """Ouvreur minimal : HTTP seul, aucun mandataire, aucune redirection suivie.

    ProxyHandler({}) : les variables d'environnement http_proxy & co sont ignorées.
    Ni HTTPRedirectHandler ni HTTPErrorProcessor ne sont installés : tout statut (3xx compris) revient tel quel,
    sans jamais être suivi ; reponse_relayee() traite ensuite un 3xx comme amont indisponible.
    """
    ouvreur = urllib.request.OpenerDirector()
    ouvreur.addheaders = []  # pas d'en-tête par défaut (« Python-urllib/x.y »)
    ouvreur.add_handler(urllib.request.ProxyHandler({}))
    ouvreur.add_handler(urllib.request.HTTPHandler())
    return ouvreur


_OUVREUR = _ouvreur()


def _appel_amont(config: dict, methode: str, chemin: str, donnees: bytes | None, cle_idem: str | None,
                 echeance: float) -> tuple[int, bytes | None]:
    """Un appel HTTP à Hermes. L'URL, les en-têtes et le corps sont entièrement construits ici :
    adresse de la configuration + chemin fixe (run_id déjà validé), clé d'Hermes, UUID d'idempotence validé,
    corps reconstruit par corps_amont()."""
    entetes = {"Authorization": "Bearer " + config["cle_hermes"], "Accept": "application/json",
               "User-Agent": "relais-majordhome"}
    if donnees is not None:
        entetes["Content-Type"] = "application/json"
        entetes["Idempotency-Key"] = cle_idem
    requete = urllib.request.Request(config["amont"] + chemin, data=donnees, headers=entetes, method=methode)
    restant = echeance - time.monotonic()
    if restant <= 0:
        raise TimeoutError("échéance atteinte")
    with _OUVREUR.open(requete, timeout=restant) as reponse:
        statut = reponse.status
        morceaux, total = [], 0
        while True:
            if time.monotonic() > echeance:
                raise TimeoutError("échéance atteinte")
            morceau = reponse.read1(MORCEAU)
            if not morceau:
                break
            total += len(morceau)
            if total > REPONSE_AMONT_MAX:
                return statut, None
            morceaux.append(morceau)
        return statut, b"".join(morceaux)


def appeler_amont(config: dict, methode: str, chemin: str, donnees: bytes | None,
                  cle_idem: str | None) -> tuple[int, dict, str | None]:
    """Appel borné par UNE échéance globale de config["delai"] secondes (connexion + en-têtes + corps).

    Un délai de socket seul borne chaque lecture, pas l'appel entier (un amont qui envoie un octet de temps en
    temps le prolongerait indéfiniment). L'appel tourne donc dans un fil de travail que le gestionnaire attend au
    plus `delai` secondes (Event.wait) : passé ce délai, l'appelant reçoit 502 quoi qu'il arrive. Le fil de travail
    s'arrête de lui-même : son délai de socket vaut le temps restant et il vérifie l'échéance entre deux lectures,
    il vit donc au plus échéance + un délai de socket.
    """
    delai = config["delai"]
    echeance = time.monotonic() + delai
    resultat = []
    fini = threading.Event()

    def travail():
        try:
            resultat.append(_appel_amont(config, methode, chemin, donnees, cle_idem, echeance))
        except Exception:
            resultat.append((None, None))
        finally:
            fini.set()

    threading.Thread(target=travail, name="relais-amont", daemon=True).start()
    if not fini.wait(delai) or not resultat:
        return 502, dict(_INDISPONIBLE), "amont=delai"
    statut, octets = resultat[0]
    return reponse_relayee(statut, octets)


# ---------------------------------------------------------------------------------------------------------------
# Serveur
# ---------------------------------------------------------------------------------------------------------------

def _horodatage() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _journal_stdout(ligne: str) -> None:
    print(ligne, flush=True)


class GestionnaireRelais(BaseHTTPRequestHandler):
    # HTTP/1.0 : une requête par connexion, fermée après la réponse (pas de connexion réutilisée).
    protocol_version = "HTTP/1.0"
    timeout = DELAI_CLIENT          # délai de socket : un client lent ne garde pas un fil indéfiniment
    server_version = "relais"
    sys_version = ""

    def version_string(self):
        return "relais"

    def log_message(self, format, *args):
        # Rien : http.server y écrirait la ligne de requête brute. Seul _journaliser() écrit.
        pass

    def setup(self):
        super().setup()
        self._debut = time.monotonic()
        self._corps_lu = False

    # Toutes les méthodes passent par _traiter() : route() rend 'inconnue' (404) pour tout sauf GET et POST
    # attendus, et http.server ne répond jamais son 501 HTML.
    def do_GET(self):
        self._traiter()

    do_POST = do_PUT = do_PATCH = do_DELETE = do_OPTIONS = do_HEAD = do_TRACE = do_CONNECT = do_GET

    def send_error(self, code, message=None, explain=None):
        # Erreurs détectées par http.server lui-même (ligne de requête, en-têtes, méthode sans do_*) : réponse JSON.
        if getattr(self, "request_version", None) not in ("HTTP/1.0", "HTTP/1.1"):
            # Version illisible : sans cela http.server répondrait « à la HTTP/0.9 », sans ligne d'état ni en-tête.
            self.request_version = "HTTP/1.0"
        if code == 501:
            self._repondre(404, {"error": "inconnue"}, "inconnue")
        else:
            self._repondre(code, {"error": "requete_invalide"}, "inconnue")

    def _traiter(self):
        mots = self.requestline.split()
        chemin = mots[1] if len(mots) >= 2 else ""      # cible brute, telle qu'envoyée par le client
        nom, run_id = route(self.command, chemin)
        if self.request_version not in ("HTTP/1.0", "HTTP/1.1"):
            # HTTP/0.9 : aucun en-tête ne peut être envoyé ; on ferme sans rien répondre.
            self.close_connection = True
            self._journaliser(400, nom, "http_0_9")
            return
        if not self.server.places.acquire(blocking=False):
            self._repondre(503, {"error": "sature"}, nom)
        else:
            try:
                self._router(nom, run_id)
            finally:
                self.server.places.release()
        self._vider_corps()

    def _router(self, nom: str, run_id: str | None):
        if nom == "inconnue":
            # Avant tout contrôle de clé : une route inconnue ne dit pas si la clé était bonne.
            return self._repondre(404, {"error": "inconnue"}, nom)
        if nom == "sante":
            return self._repondre(200, {"ok": True}, nom)
        autorisations = self.headers.get_all("Authorization") or []
        if len(autorisations) != 1 or not cle_valide(autorisations[0], self.server.config["cle_relais"]):
            return self._repondre(401, {"error": "non_autorise"}, nom)
        if self.headers.get_all("Transfer-Encoding"):
            return self._repondre(400, {"error": "forme_invalide"}, nom)
        if nom == "lancer":
            return self._lancer(nom)
        return self._relayer(nom, "GET", _PREFIXE_SUIVRE + run_id, None, None)

    def _lancer(self, nom: str):
        n = self._longueur_annoncee()
        if n is None:
            return self._repondre(400, {"error": "forme_invalide"}, nom)
        if n > CORPS_MAX:
            self._corps_lu = True   # on ne lira pas la suite
            return self._repondre(400, {"error": "corps_trop_grand"}, nom)
        brut = self._lire_corps(n)
        if brut is None:
            return self._repondre(400, {"error": "forme_invalide"}, nom)
        corps, code = corps_amont(brut)
        if code:
            return self._repondre(400, {"error": code}, nom)
        idem = self.headers.get_all("Idempotency-Key") or []
        cle = cle_idempotence(idem[0] if len(idem) == 1 else None, corps["session_id"])
        donnees = json.dumps({"input": corps["input"], "session_id": corps["session_id"]}).encode("utf-8")
        return self._relayer(nom, "POST", "/v1/runs", donnees, cle)

    def _relayer(self, nom, methode, chemin, donnees, cle_idem):
        statut, objet, motif = appeler_amont(self.server.config, methode, chemin, donnees, cle_idem)
        return self._repondre(statut, objet, nom, motif)

    def _longueur_annoncee(self) -> int | None:
        longueurs = self.headers.get_all("Content-Length") or []
        if len(longueurs) != 1:
            return None
        valeur = longueurs[0].strip(" \t")
        if not _ENTIER.fullmatch(valeur):
            return None
        return int(valeur)

    def _lire_corps(self, n: int) -> bytes | None:
        """Lit exactement n octets (n ≤ CORPS_MAX), dans une échéance globale de DELAI_CLIENT secondes."""
        self._corps_lu = True
        echeance = time.monotonic() + DELAI_CLIENT
        morceaux, reste = [], n
        while reste > 0:
            if time.monotonic() > echeance:
                return None
            try:
                morceau = self.rfile.read1(min(reste, MORCEAU))
            except OSError:
                return None
            if not morceau:
                return None
            morceaux.append(morceau)
            reste -= len(morceau)
        return b"".join(morceaux)

    def _vider_corps(self):
        """Après la réponse, jette un corps non lu de taille annoncée raisonnable, pour que la fermeture de la
        connexion ne provoque pas de RST qui ferait perdre la réponse au client. Rien n'est interprété."""
        if self._corps_lu or getattr(self, "headers", None) is None:
            return
        self._corps_lu = True
        if self.headers.get_all("Transfer-Encoding"):
            return
        n = self._longueur_annoncee()
        if n and n <= CORPS_MAX:
            self._lire_corps(n)

    def _repondre(self, code: int, objet: dict, nom: str, motif: str | None = None):
        try:
            corps = json.dumps(objet, ensure_ascii=False, allow_nan=False).encode("utf-8")
        except (ValueError, TypeError):
            code, motif = 502, "amont=non_serialisable"
            corps = json.dumps(_INDISPONIBLE).encode("utf-8")
        try:
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Length", str(len(corps)))
            self.send_header("Connection", "close")
            self.end_headers()
            if getattr(self, "command", None) != "HEAD":
                self.wfile.write(corps)
        except OSError:
            motif = "client_parti"
        self.close_connection = True
        self._journaliser(code, nom, motif)

    def _journaliser(self, code: int, nom: str, motif: str | None):
        """Une ligne par requête : horodatage, méthode, NOM de route, statut, durée. Jamais la cible brute, le corps,
        le texte de la recherche, une clé ni un en-tête."""
        commande = getattr(self, "command", None)
        methode = commande if commande in _METHODES_JOURNAL else ("AUTRE" if commande else "-")
        duree = int((time.monotonic() - self._debut) * 1000)
        ligne = f"{_horodatage()} {methode} {nom} {int(code)} {duree}ms"
        if motif:
            ligne += " " + motif
        try:
            self.server.journal(ligne)
        except Exception:
            pass


class ServeurRelais(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, config: dict, journal=None):
        self.config = config
        self.journal = journal or _journal_stdout
        self.places = threading.BoundedSemaphore(SIMULTANES_MAX)
        super().__init__((config["hote"], config["port"]), GestionnaireRelais)

    def handle_error(self, request, client_address):
        # Pas de trace complète (elle pourrait citer des données reçues) : le type d'erreur seulement.
        type_erreur = sys.exc_info()[0]
        nom = type_erreur.__name__ if type_erreur else "inconnue"
        try:
            self.journal(f"{_horodatage()} erreur_interne {nom}")
        except Exception:
            pass


def creer_serveur(config: dict, journal=None) -> ServeurRelais:
    return ServeurRelais(config, journal)


def main() -> int:
    config, erreur = charger_config(os.environ)
    if erreur:
        print(f"relais : {erreur}", file=sys.stderr, flush=True)
        return 2
    try:
        serveur = creer_serveur(config)
    except OSError as exc:
        print(f"relais : écoute impossible ({exc.strerror or type(exc).__name__}).", file=sys.stderr, flush=True)
        return 1
    hote, port = serveur.server_address[:2]
    _journal_stdout(f"{_horodatage()} démarrage écoute={hote}:{port} amont={config['amont']} délai={config['delai']}s")
    try:
        serveur.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        serveur.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
