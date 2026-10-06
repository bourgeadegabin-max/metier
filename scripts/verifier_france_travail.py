"""Vérifie réellement l'authentification et une recherche Offres d'emploi v2.

Ce contrôle ne journalise ni jeton, ni identifiant, ni secret, ni réponse d'erreur brute.
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from extraire import METIERS, chercher, obtenir_token  # noqa: E402


def main():
    token = obtenir_token()
    probe_rome = next(iter(METIERS))
    offers, total = chercher(token, {"codeROME": probe_rome}, pas=150, maximum=150)
    if not isinstance(offers, list):
        raise ValueError("La réponse de recherche n'est pas une liste.")
    if total is not None and (not isinstance(total, int) or total < len(offers)):
        raise ValueError("Le total annoncé par l'API est incohérent.")
    if any(not isinstance(offer, dict) or not offer.get("id") for offer in offers):
        raise ValueError("Les résultats ne contiennent pas les identifiants d'offres attendus.")
    print(f"Accès France Travail validé : réponse exploitable pour {probe_rome} ({len(offers)} offre(s) dans l'échantillon).")


if __name__ == "__main__":
    try:
        main()
    except BaseException:
        # Masque également les messages des erreurs HTTP et SystemExit du collecteur.
        print("Échec du contrôle France Travail (authentification ou réponse API).", file=sys.stderr)
        sys.exit(1)
