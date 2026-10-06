"""Construit le jeu public courant sans toucher au snapshot historique TD1.

Les identifiants sont lus exclusivement depuis l'environnement du runner GitHub Actions.
La sortie ne contient que les champs normalisés des offres, jamais les identifiants OAuth.
"""
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from extraire import METIERS, chercher, obtenir_token  # noqa: E402
from resumer import (  # noqa: E402
    FORMATIONS, REGEX_OUTILS, departement, exp_ans, formation, nature,
    niveau, salaire_min_max, temps_travail,
)


def normaliser(offre, rome, observed_at):
    lieu = offre.get("lieuTravail") or {}
    entreprise = offre.get("entreprise") or {}
    salaire = offre.get("salaire") or {}
    texte = f"{offre.get('intitule') or ''} {offre.get('description') or ''}".lower()
    salaire_min, salaire_max = salaire_min_max(salaire.get("libelle"))
    competences = offre.get("competences") or []
    origine = offre.get("origineOffre") or {}
    exp_label = offre.get("experienceLibelle")
    return {
        "id": offre.get("id"),
        "rome": rome,
        "intitule": offre.get("intitule"),
        "entreprise": entreprise.get("nom"),
        "lieu": lieu.get("libelle"),
        "dep": departement(lieu) or None,
        "lat": None,
        "lon": None,
        "prec": None,
        "contrat": offre.get("typeContrat"),
        "experience": exp_label,
        "alternance": bool(offre.get("alternance")),
        "salaire": salaire.get("libelle"),
        "smin": salaire_min,
        "smax": salaire_max,
        "date": (offre.get("dateCreation") or "")[:10] or None,
        "vu_le": observed_at,
        "url": origine.get("urlOrigine"),
        "outils": [label for label, regex in REGEX_OUTILS.items() if regex.search(texte)],
        "teletravail": "télétravail" in texte,
        "competences": [item.get("libelle") for item in competences if item.get("libelle")],
        "niveau": niveau(offre.get("intitule")),
        "nature": nature(offre),
        "exp_exige": offre.get("experienceExige") or None,
        "exp_ans": exp_ans(exp_label),
        "qualification": offre.get("qualificationLibelle") or None,
        "formation": formation(offre),
        "secteur": offre.get("secteurActiviteLibelle") or None,
        "temps": temps_travail(offre),
        "postes": int(offre.get("nombrePostes") or 1),
    }


def main():
    if not os.getenv("FT_CLIENT_ID") or not os.getenv("FT_CLIENT_SECRET"):
        raise RuntimeError("Secrets FT_CLIENT_ID / FT_CLIENT_SECRET absents.")

    token = obtenir_token()
    offers = []
    seen_ids = set()
    limits = []
    totals = {}

    for code in METIERS:
        rows, total = chercher(token, {"codeROME": code}, pas=150, maximum=1150)
        totals[code] = total if total is not None else len(rows)
        if total is not None and total > len(rows):
            limits.append(code)
        for row in rows:
            offer_id = row.get("id")
            # Une même annonce ne doit compter qu'une fois dans l'explorateur.
            if offer_id and offer_id in seen_ids:
                continue
            if offer_id:
                seen_ids.add(offer_id)
            offers.append(normaliser(row, code, ""))
        # La collecte suit la cadence prudente déjà utilisée par le projet.
        time.sleep(0.5)

    generated = datetime.now(timezone.utc)
    local_generated = generated.astimezone(ZoneInfo("Europe/Paris"))
    local_date = local_generated.date().isoformat()
    for offer in offers:
        offer["vu_le"] = local_date

    dataset = {
        "mode": "live",
        "date": local_date,
        "generatedAt": generated.isoformat(timespec="seconds").replace("+00:00", "Z"),
        "source": "France Travail — API Offres d'emploi v2",
        "requete": "une recherche paginée codeROME par métier suivi, France entière",
        "limites": limits,
        "metiers": [
            {"code": code, "libelle": label, "groupe": group, "coche": checked,
             "actives": sum(offer["rome"] == code for offer in offers)}
            for code, (label, group, checked) in METIERS.items()
        ],
        "outils": list(REGEX_OUTILS),
        "contrats": {},
        "niveaux": [
            ["assistant", "Assistant·e / junior"], ["charge", "Chargé·e"],
            ["responsable", "Responsable"], ["directeur", "Directeur·rice"], ["autre", "Autre"],
        ],
        "formations": FORMATIONS,
        "totaux_api": totals,
        "offres": offers,
    }

    output = ROOT / "data" / "offres-france-travail.json"
    temporary_output = output.with_suffix(output.suffix + ".tmp")
    temporary_output.write_text(json.dumps(dataset, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    temporary_output.replace(output)
    print(f"Dernière actualisation (Europe/Paris) : {local_generated:%d/%m/%Y à %H:%M}.")
    print(f"Jeu France Travail généré : {len(offers)} offres.")
    if limits:
        print("Attention : plafond de pagination atteint pour " + ", ".join(limits) + ".")
    print(f"Fichier écrit : {output.relative_to(ROOT)}")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Ne jamais imprimer les paramètres de requête ni le contenu des exceptions HTTP.
        print("Échec de la génération France Travail. Vérifier les secrets et l'accès API.", file=sys.stderr)
        sys.exit(1)
