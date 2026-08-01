"use client";

import { useEffect, useState } from "react";
import {
  optimizeInitialization,
  optimizeTuning,
  runExperiment,
  type ExperimentParams,
  type ExperimentResult,
  type LinkFunction,
  type OptimizationResult,
  type ScatterPoint,
} from "./simulation";

type NumberFieldProps = {
  label: string;
  symbol: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
};

function NumberField({ label, symbol, value, min, max, step = 1, onChange }: NumberFieldProps) {
  return (
    <label className="number-field">
      <span>{label}<small>{symbol}</small></span>
      <input type="number" min={min} max={max} step={step} value={value}
        onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

function SelectField({ label, symbol, value, options, onChange }: {
  label: string;
  symbol: string;
  value: number;
  options: Array<{ value: number; label: string }>;
  onChange: (value: number) => void;
}) {
  return (
    <label className="number-field">
      <span>{label}<small>{symbol}</small></span>
      <select value={value} onChange={(event) => onChange(Number(event.target.value))}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

function ScoreRing({ value, label, tone }: { value: number; label: string; tone: string }) {
  const radius = 49;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="score">
      <svg viewBox="0 0 120 120" role="img" aria-label={`${label}: ${value.toFixed(3)}`}>
        <circle className="ring-bg" cx="60" cy="60" r={radius} />
        <circle className={`ring ${tone}`} cx="60" cy="60" r={radius}
          strokeDasharray={circumference} strokeDashoffset={circumference * (1 - value)} />
      </svg>
      <div className="score-value"><strong>{value.toFixed(3)}</strong><span>{label}</span></div>
    </div>
  );
}

function PathPlot({ result, activeStep, setActiveStep }: {
  result: ExperimentResult;
  activeStep: number;
  setActiveStep: (step: number) => void;
}) {
  const points = [result.initialCosine, ...result.path.map((point) => point.cosine)];
  const width = 680, height = 220, left = 48, top = 20, bottom = 34;
  const x = (i: number) => left + (i / Math.max(1, points.length - 1)) * (width - left - 22);
  const y = (value: number) => top + (1 - value) * (height - top - bottom);
  return (
    <div className="plot-wrap">
      <svg className="plot" viewBox={`0 0 ${width} ${height}`} role="img"
        aria-label="Absolute cosine recovery over adaptive scales">
        {[0, .25, .5, .75, 1].map((value) => (
          <g key={value}><line x1={left} x2={width - 22} y1={y(value)} y2={y(value)} />
            <text x={left - 10} y={y(value) + 4}>{value.toFixed(2)}</text></g>
        ))}
        <polyline points={points.map((value, i) => `${x(i)},${y(value)}`).join(" ")} />
        {points.map((value, i) => <circle className={i === activeStep ? "active-point" : ""}
          onClick={() => setActiveStep(i)} key={i} cx={x(i)} cy={y(value)} r={i === activeStep ? 7 : 5} />)}
        {points.map((_, i) => <text className="x-label" key={`x${i}`} x={x(i)} y={height - 7}>
          {i === 0 ? "init" : `k${i - 1}`}
        </text>)}
      </svg>
    </div>
  );
}

function ScatterPlot({ points, label }: { points: ScatterPoint[]; label: string }) {
  const width = 680, height = 250, pad = 38;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const xMin = Math.min(...xs), xMax = Math.max(...xs), yMin = Math.min(...ys), yMax = Math.max(...ys);
  const x = (value: number) => pad + (value - xMin) / Math.max(1e-8, xMax - xMin) * (width - 2 * pad);
  const y = (value: number) => height - pad - (value - yMin) / Math.max(1e-8, yMax - yMin) * (height - 2 * pad);
  return (
    <svg className="scatter" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Y against ${label}`}>
      <line x1={pad} x2={pad} y1={pad} y2={height - pad} />
      <line x1={pad} x2={width - pad} y1={height - pad} y2={height - pad} />
      {points.map((point, i) => <circle key={i} cx={x(point.x)} cy={y(point.y)} r="2.5" />)}
      <text x={width / 2} y={height - 7}>{label}</text>
      <text className="y-axis" transform={`translate(12 ${height / 2}) rotate(-90)`}>Yᵢ</text>
    </svg>
  );
}

function Sensitivity({ optimization }: { optimization: OptimizationResult }) {
  return (
    <div className="sensitivity-grid">
      {optimization.rows.map((row) => {
        const low = Math.min(...row.scores), high = Math.max(...row.scores);
        return (
          <div className="sensitivity-item" key={row.parameter}>
            <span>{row.parameter}</span><strong>{row.best}</strong>
            <small>accuracy range {low.toFixed(3)}–{high.toFixed(3)}</small>
          </div>
        );
      })}
    </div>
  );
}

const initialParams: ExperimentParams = {
  n: 800, d: 10, sigma: .15, tau: .15, link: "sin1", seed: 7,
  nLoc: 10, lambda: 10, nJ: 50, nPhi: 10,
  nLin: 40, centerRho: .1, kMax: 5,
  factor: Math.SQRT2, hMinScale: 2,
};

function computeInBackground<T>(kind: "run" | "initialize" | "tune", params: ExperimentParams) {
  return new Promise<T>((resolve, reject) => {
    const worker = new Worker(new URL("./simulation.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<{ result?: T; error?: string }>) => {
      worker.terminate();
      if (event.data.error) reject(new Error(event.data.error));
      else resolve(event.data.result as T);
    };
    worker.onerror = () => {
      worker.terminate();
      reject(new Error("The calculation stopped unexpectedly. Try a smaller Nⱼ or Nᵩ."));
    };
    worker.postMessage({ kind, params });
  });
}

export default function Home() {
  const [mounted, setMounted] = useState(false);
  const [params, setParams] = useState(initialParams);
  const [result, setResult] = useState(() => runExperiment(initialParams));
  const [activeStep, setActiveStep] = useState(result.path.length);
  const [scatterTruth, setScatterTruth] = useState(false);
  const [running, setRunning] = useState<"run" | "tune" | null>(null);
  const [optimization, setOptimization] = useState<OptimizationResult | null>(null);
  const [initializationNote, setInitializationNote] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => setMounted(true), []);

  const update = <K extends keyof ExperimentParams>(key: K, value: ExperimentParams[K]) =>
    setParams((current) => {
      const next = { ...current, [key]: value };
      if (key === "d") next.nLin = Math.max(next.nLin, Number(value) + 2);
      if (key === "n") next.nLin = Math.min(next.nLin, Number(value) - 1);
      return next;
    });

  async function execute(next: ExperimentParams, stepByStep = false) {
    setRunning("run");
    setFailure(null);
    try {
      const nextResult = await computeInBackground<ExperimentResult>("run", next);
      setResult(nextResult);
      setActiveStep(stepByStep ? 0 : nextResult.path.length);
      setOptimization(null);
      setInitializationNote(null);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "The simulation could not be completed.");
    } finally {
      setRunning(null);
    }
  }

  function redraw() {
    const next = { ...params, seed: params.seed + 1 };
    setParams(next);
    execute(next);
  }

  async function tune() {
    setRunning("tune");
    setFailure(null);
    try {
      const tuned = await computeInBackground<OptimizationResult>("tune", params);
      setOptimization(tuned);
      setParams(tuned.params);
      setResult(tuned.result);
      setActiveStep(tuned.result.path.length);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "The tuning search could not be completed.");
    } finally {
      setRunning(null);
    }
  }

  async function tuneInitialization() {
    setRunning("tune");
    setFailure(null);
    try {
      const tuned = await computeInBackground<ReturnType<typeof optimizeInitialization>>("initialize", params);
      setParams(tuned.params);
      setResult(tuned.result);
      setActiveStep(0);
      setOptimization(null);
      setInitializationNote(
        `Tested Nₗᵢₙ = ${tuned.tested.join(", ")}; selected ${tuned.params.nLin}.`,
      );
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "Initialization tuning could not be completed.");
    } finally {
      setRunning(null);
    }
  }

  if (!mounted) return <main className="boot"><p>Preparing the locally centered simulation…</p></main>;

  const current = activeStep === 0 ? null : result.path[activeStep - 1];
  const currentCosine = current?.cosine ?? result.initialCosine;
  const currentScatter = scatterTruth ? result.truthScatter : current?.scatter ?? result.initialScatter;
  const gain = result.finalCosine - result.initialCosine;

  return (
    <main>
      <header>
        <div className="brand"><span className="brand-mark">M</span><span>Average Derivative Lab</span></div>
        <div className="paper-tag">Modified procedure · August 1</div>
      </header>

      <section className="hero">
        <div>
          <p className="eyebrow">LOCALLY CENTERED ESTIMATOR</p>
          <h1>Center locally.<br/><i>Recover globally.</i></h1>
          <p className="lede">Explore the modified single-index procedure. Each neighborhood is centered at its weighted mean Mⱼ before initialization and alternating optimization.</p>
        </div>
        <div className="formula">Zⱼ ≈ ℓⱼ Uⱼ β</div>
      </section>

      <section className="workspace">
        <aside className="panel controls">
          <div className="control-section">
            <div className="section-title"><b>01</b><span>Design</span></div>
            <label className="number-field wide">
              <span>Link function<small>f(·)</small></span>
              <select value={params.link} onChange={(event) => update("link", event.target.value as LinkFunction)}>
                {[1, 2, 3, 4].map((s) => <option key={`sin${s}`} value={`sin${s}`}>f(t) = sin({s === 1 ? "" : s}t)</option>)}
                {[1, 2, 3, 4].map((s) => <option key={`xsin${s}`} value={`xsin${s}`}>f(t) = t sin({s === 1 ? "" : s}t)</option>)}
              </select>
            </label>
            <div className="field-grid">
              <NumberField label="Sample" symbol="n" value={params.n} min={800} max={2000} step={100} onChange={(v) => update("n", v)} />
              <NumberField label="Dimension" symbol="d" value={params.d} min={10} max={100} onChange={(v) => update("d", v)} />
              <NumberField label="Noise" symbol="σᵋ" value={params.sigma} min={.1} max={1} step={.05} onChange={(v) => update("sigma", v)} />
              <NumberField label="Correlation" symbol="τ" value={params.tau} min={0} max={.9} step={.05} onChange={(v) => update("tau", v)} />
            </div>
          </div>

          <div className="control-section">
            <div className="section-title"><b>02</b><span>Initialization</span></div>
            <div className="field-grid">
              <NumberField label="Local linear" symbol="Nₗᵢₙ" value={params.nLin} min={params.d + 2} max={Math.max(params.d + 2, params.n - 1)} onChange={(v) => update("nLin", v)} />
              <NumberField label="Centers" symbol="Nⱼ" value={params.nJ} min={5} max={Math.min(200, params.n)} step={5} onChange={(v) => update("nJ", v)} />
              <SelectField label="Displacement" symbol="ν" value={params.centerRho}
                options={[.1, .3, .5].map((v) => ({ value: v, label: String(v) }))} onChange={(v) => update("centerRho", v)} />
            </div>
            <button className="ghost inline-action" onClick={tuneInitialization} disabled={running !== null}>
              {running === "tune" ? "Optimizing…" : "Optimize Nₗᵢₙ"}
            </button>
            {initializationNote && <p className="mini-note">{initializationNote}</p>}
          </div>

          <div className="control-section">
            <div className="section-title"><b>03</b><span>Main procedure</span></div>
            <div className="field-grid">
              <SelectField label="Local mass" symbol="Nₗₒ꜀" value={params.nLoc}
                options={[7, 10, 15, 20].map((v) => ({ value: v, label: String(v) }))} onChange={(v) => update("nLoc", v)} />
              <NumberField label="Directions" symbol="Nᵩ" value={params.nPhi} min={1} max={60} onChange={(v) => update("nPhi", v)} />
              <NumberField label="Penalty" symbol="λ" value={params.lambda} min={1} max={Math.max(1, 2 * params.nLoc)} onChange={(v) => update("lambda", v)} />
              <SelectField label="Decrease" symbol="a" value={params.factor}
                options={[
                  { value: Math.pow(2, .25), label: "2¼" },
                  { value: Math.SQRT2, label: "√2" },
                  { value: 2, label: "2" },
                ]} onChange={(v) => update("factor", v)} />
              <SelectField label="AO repeats" symbol="kₘₐₓ" value={params.kMax}
                options={[3, 5, 7].map((v) => ({ value: v, label: String(v) }))} onChange={(v) => update("kMax", v)} />
              <SelectField label="Smallest h" symbol="hₘᵢₙ" value={params.hMinScale}
                options={[1, 2, 3].map((v) => ({ value: v, label: `${v}σₓ/√n` }))} onChange={(v) => update("hMinScale", v)} />
            </div>
            <p className="mini-note">{"Tₖ² = hₖ⁻²{ρₖ²(I − ββᵀ) + ββᵀ}; ρₖ is the largest value retaining at least Nₗₒᶜ local points."}</p>
          </div>

          <div className="action-stack">
            <button onClick={() => execute(params)} disabled={running !== null}>
              {running === "run" ? "Estimating…" : "Run whole procedure"}<span>→</span>
            </button>
            <button className="secondary" onClick={() => execute(params, true)} disabled={running !== null}>Start step-by-step</button>
            <div className="button-pair">
              <button className="ghost" onClick={redraw} disabled={running !== null}>↻ Redraw data</button>
              <button className="ghost" onClick={tune} disabled={running !== null}>{running === "tune" ? "Tuning…" : "Optimize tuning"}</button>
            </div>
          </div>
          <p className="footnote">Optimization performs a coordinate search over Nₗₒ꜀, Nⱼ, Nᵩ, and λ using the known truth in this simulation.</p>
        </aside>

        <div className="results">
          {failure && <div className="warning">{failure}</div>}
          {result.warning && <div className="warning">{result.warning}</div>}
          <div className="method-card" aria-label="Changes in the modified estimator">
            <div><span>01</span><strong>Local mean</strong><small>Mⱼ = ΣᵢXᵢwᵢⱼ / Σᵢwᵢⱼ</small></div>
            <div><span>02</span><strong>Centered moments</strong><small>Zⱼ and Uⱼ use Xᵢ − Mⱼ</small></div>
            <div><span>03</span><strong>Lean AO step</strong><small>min Σⱼ ‖Zⱼ − ℓⱼUⱼβ‖²</small></div>
          </div>
          <div className="score-card">
            <div className="score-copy">
              <p className="eyebrow">CURRENT STAGE · {activeStep === 0 ? "INITIALIZATION" : `SCALE k${activeStep - 1}`}</p>
              <h2>{currentCosine > .95 ? "The direction is sharply resolved." : currentCosine > .7 ? "The direction is emerging." : "This setting is challenging."}</h2>
              <div className="live-metrics">
                <div><span>accuracy</span><strong>{currentCosine.toFixed(4)}</strong></div>
                <div><span>hₖ</span><strong>{current ? current.h.toFixed(4) : "—"}</strong></div>
                <div><span>hₖ / ρₖ</span><strong>{activeStep === 1 ? "isotropic" : current ? current.rho === 0 ? "∞" : (current.h / current.rho).toFixed(4) : "—"}</strong></div>
                <div><span>◇ₖ data fit</span><strong>{current ? current.dataFit >= 10000 ? current.dataFit.toExponential(3) : current.dataFit.toFixed(2) : "—"}</strong></div>
              </div>
              <p className="eigenvalues">Q eigenvalues: <strong>λ₁ {result.eigenvalues[0]?.toFixed(3)}</strong><strong>λ₂ {result.eigenvalues[1]?.toFixed(3)}</strong></p>
              {current && <p className="ao-path"><span>AO accuracy:</span> {current.aoCosines.map((value) => value.toFixed(3)).join(" → ")}</p>}
              <div className="step-actions">
                <button className="ghost" disabled={activeStep === 0} onClick={() => setActiveStep((step) => step - 1)}>← Previous</button>
                <button className="ghost" disabled={activeStep === result.path.length} onClick={() => setActiveStep((step) => step + 1)}>Next step →</button>
              </div>
            </div>
            <div className="rings">
              <ScoreRing value={result.initialCosine} label="Centered init" tone="init" />
              <ScoreRing value={result.finalCosine} label="Full procedure" tone="final" />
              <div className={`gain ${gain >= 0 ? "positive" : "negative"}`}>{gain >= 0 ? "+" : ""}{gain.toFixed(3)}<span>total gain</span></div>
            </div>
          </div>

          <div className="chart-card">
            <div className="chart-head">
              <div><p className="eyebrow">MULTISCALE PATH</p><h3>Accuracy at every step</h3></div>
              <span>{result.path.length} scales · {result.elapsedMs.toFixed(0)} ms</span>
            </div>
            <PathPlot result={result} activeStep={activeStep} setActiveStep={setActiveStep} />
            <div className="scale-table">
              <span>stage</span><span>hₖ</span><span>hₖ / ρₖ</span><span>◇ₖ fit</span><span>|cos(βₖ,β*)|</span>
              <b>init</b><em>—</em><em>—</em><em>—</em><strong>{result.initialCosine.toFixed(4)}</strong>
              {result.path.map((row, i) => (
                <div className={`table-row ${activeStep === i + 1 ? "selected" : ""}`} key={i}>
                  <b>k{i}</b><em>{row.h.toFixed(4)}</em><em>{i === 0 ? "—" : row.rho === 0 ? "∞" : (row.h / row.rho).toFixed(4)}</em><em>{row.dataFit >= 10000 ? row.dataFit.toExponential(2) : row.dataFit.toFixed(2)}</em><strong>{row.cosine.toFixed(4)}</strong>
                </div>
              ))}
            </div>
            <p className="chart-note">At k0 the localization tensor is isotropic, T₀ = h₀⁻¹I, so ρ₀ is not defined. ◇ₖ is the weighted local residual sum from the fitted slope and local response mean.</p>
          </div>

          <div className="chart-card">
            <div className="chart-head">
              <div><p className="eyebrow">DATA VIEW</p><h3>Response against index projection</h3></div>
              <div className="toggle">
                <button className={scatterTruth ? "active" : ""} onClick={() => setScatterTruth(true)}>True β*</button>
                <button className={!scatterTruth ? "active" : ""} onClick={() => setScatterTruth(false)}>{activeStep === 0 ? "Initial β" : `β k${activeStep - 1}`}</button>
              </div>
            </div>
            <ScatterPlot points={currentScatter} label={scatterTruth ? "Xᵢᵀβ*" : activeStep === 0 ? "Xᵢᵀβᵢₙ" : `Xᵢᵀβ${activeStep - 1}`} />
            <p className="chart-note">Change τ in the Design section and redraw the data to compare correlated designs from 0 to 0.9.</p>
          </div>

          {optimization && (
            <div className="chart-card tune-card">
              <div className="chart-head">
                <div><p className="eyebrow">SENSITIVITY & OPTIMIZATION</p><h3>Best coordinate-wise settings</h3></div>
                <span>{optimization.fits} fitted configurations</span>
              </div>
              <Sensitivity optimization={optimization} />
            </div>
          )}
        </div>
      </section>

      <footer><span>Efficient dimension reduction by average derivative</span><span>Modified locally centered procedure · β and −β are equivalent</span></footer>
    </main>
  );
}
