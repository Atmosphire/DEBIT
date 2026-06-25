const stocksEl = document.getElementById("stocks");
const cutsEl = document.getElementById("cuts");
const kerfEl = document.getElementById("kerf");
const optimizeBtn = document.getElementById("optimizeBtn");
const clearBtn = document.getElementById("clearBtn");
const messageEl = document.getElementById("message");
const summaryEl = document.getElementById("summary");
const resultsEl = document.getElementById("results");

const STORAGE_KEY = "optimiseur-bruts-papa-v1";

loadSavedData();
registerServiceWorker();

[stocksEl, cutsEl, kerfEl].forEach((el) => {
  el.addEventListener("input", saveData);
});

optimizeBtn.addEventListener("click", runOptimization);
clearBtn.addEventListener("click", () => {
  stocksEl.value = "";
  cutsEl.value = "";
  kerfEl.value = "3";
  saveData();
  clearOutput();
});

function saveData() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      stocks: stocksEl.value,
      cuts: cutsEl.value,
      kerf: kerfEl.value,
    })
  );
}

function loadSavedData() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved) return;
    stocksEl.value = saved.stocks || "";
    cutsEl.value = saved.cuts || "";
    kerfEl.value = saved.kerf || "3";
  } catch {
    // Aucun blocage si le stockage local est vide ou illisible.
  }
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {});
  }
}

function parseLengths(text) {
  const values = [];
  const lines = text
    .replaceAll("×", "x")
    .split(/[\n;,]+/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const repeated = line.match(/^(\d+(?:[.,]\d+)?)\s*x\s*(\d+)$/i);
    if (repeated) {
      const length = toNumber(repeated[1]);
      const qty = Number.parseInt(repeated[2], 10);
      if (Number.isFinite(length) && length > 0 && qty > 0) {
        for (let i = 0; i < qty; i++) values.push(Math.round(length * 100) / 100);
      }
      continue;
    }

    const numbers = line.match(/\d+(?:[.,]\d+)?/g) || [];
    for (const number of numbers) {
      const length = toNumber(number);
      if (Number.isFinite(length) && length > 0) values.push(Math.round(length * 100) / 100);
    }
  }

  return values;
}

function toNumber(value) {
  return Number.parseFloat(String(value).replace(",", "."));
}

function clearOutput() {
  messageEl.classList.add("hidden");
  summaryEl.classList.add("hidden");
  resultsEl.innerHTML = "";
}

function showMessage(text) {
  messageEl.textContent = text;
  messageEl.classList.remove("hidden");
}

function hideMessage() {
  messageEl.textContent = "";
  messageEl.classList.add("hidden");
}

function runOptimization() {
  clearOutput();

  const stocks = parseLengths(stocksEl.value).sort((a, b) => a - b);
  const cuts = parseLengths(cutsEl.value).sort((a, b) => b - a);
  const kerf = Math.max(0, toNumber(kerfEl.value) || 0);

  if (!stocks.length) {
    showMessage("Ajoute au moins un brut disponible.");
    return;
  }

  if (!cuts.length) {
    showMessage("Ajoute au moins une cote à débiter.");
    return;
  }

  const biggestStock = Math.max(...stocks);
  const impossible = cuts.filter((cut) => cut + kerf > biggestStock);
  if (impossible.length) {
    showMessage(`Impossible : au moins une cote est plus grande que le plus grand brut (${formatNumber(biggestStock)} mm). Cote bloquante : ${formatNumber(impossible[0])} mm.`);
    return;
  }

  const result =
    cuts.length <= 22
      ? exactOptimize(cuts, stocks, kerf, 1300) || greedyOptimize(cuts, stocks, kerf)
      : greedyOptimize(cuts, stocks, kerf);

  if (!result || result.unplaced.length) {
    showMessage("Je n’arrive pas à placer toutes les cotes avec les bruts disponibles. Il manque de la longueur ou certains bruts sont trop courts.");
    if (result) renderResult(result, cuts, kerf);
    return;
  }

  hideMessage();
  renderResult(result, cuts, kerf);
}

function pieceConsumption(length, kerf) {
  return length + kerf;
}

function exactOptimize(cuts, stocks, kerf, timeLimitMs) {
  const startTime = performance.now();
  const totalNeeded = cuts.reduce((sum, cut) => sum + pieceConsumption(cut, kerf), 0);

  let best = null;
  let timedOut = false;

  const bins = [];
  const unused = stocks.map((length, index) => ({ id: index, length, remaining: length, cuts: [] }));

  function better(candidate, current) {
    if (!current) return true;
    if (candidate.waste !== current.waste) return candidate.waste < current.waste;
    if (candidate.bins.length !== current.bins.length) return candidate.bins.length < current.bins.length;
    return candidate.maxWaste < current.maxWaste;
  }

  function snapshot() {
    const usedBins = bins.map((bin) => ({
      id: bin.id,
      length: bin.length,
      remaining: round2(bin.remaining),
      cuts: [...bin.cuts],
    }));

    const waste = round2(usedBins.reduce((sum, bin) => sum + bin.remaining, 0));
    const maxWaste = usedBins.length ? Math.max(...usedBins.map((bin) => bin.remaining)) : 0;

    return {
      bins: usedBins,
      waste,
      maxWaste,
      exact: true,
      unplaced: [],
    };
  }

  function lowerBoundWaste(consumedSoFar, selectedLength) {
    return Math.max(0, selectedLength - totalNeeded);
  }

  function dfs(index, consumedSoFar, selectedLength) {
    if (performance.now() - startTime > timeLimitMs) {
      timedOut = true;
      return;
    }

    if (best && lowerBoundWaste(consumedSoFar, selectedLength) >= best.waste) {
      return;
    }

    if (index === cuts.length) {
      const candidate = snapshot();
      if (better(candidate, best)) best = candidate;
      return;
    }

    const remainingNeeded = cuts
      .slice(index)
      .reduce((sum, cut) => sum + pieceConsumption(cut, kerf), 0);

    const availableCapacity =
      bins.reduce((sum, bin) => sum + bin.remaining, 0) +
      unused.reduce((sum, stock) => sum + stock.length, 0);

    if (availableCapacity < remainingNeeded) return;

    const cut = cuts[index];
    const consumption = pieceConsumption(cut, kerf);

    const usedOptions = bins
      .map((bin, binIndex) => ({ bin, binIndex, after: round2(bin.remaining - consumption) }))
      .filter((option) => option.after >= 0)
      .sort((a, b) => a.after - b.after);

    const seenRemainders = new Set();
    for (const option of usedOptions) {
      const key = String(option.after);
      if (seenRemainders.has(key)) continue;
      seenRemainders.add(key);

      option.bin.remaining = round2(option.bin.remaining - consumption);
      option.bin.cuts.push(cut);
      dfs(index + 1, consumedSoFar + consumption, selectedLength);
      option.bin.cuts.pop();
      option.bin.remaining = round2(option.bin.remaining + consumption);

      if (timedOut) return;
    }

    const seenStockLengths = new Set();
    for (let i = 0; i < unused.length; i++) {
      const stock = unused[i];
      if (stock.length < consumption) continue;
      if (seenStockLengths.has(stock.length)) continue;
      seenStockLengths.add(stock.length);

      const [opened] = unused.splice(i, 1);
      opened.remaining = round2(opened.length - consumption);
      opened.cuts = [cut];
      bins.push(opened);

      dfs(index + 1, consumedSoFar + consumption, selectedLength + opened.length);

      bins.pop();
      opened.cuts = [];
      opened.remaining = opened.length;
      unused.splice(i, 0, opened);

      if (timedOut) return;
    }
  }

  dfs(0, 0, 0);

  if (timedOut || !best) return null;
  best.bins.sort((a, b) => b.length - a.length || a.remaining - b.remaining);
  return best;
}

function greedyOptimize(cuts, stocks, kerf) {
  const unused = stocks.map((length, index) => ({ id: index, length })).sort((a, b) => a.length - b.length);
  const bins = [];
  const unplaced = [];

  for (const cut of cuts) {
    const consumption = pieceConsumption(cut, kerf);

    let bestBinIndex = -1;
    let bestRemaining = Infinity;

    for (let i = 0; i < bins.length; i++) {
      const after = bins[i].remaining - consumption;
      if (after >= 0 && after < bestRemaining) {
        bestRemaining = after;
        bestBinIndex = i;
      }
    }

    if (bestBinIndex !== -1) {
      bins[bestBinIndex].cuts.push(cut);
      bins[bestBinIndex].remaining = round2(bins[bestBinIndex].remaining - consumption);
      continue;
    }

    const stockIndex = unused.findIndex((stock) => stock.length >= consumption);
    if (stockIndex === -1) {
      unplaced.push(cut);
      continue;
    }

    const [stock] = unused.splice(stockIndex, 1);
    bins.push({
      id: stock.id,
      length: stock.length,
      remaining: round2(stock.length - consumption),
      cuts: [cut],
    });
  }

  bins.sort((a, b) => b.length - a.length || a.remaining - b.remaining);

  return {
    bins,
    unplaced,
    waste: round2(bins.reduce((sum, bin) => sum + bin.remaining, 0)),
    maxWaste: bins.length ? Math.max(...bins.map((bin) => bin.remaining)) : 0,
    exact: false,
  };
}

function renderResult(result, cuts, kerf) {
  const totalCuts = cuts.reduce((sum, cut) => sum + cut, 0);
  const totalKerf = cuts.length * kerf;
  const totalUsedStocks = result.bins.reduce((sum, bin) => sum + bin.length, 0);
  const wastePercent = totalUsedStocks > 0 ? (result.waste / totalUsedStocks) * 100 : 0;

  summaryEl.innerHTML = `
    <div class="stat"><strong>${result.bins.length}</strong><span>brut(s) utilisé(s)</span></div>
    <div class="stat"><strong>${formatNumber(result.waste)} mm</strong><span>chute totale</span></div>
    <div class="stat"><strong>${formatNumber(wastePercent)} %</strong><span>chute sur les bruts utilisés</span></div>
    <div class="stat"><strong>${result.exact ? "Optimisé" : "Rapide"}</strong><span>${result.exact ? "recherche avancée" : "heuristique pour grosse liste"}</span></div>
  `;
  summaryEl.classList.remove("hidden");

  resultsEl.innerHTML = result.bins
    .map((bin, index) => {
      const cutsSum = bin.cuts.reduce((sum, cut) => sum + cut, 0);
      const kerfSum = bin.cuts.length * kerf;
      const consumed = cutsSum + kerfSum;
      const usedPercent = Math.min(100, (consumed / bin.length) * 100);
      const wastePercentLocal = Math.max(0, 100 - usedPercent);

      return `
        <article class="cut-card">
          <h2>Brut ${index + 1} — ${formatNumber(bin.length)} mm</h2>
          <div class="bar" aria-hidden="true">
            <div class="bar-used" style="width:${usedPercent}%"></div>
            <div class="bar-waste" style="width:${wastePercentLocal}%"></div>
          </div>
          <div class="meta">
            <div><span class="ok">À couper :</span> ${bin.cuts.map((cut) => `${formatNumber(cut)} mm`).join(" + ")}</div>
            <div>Longueur pièces : ${formatNumber(cutsSum)} mm</div>
            <div>Trait de scie estimé : ${formatNumber(kerfSum)} mm</div>
            <div>Chute restante : <strong>${formatNumber(bin.remaining)} mm</strong></div>
          </div>
          <div class="parts">
            ${bin.cuts.map((cut) => `<span class="part">${formatNumber(cut)}</span>`).join("")}
          </div>
        </article>
      `;
    })
    .join("");

  if (result.unplaced && result.unplaced.length) {
    resultsEl.innerHTML += `
      <article class="cut-card">
        <h2>Cotes non placées</h2>
        <p>${result.unplaced.map((cut) => `${formatNumber(cut)} mm`).join(", ")}</p>
      </article>
    `;
  }
}

function formatNumber(value) {
  return new Intl.NumberFormat("fr-FR", {
    maximumFractionDigits: 2,
  }).format(round2(value));
}

function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
