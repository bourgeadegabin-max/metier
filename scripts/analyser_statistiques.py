#!/usr/bin/env python3
"""Vérifie indépendamment les analyses servies dans l'explorateur.

Usage : python3 scripts/analyser_statistiques.py [data/resume.json]
Le fichier par défaut est le snapshot TD1 immuable. Un autre JSON au même format,
notamment data/offres-france-travail.json, peut être passé en argument.
Le contrôle croisé appelle aussi le moteur JavaScript réellement chargé par la page
(Node.js requis), puis compare ses résultats aux calculs Python ci-dessous.
"""
import hashlib
import json
import math
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
DEFAULT = ROOT / "data" / "resume.json"
SNAPSHOT_GIT_BLOB_SHA1 = "c95e4c398cfa08fe8dd04896ba3174f6ce4e1aa5"
MC_DRAWS = 10000
MC_SEED = 184729
LEVELS = ("assistant", "charge", "responsable", "directeur", "autre")


def avg(xs):
    return sum(xs) / len(xs) if xs else None


def var(xs):
    m = avg(xs)
    return sum((x - m) ** 2 for x in xs) / (len(xs) - 1) if len(xs) > 1 else None


def med(xs):
    s = sorted(xs)
    if not s:
        return None
    p = (len(s) - 1) / 2
    lo = math.floor(p)
    return s[lo] + (s[math.ceil(p)] - s[lo]) * (p - lo)


def lgamma(z):
    p = [0.99999999999980993, 676.5203681218851, -1259.1392167224028,
         771.32342877765313, -176.61502916214059, 12.507343278686905,
         -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7]
    if z < .5:
        return math.log(math.pi) - math.log(math.sin(math.pi * z)) - lgamma(1 - z)
    z -= 1
    x = p[0] + sum(p[i] / (z + i) for i in range(1, len(p)))
    t = z + 7.5
    return .9189385332046727 + (z + .5) * math.log(t) - t + math.log(x)


def beta_fraction(a, b, x):
    max_iter, epsilon, tiny = 250, 3e-14, 1e-300
    qab, qap, qam = a + b, a + 1, a - 1
    c, d = 1.0, 1 - qab * x / qap
    if abs(d) < tiny:
        d = tiny
    d = 1 / d
    h = d
    for m in range(1, max_iter + 1):
        m2 = 2 * m
        aa = m * (b - m) * x / ((qam + m2) * (a + m2))
        d = 1 + aa * d
        if abs(d) < tiny:
            d = tiny
        c = 1 + aa / c
        if abs(c) < tiny:
            c = tiny
        d = 1 / d
        h *= d * c
        aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))
        d = 1 + aa * d
        if abs(d) < tiny:
            d = tiny
        c = 1 + aa / c
        if abs(c) < tiny:
            c = tiny
        d = 1 / d
        delta = d * c
        h *= delta
        if abs(delta - 1) < epsilon:
            break
    return h


def regularized_beta(x, a, b):
    if x <= 0:
        return 0.0
    if x >= 1:
        return 1.0
    log_bt = a * math.log(x) + b * math.log1p(-x) - (lgamma(a) + lgamma(b) - lgamma(a + b))
    bt = math.exp(log_bt)
    return bt * beta_fraction(a, b, x) / a if x < (a + 1) / (a + b + 2) else 1 - bt * beta_fraction(b, a, 1 - x) / b


def student_p(t, df):
    return regularized_beta(df / (df + t * t), df / 2, .5) if df > 0 else None


def f_p(f, df1, df2):
    return regularized_beta(df2 / (df2 + df1 * f), df2 / 2, df1 / 2) if df1 > 0 and df2 > 0 else None


def ranks(xs):
    order = sorted(enumerate(xs), key=lambda pair: pair[1])
    result = [0.0] * len(xs)
    start = 0
    while start < len(order):
        end = start + 1
        while end < len(order) and order[end][1] == order[start][1]:
            end += 1
        r = ((start + 1) + end) / 2
        for index, _ in order[start:end]:
            result[index] = r
        start = end
    return result


def corr(xs, ys):
    mx, my = avg(xs), avg(ys)
    cross = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    xx = sum((x - mx) ** 2 for x in xs)
    yy = sum((y - my) ** 2 for y in ys)
    return cross / math.sqrt(xx * yy) if xx and yy else None


def tukey_outliers(xs):
    s = sorted(xs)

    def q(prob):
        pos = (len(s) - 1) * prob
        lo = math.floor(pos)
        return s[lo] + (s[math.ceil(pos)] - s[lo]) * (pos - lo)
    q1, q3 = q(.25), q(.75)
    lo, hi = q1 - 1.5 * (q3 - q1), q3 + 1.5 * (q3 - q1)
    return {"low": sum(v < lo for v in xs), "high": sum(v > hi for v in xs), "lo": lo, "hi": hi}


def family(o):
    c, n = o.get("contrat") or "", o.get("nature") or ""
    if o.get("alternance") or n in ("apprentissage", "professionnalisation"):
        return "alt"
    if c == "MIS":
        return "mis"
    if c in ("LIB", "FRA", "CCE") or n == "non_salarie":
        return "indep"
    if c == "CDI":
        return "cdi"
    if c == "CDD":
        return "cdd"
    return "autre"


def rng(seed):
    state = seed % 2147483647
    if state <= 0:
        state += 2147483646
    while True:
        state = state * 16807 % 2147483647
        yield (state - 1) / 2147483646


def sample_fixed_margin_rows(row_totals, sample_count, total, random):
    """Floyd simple random sample without replacement; equivalent fixed margins."""
    chosen = set()
    for j in range(total - sample_count, total):
        candidate = math.floor(next(random) * (j + 1))
        chosen.add(j if candidate in chosen else candidate)
    by_row = [0] * len(row_totals)
    boundaries, cumulative = [], 0
    for size in row_totals:
        cumulative += size
        boundaries.append(cumulative)
    for position in chosen:
        row = 0
        while position >= boundaries[row]:
            row += 1
        by_row[row] += 1
    return by_row


def gamma_q(a, x):
    if x <= 0:
        return 1.0
    eps, tiny = 1e-14, 1e-300
    if x < a + 1:
        total = term = 1 / a
        ap = a
        for _ in range(10000):
            ap += 1
            term *= x / ap
            total += term
            if abs(term) < abs(total) * eps:
                break
        return max(0.0, min(1.0, 1 - total * math.exp(-x + a * math.log(x) - lgamma(a))))
    b = x + 1 - a
    c, d = 1 / tiny, 1 / b
    h = d
    for i in range(1, 10001):
        an = -i * (i - a)
        b += 2
        d = an * d + b
        if abs(d) < tiny:
            d = tiny
        c = b + an / c
        if abs(c) < tiny:
            c = tiny
        d = 1 / d
        delta = d * c
        h *= delta
        if abs(delta - 1) < eps:
            break
    return max(0.0, min(1.0, math.exp(-x + a * math.log(x) - lgamma(a)) * h))


def chi_analysis(offers):
    order = ("cdi", "cdd", "alt", "mis", "indep", "autre")
    rows = {}
    miss_contract = miss_tele = 0
    for o in offers:
        key = family(o)
        if key is None:
            miss_contract += 1
            continue
        if not isinstance(o.get("teletravail"), bool):
            miss_tele += 1
            continue
        rows.setdefault(key, [0, 0])[1 if o["teletravail"] else 0] += 1
    categories = sorted(rows, key=order.index)
    observed = [rows[k] for k in categories]
    row_totals = [sum(r) for r in observed]
    col_totals = [sum(row[j] for row in observed) for j in (0, 1)]
    n = sum(col_totals)
    expected = [[row_totals[i] * col_totals[j] / n for j in (0, 1)] for i in range(len(rows))]
    chi2 = sum((observed[i][j] - expected[i][j]) ** 2 / expected[i][j] for i in range(len(rows)) for j in (0, 1) if expected[i][j])
    df = len(categories) - 1
    low_expected = sum(v < 5 for row in expected for v in row)
    use_mc = low_expected > 0 and n > 0 and len(categories) > 1
    p, simulations, mc_se, extreme_count = (None, 0, None, None)
    if use_mc:
        random = rng(MC_SEED)
        extreme = 0
        for _ in range(MC_DRAWS):
            sample_absence = col_totals[0] < col_totals[1]
            sampled = sample_fixed_margin_rows(row_totals, min(col_totals), n, random)
            simulated = 0.0
            for i, size in enumerate(row_totals):
                no = sampled[i] if sample_absence else size - sampled[i]
                yes = size - no
                if expected[i][0]:
                    simulated += (no - expected[i][0]) ** 2 / expected[i][0]
                if expected[i][1]:
                    simulated += (yes - expected[i][1]) ** 2 / expected[i][1]
            extreme += simulated >= chi2 - 1e-12
        p = (extreme + 1) / (MC_DRAWS + 1)
        mc_se = math.sqrt(p * (1 - p) / (MC_DRAWS + 1))
        simulations, extreme_count = MC_DRAWS, extreme
    else:
        p = gamma_q(df / 2, chi2 / 2)
    v = math.sqrt(chi2 / (n * min(len(categories) - 1, 1))) if n and len(categories) > 1 else None
    return {"n": n, "excluded": len(offers) - n, "missingContract": miss_contract, "missingTelework": miss_tele,
            "categories": categories, "observed": observed, "expected": expected, "rowTotals": row_totals,
            "colTotals": col_totals, "chi2": chi2, "df": df, "p": p, "lowExpected": low_expected,
            "simulations": simulations, "extremeSimulations": extreme_count, "mcSe": mc_se, "cramersV": v}


def one_way(groups):
    all_values = [x for group in groups for x in group["values"]]
    n, k, overall = len(all_values), len(groups), avg(all_values)
    between = sum(len(g["values"]) * (avg(g["values"]) - overall) ** 2 for g in groups)
    within = sum(sum((x - avg(g["values"])) ** 2 for x in g["values"]) for g in groups)
    df1, df2 = k - 1, n - k
    f = (between / df1) / (within / df2)
    return {"f": f, "df1": df1, "df2": df2, "p": f_p(f, df1, df2), "eta2": between / (between + within)}


def levene(groups):
    transformed = [{"key": g["key"], "values": [abs(x - med(g["values"])) for x in g["values"]]} for g in groups]
    return one_way(transformed)


def welch(groups):
    k = len(groups)
    weights = [len(g["values"]) / var(g["values"]) for g in groups]
    wsum = sum(weights)
    weighted_mean = sum(w * avg(g["values"]) for w, g in zip(weights, groups)) / wsum
    numerator = sum(w * (avg(g["values"]) - weighted_mean) ** 2 for w, g in zip(weights, groups)) / (k - 1)
    st = sum((1 - w / wsum) ** 2 / (len(g["values"]) - 1) for w, g in zip(weights, groups))
    correction = 1 + (2 * (k - 2) / (k * k - 1)) * st
    df2 = (k * k - 1) / (3 * st)
    classic_eta = one_way(groups)["eta2"]
    f = numerator / correction
    return {"f": f, "df1": k - 1, "df2": df2, "p": f_p(f, k - 1, df2), "eta2": classic_eta}


def welch_pair(a, b):
    na, nb = len(a["values"]), len(b["values"])
    va, vb = var(a["values"]), var(b["values"])
    se2 = va / na + vb / nb
    df = se2 ** 2 / ((va / na) ** 2 / (na - 1) + (vb / nb) ** 2 / (nb - 1))
    t = (avg(a["values"]) - avg(b["values"])) / math.sqrt(se2)
    return {"a": a["key"], "b": b["key"], "difference": avg(a["values"]) - avg(b["values"]), "t": t, "df": df, "p": student_p(t, df)}


def pooled_pair(a, b):
    na, nb = len(a["values"]), len(b["values"])
    va, vb = var(a["values"]), var(b["values"])
    df = na + nb - 2
    pooled = ((na - 1) * va + (nb - 1) * vb) / df
    difference = avg(a["values"]) - avg(b["values"])
    t = difference / math.sqrt(pooled * (1 / na + 1 / nb))
    return {"a": a["key"], "b": b["key"], "difference": difference, "t": t, "df": df, "p": student_p(t, df)}


def anova_analysis(offers):
    candidates = [{"key": key, "values": [o["smin"] for o in offers if o.get("niveau") == key and isinstance(o.get("smin"), (int, float)) and not isinstance(o.get("smin"), bool)]} for key in LEVELS]
    excluded_small_groups = sum(len(g["values"]) for g in candidates if len(g["values"]) == 1)
    groups = [g for g in candidates if len(g["values"]) >= 2]
    salary_missing = sum(not (isinstance(o.get("smin"), (int, float)) and not isinstance(o.get("smin"), bool)) for o in offers)
    missing_level = sum(o.get("niveau") not in LEVELS for o in offers)
    lev, classic = levene(groups), one_way(groups)
    equal = lev["p"] >= .05
    selected = dict(classic if equal else welch(groups))
    selected["method"] = "ANOVA classique" if equal else "ANOVA de Welch"
    posthoc_method = "Tests t à variance poolée par paires + correction de Holm" if equal else "Tests t de Welch par paires + correction de Holm"
    pairs = []
    if selected["p"] < .05:
        pair_test = pooled_pair if equal else welch_pair
        for i, a in enumerate(groups):
            for b in groups[i + 1:]:
                pairs.append(pair_test(a, b))
        ordered = sorted(pairs, key=lambda p: p["p"])
        previous = 0.0
        for i, pair in enumerate(ordered):
            pair["pHolm"] = min(1.0, max(previous, (len(ordered) - i) * pair["p"]))
            previous = pair["pHolm"]
    all_values = [x for g in groups for x in g["values"]]
    assert sum(len(g["values"]) for g in groups) == len(all_values)
    return {"n": len(all_values), "excluded": len(offers) - len(all_values), "salaryMissing": salary_missing,
            "excludedSmallGroups": excluded_small_groups,
            "missingLevel": missing_level,
            "groups": [{"key": g["key"], "n": len(g["values"]), "mean": avg(g["values"]), "variance": var(g["values"])} for g in groups],
            "levene": {k: lev[k] for k in ("f", "df1", "df2", "p")}, "selected": selected,
            "classic": classic, "equalVariance": equal, "posthocMethod": posthoc_method, "comparisons": pairs,
            "significantComparisons": [p for p in pairs if p.get("pHolm", 1) < .05], "outliers": tukey_outliers(all_values)}


def correlation_analysis(offers):
    pairs, miss_x, miss_y, miss_both = [], 0, 0, 0
    for o in offers:
        x = o.get("exp_ans")
        y = o.get("smin")
        valid_x = isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)
        valid_y = isinstance(y, (int, float)) and not isinstance(y, bool) and math.isfinite(y)
        miss_x += not valid_x
        miss_y += not valid_y
        miss_both += not valid_x and not valid_y
        if valid_x and valid_y:
            pairs.append((x, y))
    xs, ys = [p[0] for p in pairs], [p[1] for p in pairs]
    n = len(pairs)
    r = corr(xs, ys)
    t = r * math.sqrt((n - 2) / (1 - r * r))
    rp = student_p(t, n - 2)
    rho = corr(ranks(xs), ranks(ys))
    rt = rho * math.sqrt((n - 2) / (1 - rho * rho))
    sp = student_p(rt, n - 2)
    mx, my = avg(xs), avg(ys)
    sxx = sum((x - mx) ** 2 for x in xs)
    slope = sum((x - mx) * (y - my) for x, y in pairs) / sxx
    intercept = my - slope * mx
    sse = sum((y - intercept - slope * x) ** 2 for x, y in pairs)
    sst = sum((y - my) ** 2 for y in ys)
    assert math.isclose(slope, r * math.sqrt(sst / sxx), rel_tol=1e-12)
    assert math.isclose(r * r, 1 - sse / sst, rel_tol=1e-12, abs_tol=1e-12)
    hc3_variance_numerator = 0.0
    for x, y in pairs:
        dx = x - mx
        residual = y - intercept - slope * x
        leverage = 1 / n + dx * dx / sxx
        hc3_variance_numerator += dx * dx * residual * residual / (1 - leverage) ** 2
    se = math.sqrt(hc3_variance_numerator) / sxx
    coefficient_p = student_p(slope / se, n - 2)
    return {"n": n, "excluded": len(offers) - n, "missingExperience": miss_x, "missingSalary": miss_y,
            "missingBoth": miss_both, "r": r, "pearsonP": rp, "rho": rho, "spearmanP": sp,
            "slope": slope, "intercept": intercept, "standardError": se, "coefficientP": coefficient_p,
            "rSquared": r * r, "xMin": min(xs), "xMax": max(xs), "yMin": min(ys), "yMax": max(ys),
            "expOutliers": tukey_outliers(xs), "salaryOutliers": tukey_outliers(ys)}


NODE_CHECK = r"""
const fs=require('fs'); const A=require(process.cwd()+'/assets/analyses.js');
const D=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));
process.stdout.write(JSON.stringify(A.compute(D.offres)));
"""


def compare_value(label, py, js, tolerance=2e-8):
    if isinstance(py, dict) and isinstance(js, dict):
        assert py.keys() == js.keys(), f"{label}: clés différentes"
        for key in py:
            compare_value(f"{label}.{key}", py[key], js[key], tolerance)
    elif isinstance(py, list) and isinstance(js, list):
        assert len(py) == len(js), f"{label}: longueurs différentes"
        for index, (a, b) in enumerate(zip(py, js)):
            compare_value(f"{label}[{index}]", a, b, tolerance)
    elif py is None or js is None:
        assert py is js, f"{label}: Python={py}, JavaScript={js}"
    elif isinstance(py, (int, float)) and isinstance(js, (int, float)):
        assert math.isclose(py, js, rel_tol=tolerance, abs_tol=tolerance), f"{label}: Python={py}, JavaScript={js}"
    else:
        assert py == js, f"{label}: Python={py}, JavaScript={js}"


def main():
    path = pathlib.Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else DEFAULT
    raw = path.read_bytes()
    dataset = json.loads(raw)
    offers = dataset.get("offres")
    if not isinstance(offers, list):
        raise SystemExit("Échec : le JSON ne contient pas de liste 'offres'.")
    if path == DEFAULT.resolve():
        blob_sha = hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest()
        assert blob_sha == SNAPSHOT_GIT_BLOB_SHA1, f"Snapshot modifié : {blob_sha}"
        assert len(offers) == 3181, f"Nombre d'offres snapshot inattendu : {len(offers)}"
    chi = chi_analysis(offers)
    cor = correlation_analysis(offers)
    anova = anova_analysis(offers)
    js_raw = subprocess.run(["node", "-e", NODE_CHECK, str(path)], cwd=ROOT, check=True, text=True, capture_output=True)
    frontend = json.loads(js_raw.stdout)
    # Comparaison des chiffres effectivement employés par assets/analyses.js.
    checks = [
        ("chiSquare.n", chi["n"], frontend["chiSquare"]["n"]),
        ("chiSquare.excluded", chi["excluded"], frontend["chiSquare"]["excluded"]),
        ("chiSquare.categories", chi["categories"], frontend["chiSquare"]["categories"]),
        ("chiSquare.missingContract", chi["missingContract"], frontend["chiSquare"]["missingContract"]),
        ("chiSquare.missingTelework", chi["missingTelework"], frontend["chiSquare"]["missingTelework"]),
        ("chiSquare.observed", chi["observed"], frontend["chiSquare"]["observed"]),
        ("chiSquare.expected", chi["expected"], frontend["chiSquare"]["expected"]),
        ("chiSquare.chi2", chi["chi2"], frontend["chiSquare"]["chi2"]),
        ("chiSquare.p", chi["p"], frontend["chiSquare"]["p"], 0),
        ("chiSquare.extremeSimulations", chi["extremeSimulations"], frontend["chiSquare"]["extremeSimulations"], 0),
        ("chiSquare.lowExpected", chi["lowExpected"], frontend["chiSquare"]["lowExpected"]),
        ("chiSquare.minimumExpected", min(min(row) for row in chi["expected"]), frontend["chiSquare"]["minimumExpected"]),
        ("chiSquare.cramersV", chi["cramersV"], frontend["chiSquare"]["cramersV"]),
        ("chiSquare.df", chi["df"], frontend["chiSquare"]["df"]),
        ("correlation.n", cor["n"], frontend["correlation"]["n"]),
        ("correlation.excluded", cor["excluded"], frontend["correlation"]["excluded"]),
        ("correlation.missingExperience", cor["missingExperience"], frontend["correlation"]["missingExperience"]),
        ("correlation.missingSalary", cor["missingSalary"], frontend["correlation"]["missingSalary"]),
        ("correlation.missingBoth", cor["missingBoth"], frontend["correlation"]["missingBoth"]),
        ("correlation.r", cor["r"], frontend["correlation"]["r"]),
        ("correlation.pearsonP", cor["pearsonP"], frontend["correlation"]["pearsonP"]),
        ("correlation.rho", cor["rho"], frontend["correlation"]["rho"]),
        ("correlation.spearmanP", cor["spearmanP"], frontend["correlation"]["spearmanP"]),
        ("regression.slope", cor["slope"], frontend["correlation"]["slope"]),
        ("regression.intercept", cor["intercept"], frontend["correlation"]["intercept"]),
        ("regression.standardError", cor["standardError"], frontend["correlation"]["standardError"]),
        ("regression.coefficientP", cor["coefficientP"], frontend["correlation"]["coefficientP"]),
        ("regression.rSquared", cor["rSquared"], frontend["correlation"]["rSquared"]),
        ("anova.n", anova["n"], frontend["anova"]["n"]),
        ("anova.excluded", anova["excluded"], frontend["anova"]["excluded"]),
        ("anova.salaryMissing", anova["salaryMissing"], frontend["anova"]["salaryMissing"]),
        ("anova.excludedSmallGroups", anova["excludedSmallGroups"], frontend["anova"]["excludedSmallGroups"]),
        ("anova.missingLevel", anova["missingLevel"], frontend["anova"]["missingLevel"]),
        ("anova.levene.f", anova["levene"]["f"], frontend["anova"]["levene"]["f"]),
        ("anova.levene.p", anova["levene"]["p"], frontend["anova"]["levene"]["p"]),
        ("anova.method", anova["selected"]["method"], frontend["anova"]["selected"]["method"]),
        ("anova.selected.df1", anova["selected"]["df1"], frontend["anova"]["selected"]["df1"]),
        ("anova.selected.df2", anova["selected"]["df2"], frontend["anova"]["selected"]["df2"]),
        ("anova.posthocMethod", anova["posthocMethod"], frontend["anova"]["posthocMethod"]),
        ("anova.selected.f", anova["selected"]["f"], frontend["anova"]["selected"]["f"]),
        ("anova.selected.p", anova["selected"]["p"], frontend["anova"]["selected"]["p"]),
        ("anova.selected.eta2", anova["selected"]["eta2"], frontend["anova"]["selected"]["eta2"]),
        ("anova.groups.N", [g["n"] for g in anova["groups"]], [g["n"] for g in frontend["anova"]["groups"]]),
        ("anova.groups.mean", [g["mean"] for g in anova["groups"]], [g["mean"] for g in frontend["anova"]["groups"]]),
        ("anova.posthoc", anova["significantComparisons"], frontend["anova"]["significantComparisons"]),
    ]
    for check in checks:
        compare_value(*check)

    if path == DEFAULT.resolve():
        assert sum(isinstance(o.get("smin"), (int, float)) and not isinstance(o.get("smin"), bool) for o in offers) == 891
        assert cor["n"] == 854
        assert chi["n"] == 3181
        assert anova["n"] == 891
        expected_rounded = {
            "chi2": (chi["chi2"], 3, 107.705),
            "cramersV": (chi["cramersV"], 3, 0.184),
            "pearsonR": (cor["r"], 3, 0.533),
            "spearmanRho": (cor["rho"], 3, 0.555),
            "regressionSlope": (cor["slope"], 2, 3674.12),
            "rSquared": (cor["rSquared"], 4, 0.2842),
            "welchF": (anova["selected"]["f"], 3, 68.067),
            "eta2": (anova["selected"]["eta2"], 3, 0.296),
        }
        for label, (value, digits, expected_value) in expected_rounded.items():
            assert round(value, digits) == expected_value, f"Valeur de référence incohérente : {label}={value}"
    print(f"Vérification réussie · {len(offers):,} offres · moteur JavaScript comparé indépendamment au calcul Python.".replace(",", " "))
    actual_blob_hash = hashlib.sha1(b"blob " + str(len(raw)).encode() + bytes([0]) + raw).hexdigest()
    print(f"Snapshot hash Git : {actual_blob_hash}")
    print("χ² contrat × mention télétravail")
    print(f"  N={chi['n']} ; χ²({chi['df']})={chi['chi2']:.6f} ; p_MC={chi['p']:.6f} ; V={chi['cramersV']:.6f} ; attendus <5={chi['lowExpected']} ; Monte-Carlo={chi['simulations']} simulations, dépassements={chi['extremeSimulations']} ± SE {chi['mcSe']:.6f}")
    print("  Catégories, effectifs observés [sans mention, mention] et théoriques : " + "; ".join(f"{k}: O={v}, E={[round(x, 3) for x in e]}" for k, v, e in zip(chi['categories'], chi['observed'], chi['expected'])))
    print("Corrélation expérience × smin")
    print(f"  N={cor['n']} ; manquants exp={cor['missingExperience']}, salaire={cor['missingSalary']}, deux={cor['missingBoth']} ; Pearson r={cor['r']:.6f}, p={cor['pearsonP']:.6g} ; Spearman rho={cor['rho']:.6f}, p={cor['spearmanP']:.6g}")
    print(f"  Plages : expérience {cor['xMin']}–{cor['xMax']} ans ; smin {cor['yMin']}–{cor['yMax']} € ; valeurs extrêmes Tukey expérience={cor['expOutliers']['low']+cor['expOutliers']['high']}, salaire={cor['salaryOutliers']['low']+cor['salaryOutliers']['high']} (conservées)")
    print("Régression simple smin ~ expérience")
    print(f"  N={cor['n']} ; intercept={cor['intercept']:.3f} € ; pente={cor['slope']:.3f} €/an ; SE={cor['standardError']:.3f} ; p={cor['coefficientP']:.6g} ; R²={cor['rSquared']:.6f}")
    print("ANOVA niveau inféré × smin")
    print(f"  N={anova['n']} ; manquants smin={anova['salaryMissing']} ; Levene médian F({anova['levene']['df1']},{anova['levene']['df2']})={anova['levene']['f']:.6f}, p={anova['levene']['p']:.6g}")
    print(f"  {anova['selected']['method']} F({anova['selected']['df1']},{anova['selected']['df2']:.3f})={anova['selected']['f']:.6f}, p={anova['selected']['p']:.6g}, eta²={anova['selected']['eta2']:.6f}")
    print("  Groupes : " + "; ".join(f"{g['key']} n={g['n']} moyenne={g['mean']:.2f} € ET={math.sqrt(g['variance']):.2f} €" for g in anova["groups"]))
    print(f"  Valeurs Tukey extrêmes retenues : {anova['outliers']['low']+anova['outliers']['high']}")
    print("  Paires significatives après Holm : " + ("; ".join(f"{p['a']}–{p['b']} différence={p['difference']:.2f} €, p-ajustée={p['pHolm']:.6g}" for p in anova["significantComparisons"]) or "aucune"))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"Échec de vérification : {exc}", file=sys.stderr)
        raise
