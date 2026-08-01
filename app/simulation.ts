export type LinkFunction =
  | "sin1" | "sin2" | "sin3" | "sin4"
  | "xsin1" | "xsin2" | "xsin3" | "xsin4";

export type ExperimentParams = {
  n: number;
  d: number;
  sigma: number;
  tau: number;
  nLoc: number;
  lambda: number;
  nJ: number;
  nPhi: number;
  nLin: number;
  centerRho: number;
  kMax: number;
  factor: number;
  hMinScale: number;
  seed: number;
  link: LinkFunction;
};

export type ScatterPoint = { x: number; y: number };
export type ScaleResult = {
  h: number;
  rho: number;
  cosine: number;
  beta: number[];
  aoCosines: number[];
  scatter: ScatterPoint[];
};
export type ExperimentResult = {
  initialCosine: number;
  finalCosine: number;
  initialBeta: number[];
  truthBeta: number[];
  eigenvalues: number[];
  elapsedMs: number;
  path: ScaleResult[];
  initialScatter: ScatterPoint[];
  truthScatter: ScatterPoint[];
  warning: string | null;
};
export type SensitivityRow = {
  parameter: "Nloc" | "NJ" | "Nphi" | "lambda";
  tested: number[];
  scores: number[];
  best: number;
};
export type OptimizationResult = {
  params: ExperimentParams;
  result: ExperimentResult;
  rows: SensitivityRow[];
  fits: number;
};
export type InitializationOptimization = {
  params: ExperimentParams;
  result: ExperimentResult;
  tested: number[];
  scores: number[];
};

class RNG {
  private state: number;
  private spare: number | null = null;
  constructor(seed: number) { this.state = (seed >>> 0) || 1; }
  uniform() {
    this.state = (1664525 * this.state + 1013904223) >>> 0;
    return (this.state + .5) / 4294967296;
  }
  normal() {
    if (this.spare !== null) { const z = this.spare; this.spare = null; return z; }
    const r = Math.sqrt(-2 * Math.log(this.uniform()));
    const angle = 2 * Math.PI * this.uniform();
    this.spare = r * Math.sin(angle);
    return r * Math.cos(angle);
  }
}

const dot = (a: number[], b: number[]) => a.reduce((sum, value, i) => sum + value * b[i], 0);
const norm = (a: number[]) => Math.sqrt(dot(a, a));
const unit = (a: number[], fallback?: number[]) => {
  const length = norm(a);
  return length > 1e-14 && Number.isFinite(length)
    ? a.map((value) => value / length)
    : [...(fallback || a.map((_, i) => i === 0 ? 1 : 0))];
};
const cosine = (a: number[], b: number[]) => Math.abs(dot(a, b));
const kernel = (q: number) => Math.max(1 - q * q, 0);
const unique = (values: number[]) => [...new Set(values.map((value) => Math.max(1, Math.round(value))))];

function solve(A: number[][], b: number[]) {
  const n = b.length;
  const matrix = A.map((row, i) => [...row, b[i]]);
  for (let k = 0; k < n; k++) {
    let pivot = k;
    for (let i = k + 1; i < n; i++) {
      if (Math.abs(matrix[i][k]) > Math.abs(matrix[pivot][k])) pivot = i;
    }
    [matrix[k], matrix[pivot]] = [matrix[pivot], matrix[k]];
    if (Math.abs(matrix[k][k]) < 1e-10) matrix[k][k] += 1e-8;
    for (let i = k + 1; i < n; i++) {
      const ratio = matrix[i][k] / matrix[k][k];
      for (let j = k; j <= n; j++) matrix[i][j] -= ratio * matrix[k][j];
    }
  }
  const answer = Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    const rest = matrix[i].slice(i + 1, n).reduce((sum, value, j) => sum + value * answer[i + 1 + j], 0);
    answer[i] = (matrix[i][n] - rest) / matrix[i][i];
  }
  return answer;
}

function outerAdd(A: number[][], x: number[], scale = 1) {
  for (let i = 0; i < x.length; i++) {
    for (let j = 0; j < x.length; j++) A[i][j] += scale * x[i] * x[j];
  }
}

function topEigenpairs(Q: number[][], count: number) {
  const work = Q.map((row) => [...row]);
  const vectors: number[][] = [];
  const values: number[] = [];
  for (let component = 0; component < count; component++) {
    let vector = unit(Q.map((_, i) => i === component ? 1 : .3 / (i + component + 1)));
    for (let iteration = 0; iteration < 120; iteration++) {
      vector = unit(work.map((row) => dot(row, vector)), vector);
    }
    const value = Math.max(0, dot(vector, Q.map((row) => dot(row, vector))));
    vectors.push(vector);
    values.push(value);
    for (let i = 0; i < work.length; i++) {
      for (let j = 0; j < work.length; j++) work[i][j] -= value * vector[i] * vector[j];
    }
  }
  return { vectors, values };
}

function localizationStats(X: number[][], centers: number[][], beta?: number[]) {
  return centers.map((center) => X.map((x) => {
    let normSquared = 0;
    let projection = 0;
    for (let k = 0; k < x.length; k++) {
      const delta = x[k] - center[k];
      normSquared += delta * delta;
      if (beta) projection += delta * beta[k];
    }
    return { normSquared, projectionSquared: projection * projection };
  }));
}

function meanMassFromStats(
  stats: { normSquared: number; projectionSquared: number }[][],
  h: number,
  rho = 1,
  anisotropic = false,
) {
  const rhoSquared = rho * rho;
  const hSquared = h * h;
  let total = 0;
  for (const neighborhood of stats) {
    for (const point of neighborhood) {
      const squaredRadius = anisotropic
        ? rhoSquared * point.normSquared + (1 - rhoSquared) * point.projectionSquared
        : point.normSquared;
      total += kernel(squaredRadius / hSquared);
    }
  }
  return total / stats.length;
}

function bisectH(X: number[][], centers: number[][], target: number) {
  const stats = localizationStats(X, centers);
  let low = 1e-8;
  let high = 1;
  while (meanMassFromStats(stats, high) < target) high *= 2;
  for (let iteration = 0; iteration < 42; iteration++) {
    const middle = (low + high) / 2;
    if (meanMassFromStats(stats, middle) >= target) high = middle;
    else low = middle;
  }
  return high;
}

function chooseRho(X: number[][], centers: number[][], beta: number[], h: number, target: number): number | null {
  const stats = localizationStats(X, centers, beta);
  if (meanMassFromStats(stats, h, 1, true) >= target) return 1;
  if (meanMassFromStats(stats, h, 0, true) < target) return null;
  let low = 0;
  let high = 1;
  for (let iteration = 0; iteration < 38; iteration++) {
    const middle = (low + high) / 2;
    if (meanMassFromStats(stats, h, middle, true) >= target) low = middle;
    else high = middle;
  }
  return low;
}

function initialize(X: number[][], y: number[], centers: number[][], nLin: number) {
  const d = X[0].length;
  const h = bisectH(X, centers, Math.min(nLin, X.length - 1));
  const Q = Array.from({ length: d }, () => Array(d).fill(0));
  for (const center of centers) {
    const weights = X.map((x) => {
      const delta = x.map((value, k) => value - center[k]);
      return kernel(dot(delta, delta) / (h * h));
    });
    const mass = weights.reduce((sum, value) => sum + value, 0);
    const mean = Array(d).fill(0);
    for (let i = 0; i < X.length; i++) {
      for (let k = 0; k < d; k++) mean[k] += weights[i] * X[i][k] / Math.max(mass, 1e-12);
    }
    const gram = Array.from({ length: d }, () => Array(d).fill(0));
    const rhs = Array(d).fill(0);
    for (let i = 0; i < X.length; i++) {
      const weight = weights[i];
      if (weight <= 0) continue;
      const centered = X[i].map((value, k) => value - mean[k]);
      outerAdd(gram, centered, weight);
      for (let k = 0; k < d; k++) rhs[k] += weight * y[i] * centered[k];
    }
    for (let k = 0; k < d; k++) gram[k][k] += 1e-8;
    outerAdd(Q, solve(gram, rhs));
  }
  const eigen = topEigenpairs(Q, 2);
  return { beta: eigen.vectors[0], eigenvalues: eigen.values };
}

function directions(J: number, P: number, d: number, beta: number[], rho: number, rng: RNG) {
  return Array.from({ length: J }, () => Array.from({ length: P }, () => {
    const gaussian = Array.from({ length: d }, () => rng.normal());
    const along = dot(gaussian, beta);
    const bump = 1 - rho;
    return unit(gaussian.map((value, k) => rho * value + bump * along * beta[k]));
  }));
}

function oneScale(
  X: number[][],
  y: number[],
  centers: number[][],
  betaIn: number[],
  truth: number[],
  h: number,
  rho: number,
  lambda: number,
  nPhi: number,
  kMax: number,
  rng: RNG,
  isotropic = false,
) {
  const J = centers.length;
  const d = X[0].length;
  const P = Math.max(1, Math.min(nPhi, 60));
  const phi = isotropic
    ? directions(J, P, d, betaIn, 1, rng).map((set) => set.map((_, p) => {
        const gaussian = Array.from({ length: d }, () => rng.normal());
        return unit(gaussian);
      }))
    : directions(J, P, d, betaIn, rho, rng);
  const Z = Array.from({ length: J }, () => Array(P).fill(0));
  const U = Array.from({ length: J }, () => Array.from({ length: P }, () => Array(d).fill(0)));
  for (let j = 0; j < J; j++) {
    const weights = X.map((x) => {
      const delta = x.map((value, k) => value - centers[j][k]);
      const q = isotropic
        ? dot(delta, delta) / (h * h)
        : (rho * rho * dot(delta, delta) + (1 - rho * rho) * dot(delta, betaIn) ** 2) / (h * h);
      return kernel(q);
    });
    const mass = weights.reduce((sum, value) => sum + value, 0);
    const mean = Array(d).fill(0);
    for (let i = 0; i < X.length; i++) {
      for (let k = 0; k < d; k++) mean[k] += weights[i] * X[i][k] / Math.max(mass, 1e-12);
    }
    for (let i = 0; i < X.length; i++) {
      const weight = weights[i];
      if (weight <= 0) continue;
      const centered = X[i].map((value, k) => value - mean[k]);
      for (let p = 0; p < P; p++) {
        const weightedProjection = weight * dot(centered, phi[j][p]);
        Z[j][p] += y[i] * weightedProjection;
        for (let k = 0; k < d; k++) U[j][p][k] += centered[k] * weightedProjection;
      }
    }
  }
  let beta = [...betaIn];
  const aoCosines: number[] = [];
  for (let iteration = 0; iteration < kMax; iteration++) {
    const anchor = [...beta];
    const ell = Array(J).fill(0);
    for (let j = 0; j < J; j++) {
      const projection = U[j].map((row) => dot(row, anchor));
      ell[j] = dot(Z[j], projection) / (dot(projection, projection) + 1e-8);
    }
    const gram = Array.from({ length: d }, (_, i) =>
      Array.from({ length: d }, (_, k) => i === k ? lambda + 1e-8 : 0),
    );
    const rhs = anchor.map((value) => lambda * value);
    for (let j = 0; j < J; j++) {
      for (let p = 0; p < P; p++) {
        const u = U[j][p];
        outerAdd(gram, u, ell[j] * ell[j]);
        for (let k = 0; k < d; k++) rhs[k] += ell[j] * u[k] * Z[j][p];
      }
    }
    beta = unit(solve(gram, rhs), anchor);
    aoCosines.push(cosine(beta, truth));
    if (1 - cosine(beta, anchor) < 1e-7) break;
  }
  return { beta, aoCosines };
}

function scatter(X: number[][], y: number[], beta: number[]) {
  const stride = Math.max(1, Math.floor(X.length / 240));
  const points: ScatterPoint[] = [];
  for (let i = 0; i < X.length && points.length < 240; i += stride) {
    points.push({ x: dot(X[i], beta), y: y[i] });
  }
  return points;
}

function linkValue(link: LinkFunction, t: number) {
  const frequency = Number(link.slice(-1));
  const sine = Math.sin(frequency * t);
  return link.startsWith("xsin") ? t * sine : sine;
}

function prepareExperiment(input: ExperimentParams) {
  const n = Math.max(50, Math.round(input.n));
  const d = Math.max(1, Math.round(input.d));
  const p = {
    ...input,
    n,
    d,
    nJ: Math.max(1, Math.min(Math.round(input.nJ), n)),
    nLoc: Math.max(2, Math.min(Math.round(input.nLoc), n - 1)),
    nLin: Math.max(d + 2, Math.min(Math.round(input.nLin), n - 1)),
  };
  const rng = new RNG(p.seed);
  const truth = unit(Array.from({ length: p.d }, () => rng.normal()));
  const common = Array.from({ length: p.d }, () => rng.normal());
  const X = Array.from({ length: p.n }, () =>
    Array.from({ length: p.d }, (_, k) => p.tau * common[k] + (1 - p.tau) * rng.normal()),
  );
  const y = X.map((x) => linkValue(p.link, dot(x, truth)) + p.sigma * rng.normal());
  const indices = Array.from({ length: p.n }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(rng.uniform() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  const centers = indices.slice(0, p.nJ).map((i) =>
    X[i].map((value) => value + p.centerRho * rng.normal()),
  );
  return { p, rng, truth, X, y, centers };
}

export function runExperiment(input: ExperimentParams): ExperimentResult {
  const start = performance.now();
  const { p, rng, truth, X, y, centers } = prepareExperiment(input);
  const initialization = initialize(X, y, centers, p.nLin);
  let beta = initialization.beta;
  const initialBeta = [...beta];
  const initialCosine = cosine(beta, truth);
  const path: ScaleResult[] = [];
  let h = bisectH(X, centers, p.nLoc);
  let rho = 1;
  let feasibilityWarning: string | null = null;
  const hMin = p.hMinScale / Math.sqrt(p.n);
  while (path.length < 14) {
    const updated = oneScale(X, y, centers, beta, truth, h, rho, p.lambda, p.nPhi, p.kMax, rng, path.length === 0);
    beta = updated.beta;
    path.push({
      h,
      rho,
      cosine: cosine(beta, truth),
      beta: [...beta],
      aoCosines: updated.aoCosines,
      scatter: scatter(X, y, beta),
    });
    const nextH = h / p.factor;
    if (nextH < hMin) break;
    const nextRho = chooseRho(X, centers, beta, nextH, p.nLoc);
    if (nextRho === null) {
      feasibilityWarning = "The next scale has no ρ ∈ [0,1] satisfying (1.7), so the procedure stops at the last feasible tensor.";
      break;
    }
    h = nextH;
    rho = nextRho;
  }
  const warning = p.n / Math.max(p.sigma * p.sigma, 1e-8) < 20 * p.d
    ? "The paper recommends n / σ²ε ≥ 20d for this experiment."
    : feasibilityWarning
      ? feasibilityWarning
      : path.length === 14
        ? "The display stopped after 14 scales to keep the browser responsive."
        : null;
  return {
    initialCosine,
    finalCosine: cosine(beta, truth),
    initialBeta,
    truthBeta: truth,
    eigenvalues: initialization.eigenvalues,
    elapsedMs: performance.now() - start,
    path,
    initialScatter: scatter(X, y, initialBeta),
    truthScatter: scatter(X, y, truth),
    warning,
  };
}

export function optimizeInitialization(base: ExperimentParams): InitializationOptimization {
  const tested = unique([base.nLin, base.d + base.nLoc, 2 * (base.d + base.nLoc), 3 * (base.d + base.nLoc)])
    .map((value) => Math.min(base.n - 1, value));
  let params = { ...base };
  const scores: number[] = [];
  let bestScore = -Infinity;
  for (const nLin of tested) {
    const trialParams = { ...base, nLin };
    const prepared = prepareExperiment(trialParams);
    const trial = initialize(prepared.X, prepared.y, prepared.centers, prepared.p.nLin);
    const score = cosine(trial.beta, prepared.truth);
    scores.push(score);
    if (score > bestScore) {
      bestScore = score;
      params = trialParams;
    }
  }
  const result = runExperiment(params);
  return { params, result, tested, scores };
}

export function optimizeTuning(base: ExperimentParams): OptimizationResult {
  let params = { ...base };
  const rows: SensitivityRow[] = [];
  let fits = 1;
  const heavy = base.d >= 40 || base.n >= 1500;
  const searchParams = (input: ExperimentParams): ExperimentParams => heavy
    ? {
        ...input,
        n: Math.min(400, input.n),
        nJ: Math.min(40, input.nJ),
        nPhi: Math.min(15, input.nPhi),
        kMax: 1,
        factor: Math.max(2, input.factor),
        hMinScale: Math.max(3, input.hMinScale),
      }
    : input;
  let result = runExperiment(searchParams(params));
  const candidates: Array<{
    key: "nLoc" | "nJ" | "nPhi" | "lambda";
    values: number[];
  }> = [
    { key: "nLoc", values: unique(heavy ? [params.nLoc, 15] : [7, 10, 15, 20, params.nLoc]) },
    {
      key: "nJ",
      values: unique(heavy
        ? [params.nJ, 30]
        : [params.n / params.nLoc, 2 * params.n / params.nLoc, params.nJ]).map((v) => Math.min(v, heavy ? 60 : 120)),
    },
    {
      key: "nPhi",
      values: unique(heavy
        ? [params.nPhi, 15]
        : [params.nLoc, 2 * params.nLoc, 3 * params.nLoc, params.nPhi]).map((v) => Math.min(v, heavy ? 20 : 60)),
    },
    { key: "lambda", values: unique(heavy ? [params.lambda, params.nLoc, 2 * params.nLoc] : [1, params.nLoc / 2, params.nLoc, 2 * params.nLoc, params.lambda]) },
  ];
  for (const candidate of candidates) {
    const tested: number[] = [];
    const scores: number[] = [];
    let bestValue = params[candidate.key];
    let bestResult = result;
    for (const value of unique(candidate.values)) {
      const trialParams = { ...params, [candidate.key]: value };
      const isCurrent = value === params[candidate.key];
      const trial = isCurrent ? result : runExperiment(searchParams(trialParams));
      if (!isCurrent) fits++;
      tested.push(value);
      scores.push(trial.finalCosine);
      if (trial.finalCosine > bestResult.finalCosine) {
        bestResult = trial;
        bestValue = value;
      }
    }
    params = { ...params, [candidate.key]: bestValue };
    result = bestResult;
    rows.push({ parameter: candidate.key === "nPhi" ? "Nphi" : candidate.key === "nJ" ? "NJ" : candidate.key === "nLoc" ? "Nloc" : "lambda", tested, scores, best: bestValue });
  }
  if (heavy) {
    result = runExperiment(params);
    fits++;
  }
  return { params, result, rows, fits };
}
