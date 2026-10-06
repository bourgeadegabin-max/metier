/* Analyses inférentielles calculées à partir de la sélection courante.
   Fonctions statistiques sans dépendance externe, également importables par Node
   pour les contrôles indépendants de scripts/analyser_statistiques.py. */
(function (root) {
  "use strict";

  const MONTE_CARLO_DRAWS = 10000;
  const MONTE_CARLO_SEED = 184729;
  const LEVELS = ["assistant", "charge", "responsable", "directeur", "autre"];
  const LEVEL_LABELS = { assistant: "Assistant·e / junior", charge: "Chargé·e", responsable: "Responsable", directeur: "Directeur·rice", autre: "Autre" };
  const CONTRACT_LABELS = { cdi: "CDI", cdd: "CDD", alt: "Alternance", mis: "Intérim", indep: "Indépendant", autre: "Autre" };
  const finite = value => typeof value === "number" && Number.isFinite(value);
  const average = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  const variance = values => values.length > 1 ? values.reduce((s, v) => s + (v - average(values)) ** 2, 0) / (values.length - 1) : null;
  const median = values => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b), m = (sorted.length - 1) / 2, lo = Math.floor(m);
    return sorted[lo] + (sorted[Math.ceil(m)] - sorted[lo]) * (m - lo);
  };

  function betaFraction(a, b, x) {
    const maxIterations = 250, epsilon = 3e-14, tiny = 1e-300;
    const qab = a + b, qap = a + 1, qam = a - 1;
    let c = 1, d = 1 - qab * x / qap;
    if (Math.abs(d) < tiny) d = tiny;
    d = 1 / d;
    let h = d;
    for (let m = 1; m <= maxIterations; m++) {
      const m2 = 2 * m;
      let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < tiny) d = tiny;
      c = 1 + aa / c; if (Math.abs(c) < tiny) c = tiny;
      d = 1 / d; h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d; if (Math.abs(d) < tiny) d = tiny;
      c = 1 + aa / c; if (Math.abs(c) < tiny) c = tiny;
      d = 1 / d;
      const delta = d * c; h *= delta;
      if (Math.abs(delta - 1) < epsilon) break;
    }
    return h;
  }

  function regularizedBeta(x, a, b) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    const logBt = (a * Math.log(x) + b * Math.log1p(-x)) -
      (lgamma(a) + lgamma(b) - lgamma(a + b));
    const bt = Math.exp(logBt);
    return x < (a + 1) / (a + b + 2)
      ? bt * betaFraction(a, b, x) / a
      : 1 - bt * betaFraction(b, a, 1 - x) / b;
  }

  // Lanczos approximation, g=7; accuracy is ample for displayed inferential results.
  function lgamma(z) {
    const p = [0.99999999999980993, 676.5203681218851, -1259.1392167224028,
      771.32342877765313, -176.61502916214059, 12.507343278686905,
      -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    if (z < 0.5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * z)) - lgamma(1 - z);
    z -= 1;
    let x = p[0];
    for (let i = 1; i < p.length; i++) x += p[i] / (z + i);
    const t = z + 7.5;
    return 0.9189385332046727 + (z + 0.5) * Math.log(t) - t + Math.log(x);
  }

  function pStudentTwoSided(t, df) {
    if (!(df > 0) || !finite(t)) return null;
    return regularizedBeta(df / (df + t * t), df / 2, 0.5);
  }
  function pFUpper(f, df1, df2) {
    if (!(df1 > 0 && df2 > 0) || !finite(f) || f < 0) return null;
    return regularizedBeta(df2 / (df2 + df1 * f), df2 / 2, df1 / 2);
  }

  function rank(values) {
    const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
    const result = Array(values.length);
    for (let start = 0; start < order.length;) {
      let end = start + 1;
      while (end < order.length && order[end].value === order[start].value) end++;
      const averageRank = ((start + 1) + end) / 2;
      for (let j = start; j < end; j++) result[order[j].index] = averageRank;
      start = end;
    }
    return result;
  }

  function pearson(x, y) {
    const mx = average(x), my = average(y);
    let cross = 0, xx = 0, yy = 0;
    for (let i = 0; i < x.length; i++) {
      const dx = x[i] - mx, dy = y[i] - my;
      cross += dx * dy; xx += dx * dx; yy += dy * dy;
    }
    return xx && yy ? cross / Math.sqrt(xx * yy) : null;
  }

  function quantile(values, q) {
    const a = [...values].sort((x, y) => x - y);
    if (!a.length) return null;
    const p = (a.length - 1) * q, lo = Math.floor(p);
    return a[lo] + (a[Math.ceil(p)] - a[lo]) * (p - lo);
  }
  function outlierCounts(values) {
    if (!values.length) return { low: 0, high: 0, lo: null, hi: null };
    const q1 = quantile(values, .25), q3 = quantile(values, .75), iqr = q3 - q1;
    const lo = q1 - 1.5 * iqr, hi = q3 + 1.5 * iqr;
    return { low: values.filter(v => v < lo).length, high: values.filter(v => v > hi).length, lo, hi };
  }

  function familyFallback(offer) {
    const contract = offer.contrat || "", nature = offer.nature || "";
    if (offer.alternance || nature === "apprentissage" || nature === "professionnalisation") return "alt";
    if (contract === "MIS") return "mis";
    if (["LIB", "FRA", "CCE"].includes(contract) || nature === "non_salarie") return "indep";
    if (contract === "CDI") return "cdi";
    if (contract === "CDD") return "cdd";
    return "autre";
  }

  function seeded(seed) {
    let state = seed % 2147483647;
    if (state <= 0) state += 2147483646;
    return () => ((state = state * 16807 % 2147483647) - 1) / 2147483646;
  }

  function sampleFixedMarginRows(rowTotals, sampledCount, total, random) {
    // Floyd's algorithm draws a simple random subset in O(k), where k is the
    // smaller column margin. This is the same conditional multivariate
    // hypergeometric null as sequential hypergeometric draws, but fast enough
    // to rerun when a user changes a filter.
    const chosen = new Set();
    for (let j = total - sampledCount; j < total; j++) {
      const candidate = Math.floor(random() * (j + 1));
      chosen.add(chosen.has(candidate) ? j : candidate);
    }
    const sampledByRow = Array(rowTotals.length).fill(0);
    const boundaries = [];
    let cumulative = 0;
    rowTotals.forEach(size => { cumulative += size; boundaries.push(cumulative); });
    for (const position of chosen) {
      let row = 0;
      while (position >= boundaries[row]) row++;
      sampledByRow[row]++;
    }
    return sampledByRow;
  }

  function chiSquareAnalysis(offers, familyOf) {
    const rows = new Map();
    let missingContract = 0, missingTelework = 0;
    for (const offer of offers) {
      const family = familyOf(offer), telework = offer.teletravail;
      if (family == null || family === "") { missingContract++; continue; }
      if (typeof telework !== "boolean") { missingTelework++; continue; }
      if (!rows.has(family)) rows.set(family, [0, 0]);
      rows.get(family)[telework ? 1 : 0]++;
    }
    const categories = [...rows.keys()].sort((a, b) => Object.keys(CONTRACT_LABELS).indexOf(a) - Object.keys(CONTRACT_LABELS).indexOf(b));
    const observed = categories.map(key => rows.get(key));
    const rowTotals = observed.map(row => row[0] + row[1]);
    const colTotals = [0, 0];
    observed.forEach(row => { colTotals[0] += row[0]; colTotals[1] += row[1]; });
    const n = colTotals[0] + colTotals[1], expected = observed.map((_, i) => [0, 1].map(j => rowTotals[i] * colTotals[j] / n));
    const chi2 = expected.length ? observed.reduce((sum, row, i) => sum + row.reduce((s, value, j) => s + (expected[i][j] ? (value - expected[i][j]) ** 2 / expected[i][j] : 0), 0), 0) : null;
    const df = Math.max(0, (categories.length - 1));
    const lowExpected = expected.flat().filter(value => value < 5).length;
    const minimumExpected = expected.flat().length ? Math.min(...expected.flat()) : null;
    const useMonteCarlo = lowExpected > 0 && n > 0 && categories.length > 1;
    let p = useMonteCarlo ? 0 : (df > 0 ? pFUpper(chi2 / df, df, Infinity) : null);
    // For the regular Pearson chi-square tail, use the gamma-Q identity via beta limit.
    if (!useMonteCarlo && df > 0) p = gammaQ(df / 2, chi2 / 2);
    let simulations = 0, mcSe = null, extremeSimulations = null;
    if (useMonteCarlo) {
      const random = seeded(MONTE_CARLO_SEED), draws = MONTE_CARLO_DRAWS;
      let extreme = 0;
      for (let b = 0; b < draws; b++) {
        const sampleAbsence = colTotals[0] < colTotals[1];
        const sampled = sampleFixedMarginRows(rowTotals, Math.min(...colTotals), n, random);
        let simulatedChi = 0;
        for (let i = 0; i < categories.length; i++) {
          const no = sampleAbsence ? sampled[i] : rowTotals[i] - sampled[i];
          const yes = rowTotals[i] - no;
          simulatedChi += expected[i][0] ? (no - expected[i][0]) ** 2 / expected[i][0] : 0;
          simulatedChi += expected[i][1] ? (yes - expected[i][1]) ** 2 / expected[i][1] : 0;
        }
        if (simulatedChi >= chi2 - 1e-12) extreme++;
      }
      p = (extreme + 1) / (draws + 1); simulations = draws; extremeSimulations = extreme; mcSe = Math.sqrt(p * (1 - p) / (draws + 1));
    }
    return { n, excluded: offers.length - n, missingContract, missingTelework, categories, labels: categories.map(k => CONTRACT_LABELS[k] || k), observed, expected, rowTotals, colTotals, chi2, df, p, lowExpected, minimumExpected, test: useMonteCarlo ? "χ² de Pearson avec p-value Monte-Carlo conditionnelle (marges fixes)" : "χ² de Pearson asymptotique", simulations, extremeSimulations, mcSe, cramersV: n && categories.length > 1 ? Math.sqrt(chi2 / (n * Math.min(categories.length - 1, 1))) : null };
  }

  function gammaQ(a, x) {
    if (x <= 0) return 1;
    const maxIterations = 10000, epsilon = 1e-14, tiny = 1e-300;
    if (x < a + 1) {
      let sum = 1 / a, term = sum, ap = a;
      for (let i = 0; i < maxIterations; i++) { ap++; term *= x / ap; sum += term; if (Math.abs(term) < Math.abs(sum) * epsilon) break; }
      return Math.max(0, Math.min(1, 1 - sum * Math.exp(-x + a * Math.log(x) - lgamma(a))));
    }
    let b = x + 1 - a, c = 1 / tiny, d = 1 / b, h = d;
    for (let i = 1; i <= maxIterations; i++) {
      const an = -i * (i - a); b += 2;
      d = an * d + b; if (Math.abs(d) < tiny) d = tiny;
      c = b + an / c; if (Math.abs(c) < tiny) c = tiny;
      d = 1 / d; const delta = d * c; h *= delta;
      if (Math.abs(delta - 1) < epsilon) break;
    }
    return Math.max(0, Math.min(1, Math.exp(-x + a * Math.log(x) - lgamma(a)) * h));
  }

  function correlationAnalysis(offers) {
    let missingExperience = 0, missingSalary = 0, missingBoth = 0;
    const pairs = [];
    for (const offer of offers) {
      const x = finite(offer.exp_ans), y = finite(offer.smin);
      if (!x) missingExperience++;
      if (!y) missingSalary++;
      if (!x && !y) missingBoth++;
      if (x && y) pairs.push({ x: offer.exp_ans, y: offer.smin });
    }
    const xs = pairs.map(p => p.x), ys = pairs.map(p => p.y), n = pairs.length;
    const r = n > 2 ? pearson(xs, ys) : null, t = r == null || Math.abs(r) >= 1 ? null : r * Math.sqrt((n - 2) / (1 - r * r));
    const pearsonP = t == null ? null : pStudentTwoSided(t, n - 2);
    const rho = n > 2 ? pearson(rank(xs), rank(ys)) : null;
    const rhoT = rho == null || Math.abs(rho) >= 1 ? null : rho * Math.sqrt((n - 2) / (1 - rho * rho));
    const spearmanP = rhoT == null ? null : pStudentTwoSided(rhoT, n - 2);
    const slope = n > 1 ? (r * Math.sqrt(xs.reduce((s, x) => s + (x - average(xs)) ** 2, 0)) * Math.sqrt(ys.reduce((s, y) => s + (y - average(ys)) ** 2, 0))) / xs.reduce((s, x) => s + (x - average(xs)) ** 2, 0) : null;
    const intercept = slope == null ? null : average(ys) - slope * average(xs);
    const residuals = pairs.map(p => p.y - (intercept + slope * p.x));
    const sse = residuals.reduce((s, v) => s + v * v, 0), sxx = xs.reduce((s, x) => s + (x - average(xs)) ** 2, 0);
    let hc3Numerator = 0;
    pairs.forEach((pair, i) => {
      const dx = xs[i] - average(xs), leverage = 1 / n + dx * dx / sxx;
      hc3Numerator += dx * dx * residuals[i] * residuals[i] / ((1 - leverage) ** 2);
    });
    const se = n > 2 && sxx ? Math.sqrt(hc3Numerator) / sxx : null;
    const regT = se ? slope / se : null;
    const expOutliers = outlierCounts(xs), salaryOutliers = outlierCounts(ys);
    return { n, excluded: offers.length - n, missingExperience, missingSalary, missingBoth, r, pearsonP, rho, spearmanP,
      slope, intercept, standardError: se, coefficientP: regT == null ? null : pStudentTwoSided(regT, n - 2), rSquared: r == null ? null : r * r,
      xMin: n ? Math.min(...xs) : null, xMax: n ? Math.max(...xs) : null, yMin: n ? Math.min(...ys) : null, yMax: n ? Math.max(...ys) : null,
      expOutliers, salaryOutliers, points: pairs };
  }

  function oneWayF(groups) {
    const all = groups.flatMap(g => g.values), n = all.length, k = groups.length, overall = average(all);
    const between = groups.reduce((s, g) => s + g.values.length * (average(g.values) - overall) ** 2, 0);
    const within = groups.reduce((s, g) => s + g.values.reduce((t, v) => t + (v - average(g.values)) ** 2, 0), 0);
    const df1 = k - 1, df2 = n - k, f = (between / df1) / (within / df2);
    return { f, df1, df2, p: pFUpper(f, df1, df2), between, within, total: between + within, eta2: between / (between + within) };
  }

  function leveneMedian(groups) {
    const transformed = groups.map(g => ({ key: g.key, values: g.values.map(v => Math.abs(v - median(g.values))) }));
    return oneWayF(transformed);
  }

  function welchAnova(groups) {
    const k = groups.length, weights = groups.map(g => g.values.length / variance(g.values));
    const weightSum = weights.reduce((a, b) => a + b, 0);
    const weightedMean = groups.reduce((s, g, i) => s + weights[i] * average(g.values), 0) / weightSum;
    const numerator = groups.reduce((s, g, i) => s + weights[i] * (average(g.values) - weightedMean) ** 2, 0) / (k - 1);
    const sumTerm = groups.reduce((s, g, i) => s + (1 - weights[i] / weightSum) ** 2 / (g.values.length - 1), 0);
    const correction = 1 + (2 * (k - 2) / (k * k - 1)) * sumTerm;
    const df2 = (k * k - 1) / (3 * sumTerm), f = numerator / correction;
    const classical = oneWayF(groups);
    return { f, df1: k - 1, df2, p: pFUpper(f, k - 1, df2), eta2: classical.eta2, classicalEta2: classical.eta2 };
  }

  function welchPair(a, b) {
    const va = variance(a.values), vb = variance(b.values), na = a.values.length, nb = b.values.length;
    const se2 = va / na + vb / nb, df = se2 * se2 / ((va / na) ** 2 / (na - 1) + (vb / nb) ** 2 / (nb - 1));
    const t = (average(a.values) - average(b.values)) / Math.sqrt(se2);
    return { a: a.key, b: b.key, difference: average(a.values) - average(b.values), t, df, p: pStudentTwoSided(t, df) };
  }

  function pooledPair(a, b) {
    const va = variance(a.values), vb = variance(b.values), na = a.values.length, nb = b.values.length;
    const df = na + nb - 2, pooled = ((na - 1) * va + (nb - 1) * vb) / df;
    const t = (average(a.values) - average(b.values)) / Math.sqrt(pooled * (1 / na + 1 / nb));
    return { a: a.key, b: b.key, difference: average(a.values) - average(b.values), t, df, p: pStudentTwoSided(t, df) };
  }

  function holm(pairs) {
    const sorted = [...pairs].sort((a, b) => a.p - b.p);
    let previous = 0;
    sorted.forEach((pair, i) => { pair.pHolm = Math.min(1, Math.max(previous, (sorted.length - i) * pair.p)); previous = pair.pHolm; });
    return pairs;
  }

  function anovaAnalysis(offers) {
    const candidates = LEVELS.map(key => ({ key, values: offers.filter(o => o.niveau === key && finite(o.smin)).map(o => o.smin) }));
    const excludedSmallGroups = candidates.filter(g => g.values.length === 1).reduce((sum, g) => sum + g.values.length, 0);
    const groups = candidates.filter(g => g.values.length >= 2);
    const salaryMissing = offers.filter(o => !finite(o.smin)).length;
    const missingLevel = offers.filter(o => !LEVELS.includes(o.niveau)).length;
    if (groups.length < 2) return { n: groups.reduce((s, g) => s + g.values.length, 0), excluded: offers.length - groups.reduce((s, g) => s + g.values.length, 0), salaryMissing, missingLevel, excludedSmallGroups, groups, status: "Pas assez de groupes avec au moins deux salaires numériques." };
    if (groups.some(g => !(variance(g.values) > 0))) return { n: groups.reduce((s, g) => s + g.values.length, 0), excluded: offers.length - groups.reduce((s, g) => s + g.values.length, 0), salaryMissing, missingLevel, excludedSmallGroups, groups, status: "Test non calculable : au moins un groupe a une variance salariale nulle." };
    const levene = leveneMedian(groups), classic = oneWayF(groups), equalVariance = levene.p >= .05;
    const chosen = equalVariance ? { ...classic, method: "ANOVA classique" } : { ...welchAnova(groups), method: "ANOVA de Welch" };
    let comparisons = [];
    const posthocMethod = chosen.method === "ANOVA de Welch" ? "Tests t de Welch par paires + correction de Holm" : "Tests t à variance poolée par paires + correction de Holm";
    if (chosen.p < .05) {
      const pairTest = chosen.method === "ANOVA de Welch" ? welchPair : pooledPair;
      for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) comparisons.push(pairTest(groups[i], groups[j]));
      holm(comparisons);
    }
    const all = groups.flatMap(g => g.values), outliers = outlierCounts(all);
    return { n: all.length, excluded: offers.length - all.length, salaryMissing, missingLevel, excludedSmallGroups,
      groups: groups.map(g => ({ key: g.key, label: LEVEL_LABELS[g.key], n: g.values.length, mean: average(g.values), variance: variance(g.values) })),
      levene: { f: levene.f, df1: levene.df1, df2: levene.df2, p: levene.p },
      selected: chosen, classic, equalVariance, posthocMethod, comparisons, significantComparisons: comparisons.filter(p => p.pHolm < .05), outliers };
  }

  function compute(offers, familyOf = familyFallback) {
    return { n: offers.length, chiSquare: chiSquareAnalysis(offers, familyOf), correlation: correlationAnalysis(offers), anova: anovaAnalysis(offers) };
  }

  function fmt(value, digits = 3) {
    if (value == null || !Number.isFinite(value)) return "non calculable";
    if (value < .001 && value >= 0) return "< 0,001";
    return value.toLocaleString("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }
  function fmtP(value) { return value == null ? "non calculable" : value < .001 ? "< 0,001" : value.toLocaleString("fr-FR", { minimumFractionDigits: 4, maximumFractionDigits: 4 }); }
  function fmtEuro(value) { return value == null || !Number.isFinite(value) ? "—" : `${Math.round(value).toLocaleString("fr-FR")} €`; }
  function labelEffect(value, kind) {
    const n = Math.abs(value || 0);
    if (kind === "V") return n < .1 ? "faible" : n < .3 ? "modérée" : n < .5 ? "marquée" : "forte";
    if (kind === "r") return n < .1 ? "très faible" : n < .3 ? "faible" : n < .5 ? "modérée" : "forte";
    return n < .01 ? "très faible" : n < .06 ? "faible" : n < .14 ? "modérée" : "forte";
  }

  function setFacts(id, entries) {
    const list = document.getElementById(id); if (!list) return;
    list.replaceChildren();
    for (const [term, value] of entries) {
      const dt = document.createElement("dt"), dd = document.createElement("dd");
      dt.textContent = term; dd.textContent = value; list.append(dt, dd);
    }
  }
  function makeTable(headers, rows) {
    const table = document.createElement("table"), thead = document.createElement("thead"), hr = document.createElement("tr"), tbody = document.createElement("tbody");
    for (const header of headers) { const th = document.createElement("th"); th.scope = "col"; th.textContent = header; hr.append(th); }
    thead.append(hr);
    for (const row of rows) { const tr = document.createElement("tr"); for (const value of row) { const td = document.createElement("td"); td.textContent = String(value); tr.append(td); } tbody.append(tr); }
    table.append(thead, tbody); table.className = "analysis-table"; return table;
  }
  function renderChi(result) {
    if (result.n === 0 || result.categories.length < 2 || result.colTotals.some(total => total === 0)) {
      setFacts("chi-facts", [["QUESTION", "La mention du terme « télétravail » est-elle associée à la famille de contrat ?"], ["H0", "La mention du terme « télétravail » ne dépend pas de la famille de contrat."], ["H1", "La mention du terme « télétravail » est associée à la famille de contrat."], ["TEST", "χ² non calculable sur cette sélection"], ["N", `N = ${result.n} · ${result.excluded} offre(s) exclue(s) pour valeurs manquantes`], ["RÉSULTAT", "Il faut au moins deux familles et deux modalités observées."], ["p-value", "non calculable"], ["TAILLE D’EFFET", "non calculable"], ["INTERPRÉTATION", "Élargissez les filtres pour disposer de catégories comparables."], ["LIMITES", "Cette variable détecte uniquement une mention textuelle du terme « télétravail » ; elle n’indique pas une autorisation réelle."]]);
      const host = document.getElementById("chi-table"); if (host) host.replaceChildren();
      return;
    }
    const significant = result.p < .05;
    const effect = `V de Cramer = ${fmt(result.cramersV)} (${labelEffect(result.cramersV, "V")} ; repère conventionnel)`;
    const pReport = result.simulations
      ? `p_MC estimée ≈ ${result.p.toLocaleString("fr-FR", { minimumFractionDigits: 6, maximumFractionDigits: 6 })} · ${result.extremeSimulations} / ${result.simulations.toLocaleString("fr-FR")} tables simulées aussi extrêmes ; résolution minimale 1/${(result.simulations + 1).toLocaleString("fr-FR")} ; erreur-type MC ≈ ${fmt(result.mcSe)}`
      : fmtP(result.p);
    setFacts("chi-facts", [["QUESTION", "La mention du terme « télétravail » est-elle associée à la famille de contrat ?"], ["H0", "La mention du terme « télétravail » ne dépend pas de la famille de contrat."], ["H1", "La mention du terme « télétravail » est associée à la famille de contrat."], ["TEST", result.test], ["N", `N = ${result.n} · exclus : ${result.excluded} (famille manquante : ${result.missingContract} ; indicateur non renseigné : ${result.missingTelework})`], ["CATÉGORIES", result.labels.join(", ")], ["CONDITIONS", `${result.lowExpected} cellule(s) théorique(s) sur ${result.expected.flat().length} ont un effectif < 5 ; minimum attendu = ${fmt(result.minimumExpected, 2)}. La condition d’approximation asymptotique n’est pas respectée.`], ["RÉSULTAT", `χ²(${result.df}) = ${fmt(result.chi2)} · ${significant ? "significatif" : "non significatif"} à 5 %`], ["p-value", pReport], ["TAILLE D’EFFET", effect], ["INTERPRÉTATION", significant ? `Association statistique détectée entre famille de contrat et mention du terme « télétravail » ; taille ${labelEffect(result.cramersV, "V")} selon un repère conventionnel.` : "Les données ne permettent pas de rejeter H0 au seuil de 5 %. Cela ne prouve pas l’absence d’association."], ["LIMITES", "teletravail est un indicateur de présence du terme dans le texte, pas une autorisation réelle. La p-value Monte-Carlo est une estimation simulée à résolution limitée ; V de Cramer décrit l’intensité, pas l’importance pratique."]]);
    const host = document.getElementById("chi-table"); if (!host) return; host.replaceChildren();
    host.append(makeTable(["Famille", "Sans mention — observé", "Sans mention — théorique", "Mention — observé", "Mention — théorique"], result.labels.map((label, i) => [label, result.observed[i][0], fmt(result.expected[i][0], 1), result.observed[i][1], fmt(result.expected[i][1], 1)])));
  }
  function chartScatter(id, points, regression) {
    if (!root.Chart || !document.getElementById(id)) return;
    const ctx = document.getElementById(id).getContext("2d");
    const datasets = [{ label: "Offres utilisées", data: points.map(p => ({ x: p.x, y: p.y })), backgroundColor: "rgba(23,107,135,.46)", pointRadius: 3, pointHoverRadius: 5 }];
    if (regression && points.length) {
      const xs = points.map(p => p.x), low = Math.min(...xs), high = Math.max(...xs);
      datasets.push({ type: "line", label: "Droite des moindres carrés", data: [{ x: low, y: regression.intercept + regression.slope * low }, { x: high, y: regression.intercept + regression.slope * high }], borderColor: "#d66a2c", borderWidth: 2, pointRadius: 0, fill: false });
    }
    if (root.__analyseCharts && root.__analyseCharts[id]) {
      const chart = root.__analyseCharts[id]; chart.data.datasets = datasets; chart.update("none"); return;
    }
    root.__analyseCharts = root.__analyseCharts || {};
    root.__analyseCharts[id] = new root.Chart(ctx, { type: "scatter", data: { datasets }, options: { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { display: Boolean(regression), position: "bottom" }, tooltip: { callbacks: { label: c => `${fmt(c.parsed.x, 2)} an · ${fmtEuro(c.parsed.y)}` } } }, scales: { x: { title: { display: true, text: "Années d’expérience demandées" } }, y: { title: { display: true, text: "smin annualisé (brut/an)" }, ticks: { callback: v => `${Math.round(v / 1000)} k€` } } } } });
  }
  function renderCorrelation(result) {
    if (result.n < 3) {
      setFacts("corr-facts", [["QUESTION", "L’expérience demandée est-elle associée au minimum salarial annualisé (smin) ?"], ["H0", "Aucune association entre expérience et smin."], ["H1", "Il existe une association."], ["TEST", "Pearson et Spearman non calculables"], ["N", "N = " + result.n + " paire(s) · " + result.excluded + " offre(s) exclue(s) pour valeurs manquantes"], ["RÉSULTAT", "Au moins trois paires complètes sont requises."], ["p-value", "non calculable"], ["TAILLE D’EFFET", "non calculable"], ["INTERPRÉTATION", "Élargissez les filtres pour disposer de paires complètes."], ["LIMITES", "smin est un minimum salarial annualisé extrait de l’annonce ; corrélation ≠ causalité."]]);
      chartScatter("chart-correlation", [], null);
      return;
    }
    const sigP = result.pearsonP < .05, sign = result.r >= 0 ? "positif" : "négatif";
    const sampleLine = "N = " + result.n + " paires complètes · exclues : " + result.excluded + " (expérience manquante : " + result.missingExperience + "; smin manquant : " + result.missingSalary + "; les deux : " + result.missingBoth + ")";
    setFacts("corr-facts", [
      ["QUESTION", "L’expérience demandée est-elle associée au minimum salarial annualisé (smin) ?"],
      ["H0", "Aucune association linéaire entre expérience et smin."], ["H1", "Il existe une association linéaire."],
      ["TEST", "Corrélation de Pearson ; Spearman en contrôle de robustesse"], ["N", sampleLine],
      ["RÉSULTAT", `Pearson r = ${fmt(result.r)} · ${sigP ? "significatif" : "non significatif"} à 5 %`],
      ["p-value", fmtP(result.pearsonP)], ["TAILLE D’EFFET", `|r| = ${fmt(Math.abs(result.r))} · lien ${labelEffect(result.r, "r")}`],
      ["ROBUSTESSE", `Spearman ρ = ${fmt(result.rho)} · p = ${fmtP(result.spearmanP)} (approximation t bilatérale)`],
      ["INTERPRÉTATION", `Association ${sign} ${labelEffect(result.r, "r")} entre expérience demandée et smin ; corrélation ≠ causalité.`],
      ["LIMITES", `smin est une borne basse annualisée issue du libellé, pas une rémunération observée. Plages : ${result.xMin}–${result.xMax} ans et ${fmtEuro(result.yMin)}–${fmtEuro(result.yMax)} ; ${result.expOutliers.low + result.expOutliers.high} valeur(s) d’expérience et ${result.salaryOutliers.low + result.salaryOutliers.high} valeur(s) de smin sont extrêmes selon Tukey et conservées.`]
    ]);
    chartScatter("chart-correlation", result.points, null);
  }
  function renderRegression(result) {
    if (result.n < 3) {
      setFacts("reg-facts", [["QUESTION", "Comment l’expérience demandée s’associe-t-elle au minimum salarial annualisé (smin) ?"], ["H0", "La pente b est nulle."], ["H1", "La pente b est différente de zéro."], ["TEST", "Régression linéaire non calculable"], ["N", `${result.n} paire(s) · ${result.excluded} offre(s) exclue(s) pour valeurs manquantes`], ["RÉSULTAT", "Au moins trois paires complètes sont requises."], ["p-value", "non calculable"], ["TAILLE D’EFFET", "non calculable"], ["INTERPRÉTATION", "Élargissez les filtres pour disposer de paires complètes."], ["LIMITES", "smin est une borne annualisée d’annonce ; une pente ne démontre pas de causalité."]]);
      chartScatter("chart-regression", [], null);
      return;
    }
    const sig = result.coefficientP < .05;
    setFacts("reg-facts", [["QUESTION", "Comment l’expérience demandée s’associe-t-elle au minimum salarial annualisé (smin) ?"], ["H0", "Le coefficient de pente b est nul."], ["H1", "Le coefficient de pente b est différent de zéro."], ["TEST", "Régression linéaire simple ; erreur-type robuste HC3"], ["N", `N = ${result.n} paires complètes · exclues : ${result.excluded} (expérience manquante : ${result.missingExperience} ; smin manquant : ${result.missingSalary} ; les deux : ${result.missingBoth})`], ["RÉSULTAT", `smin = ${fmtEuro(result.intercept)} ${result.slope < 0 ? "−" : "+"} ${fmt(Math.abs(result.slope), 2)} € × années d’expérience`], ["COEFFICIENT b", `${fmt(result.slope, 2)} €/an supplémentaire`], ["ERREUR STANDARD", `${fmt(result.standardError, 2)} € (HC3)`], ["p-value", `${fmtP(result.coefficientP)} · ${sig ? "significatif" : "non significatif"} à 5 %`], ["TAILLE D’EFFET", `R² = ${fmt(result.rSquared, 4)} (${(100 * result.rSquared).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} % de variance de smin expliquée par la droite dans cet échantillon)`], ["INTERPRÉTATION", `Une année d’expérience supplémentaire demandée est associée à ${fmtEuro(Math.abs(result.slope))} ${result.slope >= 0 ? "de plus" : "de moins"} sur le minimum salarial annualisé (smin), en moyenne ; ce n’est pas un effet causal.`], ["LIMITES", "smin est une borne basse annualisée extraite de l’annonce, pas une rémunération observée. Les données source ont déjà appliqué une plage de plausibilité (4 000–250 000 €) ; les valeurs extrêmes restantes sont conservées."]]);
    chartScatter("chart-regression", result.points, result);
  }
  function renderAnova(result) {
    if (result.status) { setFacts("anova-facts", [["QUESTION", "Le niveau inféré à partir de l’intitulé est-il associé au minimum salarial annualisé (smin) ?"], ["H0", "Les moyennes de smin sont égales entre niveaux inférés."], ["H1", "Au moins une moyenne de smin diffère."], ["TEST", result.status], ["N", `${result.n} valeur(s) exploitable(s)`], ["RÉSULTAT", result.status], ["p-value", "non calculable"], ["TAILLE D’EFFET", "non calculable"], ["INTERPRÉTATION", "Élargissez les filtres pour obtenir plusieurs groupes comparables."], ["LIMITES", "Le niveau est inféré à partir de l’intitulé et le salaire est le minimum annualisé smin."]]); return; }
    const selected = result.selected, sig = selected.p < .05;
    const pairText = !sig ? "Aucun post-hoc : le test global n’est pas significatif." : result.significantComparisons.length ? `${result.posthocMethod} ; différences significatives : ` + result.significantComparisons.map(p => `${LEVEL_LABELS[p.a]} vs ${LEVEL_LABELS[p.b]} (différence ${fmtEuro(p.difference)}, p ajustée Holm = ${fmtP(p.pHolm)})`).join(" ; ") : `${result.posthocMethod} ; aucune paire ne reste significative après correction de Holm.`;
    const director = result.groups.find(g => g.key === "directeur");
    const directorNote = director ? `Le groupe Directeur·rice contient ${director.n} observations.` : "Le groupe Directeur·rice n’a pas assez de données pour être inclus.";
    setFacts("anova-facts", [["QUESTION", "Le niveau inféré à partir de l’intitulé est-il associé au minimum salarial annualisé (smin) ?"], ["H0", "Les moyennes de smin sont égales entre niveaux inférés."], ["H1", "Au moins une moyenne de smin diffère."], ["TEST", `${selected.method} · Levene médian : F(${fmt(result.levene.df1, 0)}, ${fmt(result.levene.df2, 1)}) = ${fmt(result.levene.f)}, p = ${fmtP(result.levene.p)} · variances ${result.equalVariance ? "non rejetées comme différentes" : "hétérogènes"}`], ["N", `N = ${result.n} minima salariaux annualisés répartis entre ${result.groups.length} niveaux inférés (${result.groups.map(g => g.label).join(", ")}) · exclus : ${result.excluded} (smin manquant : ${result.salaryMissing} ; niveau invalide : ${result.missingLevel} ; groupe avec un seul salaire : ${result.excludedSmallGroups})`], ["RÉSULTAT", `${selected.method} : F(${fmt(selected.df1, 0)}, ${fmt(selected.df2, 1)}) = ${fmt(selected.f)} · ${sig ? "significatif" : "non significatif"} à 5 %`], ["p-value", fmtP(selected.p)], ["TAILLE D’EFFET", `η² descriptif = ${fmt(selected.eta2)} (${labelEffect(selected.eta2, "eta2")})`], ["POST-HOC", pairText], ["GROUPES / LIMITES", `${directorNote} Aucune suppression d’extrêmes durant l’analyse ; règle de Tukey 1,5 IQR : ${result.outliers.low + result.outliers.high} smin extrême(s) conservé(s).`], ["INTERPRÉTATION", sig ? "Les moyennes de minimum salarial annualisé ne sont pas toutes égales selon le test global ; seules les paires indiquées restent significatives après correction de Holm." : "Les données ne permettent pas de rejeter l’égalité des moyennes au seuil de 5 %. Cela ne prouve pas leur égalité."], ["LIMITES", "Le niveau est inféré à partir de l’intitulé, pas fourni comme variable officielle. η² est descriptif ; Welch corrige les variances inégales mais pas les dépendances entre annonces ni toute asymétrie de smin."]]);
    const host = document.getElementById("anova-table"); if (!host) return; host.replaceChildren();
    const rows = result.groups.map(g => [g.label, g.n, fmtEuro(g.mean), fmt(Math.sqrt(g.variance), 1)]);
    host.append(makeTable(["Niveau inféré à partir de l’intitulé", "N", "Moyenne de smin", "Écart-type"], rows));
  }

  function render(offers, familyOf) {
    const results = compute(offers, familyOf);
    const base = document.getElementById("analysis-base");
    if (base) base.textContent = `${offers.length.toLocaleString("fr-FR")} offres après filtres globaux ; chaque analyse peut utiliser un sous-échantillon distinct selon ses variables disponibles.`;
    renderChi(results.chiSquare); renderCorrelation(results.correlation); renderRegression(results.correlation); renderAnova(results.anova);
    return results;
  }

  const api = { compute, chiSquareAnalysis, correlationAnalysis, anovaAnalysis, pStudentTwoSided, pFUpper, regularizedBeta, MONTE_CARLO_DRAWS, MONTE_CARLO_SEED };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.AnalysesStatistiques = Object.assign(root.AnalysesStatistiques || {}, api, { render });
})(typeof window !== "undefined" ? window : globalThis);
