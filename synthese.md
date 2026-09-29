# Première exploration descriptive des offres

**Source :** `data/resume.json`, extraction du **2026-09-29**. Le périmètre comprend **3 181 offres actives** sur les 23 codes ROME suivis. Les graphiques sont des SVG vectoriels.

**Préparation :** sources brutes conservées ; aucune offre supprimée du périmètre résumé. Les valeurs manquantes sont comptées séparément. Le salaire est analysé uniquement lorsque `smin` est un montant annuel numérique. Les offres actives, et non les versions brutes, servent d’unité de compte.

## Graphiques

### Offres actives par métier

![Offres actives par métier](graphiques/01_offres_par_metier.svg)

**Chiffre clé :** le métier le plus représenté est **D1415 — Chargé(e) de relation client (CRM) : 350 offres**. 22 des 23 codes suivis ont au moins une offre.

Cela décrit les volumes dans le périmètre des métiers ROME sélectionnés, pas l’ensemble des emplois du marché.

### Offres par type de contrat

![Offres par type de contrat](graphiques/02_types_de_contrat.svg)

**Chiffre clé :** **CDI** est le contrat le plus fréquent, avec **1 644 offres (51,7 %)**.

La répartition résume le type de contrat annoncé dans les offres actives ; elle ne mesure ni leur durée réelle ni le nombre de postes pourvus.

### Minima salariaux annuels

![Minima salariaux annuels](graphiques/03_distribution_salaires.svg)

**Chiffre clé :** la médiane des minima annualisés est de **27 600 € brut/an**, sur 891 offres ; la tranche la plus fréquente est **20–30 k€** (362 offres).

La variable représentée est le minimum salarial affiché, pas un salaire moyen. 2 290 offres (72,0 %) n’ont pas de minimum numérique annuel exploitable et ne sont pas imputées.

### Offres par département

![Offres par département](graphiques/04_offres_par_departement.svg)

**Chiffre clé :** le département le plus représenté parmi ceux renseignés est **75 : 367 offres**.

Le graphique montre les dix premiers départements plus 103 offres sans département. Certaines coordonnées sont estimées au centre d’une commune ou d’un département.

### Secteurs renseignés

![Secteurs renseignés](graphiques/05_secteurs_employeurs.svg)

**Chiffre clé :** parmi les 1 482 secteurs renseignés, le plus fréquent est **Activités des agences de travail temporaire : 224 offres**.

Le secteur manque pour 1 699 offres (53,4 %). La figure décrit les seuls cas renseignés et ne doit pas être extrapolée sans réserve.

### Nature du contrat

![Nature du contrat](graphiques/06_nature_contrat.svg)

**Chiffre clé :** la catégorie la plus fréquente est **Salarié : 2 236 offres**.

Cette catégorie distingue notamment apprentissage et professionnalisation du salariat et des formes non salariées.

## Lecture transversale

Les trois codes ROME les plus représentés sont D1415 (350), E1113 (301), M1703 (292) : **943 offres, soit 29,6 % du corpus**. Les CDI représentent **1 644 offres (51,7 %)** et les CDD **961 (30,2 %)**.

Le secteur est renseigné pour 1 482 offres (46,6 %), le salaire annualisé pour 891 (28,0 %), et l’employeur pour 2 301 (72,3 %). Toute comparaison sur ces variables doit donner le dénominateur valide.

## Notes de méthode

- Une ligne du résumé correspond à une offre active à la date d’extraction ; le nombre de postes (`postes`) peut différer du nombre d’offres.
- Les montants sont présentés tels que transformés par le script du dépôt ; la médiane porte sur les minima (`smin`), pas sur les maxima ni sur un salaire représentatif par intervalle.
- Les libellés longs du graphique sectoriel sont abrégés à l’affichage ; les catégories n’ont pas été regroupées.
- La source est l’API France Travail : ce corpus ne recense pas toutes les offres du marché du travail.
