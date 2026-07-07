const els = {};
let plan = null;
let state = null;

const DEFAULT_PLAN_URL = "plan.json";
const STORAGE_PREFIX = "rimaflow-v2-state:";
const OLD_STORAGE_PREFIX = "rimaflow-state:";
const SCALE = 10; // 0,1 cm tarkkuus optimointiin

// Käytännön kenttämarginaali: 500 cm rima → käytetään oletuksena 495 cm.
const DEFAULT_SAFETY_MARGIN_CM = 5;

document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindEls();
  bindEvents();
  await loadDefaultPlan();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  }
}

function bindEls() {
  [
    "planName","menuBtn","menu","showWorkBtn","showPilesBtn","showPlanBtn","exportBtn","planFileInput","resetBtn",
    "cutProgress","boardProgress","failedProgress","progressBar","workView","pilesView","planView",
    "measureCard","boardLengthInput","startBoardBtn","nextFitPreview",
    "stepCard","stepMeta","stepTitle","lengthBadge","lengthValue","stepInstruction","pileBox",
    "factModel","factUse","factWaste","factRemaining","successBtn","finishBoardBtn","failBtn","undoBtn",
    "doneCard","doneText","donePilesBtn","failHelp","confirmFailBtn","cancelFailBtn","pilesList",
    "planSummary","boardsList"
  ].forEach(id => els[id] = document.getElementById(id));
}

function bindEvents() {
  els.menuBtn.addEventListener("click", () => {
    els.menu.classList.toggle("hidden");
    els.menuBtn.setAttribute("aria-expanded", String(!els.menu.classList.contains("hidden")));
  });
  els.showWorkBtn.addEventListener("click", () => showView("work"));
  els.showPilesBtn.addEventListener("click", () => showView("piles"));
  els.showPlanBtn.addEventListener("click", () => showView("plan"));
  els.donePilesBtn.addEventListener("click", () => showView("piles"));
  els.boardLengthInput.addEventListener("input", () => renderMeasurePreview());
  els.startBoardBtn.addEventListener("click", onStartBoard);
  els.successBtn.addEventListener("click", onSuccess);
  els.finishBoardBtn.addEventListener("click", onFinishBoard);
  els.failBtn.addEventListener("click", showFailHelp);
  els.cancelFailBtn.addEventListener("click", hideFailHelp);
  els.confirmFailBtn.addEventListener("click", onFailBoard);
  els.undoBtn.addEventListener("click", onUndo);
  els.resetBtn.addEventListener("click", onReset);
  els.exportBtn.addEventListener("click", exportState);
  els.planFileInput.addEventListener("change", onPlanFile);
}

async function loadDefaultPlan() {
  try {
    const response = await fetch(DEFAULT_PLAN_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    loadPlan(data);
  } catch (err) {
    els.measureCard.classList.add("hidden");
    els.stepCard.classList.remove("hidden");
    els.stepTitle.textContent = "Suunnitelmaa ei voitu ladata";
    els.stepInstruction.textContent = "Tarkista, että plan.json löytyy sovelluksen juuresta.";
    console.error(err);
  }
}

function loadPlan(newPlan) {
  plan = normalizePlan(newPlan);
  const existing = loadState(plan.id) || migrateOldState(plan.id);
  state = existing || freshState(plan.id);
  ensureStateShape();
  renderAll();
}

function normalizePlan(raw) {
  if (!raw.boards || !Array.isArray(raw.boards)) {
    throw new Error("Plan must contain boards[]");
  }
  const normalized = JSON.parse(JSON.stringify(raw));
  normalized.units = normalized.units || "cm";
  normalized.piles = normalized.piles || derivePiles(normalized.boards);
  normalized.summary = normalized.summary || {};
  normalized.summary.stock_length_cm = Number(normalized.summary.stock_length_cm || maxBoardLength(normalized.boards) || 500);
  normalized.summary.safety_margin_cm = Number(normalized.summary.safety_margin_cm ?? normalized.summary.kerf_margin_cm ?? DEFAULT_SAFETY_MARGIN_CM);
  normalized.summary.total_boards = normalized.boards.length;
  normalized.summary.total_cuts = totalCuts(normalized.boards);
  normalized.summary.total_length_cm = normalized.summary.total_length_cm || sumAllCuts(normalized.boards);
  normalized.boards.forEach((board, bi) => {
    board.id = board.id || `R${String(bi + 1).padStart(3, "0")}`;
    board.number = board.number || bi + 1;
    board.stock_length_cm = Number(board.stock_length_cm || normalized.summary.stock_length_cm || 500);
    board.cuts = board.cuts || [];
    board.cuts.forEach((cut, ci) => {
      cut.id = cut.id || `${board.id}-C${String(ci + 1).padStart(2, "0")}`;
      cut.seq = cut.seq || ci + 1;
      cut.length_cm = Number(cut.length_cm);
      cut.pile_id = cut.pile_id || `PINO-${cut.length_cm}`;
      cut.pile_label = cut.pile_label || `Pino ${cut.length_cm} cm`;
      cut.instruction = cut.instruction || `Sahaa ${formatCm(cut.length_cm)} cm ja pinoa: ${cut.pile_label}`;
      cut.source_board_id = board.id;
      cut.source_board_number = board.number;
    });
    board.planned_use_cm = Number(board.planned_use_cm || board.cuts.reduce((s, c) => s + Number(c.length_cm || 0), 0));
    board.planned_waste_cm = Number(board.planned_waste_cm ?? (board.stock_length_cm - board.planned_use_cm));
  });
  normalized.piles = normalized.piles.map(p => ({
    ...p,
    needed: Number(p.needed || 0),
    length_cm: Number(p.length_cm || 0)
  }));
  return normalized;
}

function derivePiles(boards) {
  const map = new Map();
  boards.flatMap(b => b.cuts || []).forEach(c => {
    const id = c.pile_id || `PINO-${c.length_cm}`;
    if (!map.has(id)) {
      map.set(id, {
        id,
        label: c.pile_label || `Pino ${c.length_cm} cm`,
        length_cm: Number(c.length_cm),
        needed: 0,
        kind: c.kind || "",
        interval: c.interval || "",
        note: c.note || ""
      });
    }
    map.get(id).needed += 1;
  });
  return [...map.values()].sort((a, b) => String(a.id).localeCompare(String(b.id), "fi"));
}

function totalCuts(boards) {
  return boards.reduce((sum, b) => sum + (b.cuts ? b.cuts.length : 0), 0);
}

function sumAllCuts(boards) {
  return boards.reduce((sum, b) => sum + (b.cuts || []).reduce((s, c) => s + Number(c.length_cm || 0), 0), 0);
}

function maxBoardLength(boards) {
  return Math.max(...boards.map(b => Number(b.stock_length_cm || 0)), 0);
}

function freshState(planId) {
  return {
    version: 2,
    planId,
    completedCuts: {},
    failedBoards: {},
    boardSessions: [],
    activeBoard: null,
    history: [],
    lastMeasuredLengthCm: plan?.summary?.stock_length_cm || 500,
    startedAt: new Date().toISOString()
  };
}

function ensureStateShape() {
  state.version = 2;
  state.completedCuts = state.completedCuts || {};
  state.failedBoards = state.failedBoards || {};
  state.boardSessions = state.boardSessions || [];
  state.activeBoard = state.activeBoard || null;
  state.history = state.history || [];
  state.lastMeasuredLengthCm = Number(state.lastMeasuredLengthCm || plan.summary.stock_length_cm || 500);
}

function loadState(planId) {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + planId);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed.planId !== planId) return null;
    return parsed;
  } catch {
    return null;
  }
}

function migrateOldState(planId) {
  try {
    const raw = localStorage.getItem(OLD_STORAGE_PREFIX + planId);
    if (!raw) return null;
    const old = JSON.parse(raw);
    if (old.planId !== planId) return null;
    return {
      version: 2,
      planId,
      completedCuts: old.completedCuts || {},
      failedBoards: {},
      boardSessions: [],
      activeBoard: null,
      history: [],
      lastMeasuredLengthCm: plan?.summary?.stock_length_cm || 500,
      startedAt: old.startedAt || new Date().toISOString(),
      migratedFromV1At: new Date().toISOString()
    };
  } catch {
    return null;
  }
}

function saveState() {
  if (!plan || !state) return;
  state.updatedAt = new Date().toISOString();
  localStorage.setItem(STORAGE_PREFIX + plan.id, JSON.stringify(state));
}

function allCuts() {
  return plan.boards.flatMap(board => (board.cuts || []).map(cut => ({
    ...cut,
    source_board_id: board.id,
    source_board_number: board.number
  })));
}

function remainingCuts() {
  return allCuts().filter(cut => !state.completedCuts[cut.id]);
}

function completedCount() {
  return Object.keys(state.completedCuts).length;
}

function remainingTotalCm() {
  return remainingCuts().reduce((s, c) => s + Number(c.length_cm || 0), 0);
}

function activeCompletedCuts() {
  if (!state.activeBoard) return [];
  const ids = state.activeBoard.completed_cut_ids || [];
  const map = new Map(allCuts().map(c => [c.id, c]));
  return ids.map(id => map.get(id)).filter(Boolean);
}

function activeUsedCm() {
  return activeCompletedCuts().reduce((sum, c) => sum + Number(c.length_cm || 0), 0);
}

function activeUsableRemainingCm() {
  if (!state.activeBoard) return 0;
  const usable = Number(state.activeBoard.measured_length_cm) - Number(state.activeBoard.safety_margin_cm || 0);
  return Math.max(0, usable - activeUsedCm());
}

function renderAll() {
  if (!plan || !state) return;
  els.planName.textContent = plan.name || "Sahausohjain";
  renderStatus();
  renderWork();
  renderPiles();
  renderPlan();
}

function renderStatus() {
  const done = completedCount();
  const total = totalCuts(plan.boards);
  const failedBoards = Object.keys(state.failedBoards).length;
  const usedBoards = state.boardSessions.length;
  const estimate = estimateTotalBoardsNeeded();
  els.cutProgress.textContent = `${done} / ${total}`;
  els.boardProgress.textContent = `${usedBoards} / ~${estimate}`;
  els.failedProgress.textContent = `${failedBoards}`;
  els.progressBar.style.width = total ? `${Math.round(done / total * 100)}%` : "0%";
}

function estimateTotalBoardsNeeded(lengthCm) {
  const measured = Number(lengthCm || state.lastMeasuredLengthCm || plan.summary.stock_length_cm || 500);
  const usable = Math.max(1, measured - safetyMarginCm());
  const remainingBoards = Math.ceil(remainingTotalCm() / usable);
  return state.boardSessions.length + remainingBoards;
}

function renderWork() {
  hideFailHelp();
  const remaining = remainingCuts();

  if (remaining.length === 0) {
    els.measureCard.classList.add("hidden");
    els.stepCard.classList.add("hidden");
    els.doneCard.classList.remove("hidden");
    const failed = Object.keys(state.failedBoards).length;
    const done = completedCount();
    const total = totalCuts(plan.boards);
    els.doneText.textContent = failed
      ? `Hyväksyttyjä sahauksia ${done}/${total}. ${failed} rimaa on keskeytetty, mutta kaikki suunnitelman palat on kuitattu.`
      : `Kaikki ${total} sahausta on kuitattu ja pinottu.`;
    return;
  }

  els.doneCard.classList.add("hidden");

  if (!state.activeBoard) {
    els.stepCard.classList.add("hidden");
    els.measureCard.classList.remove("hidden");
    els.boardLengthInput.value = String(state.lastMeasuredLengthCm || plan.summary.stock_length_cm || 500);
    renderMeasurePreview();
    return;
  }

  els.measureCard.classList.add("hidden");
  els.stepCard.classList.remove("hidden");

  const recommendation = getRecommendationForActiveBoard();
  if (!recommendation || recommendation.items.length === 0) {
    renderActiveBoardNoFit(remaining);
    return;
  }

  const cut = recommendation.items[0];
  const session = state.activeBoard;
  const usedBefore = activeUsedCm();
  const usableRemaining = activeUsableRemainingCm();
  const afterThisUsable = Math.max(0, usableRemaining - Number(cut.length_cm));
  const comboText = recommendation.items.map(c => `${formatCm(c.length_cm)}`).join(" + ");
  const source = cut.source_board_number ? `Alkuperäinen rima ${cut.source_board_number}` : "";

  els.successBtn.classList.remove("hidden");
  els.finishBoardBtn.classList.add("hidden");
  els.failBtn.classList.remove("hidden");
  els.lengthBadge.classList.remove("hidden");
  els.pileBox.classList.remove("hidden");

  els.stepMeta.textContent = `Rima ${session.number} · mitattu ${formatCm(session.measured_length_cm)} cm · jäljellä ${formatCm(usableRemaining)} cm`;
  els.stepTitle.textContent = `Sahaa ${formatCm(cut.length_cm)} cm`;
  els.lengthValue.textContent = formatCm(cut.length_cm);
  els.stepInstruction.textContent = `Tarkista mitta, sahaa ja vie suoraan alla näkyvään pinoon.`;
  els.pileBox.innerHTML = `
    <div class="pile-kicker">Pinoon</div>
    <div class="pile-title">${escapeHtml(cut.pile_label)}</div>
    <div class="pile-sub">${escapeHtml(cut.piece_label || cut.note || source || "")}</div>
  `;

  els.factModel.textContent = `Rima ${session.number}: ${formatCm(session.measured_length_cm)} cm`;
  els.factUse.textContent = `Tehty ${formatCm(usedBefore)} cm. Tämän riman ehdotus: ${comboText} cm`;
  els.factWaste.textContent = `${formatCm(recommendation.waste_cm)} cm + ${formatCm(session.safety_margin_cm)} cm marginaali`;
  els.factRemaining.textContent = `${formatCm(afterThisUsable)} cm käyttökelpoista`;
}

function renderMeasurePreview() {
  if (!plan || !state) return;
  const measured = parseNumber(els.boardLengthInput.value);
  const remaining = remainingCuts();
  if (remaining.length === 0) {
    els.nextFitPreview.innerHTML = `<strong>Kaikki palat on tehty.</strong>`;
    return;
  }
  if (!Number.isFinite(measured) || measured <= 0) {
    els.nextFitPreview.innerHTML = `<strong>Syötä mitattu pituus senttimetreinä.</strong>`;
    return;
  }

  const margin = safetyMarginCm();
  const usable = measured - margin;
  const tooLong = remaining.filter(c => Number(c.length_cm) > usable).sort((a,b) => b.length_cm - a.length_cm);
  const fit = optimizeCuts(remaining, usable);
  const totalRemaining = remainingTotalCm();

  if (!fit.items.length) {
    els.nextFitPreview.innerHTML = `
      <strong>Tähän rimaan ei mahdu yhtään jäljellä olevaa palaa.</strong>
      <p>Mitattu ${formatCm(measured)} cm, käyttökelpoinen pituus marginaalin jälkeen ${formatCm(Math.max(0, usable))} cm.</p>
      ${tooLong.length ? `<p>Pisin jäljellä oleva pala on ${formatCm(tooLong[0].length_cm)} cm.</p>` : ""}
    `;
    return;
  }

  els.nextFitPreview.innerHTML = `
    <strong>Seuraavalle rimalla ehdotus:</strong>
    <p class="combo">${fit.items.map(c => `${formatCm(c.length_cm)} cm`).join(" + ")}</p>
    <p>Käyttö ${formatCm(fit.used_cm)} cm / ${formatCm(Math.max(0, usable))} cm. Arviohukka ${formatCm(fit.waste_cm)} cm + ${formatCm(margin)} cm marginaali.</p>
    <p>Tekemättä ${remaining.length} palaa, yhteensä ${formatCm(totalRemaining)} cm. Arvio rimoja tästä eteenpäin: ~${Math.ceil(totalRemaining / Math.max(1, usable))} kpl.</p>
    ${tooLong.length ? `<p class="warn-text">Huom: ${tooLong.length} jäljellä olevaa palaa ei mahdu näin pitkään rimaan ilman jatkosta tai pidempää aihiota.</p>` : ""}
  `;
}

function renderActiveBoardNoFit(remaining) {
  const session = state.activeBoard;
  const usableRemaining = activeUsableRemainingCm();
  const shortest = remaining.slice().sort((a, b) => a.length_cm - b.length_cm)[0];

  els.successBtn.classList.add("hidden");
  els.finishBoardBtn.classList.remove("hidden");
  els.failBtn.classList.add("hidden");
  els.lengthBadge.classList.add("hidden");
  els.pileBox.classList.add("hidden");

  els.stepMeta.textContent = `Rima ${session.number} · mitattu ${formatCm(session.measured_length_cm)} cm`;
  els.stepTitle.textContent = "Rima valmis";
  els.stepInstruction.textContent = shortest
    ? `Jäljellä ${formatCm(usableRemaining)} cm. Lyhin tekemätön pala on ${formatCm(shortest.length_cm)} cm. Mittaa seuraava rima.`
    : "Tämän riman osuus on valmis. Mittaa seuraava rima.";
  els.factModel.textContent = `Rima ${session.number}: ${formatCm(session.measured_length_cm)} cm`;
  els.factUse.textContent = `Tästä tehty ${formatCm(activeUsedCm())} cm`;
  els.factWaste.textContent = `${formatCm(usableRemaining)} cm + ${formatCm(session.safety_margin_cm)} cm marginaali`;
  els.factRemaining.textContent = "0 cm tähän käyttöön";
}

function renderPiles() {
  const completedByPile = {};
  allCuts().forEach(c => {
    if (state.completedCuts[c.id]) {
      completedByPile[c.pile_id] = (completedByPile[c.pile_id] || 0) + 1;
    }
  });

  els.pilesList.innerHTML = "";
  plan.piles
    .slice()
    .sort((a, b) => String(a.id).localeCompare(String(b.id), "fi"))
    .forEach(pile => {
      const done = completedByPile[pile.id] || 0;
      const needed = Number(pile.needed || 0);
      const complete = needed > 0 && done >= needed;
      const div = document.createElement("div");
      div.className = "item";
      div.innerHTML = `
        <div class="item-title">
          <span>${escapeHtml(pile.label || pile.id)}</span>
          <span class="badge ${complete ? "done" : ""}">${done}/${needed}</span>
        </div>
        <small>${escapeHtml(pile.note || `Pituus ${formatCm(pile.length_cm)} cm`)}</small>
      `;
      els.pilesList.appendChild(div);
    });
}

function renderPlan() {
  const s = plan.summary || {};
  const remaining = remainingCuts();
  const entries = [
    ["Palat yhteensä", `${completedCount()} / ${totalCuts(plan.boards)}`],
    ["Tekemättä", `${remaining.length} palaa · ${formatCm(remainingTotalCm())} cm`],
    ["Oletusaihio", `${formatCm(s.stock_length_cm || 500)} cm`],
    ["Kenttämarginaali", `${formatCm(s.safety_margin_cm ?? DEFAULT_SAFETY_MARGIN_CM)} cm / rima`],
    ["Aloitettuja rimoja", `${state.boardSessions.length}`],
    ["Keskeytettyjä rimoja", `${Object.keys(state.failedBoards).length}`]
  ];
  els.planSummary.innerHTML = entries.map(([k, v]) => `
    <div><span>${escapeHtml(k)}</span><strong>${escapeHtml(v)}</strong></div>
  `).join("");

  els.boardsList.innerHTML = "";
  plan.boards.forEach(board => {
    const done = board.cuts.filter(c => state.completedCuts[c.id]).length;
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <div class="item-title">
        <span>Rima ${escapeHtml(board.number)} · ${escapeHtml(board.cuts.map(c => formatCm(c.length_cm)).join(" + "))} cm</span>
        <span class="badge ${done === board.cuts.length ? "done" : ""}">${done}/${board.cuts.length}</span>
      </div>
      <small>Alkuperäinen paketti. Dynaaminen työjärjestys voi sahata nämä eri rimoilta.</small>
    `;
    els.boardsList.appendChild(div);
  });
}

function getRecommendationForActiveBoard() {
  if (!state.activeBoard) return null;
  return optimizeCuts(remainingCuts(), activeUsableRemainingCm());
}

function optimizeCuts(cuts, capacityCm) {
  const capacity = Math.max(0, Math.floor(Number(capacityCm || 0) * SCALE + 1e-6));
  const items = cuts
    .filter(c => Number.isFinite(Number(c.length_cm)) && Number(c.length_cm) > 0)
    .map((c, index) => ({ cut: c, len: Math.ceil(Number(c.length_cm) * SCALE - 1e-6), index }))
    .filter(item => item.len <= capacity);

  if (!items.length || capacity <= 0) return { items: [], used_cm: 0, waste_cm: round1(capacity / SCALE) };

  const dp = Array(capacity + 1).fill(null);
  dp[0] = { count: 0, prev: null, item: null };

  for (const item of items) {
    for (let s = capacity - item.len; s >= 0; s--) {
      if (!dp[s]) continue;
      const ns = s + item.len;
      const candidateCount = dp[s].count + 1;
      if (!dp[ns] || candidateCount < dp[ns].count) {
        dp[ns] = { count: candidateCount, prev: dp[s], item };
      }
    }
  }

  let bestSum = 0;
  for (let s = capacity; s >= 0; s--) {
    if (dp[s]) { bestSum = s; break; }
  }

  const selected = [];
  let node = dp[bestSum];
  while (node && node.item) {
    selected.push(node.item.cut);
    node = node.prev;
  }

  selected.sort((a, b) => {
    const d = Number(b.length_cm) - Number(a.length_cm);
    if (d !== 0) return d;
    return String(a.pile_id).localeCompare(String(b.pile_id), "fi");
  });

  return {
    items: selected,
    used_cm: round1(bestSum / SCALE),
    waste_cm: round1((capacity - bestSum) / SCALE)
  };
}

function onStartBoard() {
  const measured = parseNumber(els.boardLengthInput.value);
  if (!Number.isFinite(measured) || measured <= 0) {
    alert("Syötä mitattu pituus senttimetreinä, esimerkiksi 500.");
    return;
  }
  const remaining = remainingCuts();
  if (!remaining.length) return;

  const margin = safetyMarginCm();
  const fit = optimizeCuts(remaining, measured - margin);
  if (!fit.items.length) {
    alert("Tähän rimaan ei mahdu yhtään jäljellä olevaa palaa marginaalin jälkeen. Tarkista pituus tai käytä pidempää rimaa.");
    return;
  }

  const session = {
    id: `B${Date.now()}`,
    number: state.boardSessions.length + 1,
    measured_length_cm: round1(measured),
    safety_margin_cm: margin,
    completed_cut_ids: [],
    started_at: new Date().toISOString()
  };
  state.activeBoard = session;
  state.boardSessions.push(session);
  state.lastMeasuredLengthCm = round1(measured);
  state.history.push({ type: "start_board", session_id: session.id });
  saveState();
  renderAll();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function onSuccess() {
  if (!state.activeBoard) return;
  const recommendation = getRecommendationForActiveBoard();
  if (!recommendation || !recommendation.items.length) return;
  const cut = recommendation.items[0];
  const session = state.activeBoard;

  state.completedCuts[cut.id] = {
    at: new Date().toISOString(),
    session_id: session.id,
    board_number: session.number,
    length_cm: cut.length_cm,
    pile_id: cut.pile_id
  };
  session.completed_cut_ids = session.completed_cut_ids || [];
  session.completed_cut_ids.push(cut.id);
  updateSession(session);
  state.history.push({ type: "complete_cut", cut_id: cut.id, session_id: session.id });
  saveState();
  renderAll();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function onFinishBoard() {
  if (!state.activeBoard) return;
  const session = state.activeBoard;
  session.finished_at = new Date().toISOString();
  session.final_unused_cm = round1(activeUsableRemainingCm());
  updateSession(session);
  state.activeBoard = null;
  state.history.push({ type: "finish_board", session_id: session.id });
  saveState();
  renderAll();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showFailHelp() {
  els.failHelp.classList.remove("hidden");
  els.failHelp.scrollIntoView({ behavior: "smooth", block: "center" });
}

function hideFailHelp() {
  els.failHelp.classList.add("hidden");
}

function onFailBoard() {
  if (!state.activeBoard) return;
  const session = JSON.parse(JSON.stringify(state.activeBoard));
  const recommendation = getRecommendationForActiveBoard();
  const currentCut = recommendation && recommendation.items[0];

  state.failedBoards[session.id] = {
    at: new Date().toISOString(),
    board_number: session.number,
    measured_length_cm: session.measured_length_cm,
    completed_cut_ids: session.completed_cut_ids || [],
    current_cut_id: currentCut ? currentCut.id : null,
    message: "Rima jätetty kesken sahausvirheen takia. Tekemättömät palat palautuivat optimointijonoon."
  };
  session.failed_at = new Date().toISOString();
  updateSession(session);
  state.activeBoard = null;
  state.history.push({ type: "fail_board", session });
  saveState();
  renderAll();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function onUndo() {
  const last = state.history.pop();
  if (!last) return;

  if (last.type === "complete_cut") {
    delete state.completedCuts[last.cut_id];
    const session = findSession(last.session_id);
    if (session) {
      session.completed_cut_ids = (session.completed_cut_ids || []).filter(id => id !== last.cut_id);
      updateSession(session);
      if (!state.activeBoard && !session.finished_at && !session.failed_at) state.activeBoard = session;
    }
  } else if (last.type === "fail_board") {
    delete state.failedBoards[last.session.id];
    const restored = last.session;
    delete restored.failed_at;
    updateSession(restored);
    state.activeBoard = restored;
  } else if (last.type === "finish_board") {
    const session = findSession(last.session_id);
    if (session) {
      delete session.finished_at;
      delete session.final_unused_cm;
      updateSession(session);
      state.activeBoard = session;
    }
  } else if (last.type === "start_board") {
    if (state.activeBoard && state.activeBoard.id === last.session_id && !(state.activeBoard.completed_cut_ids || []).length) {
      state.activeBoard = null;
      state.boardSessions = state.boardSessions.filter(s => s.id !== last.session_id);
    }
  }
  saveState();
  renderAll();
}

function onReset() {
  const ok = confirm("Nollataanko tämän suunnitelman edistyminen?");
  if (!ok) return;
  state = freshState(plan.id);
  saveState();
  renderAll();
}

function showView(view) {
  els.workView.classList.toggle("hidden", view !== "work");
  els.pilesView.classList.toggle("hidden", view !== "piles");
  els.planView.classList.toggle("hidden", view !== "plan");
  els.menu.classList.add("hidden");
  els.menuBtn.setAttribute("aria-expanded", "false");
  renderAll();
}

async function onPlanFile(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    let imported;
    if (file.name.toLowerCase().endsWith(".csv")) {
      imported = planFromCsv(text, file.name);
    } else {
      imported = JSON.parse(text);
    }
    loadPlan(imported);
    showView("work");
  } catch (err) {
    alert(`Suunnitelman tuonti epäonnistui: ${err.message}`);
  } finally {
    event.target.value = "";
  }
}

function planFromCsv(text, fileName) {
  const rows = parseCsv(text).filter(r => r.some(v => String(v).trim()));
  if (rows.length < 2) throw new Error("CSV: vähintään otsikkorivi ja yksi data-rivi tarvitaan.");
  const headers = rows[0].map(h => String(h).trim().toLowerCase());
  const idx = name => headers.indexOf(name);
  const boardIdx = idx("board_id");
  const lengthIdx = idx("length_cm");
  const pileIdx = idx("pile_id");
  const pileLabelIdx = idx("pile_label");
  if (lengthIdx < 0) {
    throw new Error("CSV: pakollinen sarake on length_cm. Suositus: board_id, pile_id, pile_label.");
  }
  const map = new Map();
  rows.slice(1).forEach((r, i) => {
    const boardId = boardIdx >= 0 && r[boardIdx] ? r[boardIdx] : `R${String(i + 1).padStart(3, "0")}`;
    const length = parseNumber(r[lengthIdx]);
    if (!Number.isFinite(length)) throw new Error(`CSV: virheellinen length_cm rivillä ${i + 2}`);
    if (!map.has(boardId)) {
      map.set(boardId, { id: boardId, number: map.size + 1, stock_length_cm: 500, cuts: [] });
    }
    const pileId = (pileIdx >= 0 && r[pileIdx]) ? r[pileIdx] : `PINO-${length}`;
    const pileLabel = (pileLabelIdx >= 0 && r[pileLabelIdx]) ? r[pileLabelIdx] : `Pino ${formatCm(length)} cm`;
    const board = map.get(boardId);
    board.cuts.push({
      id: `${boardId}-C${String(board.cuts.length + 1).padStart(2, "0")}`,
      seq: board.cuts.length + 1,
      length_cm: length,
      pile_id: pileId,
      pile_label: pileLabel,
      instruction: `Sahaa ${formatCm(length)} cm ja pinoa: ${pileLabel}`
    });
  });
  const boards = [...map.values()].map(b => {
    b.planned_use_cm = b.cuts.reduce((s, c) => s + Number(c.length_cm || 0), 0);
    b.planned_waste_cm = b.stock_length_cm - b.planned_use_cm;
    return b;
  });
  return {
    schema_version: "1.0",
    id: `csv-${Date.now()}`,
    name: `Tuotu suunnitelma: ${fileName}`,
    units: "cm",
    summary: { total_boards: boards.length, total_cuts: totalCuts(boards), stock_length_cm: 500, safety_margin_cm: DEFAULT_SAFETY_MARGIN_CM },
    piles: derivePiles(boards),
    boards
  };
}

function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], next = text[i + 1];
    if (ch === '"' && inQuotes && next === '"') { field += '"'; i++; continue; }
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === "," && !inQuotes) { row.push(field); field = ""; continue; }
    if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && next === "\n") i++;
      row.push(field); rows.push(row); row = []; field = ""; continue;
    }
    field += ch;
  }
  row.push(field); rows.push(row);
  return rows;
}

function exportState() {
  const payload = {
    plan_id: plan.id,
    plan_name: plan.name,
    exported_at: new Date().toISOString(),
    remaining_cuts: remainingCuts(),
    state
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `rimaflow-tilanne-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function updateSession(session) {
  const idx = state.boardSessions.findIndex(s => s.id === session.id);
  if (idx >= 0) state.boardSessions[idx] = JSON.parse(JSON.stringify(session));
}

function findSession(sessionId) {
  return state.boardSessions.find(s => s.id === sessionId) || null;
}

function safetyMarginCm() {
  return Number(plan?.summary?.safety_margin_cm ?? plan?.summary?.kerf_margin_cm ?? DEFAULT_SAFETY_MARGIN_CM);
}

function parseNumber(value) {
  if (typeof value === "number") return value;
  return Number(String(value ?? "").trim().replace(",", "."));
}

function round1(value) {
  return Math.round(Number(value || 0) * 10) / 10;
}

function formatCm(value) {
  const n = round1(value);
  return Number.isInteger(n) ? String(n) : String(n).replace(".", ",");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
