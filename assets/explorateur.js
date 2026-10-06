/* Explorateur statique : les effectifs sont calculés depuis data/resume.json. */
(function () {
  "use strict";

  const EXPERIENCE_LABELS = [
    "Débutant accepté",
    "Moins d'un an",
    "1 à 2 ans",
    "3 à 4 ans",
    "5 ans et plus",
    "Durée non précisée / non convertible",
  ];
  const AGE_BINS = [
    { label: "0–6 jours", test: age => age >= 0 && age < 7 },
    { label: "7–29 jours", test: age => age >= 7 && age < 30 },
    { label: "30–59 jours", test: age => age >= 30 && age < 60 },
    { label: "60+ jours", test: age => age >= 60 },
  ];
  const MISSING_DEPARTMENT = "__missing_department__";
  const DAY_MS = 86400000;
  const LIVE_DATA_URL = "data/offres-france-travail.json";
  const $ = id => document.getElementById(id);
  const normalize = value => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr-FR");
  const missing = value => value == null || value === "";
  const formatNumber = value => Number(value).toLocaleString("fr-FR");
  const formatEuro = value => value == null || !Number.isFinite(value) ? "—" : `${Math.round(value).toLocaleString("fr-FR")} €`;
  const formatDays = value => value == null || !Number.isFinite(value) ? "—" : `${(Math.round(value * 10) / 10).toLocaleString("fr-FR")} jours`;
  const formatDate = value => {
    if (!value) return null;
    const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
    return Number.isNaN(date.getTime()) ? null : new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC" }).format(date);
  };

  function experienceCategory(offer) {
    if (typeof trancheExp !== "function") throw new Error("Le recodage d'expérience de assets/commun.js est indisponible.");
    const value = trancheExp(offer);
    return value === "Non précisé" ? EXPERIENCE_LABELS[5] : value;
  }

  function ageInDays(offer, snapshot) {
    const created = new Date(`${String(offer.date || "").slice(0, 10)}T00:00:00Z`);
    const reference = new Date(`${String(snapshot || "").slice(0, 10)}T00:00:00Z`);
    if (Number.isNaN(created.getTime()) || Number.isNaN(reference.getTime())) return null;
    const age = Math.floor((reference.getTime() - created.getTime()) / DAY_MS);
    return age >= 0 ? age : null;
  }

  function familyKey(offer) {
    if (typeof familleContrat !== "function") throw new Error("Le recodage des contrats de assets/commun.js est indisponible.");
    return familleContrat(offer);
  }

  function filterOffers(offers, filters) {
    const minSalary = filters.salaryMin === "" ? null : Number(filters.salaryMin);
    const maxSalary = filters.salaryMax === "" ? null : Number(filters.salaryMax);
    const salaryActive = minSalary != null || maxSalary != null;
    if (minSalary != null && maxSalary != null && minSalary > maxSalary) return [];
    return offers.filter(offer => {
      if (filters.rome && offer.rome !== filters.rome) return false;
      if (filters.family && familyKey(offer) !== filters.family) return false;
      if (filters.department) {
        const department = missing(offer.dep) ? MISSING_DEPARTMENT : String(offer.dep);
        if (department !== filters.department) return false;
      }
      if (filters.experience && experienceCategory(offer) !== filters.experience) return false;
      if (salaryActive) {
        if (offer.smin == null) {
          if (!filters.includeMissingSalary) return false;
        } else {
          if (minSalary != null && offer.smin < minSalary) return false;
          if (maxSalary != null && offer.smin > maxSalary) return false;
        }
      }
      return true;
    });
  }

  function sortOffers(offers, key, direction, metierLabels) {
    const sign = direction === "desc" ? -1 : 1;
    const getter = offer => {
      if (key === "family") return familyKey(offer);
      if (key === "experience") return experienceCategory(offer);
      if (key === "rome") return metierLabels.get(offer.rome) || offer.rome;
      if (key === "dep") return missing(offer.dep) ? null : String(offer.dep);
      if (key === "smin") return offer.smin;
      if (key === "date") return missing(offer.date) ? null : offer.date;
      const value = offer[key];
      return missing(value) ? null : value;
    };
    return [...offers].sort((a, b) => {
      const av = getter(a), bv = getter(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * sign;
      return String(av).localeCompare(String(bv), "fr", { numeric: true, sensitivity: "base" }) * sign;
    });
  }

  function salaryBins(offers) {
    const values = offers.map(offer => offer.smin).filter(value => Number.isFinite(value));
    if (!values.length) return { labels: [], counts: [], values };
    const upper = Math.max(110000, Math.ceil((Math.max(...values) + 1) / 10000) * 10000);
    const labels = [], counts = [];
    for (let low = 0; low < upper; low += 10000) {
      const high = low + 10000;
      labels.push(`${Math.round(low / 1000)}–${Math.round(high / 1000)} k€`);
      counts.push(values.filter(value => value >= low && value < high).length);
    }
    return { labels, counts, values };
  }

  function distributions(offers, data) {
    const count = values => values.reduce((result, value) => result.set(value, (result.get(value) || 0) + 1), new Map());
    const jobCounts = count(offers.map(offer => offer.rome));
    const jobs = (data.metiers || []).map(job => ({
      code: job.code,
      label: `${job.code} · ${job.libelle}`,
      count: jobCounts.get(job.code) || 0,
    })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "fr"));

    const contractKeys = (typeof CONTRATS !== "undefined" ? CONTRATS : []).map(([key, label]) => ({ key, label }));
    const contracts = contractKeys.map(item => ({
      ...item,
      count: offers.reduce((sum, offer) => sum + (familyKey(offer) === item.key ? 1 : 0), 0),
    }));

    const experience = EXPERIENCE_LABELS.map(label => ({
      label,
      count: offers.reduce((sum, offer) => sum + (experienceCategory(offer) === label ? 1 : 0), 0),
    }));
    const ages = offers.map(offer => ageInDays(offer, data.date)).filter(value => value != null);
    const ageCounts = AGE_BINS.map(bin => ({ label: bin.label, count: ages.filter(bin.test).length }));

    const depCounts = count(offers.filter(offer => !missing(offer.dep)).map(offer => String(offer.dep)));
    const departments = [...depCounts].map(([code, value]) => ({ code, label: code, count: value }))
      .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code, "fr", { numeric: true })).slice(0, 15);
    const missingDepartments = offers.filter(offer => missing(offer.dep)).length;
    if (missingDepartments) departments.push({ code: MISSING_DEPARTMENT, label: "Non renseigné", count: missingDepartments });

    const salary = salaryBins(offers);
    return { jobs, contracts, experience, ages, ageCounts, departments, salary, missingDepartments };
  }

  function currentFilters() {
    return {
      rome: $("filter-rome").value,
      family: $("filter-family").value,
      department: $("filter-department").value,
      experience: $("filter-experience").value,
      salaryMin: $("filter-salary-min").value.trim(),
      salaryMax: $("filter-salary-max").value.trim(),
      includeMissingSalary: $("include-missing-salary").checked,
    };
  }

  function addOption(select, value, label) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.append(option);
  }

  function addOptions(data) {
    const rome = $("filter-rome");
    [[rome, "Tous les métiers"], [$("filter-family"), "Toutes les familles"], [$("filter-department"), "Tous les départements"], [$("filter-experience"), "Toutes les catégories"]]
      .forEach(([select, label]) => select.replaceChildren(new Option(label, "")));
    [...(data.metiers || [])].sort((a, b) => a.libelle.localeCompare(b.libelle, "fr"))
      .forEach(job => addOption(rome, job.code, `${job.libelle} (${job.code})`));

    (typeof CONTRATS !== "undefined" ? CONTRATS : []).forEach(([key, label]) => addOption($("filter-family"), key, label));
    const departments = [...new Set(data.offres.map(offer => missing(offer.dep) ? MISSING_DEPARTMENT : String(offer.dep)))]
      .sort((a, b) => a === MISSING_DEPARTMENT ? 1 : b === MISSING_DEPARTMENT ? -1 : a.localeCompare(b, "fr", { numeric: true }));
    departments.forEach(code => addOption($("filter-department"), code, code === MISSING_DEPARTMENT ? "Non renseigné" : code));
    EXPERIENCE_LABELS.forEach(label => addOption($("filter-experience"), label, label));
  }

  function chartOptions(horizontal, labelFormatter, tooltipFormatter) {
    return {
      indexAxis: horizontal ? "y" : "x",
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      events: ["mousemove", "mouseout", "click", "touchstart", "touchmove"],
      onClick(event, elements, chart) {
        if (elements.length && typeof chart.$onChoose === "function") chart.$onChoose(elements[0].index);
      },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: tooltipFormatter } },
      },
      scales: {
        x: {
          beginAtZero: true,
          grid: { color: horizontal ? "#eef2f4" : "#e5ecef" },
          ticks: horizontal ? { precision: 0 } : { maxRotation: 0, autoSkip: true, maxTicksLimit: 7 },
        },
        y: {
          beginAtZero: true,
          grid: { display: false },
          ticks: { autoSkip: false, callback: labelFormatter },
        },
      },
    };
  }

  const charts = {};
  function createChart(id, labels, values, horizontal, labelFormatter, tooltipFormatter, onChoose, color = "#176b87") {
    const context = $(id).getContext("2d");
    const chart = new Chart(context, {
      type: "bar",
      data: { labels, datasets: [{ data: values, backgroundColor: color, borderRadius: 4, maxBarThickness: 22 }] },
      options: chartOptions(horizontal, labelFormatter, tooltipFormatter),
    });
    chart.$onChoose = onChoose;
    charts[id.replace(/^chart-/, "")] = chart;
    return chart;
  }

  function chartLabels(labels, limit = 26) {
    return typeof enLignes === "function" ? enLignes(String(labels), limit) : String(labels);
  }

  function tooltipCount(context, total) {
    const value = Number(context.raw) || 0;
    const percent = total ? (100 * value / total).toLocaleString("fr-FR", { maximumFractionDigits: 1 }) : "0";
    return `${formatNumber(value)} offre${value === 1 ? "" : "s"} (${percent} % de ${formatNumber(total)})`;
  }

  function updateChart(chart, labels, values, total, labelFormatter, onChoose) {
    chart.data.labels = labels;
    chart.data.datasets[0].data = values;
    chart.options.scales.y.ticks.callback = labelFormatter;
    chart.options.plugins.tooltip.callbacks.label = context => tooltipCount(context, total);
    chart.$onChoose = onChoose;
    chart.update("none");
  }

  function bootCharts() {
    const blank = () => {};
    createChart("chart-jobs", [], [], true, (value, index) => chartLabels(charts.jobs?.data.labels[index] ?? value, 30), context => tooltipCount(context, 0), blank);
    createChart("chart-contracts", [], [], true, (value, index) => chartLabels(charts.contracts?.data.labels[index] ?? value, 23), context => tooltipCount(context, 0), blank, "#4c9b92");
    charts.salaries = new Chart($("chart-salaries").getContext("2d"), {
      type: "bar", data: { labels: [], datasets: [{ data: [], backgroundColor: "#176b87", borderRadius: 3, maxBarThickness: 42 }] },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: context => `${formatNumber(context.raw)} offre${context.raw === 1 ? "" : "s"}` } } },
        scales: {
          x: { grid: { display: false }, ticks: { maxRotation: 35, minRotation: 0, autoSkip: true, maxTicksLimit: 9 } },
          y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: "#e5ecef" }, title: { display: true, text: "Nombre d'offres" } },
        },
      },
    });
    createChart("chart-experience", [], [], true, (value, index) => chartLabels(charts.experience?.data.labels[index] ?? value, 24), context => tooltipCount(context, 0), blank, "#cf8b3c");
    createChart("chart-age", [], [], true, (value, index) => chartLabels(charts.age?.data.labels[index] ?? value, 20), context => tooltipCount(context, 0), blank, "#4c9b92");
    createChart("chart-departments", [], [], true, (value, index) => chartLabels(charts.departments?.data.labels[index] ?? value, 22), context => tooltipCount(context, 0), blank, "#66889a");
  }

  let dataSet = null;
  let selectedMode = "historique";
  let filteredOffers = [];
  let page = 1;
  let pageSize = 25;
  let searchTerm = "";
  let sortKey = "date";
  let sortDirection = "desc";
  let visibleJobs = [];
  let visibleFamilies = [];
  let visibleExperiences = [];
  let visibleDepartments = [];
  const metierLabels = new Map();

  function chooseFromChart(values, index, id) {
    const value = values[index];
    if (value == null) return;
    const element = $(id);
    element.value = element.value === value ? "" : value;
    page = 1;
    refresh();
  }

  function renderKpis(offers, views) {
    const total = offers.length;
    $("kpi-offers").textContent = formatNumber(total);
    $("kpi-top-job").textContent = views.jobs.length && views.jobs[0].count ? metierLabels.get(views.jobs[0].code) || views.jobs[0].code : "—";
    const top = views.jobs[0];
    $("kpi-top-job-note").textContent = top && top.count ? `${formatNumber(top.count)} offre${top.count > 1 ? "s" : ""} · ${share(top.count, total)} de la sélection` : "Aucune offre dans cette sélection";

    const salaryValues = offers.map(offer => offer.smin).filter(value => Number.isFinite(value));
    const salaryMedian = salaryValues.length && typeof mediane === "function" ? mediane(salaryValues) : null;
    $("kpi-salary-median").textContent = salaryMedian == null ? "—" : formatEuro(salaryMedian);
    const salaryMissing = total - salaryValues.length;
    $("kpi-salary-note").textContent = `${formatNumber(salaryValues.length)} / ${formatNumber(total)} valeurs numériques (${share(salaryValues.length, total)}) · ${formatNumber(salaryMissing)} sans minimum numérique`;

    const ageMedian = views.ages.length && typeof mediane === "function" ? mediane(views.ages) : null;
    $("kpi-age-median").textContent = formatDays(ageMedian);
    $("kpi-age-note").textContent = `${formatNumber(views.ages.length)} / ${formatNumber(total)} dates exploitables`;
  }

  function share(value, total) {
    return `${total ? (100 * value / total).toLocaleString("fr-FR", { maximumFractionDigits: 1 }) : "0"} %`;
  }

  function renderCharts(offers, views) {
    visibleJobs = views.jobs.map(item => item.code);
    updateChart(charts.jobs,
      views.jobs.map(item => item.label), views.jobs.map(item => item.count), offers.length,
      (value, index) => chartLabels(views.jobs[index]?.label || value, 30),
      index => chooseFromChart(visibleJobs, index, "filter-rome"));

    visibleFamilies = views.contracts.map(item => item.key);
    updateChart(charts.contracts,
      views.contracts.map(item => item.label), views.contracts.map(item => item.count), offers.length,
      (value, index) => chartLabels(views.contracts[index]?.label || value, 23),
      index => chooseFromChart(visibleFamilies, index, "filter-family"));

    charts.salaries.data.labels = views.salary.labels;
    charts.salaries.data.datasets[0].data = views.salary.counts;
    const salaryValues = views.salary.values;
    charts.salaries.options.plugins.tooltip.callbacks.label = context => tooltipCount(context, salaryValues.length);
    charts.salaries.update("none");
    const q1 = salaryValues.length && typeof quantile === "function" ? quantile(salaryValues, .25) : null;
    const median = salaryValues.length && typeof mediane === "function" ? mediane(salaryValues) : null;
    const q3 = salaryValues.length && typeof quantile === "function" ? quantile(salaryValues, .75) : null;
    const absent = offers.length - salaryValues.length;
    $("salary-summary").textContent = salaryValues.length
      ? `Médiane : ${formatEuro(median)} brut/an · Q1 : ${formatEuro(q1)} · Q3 : ${formatEuro(q3)}. Base : ${formatNumber(salaryValues.length)} salaires numériques sur ${formatNumber(offers.length)} offres ; ${formatNumber(absent)} sans minimum numérique (${share(absent, offers.length)}).`
      : `Aucun minimum salarial numérique dans cette sélection (${formatNumber(absent)} offre${absent > 1 ? "s" : ""}). Les valeurs manquantes ne sont pas remplacées par zéro.`;

    visibleExperiences = views.experience.map(item => item.label);
    updateChart(charts.experience,
      views.experience.map(item => item.label), views.experience.map(item => item.count), offers.length,
      (value, index) => chartLabels(views.experience[index]?.label || value, 24),
      index => chooseFromChart(visibleExperiences, index, "filter-experience"));

    updateChart(charts.age,
      views.ageCounts.map(item => item.label), views.ageCounts.map(item => item.count), views.ages.length,
      (value, index) => chartLabels(views.ageCounts[index]?.label || value, 20), null);
    const ageMedian = views.ages.length && typeof mediane === "function" ? mediane(views.ages) : null;
    $("age-summary").textContent = ageMedian == null
      ? "Aucune date exploitable dans cette sélection."
      : `Âge médian : ${formatDays(ageMedian)} · base : ${formatNumber(views.ages.length)} dates exploitables sur ${formatNumber(offers.length)} offres. La barre 60+ compte les annonces d'au moins 60 jours.`;

    visibleDepartments = views.departments.map(item => item.code);
    updateChart(charts.departments,
      views.departments.map(item => item.label), views.departments.map(item => item.count), offers.length,
      (value, index) => chartLabels(views.departments[index]?.label || value, 22),
      index => chooseFromChart(visibleDepartments, index, "filter-department"));
    const knownDepartments = offers.filter(offer => !missing(offer.dep)).length;
    $("department-note").textContent = `Top 15 parmi ${formatNumber(knownDepartments)} offres avec département ; ${formatNumber(views.missingDepartments)} sans département sur ${formatNumber(offers.length)} offres. Cliquez une barre pour filtrer.`;
  }

  function tableValue(offer, key) {
    if (key === "family") return familyKey(offer);
    if (key === "experience") return experienceCategory(offer);
    if (key === "rome") return metierLabels.get(offer.rome) || offer.rome;
    if (key === "dep") return missing(offer.dep) ? null : String(offer.dep);
    return missing(offer[key]) ? null : offer[key];
  }

  function missingCell(label = "Non renseigné") {
    const span = document.createElement("span");
    span.className = "missing-value";
    span.textContent = label;
    return span;
  }

  function appendCell(row, value, options = {}) {
    const cell = document.createElement("td");
    if (value == null || value === "") cell.append(missingCell());
    else if (options.href) {
      const link = document.createElement("a");
      link.href = options.href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = String(value);
      link.setAttribute("aria-label", `${value} — ouvrir l'annonce sur France Travail`);
      cell.append(link);
    } else cell.textContent = String(value);
    row.append(cell);
    return cell;
  }

  function salaryCell(offer, row) {
    let value = null;
    if (Number.isFinite(offer.smin)) {
      if (Number.isFinite(offer.smax) && offer.smax !== offer.smin) value = `${formatEuro(offer.smin)} – ${formatEuro(offer.smax)} brut/an`;
      else value = `${formatEuro(offer.smin)} brut/an`;
    } else if (offer.salaire) value = offer.salaire;
    appendCell(row, value);
  }

  function searchable(offer) {
    return normalize([
      offer.intitule, offer.entreprise, offer.lieu, offer.dep,
      offer.rome, metierLabels.get(offer.rome), offer.id,
    ].filter(Boolean).join(" "));
  }

  function renderTable() {
    const query = normalize(searchTerm.trim());
    const matches = query ? filteredOffers.filter(offer => searchable(offer).includes(query)) : filteredOffers;
    const sorted = sortOffers(matches, sortKey, sortDirection, metierLabels);
    const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
    page = Math.min(Math.max(1, page), totalPages);
    const start = (page - 1) * pageSize;
    const current = sorted.slice(start, start + pageSize);
    const body = $("offers-body");
    body.replaceChildren();

    if (!current.length) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 8;
      cell.className = "table-empty";
      cell.textContent = "Aucune offre ne correspond à ces filtres et à cette recherche.";
      row.append(cell);
      body.append(row);
    } else current.forEach(offer => {
      const row = document.createElement("tr");
      appendCell(row, offer.intitule || null, { href: offer.url || null });
      appendCell(row, tableValue(offer, "rome"));
      appendCell(row, offer.entreprise || null);
      appendCell(row, missing(offer.dep) ? null : String(offer.dep));
      appendCell(row, tableValue(offer, "family"));
      salaryCell(offer, row);
      appendCell(row, tableValue(offer, "experience"));
      const date = formatDate(offer.date);
      const dateCell = appendCell(row, date);
      const age = ageInDays(offer, dataSet.date);
      if (date && age != null) dateCell.title = `${formatNumber(age)} jour${age === 1 ? "" : "s"} à la date d'extraction`;
      body.append(row);
    });

    const from = sorted.length ? start + 1 : 0;
    const to = Math.min(start + pageSize, sorted.length);
    $("table-count").textContent = query
      ? `${formatNumber(matches.length)} résultat${matches.length === 1 ? "" : "s"} sur ${formatNumber(filteredOffers.length)} offres filtrées par les critères globaux.`
      : `${formatNumber(filteredOffers.length)} offre${filteredOffers.length === 1 ? "" : "s"} après filtres globaux · affichage de ${formatNumber(from)} à ${formatNumber(to)}.`;
    $("page-info").textContent = `Page ${formatNumber(page)} / ${formatNumber(totalPages)}`;
    $("page-prev").disabled = page <= 1;
    $("page-next").disabled = page >= totalPages;
    document.querySelectorAll(".sort-button").forEach(button => {
      const indicator = button.querySelector("span");
      if (button.dataset.sort === sortKey) {
        button.setAttribute("aria-sort", sortDirection === "asc" ? "ascending" : "descending");
        if (indicator) indicator.textContent = sortDirection === "asc" ? " ↑" : " ↓";
      } else {
        button.removeAttribute("aria-sort");
        if (indicator) indicator.textContent = "";
      }
    });
  }

  function refresh() {
    if (!dataSet) return;
    const filters = currentFilters();
    filteredOffers = filterOffers(dataSet.offres, filters);
    const views = distributions(filteredOffers, dataSet);
    const count = filteredOffers.length;
    const reversedRange = filters.salaryMin !== "" && filters.salaryMax !== "" && Number(filters.salaryMin) > Number(filters.salaryMax);
    const salaryActive = filters.salaryMin !== "" || filters.salaryMax !== "";
    const withoutSalaryFilter = salaryActive
      ? filterOffers(dataSet.offres, { ...filters, salaryMin: "", salaryMax: "", includeMissingSalary: true })
      : [];
    const missingExcludedBySalary = salaryActive && !filters.includeMissingSalary
      ? withoutSalaryFilter.filter(offer => offer.smin == null).length
      : 0;
    const missingNote = missingExcludedBySalary
      ? ` La fourchette exclut ${formatNumber(missingExcludedBySalary)} offre${missingExcludedBySalary > 1 ? "s" : ""} sans salaire numérique ; cochez l'option pour les inclure.`
      : "";
    $("filter-count").textContent = reversedRange
      ? "Le minimum salarial dépasse le maximum : aucun résultat pour cette fourchette."
      : `${formatNumber(count)} offre${count === 1 ? "" : "s"} sélectionnée${count === 1 ? "" : "s"} sur ${formatNumber(dataSet.offres.length)}. Les filtres s'appliquent aux indicateurs, graphiques et au tableau.${missingNote}`;
    renderKpis(filteredOffers, views);
    renderCharts(filteredOffers, views);
    if (window.AnalysesStatistiques && typeof window.AnalysesStatistiques.render === "function") {
      window.AnalysesStatistiques.render(filteredOffers, familyKey);
    }
    renderTable();
  }

  function bindControls() {
    $("data-mode").addEventListener("change", event => {
      const mode = event.target.value;
      loadSource(mode);
    });
    ["filter-rome", "filter-family", "filter-department", "filter-experience"].forEach(id => {
      $(id).addEventListener("change", () => { page = 1; refresh(); });
    });
    ["filter-salary-min", "filter-salary-max"].forEach(id => $(id).addEventListener("input", () => { page = 1; refresh(); }));
    $("include-missing-salary").addEventListener("change", () => { page = 1; refresh(); });
    $("reset-filters").addEventListener("click", () => {
      $("filter-rome").value = "";
      $("filter-family").value = "";
      $("filter-department").value = "";
      $("filter-experience").value = "";
      $("filter-salary-min").value = "";
      $("filter-salary-max").value = "";
      $("include-missing-salary").checked = false;
      $("offer-search").value = "";
      searchTerm = "";
      page = 1;
      refresh();
    });
    $("offer-search").addEventListener("input", event => { searchTerm = event.target.value; page = 1; renderTable(); });
    $("page-size").addEventListener("change", event => { pageSize = Number(event.target.value) || 25; page = 1; renderTable(); });
    $("page-prev").addEventListener("click", () => { page = Math.max(1, page - 1); renderTable(); });
    $("page-next").addEventListener("click", () => { page += 1; renderTable(); });
    document.querySelectorAll(".sort-button").forEach(button => button.addEventListener("click", () => {
      const next = button.dataset.sort;
      if (sortKey === next) sortDirection = sortDirection === "asc" ? "desc" : "asc";
      else { sortKey = next; sortDirection = next === "date" || next === "smin" ? "desc" : "asc"; }
      page = 1;
      renderTable();
    }));
  }

  function loadSource(mode) {
    const errorPanel = $("error-panel");
    const sourceLine = $("source-line");
    const url = mode === "live" ? LIVE_DATA_URL : "data/resume.json";
    sourceLine.textContent = mode === "live" ? "Chargement des dernières offres France Travail publiées…" : "Chargement du snapshot historique…";
    errorPanel.hidden = true;
    $("data-mode").disabled = true;
    fetch(url, { cache: mode === "live" ? "no-store" : "no-cache" })
      .then(response => {
        if (!response.ok) throw new Error(`chargement HTTP ${response.status}`);
        return response.json();
      })
      .then(data => {
        if (!data || !Array.isArray(data.offres) || !Array.isArray(data.metiers) || !data.date) throw new Error("format inattendu dans la réponse");
        if (mode === "live" && (data.mode !== "live" || !data.generatedAt)) throw new Error("le fichier France Travail n'a pas le format attendu");
        dataSet = data;
        selectedMode = mode;
        metierLabels.clear();
        data.metiers.forEach(job => metierLabels.set(job.code, job.libelle));
        addOptions(data);
        page = 1;
        refresh();
        sourceLine.textContent = mode === "live"
          ? `${formatNumber(data.offres.length)} offres France Travail · dernière actualisation : ${new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Paris" }).format(new Date(data.generatedAt))}${data.limites?.length ? ` · plafond de pagination atteint pour ${data.limites.join(", ")}` : ""}`
          : `${formatNumber(data.offres.length)} offres actives · extraction du ${formatDate(data.date)} · source : data/resume.json`;
      })
      .catch(error => {
        errorPanel.hidden = false;
        errorPanel.textContent = `Impossible de charger la source ${mode === "live" ? "France Travail" : "historique"} : ${error.message}. Le snapshot historique reste disponible.`;
        $("data-mode").value = selectedMode;
        sourceLine.textContent = selectedMode === "historique" ? "Snapshot historique du 29 septembre 2026." : "Fichier France Travail précédemment chargé.";
      })
      .finally(() => { $("data-mode").disabled = false; });
  }

  function initialize() {
    const errorPanel = $("error-panel");
    const sourceLine = $("source-line");
    if (!window.Chart) {
      errorPanel.hidden = false;
      errorPanel.textContent = "Chart.js n'a pas pu être chargé. Vérifiez la connexion au CDN.";
      sourceLine.textContent = "Les graphiques ne sont pas disponibles.";
      return;
    }
    if (typeof familleContrat !== "function" || typeof trancheExp !== "function") {
      errorPanel.hidden = false;
      errorPanel.textContent = "Les règles de recodage partagées sont indisponibles.";
      sourceLine.textContent = "Les données ne peuvent pas être interprétées.";
      return;
    }
    bootCharts();
    bindControls();
    loadSource("historique");
  }

  // Interface exportée pour les contrôles de calcul sans lancer le rendu DOM.
  window.Explorateur = {
    experienceCategory,
    ageInDays,
    familyKey,
    filterOffers,
    sortOffers,
    salaryBins,
    distributions,
    ageBins: AGE_BINS.map(bin => bin.label),
    experienceLabels: [...EXPERIENCE_LABELS],
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true });
  else initialize();
})();
