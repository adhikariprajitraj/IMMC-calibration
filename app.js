// app.js
(() => {
  // -----------------------------
  // Slide navigation + UI
  // -----------------------------
  const slides = Array.from(document.querySelectorAll(".slide"));
  const total = slides.length;
  let current = 0;
  let isAnimating = false;

  const $ = (id) => document.getElementById(id);

  const plotRegistry = new Map(); // canvasId -> controller

  function buildThumbNav() {
    const thumbList = $("thumb-list");
    if (!thumbList) return;
    thumbList.innerHTML = "";
    slides.forEach((sl, i) => {
      const div = document.createElement("div");
      div.className = "thumb-item" + (i === 0 ? " active" : "");
      div.innerHTML = `<span class="thumb-num">${String(i + 1).padStart(2, "0")}</span>
                       <span class="thumb-title">${sl.dataset.title || `Slide ${i + 1}`}</span>`;
      div.addEventListener("click", () => { goTo(i); toggleMenu(false); });
      thumbList.appendChild(div);
    });
  }

  function toggleMenu(force) {
    const nav = $("thumb-nav");
    if (!nav) return;
    const open = nav.classList.contains("open");
    nav.classList.toggle("open", force !== undefined ? force : !open);
  }

  function stopPlotsInSlide(slideEl) {
    if (!slideEl) return;
    slideEl.querySelectorAll("canvas.plot-canvas").forEach((c) => {
      plotRegistry.get(c.id)?.stop?.();
    });
  }

  function startPlotsInSlide(slideEl, mode = "restart") {
    if (!slideEl) return;
    slideEl.querySelectorAll("canvas.plot-canvas").forEach((c) => {
      const ctl = plotRegistry.get(c.id);
      if (!ctl) return;
      if (ctl.start) ctl.start();
      else if (mode === "full") ctl.drawFull?.();
      else ctl.restart?.();
    });
  }

  function updateUI() {
    const n = String(current + 1).padStart(2, "0");
    $("slide-counter").textContent = `${n} / ${String(total).padStart(2, "0")}`;

    $("btn-prev").disabled = current === 0;
    $("btn-next").disabled = current === total - 1;

    $("progress-bar").style.width = ((current + 1) / total * 100) + "%";

    // Use the current slide header label as section indicator if present.
    const sl = slides[current];
    const section =
      sl.querySelector(".slide-header .section-label")?.textContent ||
      sl.querySelector(".sec-label")?.textContent ||
      "IMMC Training · Mathematics Initiatives in Nepal";
    $("section-indicator").textContent = section;

    document.querySelectorAll(".thumb-item").forEach((el, i) => el.classList.toggle("active", i === current));
    document.querySelector(".thumb-item.active")?.scrollIntoView({ block: "nearest" });
  }

  function renderMath(root = document.body) {
    if (!window.renderMathInElement) return;
    window.renderMathInElement(root, {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "\\[", right: "\\]", display: true },
        { left: "$", right: "$", display: false },
        { left: "\\(", right: "\\)", display: false },
      ],
      throwOnError: false,
      strict: "ignore",
    });
  }

  function navigate(dir) {
    if (isAnimating) return;
    const next = current + dir;
    if (next < 0 || next >= total) return;

    isAnimating = true;
    stopPlotsInSlide(slides[current]);

    slides[current].classList.remove("active");
    slides[current].classList.add("exit");

    setTimeout(() => {
      slides[current].classList.remove("exit");
      current = next;
      slides[current].classList.add("active");

      updateUI();
      renderMath(slides[current]);
      startPlotsInSlide(slides[current], "restart");
      isAnimating = false;
    }, 180);
  }

  function goTo(idx) {
    if (idx === current || isAnimating) return;
    isAnimating = true;

    stopPlotsInSlide(slides[current]);
    slides[current].classList.remove("active");
    slides[current].classList.add("exit");

    setTimeout(() => {
      slides[current].classList.remove("exit");
      current = idx;
      slides[current].classList.add("active");

      updateUI();
      renderMath(slides[current]);
      startPlotsInSlide(slides[current], "restart");
      isAnimating = false;
    }, 180);
  }

  // -----------------------------
  // HiDPI canvas + plotting utils
  // -----------------------------
  function prepCanvas(canvas, ctx) {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const root = getComputedStyle(document.documentElement);
    const deckScale = Number.parseFloat(root.getPropertyValue("--deck-scale")) || 1;
    const pixelRatio = dpr * deckScale;
    const cssW = Math.max(1, canvas.clientWidth);
    const cssH = Math.max(1, canvas.clientHeight);

    const need = canvas.width !== Math.round(cssW * pixelRatio) || canvas.height !== Math.round(cssH * pixelRatio);
    if (need) {
      canvas.width = Math.round(cssW * pixelRatio);
      canvas.height = Math.round(cssH * pixelRatio);
    }

    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    const pad = { l: 46, r: 16, t: 16, b: 34 };
    const plotW = Math.max(1, cssW - pad.l - pad.r);
    const plotH = Math.max(1, cssH - pad.t - pad.b);

    return {
      w: cssW, h: cssH, pad,
      x0: pad.l, y0: pad.t,
      x1: cssW - pad.r, y1: cssH - pad.b,
      plotW, plotH,
    };
  }

  function xMap(m, x, xMin, xMax) {
    return m.x0 + ((x - xMin) / (xMax - xMin)) * m.plotW;
  }
  function yMap(m, y, yMin, yMax) {
    return m.y1 - ((y - yMin) / (yMax - yMin)) * m.plotH;
  }

  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function plotFrame(ctx, m, { yTicks = 5, xTicks = 5, xLabel = "", yLabel = "" } = {}) {
    ctx.clearRect(0, 0, m.w, m.h);

    // background
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, m.w, m.h);

    // subtle plot background
    ctx.fillStyle = "rgba(249,249,247,0.65)";
    roundRect(ctx, m.x0 - 10, m.y0 - 8, m.plotW + 20, m.plotH + 16, 12);
    ctx.fill();

    // grid
    ctx.strokeStyle = "#ededed";
    ctx.lineWidth = 1;

    for (let i = 1; i <= yTicks; i++) {
      const y = m.y0 + (i / (yTicks + 1)) * m.plotH;
      ctx.beginPath();
      ctx.moveTo(m.x0, Math.round(y) + 0.5);
      ctx.lineTo(m.x1, Math.round(y) + 0.5);
      ctx.stroke();
    }

    for (let i = 1; i <= xTicks; i++) {
      const x = m.x0 + (i / (xTicks + 1)) * m.plotW;
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, m.y0);
      ctx.lineTo(Math.round(x) + 0.5, m.y1);
      ctx.stroke();
    }

    // axes
    ctx.strokeStyle = "#d9d9d9";
    ctx.lineWidth = 1.25;

    ctx.beginPath();
    ctx.moveTo(m.x0 + 0.5, m.y0);
    ctx.lineTo(m.x0 + 0.5, m.y1 + 0.5);
    ctx.lineTo(m.x1, m.y1 + 0.5);
    ctx.stroke();

    // axis labels
    if (xLabel || yLabel) {
      ctx.save();
      ctx.fillStyle = "#666";
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.textAlign = "right";
      if (xLabel) ctx.fillText(xLabel, m.x1, m.h - 10);
      if (yLabel) {
        ctx.save();
        ctx.translate(12, m.y0 + m.plotH / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = "center";
        ctx.fillText(yLabel, 0, 0);
        ctx.restore();
      }
      ctx.restore();
    }
  }

  function drawNote(ctx, m, title, text) {
    const boxW = Math.min(360, Math.max(240, Math.round(m.w * 0.50)));
    const boxH = 62;
    const x = m.x0 + Math.max(12, (m.plotW - boxW) * 0.58);
    const y = 18;

    ctx.save();
    roundRect(ctx, x, y, boxW, boxH, 12);
    ctx.fillStyle = "rgba(255,255,255,0.90)";
    ctx.fill();
    ctx.strokeStyle = "rgba(18,18,18,0.12)";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = "#8f1d1d";
    ctx.font = '600 10px "JetBrains Mono", monospace';
    ctx.fillText(title, x + 12, y + 18);

    ctx.fillStyle = "#333";
    ctx.font = '12px "EB Garamond", serif';
    // simple wrap (2 lines)
    const maxW = boxW - 24;
    const words = String(text).split(/\s+/);
    let line = "", yy = y + 40, lines = 0;
    for (let i = 0; i < words.length; i++) {
      const test = line ? `${line} ${words[i]}` : words[i];
      if (ctx.measureText(test).width <= maxW) { line = test; continue; }
      ctx.fillText(line, x + 12, yy);
      lines++;
      if (lines >= 2) break;
      line = words[i];
      yy += 14;
    }
    if (lines < 2 && line) ctx.fillText(line, x + 12, yy);

    ctx.restore();
  }

  // DOM overlay legend (crisp, aligned, looks “native”)
  function ensureLegend(plotWrap, items) {
    if (!plotWrap || plotWrap.querySelector(".plot-legend")) return;
    const div = document.createElement("div");
    div.className = "plot-legend";
    items.forEach((it) => {
      const sp = document.createElement("span");
      sp.className = "item";
      const sw = document.createElement("i");
      sw.className = "sw";
      sw.style.setProperty("--c", it.color);
      const tx = document.createElement("span");
      tx.textContent = it.label;
      sp.appendChild(sw);
      sp.appendChild(tx);
      div.appendChild(sp);
    });
    plotWrap.appendChild(div);
  }

  // -----------------------------
  // Animators
  // -----------------------------
  function makeOneShot(draw, { speed = 0.055 } = {}) {
    let progress = 0;
    let raf = 0;
    const tick = () => {
      progress = Math.min(1, progress + speed);
      draw(progress);
      if (progress < 1) raf = requestAnimationFrame(tick);
      else raf = 0;
    };
    return {
      restart() { progress = 0; if (!raf) tick(); },
      drawFull() { progress = 1; draw(1); },
      stop() { if (raf) cancelAnimationFrame(raf); raf = 0; },
    };
  }

  function makeLoop(draw) {
    let raf = 0;
    let t0 = 0;
    const tick = (t) => {
      if (!t0) t0 = t;
      const dt = (t - t0) / 1000;
      draw(dt);
      raf = requestAnimationFrame(tick);
    };
    return {
      start() { if (!raf) { t0 = 0; raf = requestAnimationFrame(tick); } },
      stop() { if (raf) cancelAnimationFrame(raf); raf = 0; t0 = 0; },
      drawFull() { draw(0); },
    };
  }

  function bindRange(id, format, onChange) {
    const input = $(id);
    const out = $(`${id}-val`);
    if (!input || !out) return;

    const update = () => {
      out.textContent = format(Number(input.value));
      onChange?.();
    };

    input.addEventListener("input", update);
    update();
  }

  function initGradientDescentLab() {
    const canvas = $("gdx-canvas");
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    const etaInput = $("gdx-eta");
    const startInput = $("gdx-start");
    const stepsInput = $("gdx-steps");
    const lossOut = $("gdx-loss");
    const thetaOut = $("gdx-theta");
    const resetBtn = $("gdx-reset");

    if (!etaInput || !startInput || !stepsInput) return;

    const optimum = 3;
    const xMin = -4;
    const xMax = 10;
    const yMax = 52;

    const draw = (progress = 1) => {
      const m = prepCanvas(canvas, ctx);
      plotFrame(ctx, m, { xTicks: 5, yTicks: 4, xLabel: "θ", yLabel: "L(θ)" });

      const eta = Number(etaInput.value);
      const start = Number(startInput.value);
      const steps = Number(stepsInput.value);

      ctx.strokeStyle = "#a02020";
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i <= 300; i++) {
        const x = xMin + (i / 300) * (xMax - xMin);
        const y = (x - optimum) * (x - optimum);
        const px = xMap(m, x, xMin, xMax);
        const py = yMap(m, y, 0, yMax);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();

      const path = [start];
      for (let i = 0; i < steps; i++) {
        const t = path[path.length - 1];
        const grad = 2 * (t - optimum);
        path.push(t - eta * grad);
      }

      const visibleCount = Math.max(2, Math.floor(path.length * progress));
      const visiblePath = path.slice(0, visibleCount);

      ctx.strokeStyle = "#222";
      ctx.lineWidth = 1.7;
      ctx.beginPath();
      visiblePath.forEach((theta, idx) => {
        const y = (theta - optimum) * (theta - optimum);
        const px = xMap(m, theta, xMin, xMax);
        const py = yMap(m, y, 0, yMax);
        if (idx === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();

      ctx.fillStyle = "#111";
      visiblePath.forEach((theta) => {
        const y = (theta - optimum) * (theta - optimum);
        const px = xMap(m, theta, xMin, xMax);
        const py = yMap(m, y, 0, yMax);
        ctx.beginPath();
        ctx.arc(px, py, 2.8, 0, Math.PI * 2);
        ctx.fill();
      });

      const finalTheta = path[path.length - 1];
      const finalLoss = (finalTheta - optimum) * (finalTheta - optimum);
      if (lossOut) lossOut.textContent = `L(θ)=${finalLoss.toFixed(4)}`;
      if (thetaOut) thetaOut.textContent = `θ*=${finalTheta.toFixed(3)}`;

      const note = eta > 0.55
        ? "Large η can overshoot and oscillate around the minimum."
        : "Updates move downhill and settle near the parabola minimum.";
      drawNote(ctx, m, "WHAT YOU'RE SEEING", note);
    };

    const controller = makeOneShot(draw, { speed: 0.055 });

    bindRange("gdx-eta", (v) => v.toFixed(2), () => controller.restart());
    bindRange("gdx-start", (v) => v.toFixed(1), () => controller.restart());
    bindRange("gdx-steps", (v) => String(v), () => controller.restart());

    if (resetBtn) {
      resetBtn.addEventListener("click", () => {
        etaInput.value = "0.22";
        startInput.value = "8.2";
        stepsInput.value = "14";
        $("gdx-eta-val").textContent = "0.22";
        $("gdx-start-val").textContent = "8.2";
        $("gdx-steps-val").textContent = "14";
        controller.restart();
      });
    }

    plotRegistry.set(canvas.id, controller);
  }

  function initSirxLab() {
    const canvas = $("sirx-canvas");
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    const betaInput = $("sirx-beta");
    const gammaInput = $("sirx-gamma");
    const i0Input = $("sirx-i0");
    const daysInput = $("sirx-days");
    const r0Out = $("sirx-r0");
    const peakOut = $("sirx-peak");
    const peakDayOut = $("sirx-peak-day");

    if (!betaInput || !gammaInput || !i0Input || !daysInput) return;

    const draw = (progress = 1) => {
      const m = prepCanvas(canvas, ctx);
      plotFrame(ctx, m, { xTicks: 5, yTicks: 4, xLabel: "days", yLabel: "population share" });

      const beta = Number(betaInput.value);
      const gamma = Number(gammaInput.value);
      const i0 = Number(i0Input.value) / 100;
      const days = Number(daysInput.value);

      const dt = 0.3;
      const steps = Math.max(2, Math.floor(days / dt));
      let s = 1 - i0;
      let i = i0;
      let r = 0;
      const S = [s], I = [i], R = [r];

      for (let t = 0; t < steps; t++) {
        const ds = -beta * s * i;
        const di = beta * s * i - gamma * i;
        const dr = gamma * i;
        s = Math.max(0, s + ds * dt);
        i = Math.max(0, i + di * dt);
        r = Math.max(0, r + dr * dt);
        const sum = s + i + r;
        if (sum > 0) {
          s /= sum;
          i /= sum;
          r /= sum;
        }
        S.push(s);
        I.push(i);
        R.push(r);
      }

      const visibleCount = Math.max(2, Math.floor(S.length * progress));
      const Sv = S.slice(0, visibleCount);
      const Iv = I.slice(0, visibleCount);
      const Rv = R.slice(0, visibleCount);

      const drawSeries = (series, color) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        series.forEach((v, idx) => {
          const day = (idx / (series.length - 1)) * days;
          const px = xMap(m, day, 0, days);
          const py = yMap(m, v, 0, 1);
          if (idx === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.stroke();
      };

      drawSeries(Sv, "#2f7d32");
      drawSeries(Iv, "#a02020");
      drawSeries(Rv, "#1f5fa8");

      const peakI = Math.max(...I);
      const peakIdx = I.indexOf(peakI);
      const peakDay = peakIdx * dt;
      const r0 = gamma > 0 ? beta / gamma : 0;

      if (r0Out) r0Out.textContent = `R₀=${r0.toFixed(2)}`;
      if (peakOut) peakOut.textContent = `Peak I=${(peakI * 100).toFixed(1)}%`;
      if (peakDayOut) peakDayOut.textContent = `Peak day=${peakDay.toFixed(1)}`;

      const c = Math.max(1, visibleCount - 1);
      const trend = Iv[c] > Iv[Math.max(0, c - 1)] ? "rising" : "falling";
      drawNote(ctx, m, "WHAT YOU'RE SEEING", `I(t) is ${trend}; decline starts after susceptible pool drops.`);
    };

    const controller = makeOneShot(draw, { speed: 0.055 });

    bindRange("sirx-beta", (v) => v.toFixed(2), () => controller.restart());
    bindRange("sirx-gamma", (v) => v.toFixed(2), () => controller.restart());
    bindRange("sirx-i0", (v) => `${v.toFixed(1)}%`, () => controller.restart());
    bindRange("sirx-days", (v) => String(v), () => controller.restart());

    ensureLegend(canvas.closest(".plot-wrap"), [
      { label: "S(t)", color: "#2f7d32" },
      { label: "I(t)", color: "#a02020" },
      { label: "R(t)", color: "#1f5fa8" },
    ]);

    plotRegistry.set(canvas.id, controller);
  }

  function initLogxLab() {
    const canvas = $("logx-canvas");
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    const kInput = $("logx-k");
    const aInput = $("logx-a");
    const rInput = $("logx-r");
    const rmseOut = $("logx-rmse");
    const midOut = $("logx-mid");
    const obs = [8, 11, 14, 19, 28, 36, 48, 59, 69, 76, 84, 89, 92, 96, 97, 99];
    const tVals = obs.map((_, idx) => idx * 2);

    if (!kInput || !aInput || !rInput) return;

    const model = (t, K, A, r) => K / (1 + A * Math.exp(-r * t));

    const draw = (progress = 1) => {
      const m = prepCanvas(canvas, ctx);
      plotFrame(ctx, m, { xTicks: 5, yTicks: 4, xLabel: "time", yLabel: "y" });

      const K = Number(kInput.value);
      const A = Number(aInput.value);
      const r = Number(rInput.value);
      const preds = tVals.map((t) => model(t, K, A, r));
      const maxT = tVals[tVals.length - 1];
      const maxY = Math.max(120, ...obs, ...preds) * 1.05;

      let mse = 0;
      for (let idx = 0; idx < obs.length; idx++) {
        const d = obs[idx] - preds[idx];
        mse += d * d;
      }
      const rmse = Math.sqrt(mse / obs.length);
      const inflection = r > 0 ? Math.log(A) / r : 0;

      ctx.fillStyle = "#121212";
      obs.forEach((v, idx) => {
        const px = xMap(m, tVals[idx], 0, maxT);
        const py = yMap(m, v, 0, maxY);
        ctx.beginPath();
        ctx.arc(px, py, 3, 0, Math.PI * 2);
        ctx.fill();
      });

      ctx.strokeStyle = "#a02020";
      ctx.lineWidth = 2;
      ctx.beginPath();
      const jMax = Math.max(2, Math.floor(240 * progress));
      for (let j = 0; j <= jMax; j++) {
        const t = (j / 240) * maxT;
        const y = model(t, K, A, r);
        const px = xMap(m, t, 0, maxT);
        const py = yMap(m, y, 0, maxY);
        if (j === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();

      if (rmseOut) rmseOut.textContent = `RMSE=${rmse.toFixed(2)}`;
      if (midOut) midOut.textContent = `Inflection t*=${inflection.toFixed(1)}`;

      const fitText = rmse < 6
        ? "Curve follows points well; fit error is low."
        : "Visible gap to points; tune K, A, and r to improve fit.";
      drawNote(ctx, m, "WHAT YOU'RE SEEING", fitText);
    };

    const controller = makeOneShot(draw, { speed: 0.055 });
    bindRange("logx-k", (v) => String(v.toFixed(0)), () => controller.restart());
    bindRange("logx-a", (v) => v.toFixed(1), () => controller.restart());
    bindRange("logx-r", (v) => v.toFixed(2), () => controller.restart());

    ensureLegend(canvas.closest(".plot-wrap"), [
      { label: "model", color: "#a02020" },
      { label: "observed", color: "#121212" },
    ]);

    plotRegistry.set(canvas.id, controller);
  }

  // -----------------------------
  // Standalone animations
  // -----------------------------
  function initLossLandscape() {
    const canvas = $("land-canvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    const status = $("land-status");
    const iterOut = $("land-iter");
    const bestOut = $("land-best");

    // Nonconvex-ish loss in 2D
    const L = (x, y) => {
      const a = (x*x + y*y) * 0.12;
      const b = 0.22 * Math.sin(2.2*x) * Math.cos(2.0*y);
      const c = 0.12 * Math.sin(3.0*y);
      return a + b + c;
    };

    // Numerical gradient
    const grad = (x, y) => {
      const e = 1e-3;
      const gx = (L(x + e, y) - L(x - e, y)) / (2*e);
      const gy = (L(x, y + e) - L(x, y - e)) / (2*e);
      return [gx, gy];
    };

    // State
    let x = 2.3, y = -1.8;
    let best = Infinity;
    let it = 0;

    const xMin = -4, xMax = 4;
    const yMin = -3, yMax = 3;

    function drawContours(m) {
      // contour grid (dense but cheap enough)
      const nx = 70, ny = 50;
      let minV = Infinity, maxV = -Infinity;
      const vals = [];
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const xx = xMin + (i / (nx - 1)) * (xMax - xMin);
          const yy = yMin + (j / (ny - 1)) * (yMax - yMin);
          const v = L(xx, yy);
          vals.push(v);
          minV = Math.min(minV, v);
          maxV = Math.max(maxV, v);
        }
      }

      // heat-ish background
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const v = vals[j * nx + i];
          const u = (v - minV) / (maxV - minV + 1e-9);
          const xx = xMin + (i / (nx - 1)) * (xMax - xMin);
          const yy = yMin + (j / (ny - 1)) * (yMax - yMin);
          const px = xMap(m, xx, xMin, xMax);
          const py = yMap(m, yy, yMin, yMax);

          // small rect cell
          ctx.fillStyle = `rgba(160,32,32,${0.05 + 0.10*u})`;
          ctx.fillRect(px - m.plotW/(nx*2), py - m.plotH/(ny*2), m.plotW/nx + 1, m.plotH/ny + 1);
        }
      }

      // a few contour lines
      ctx.strokeStyle = "rgba(18,18,18,0.10)";
      ctx.lineWidth = 1;

      const levels = 8;
      for (let k = 1; k <= levels; k++) {
        const target = minV + (k / (levels + 1)) * (maxV - minV);
        ctx.beginPath();
        // quick marching-like via sampling stripes
        for (let j = 0; j < ny; j++) {
          for (let i = 0; i < nx; i++) {
            const v = vals[j * nx + i];
            if (Math.abs(v - target) < (maxV - minV) / 120) {
              const xx = xMin + (i / (nx - 1)) * (xMax - xMin);
              const yy = yMin + (j / (ny - 1)) * (yMax - yMin);
              const px = xMap(m, xx, xMin, xMax);
              const py = yMap(m, yy, yMin, yMax);
              ctx.moveTo(px, py);
              ctx.lineTo(px + 1, py + 1);
            }
          }
        }
        ctx.stroke();
      }
    }

    const controller = makeLoop((time) => {
      const m = prepCanvas(canvas, ctx);
      plotFrame(ctx, m, { xTicks: 4, yTicks: 4, xLabel: "parameter θ₁", yLabel: "parameter θ₂" });

      drawContours(m);

      // gradient descent step (stable time-based)
      const [gx, gy] = grad(x, y);
      const eta = 0.08;
      x -= eta * gx;
      y -= eta * gy;

      // clamp in bounds
      x = Math.max(xMin, Math.min(xMax, x));
      y = Math.max(yMin, Math.min(yMax, y));

      const loss = L(x, y);
      best = Math.min(best, loss);
      it++;

      // draw current point + trail
      const px = xMap(m, x, xMin, xMax);
      const py = yMap(m, y, yMin, yMax);

      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.18)";
      ctx.shadowBlur = 10;

      ctx.fillStyle = "#a02020";
      ctx.beginPath();
      ctx.arc(px, py, 5.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.shadowBlur = 0;
      ctx.strokeStyle = "rgba(18,18,18,0.22)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(px, py, 6.1, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      drawNote(ctx, m, "WHAT YOU’RE SEEING", "A nonconvex loss surface with multiple basins. This run may converge to a local minimum.");

      if (status) status.textContent = "status: running";
      if (iterOut) iterOut.textContent = `iter=${it}`;
      if (bestOut) bestOut.textContent = `best L=${best.toFixed(4)}`;
    });

    plotRegistry.set(canvas.id, controller);
  }

  function initReliabilityDiagram() {
    const canvas = $("rel-canvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    const eceOut = $("rel-ece");
    const modeOut = $("rel-mode");

    // bins
    const B = 10;
    const bins = Array.from({ length: B }, (_, i) => (i + 0.5) / B);

    // “miscalibrated” curve (overconfident)
    const mis = (p) => Math.pow(p, 1.7);
    // “calibrated” curve ~ identity
    const cal = (p) => p;

    const controller = makeLoop((time) => {
      const m = prepCanvas(canvas, ctx);
      plotFrame(ctx, m, { xTicks: 4, yTicks: 4, xLabel: "predicted probability", yLabel: "observed frequency" });

      // interpolation from mis -> calibrated
      const alpha = 0.5 * (1 + Math.sin(time * 0.8)); // 0..1
      const curve = (p) => (1 - alpha) * mis(p) + alpha * cal(p);

      // perfect diagonal
      ctx.strokeStyle = "rgba(18,18,18,0.18)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(xMap(m, 0, 0, 1), yMap(m, 0, 0, 1));
      ctx.lineTo(xMap(m, 1, 0, 1), yMap(m, 1, 0, 1));
      ctx.stroke();
      ctx.setLineDash([]);

      // bars (bin freq)
      let ece = 0;
      ctx.fillStyle = "rgba(160,32,32,0.15)";
      ctx.strokeStyle = "rgba(160,32,32,0.35)";
      ctx.lineWidth = 1;

      bins.forEach((p, i) => {
        const f = curve(p);
        ece += Math.abs(f - p) / B;

        const x = xMap(m, p, 0, 1);
        const y = yMap(m, f, 0, 1);
        const base = yMap(m, 0, 0, 1);

        const w = m.plotW / B * 0.72;
        ctx.beginPath();
        ctx.rect(x - w / 2, y, w, base - y);
        ctx.fill();
        ctx.stroke();
      });

      // reliability curve
      ctx.strokeStyle = "#a02020";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      for (let i = 0; i <= 200; i++) {
        const p = i / 200;
        const f = curve(p);
        const x = xMap(m, p, 0, 1);
        const y = yMap(m, f, 0, 1);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      drawNote(ctx, m, "WHAT YOU’RE SEEING", "The curve moves toward the diagonal as calibration improves. Overconfidence shows below the diagonal.");

      if (eceOut) eceOut.textContent = `ECE=${ece.toFixed(3)}`;
      if (modeOut) modeOut.textContent = alpha > 0.5 ? "mode: closer to calibrated" : "mode: miscalibrated";
    });

    // legend overlay
    const wrap = canvas.closest(".plot-wrap");
    ensureLegend(wrap, [
      { label: "reliability", color: "#a02020" },
      { label: "perfect", color: "rgba(18,18,18,0.18)" },
    ]);

    plotRegistry.set(canvas.id, controller);
  }

  // -----------------------------
  // Existing interactive labs
  // -----------------------------

  // -----------------------------
  // Boot
  // -----------------------------
  function boot() {
    if (slides.length === 0) return;

    window.toggleMenu = toggleMenu;
    window.navigate = navigate;
    window.goTo = goTo;

    buildThumbNav();

    $("menu-btn")?.addEventListener("click", () => toggleMenu());
    $("btn-prev")?.addEventListener("click", () => navigate(-1));
    $("btn-next")?.addEventListener("click", () => navigate(1));

    document.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight" || e.key === " ") { e.preventDefault(); navigate(1); }
      if (e.key === "ArrowLeft") { e.preventDefault(); navigate(-1); }
      if (e.key === "Escape") toggleMenu(false);
    });

    // init animations (standalone)
    initLossLandscape();
    initReliabilityDiagram();
    initGradientDescentLab();
    initSirxLab();
    initLogxLab();

    // activate first slide
    slides.forEach((s, i) => s.classList.toggle("active", i === 0));
    updateUI();
    renderMath(document.body);
    startPlotsInSlide(slides[current], "full");

    // redraw on resize
    window.addEventListener("resize", () => {
      // redraw only active slide canvases
      startPlotsInSlide(slides[current], "full");
    });
  }

  window.addEventListener("load", boot);
})();