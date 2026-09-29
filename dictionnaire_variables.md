# Dictionnaire des variables — `data/resume.json`

**Périmètre :** 3 181 offres actives dans l’extraction du 29 septembre 2026. Les types décrivent les valeurs sérialisées dans JSON. « Vide » désigne `null`, chaîne vide ou liste vide selon le champ ; ces situations ne signifient pas toujours la même chose.

| Variable | Type | Définition / précaution |
|---|---|---|
| `id` | Texte | Identifiant France Travail de l’offre. |
| `rome` | Catégorie (texte) | Code du métier ROME suivi. |
| `intitule` | Texte | Intitulé de l’offre. |
| `entreprise` | Texte, parfois nul | Employeur tel que fourni par la source. |
| `lieu` | Texte | Libellé du lieu de travail. |
| `dep` | Catégorie (texte), parfois vide | Code du département ; conserver comme texte, notamment pour les zéros initiaux. |
| `lat`, `lon` | Numérique, parfois nul | Coordonnées fournies ou estimées ; interpréter avec `prec`. |
| `prec` | Catégorie (texte), parfois nulle | Précision géographique (offre, commune, département, etc.). |
| `contrat` | Catégorie (texte) | Code du type de contrat de l’API ; `contrats` dans le résumé donne les libellés. |
| `experience` | Texte | Libellé d’expérience de l’annonce. |
| `alternance` | Booléen | Indicateur d’alternance produit lors du résumé. |
| `salaire` | Texte, parfois nul | Libellé salarial original de l’API. |
| `smin`, `smax` | Numérique, parfois nul | Bornes extraites du libellé et annualisées par le script ; ce ne sont pas des salaires observés. |
| `date` | Date ISO (texte) | Date de création de l’offre, utilisée ici pour mesurer son ancienneté. |
| `vu_le` | Date/heure (texte) | Date à laquelle le collecteur a vu cette version. |
| `url` | Texte | Lien vers l’annonce. |
| `outils` | Liste de textes | Outils détectés par recherche de mots-clés dans l’intitulé et la description ; liste vide = aucun terme de la grille détecté. |
| `teletravail` | Booléen | Indicateur de télétravail recodé à partir de l’annonce. |
| `competences` | Liste de textes | Compétences associées par la source ; liste vide si aucune n’est fournie. |
| `niveau` | Catégorie (texte) | Niveau de poste inféré de l’intitulé (assistant, chargé, responsable, directeur, autre). |
| `nature` | Catégorie (texte) | Nature du contrat recodée (apprentissage, professionnalisation, salarié, non salarié, autre). |
| `exp_exige` | Catégorie (texte), parfois nulle | Indicateur source relatif à l’exigence d’expérience (`D`/`E`). |
| `exp_ans` | Numérique, parfois nul | Durée d’expérience convertie en années ; zéro peut signaler « débutant accepté ». |
| `qualification` | Texte, parfois nul | Qualification renseignée dans l’annonce. |
| `formation` | Catégorie (texte), parfois nulle | Niveau de formation recodé en catégories ordonnées, du niveau inférieur au Bac+5. |
| `secteur` | Texte, parfois nul | Libellé de secteur d’activité de l’employeur. |
| `temps` | Catégorie (texte), parfois nulle | Temps plein/partiel lorsque l’information est disponible. |
| `postes` | Entier | Nombre de postes annoncé ; ce n’est pas le nombre d’offres. |

Le fichier JSONL brut contient le détail variable de la réponse API (43 champs distincts observés dans ce lot), tandis que `resume.json` est la table préparée employée par le site. Pour reproduire les recodages, consulter `scripts/resumer.py`.
