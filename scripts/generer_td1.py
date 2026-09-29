"""Génère les graphiques SVG et le dictionnaire descriptif du TD1.

Les calculs utilisent exclusivement data/resume.json. Les offres ne sont jamais
supprimées ni imputées ; les valeurs absentes sont documentées dans la synthèse.
Usage : python3 scripts/generer_td1.py
"""
import html
import json
import math
import textwrap
from collections import Counter
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = json.loads((ROOT / "data/resume.json").read_text(encoding="utf-8"))
OFFRES = DATA["offres"]
OUT = ROOT / "graphiques"
OUT.mkdir(exist_ok=True)
INK, BLUE, LIGHT, GREY = "#17324d", "#176b87", "#d9e8ee", "#536575"


def txt(s):
    return html.escape(str(s), quote=True)


def svg_text_width_estimate(s):
    """Estimation prudente de largeur en Arial 13 px pour éviter les débordements."""
    narrow = " ilI.,'`:;!|"
    wide = "MW@%&"
    return sum(3.8 if c in narrow else 10 if c in wide else 8.2 if c.isupper() else 7.2 for c in s)


def svg_start(title, subtitle, height=560):
    return [f'''<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="{height}" viewBox="0 0 1000 {height}">
<rect width="1000" height="100%" fill="#fff"/><style>text{{font-family:Arial,sans-serif;fill:{INK}}}.muted{{fill:{GREY}}}</style>
<text x="40" y="48" font-size="26" font-weight="bold">{txt(title)}</text>
<text x="40" y="77" font-size="15" class="muted">{txt(subtitle)}</text>''']


def horizontal(name, title, subtitle, rows, n_total, suffix=" offres", max_rows=23, annotation=None):
    rows = rows[:max_rows]
    wrapped = [textwrap.wrap(str(label), width=38, break_long_words=True, break_on_hyphens=False) or [""] for label, _ in rows]
    row_heights = [max(28, len(lines) * 16 + 8) for lines in wrapped]
    top = 128 if annotation else 108
    height = max(240, top + sum(row_heights) + 42)
    parts = svg_start(title, subtitle, height)
    left, bar_w = 350, 450
    maximum = max((v for _, v in rows), default=1) or 1
    if annotation:
        parts.append(f'<text x="{left}" y="106" font-size="14" font-weight="bold">{txt(annotation)}</text>')
    y = top
    for (label, value), lines, row_h in zip(rows, wrapped, row_heights):
        bar_y = y + (row_h - 18) / 2
        # Chaque ligne dispose d'une largeur maximale explicite dans le SVG : même les
        # libellés inhabituels ne peuvent déborder dans la marge ou sur les barres.
        baseline = y + (row_h - len(lines) * 16) / 2 + 12
        for j, line in enumerate(lines):
            width_attr = ' textLength="292" lengthAdjust="spacingAndGlyphs"' if svg_text_width_estimate(line) > 292 else ""
            parts.append(f'<text x="{left-12}" y="{baseline + j*16:.1f}" font-size="13" text-anchor="end"{width_attr}>{txt(line)}</text>')
        w = bar_w * value / maximum
        parts.append(f'<rect x="{left}" y="{bar_y:.1f}" width="{bar_w}" height="18" rx="3" fill="{LIGHT}"/>')
        parts.append(f'<rect x="{left}" y="{bar_y:.1f}" width="{w:.1f}" height="18" rx="3" fill="{BLUE}"/>')
        pct = 100 * value / n_total if n_total else 0
        parts.append(f'<text x="{left+bar_w+12}" y="{bar_y+14:.1f}" font-size="12">{value:,} ({pct:.1f} %)</text>'.replace(",", " "))
        y += row_h
    parts.append(f'<text x="40" y="{height-18}" font-size="12" class="muted">Base : {n_total:,} offres. {txt(suffix)}'.replace(",", " ") + '</text></svg>')
    (OUT / name).write_text("\n".join(parts), encoding="utf-8")


def chart_salary():
    xs = sorted(o["smin"] for o in OFFRES if isinstance(o.get("smin"), (int, float)))
    n = len(xs)
    q = lambda p: xs[round((n - 1) * p)]
    bins = list(range(0, 110001, 10000))
    counts = [sum(a <= x < b for x in xs) for a, b in zip(bins, bins[1:])]
    height, left, top, width, plot_h = 440, 85, 112, 820, 235
    parts = svg_start("Minima salariaux annuels", f"{n:,} offres renseignées sur {len(OFFRES):,} ({100*n/len(OFFRES):.1f} %) · brut annuel".replace(",", " "), height)
    ymax = max(counts)
    for tick in range(0, ymax + 1, max(1, math.ceil(ymax / 4))):
        y = top + plot_h * (1 - tick / ymax)
        parts.append(f'<line x1="{left}" y1="{y:.1f}" x2="{left+width}" y2="{y:.1f}" stroke="#e5ebef"/><text x="{left-12}" y="{y+4:.1f}" font-size="12" text-anchor="end" class="muted">{tick}</text>')
    bw = width / len(counts)
    for i, c in enumerate(counts):
        h = plot_h * c / ymax
        x = left + i * bw + 3
        parts.append(f'<rect x="{x:.1f}" y="{top+plot_h-h:.1f}" width="{bw-6:.1f}" height="{h:.1f}" fill="{BLUE}"/>')
        parts.append(f'<text x="{x+bw/2-3:.1f}" y="{top+plot_h-h-7:.1f}" text-anchor="middle" font-size="11">{c}</text>')
        parts.append(f'<text x="{x+bw/2-3:.1f}" y="{top+plot_h+20}" text-anchor="middle" font-size="11" class="muted">{bins[i]//1000}k</text>')
    median_x = left + width * q(.5) / 110000
    parts.append(f'<line x1="{median_x:.1f}" y1="{top-8}" x2="{median_x:.1f}" y2="{top+plot_h}" stroke="#c04b36" stroke-width="3" stroke-dasharray="7 5"/>')
    parts.append(f'<text x="40" y="390" font-size="14" font-weight="bold">Médiane : {q(.5):,.0f} € · Q1 : {q(.25):,.0f} € · Q3 : {q(.75):,.0f} €</text>'.replace(",", " "))
    parts.append(f'<text x="40" y="414" font-size="12" class="muted">Chaque barre = intervalle de 10 k€ ; la ligne pointillée indique la médiane. Les 2 290 salaires non numériques ne sont pas imputés.</text></svg>')
    (OUT / "03_distribution_salaires.svg").write_text("\n".join(parts), encoding="utf-8")
    return xs


def main():
    n = len(OFFRES)
    métiers = Counter(o["rome"] for o in OFFRES)
    labels = DATA.get("metiers", {})
    if isinstance(labels, list):
        labels = {x.get("code"): x.get("libelle", x.get("code")) for x in labels if isinstance(x, dict)}
    horizontal("01_offres_par_metier.svg", "Offres actives par métier", f"Extraction du {DATA['date']} · {n:,} offres".replace(",", " "),
               [(f"{c} — {labels.get(c, c) if isinstance(labels, dict) else c}", v) for c, v in métiers.most_common()], n)

    def famille_contrat(o):
        c, nat = o.get("contrat") or "", o.get("nature") or ""
        if o.get("alternance") or nat in ("apprentissage", "professionnalisation"): return "Alternance"
        if c == "MIS": return "Intérim"
        if c in ("LIB", "FRA", "CCE") or nat == "non_salarie": return "Indépendant"
        if c == "CDI": return "CDI"
        if c == "CDD": return "CDD"
        return "Autre"
    contrats = Counter(famille_contrat(o) for o in OFFRES)
    ordre_contrats = ["CDI", "CDD", "Alternance", "Intérim", "Indépendant", "Autre"]
    rows = [(k, contrats[k]) for k in ordre_contrats]
    horizontal("02_types_de_contrat.svg", "Type de contrat annoncé", "Familles exclusives selon la règle du site · effectifs et part du corpus", rows, n)

    xs = chart_salary()

    deps = Counter(o.get("dep") or "Non renseigné" for o in OFFRES)
    horizontal("04_offres_par_departement.svg", "Offres par département", "15 premières catégories · les données manquantes sont affichées", deps.most_common(), n, max_rows=16)

    secteurs = Counter(o["secteur"] for o in OFFRES if o.get("secteur"))
    horizontal("05_secteurs_employeurs.svg", "Secteurs renseignés", "Top 12 · calcul sur les seules offres dont le secteur est connu", secteurs.most_common(), sum(secteurs.values()), max_rows=12)

    nature = Counter(o.get("nature") or "Non précisé" for o in OFFRES)
    horizontal("06_nature_contrat.svg", "Nature du contrat", "Variable distincte du type de contrat · effectifs et part du corpus", nature.most_common(), n)

    def exp_group(o):
        a = o.get("exp_ans")
        if o.get("exp_exige") == "D" or a == 0:
            return "Débutant accepté"
        if a is None:
            return "Durée non précisée / non convertible"
        if a < 1:
            return "Moins d’un an"
        if a < 3:
            return "1 à 2 ans"
        if a < 5:
            return "3 à 4 ans"
        return "5 ans et plus"
    exp_order = ["Débutant accepté", "Moins d’un an", "1 à 2 ans", "3 à 4 ans", "5 ans et plus", "Durée non précisée / non convertible"]
    exp_counts = Counter(exp_group(o) for o in OFFRES)
    horizontal("07_experience.svg", "Expérience demandée", "Durées recodées par tranches ; les mentions non convertibles restent visibles", [(k, exp_counts[k]) for k in exp_order], n)

    snapshot = date.fromisoformat(DATA["date"])
    ages = []
    for o in OFFRES:
        try:
            ages.append((snapshot - date.fromisoformat(o["date"][:10])).days)
        except (TypeError, ValueError):
            pass
    age_bins = [("0–6 jours", lambda x: 0 <= x < 7), ("7–29 jours", lambda x: 7 <= x < 30),
                ("30–59 jours", lambda x: 30 <= x < 60), ("60 jours et plus", lambda x: x >= 60)]
    age_counts = [(label, sum(test(a) for a in ages)) for label, test in age_bins]
    horizontal("08_fraicheur_offres.svg", "Ancienneté des annonces", f"Calculée à la date d’extraction {DATA['date']} · {len(ages):,} dates exploitables".replace(",", " "), age_counts, len(ages), annotation=f"Âge médian : {sorted(ages)[len(ages)//2]} jours")

    print(f"Graphiques créés dans {OUT}; n={n}, médiane smin={xs[len(xs)//2]:.0f} €, âge médian={sorted(ages)[len(ages)//2]} jours")


if __name__ == "__main__":
    main()
