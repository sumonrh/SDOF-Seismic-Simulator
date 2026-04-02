import { GroundMotion } from "../types";
import {
  calculateSpectra,
  baselineCorrect,
  sanitizeSpectrumPoints,
  interpolateSa,
} from "./seismicSolver";

type SpectrumPoint = { period: number; sa: number };

function clamp(x: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, x));
}

function nearestIndex(values: number[], target: number): number {
  let idx = 0;
  let best = Infinity;
  for (let i = 0; i < values.length; i++) {
    const d = Math.abs(values[i] - target);
    if (d < best) {
      best = d;
      idx = i;
    }
  }
  return idx;
}

function maxAbs(values: ArrayLike<number>): number {
  let m = 0;
  for (let i = 0; i < values.length; i++) {
    const a = Math.abs(values[i]);
    if (a > m) m = a;
  }
  return m;
}

function geometricMean(values: number[]): number {
  if (values.length === 0) return 1.0;
  let sum = 0;
  for (const v of values) sum += Math.log(v);
  return Math.exp(sum / values.length);
}

function scaleArray(values: Float64Array, factor: number): Float64Array {
  const out = new Float64Array(values.length);
  for (let i = 0; i < values.length; i++) out[i] = values[i] * factor;
  return out;
}

function addScaledArray(
  base: Float64Array,
  wavelet: Float64Array,
  scale: number
): Float64Array {
  const out = new Float64Array(base.length);
  for (let i = 0; i < base.length; i++) {
    out[i] = base[i] + scale * wavelet[i];
  }
  return out;
}

/**
 * Build a conservative set of correction periods.
 * We use target points inside the current spectrum range, and optionally
 * add logarithmic midpoints if adjacent target points are widely spaced.
 */
function buildCorrectionPeriods(
  target: SpectrumPoint[],
  minT: number,
  maxT: number
): number[] {
  const base = target
    .map((p) => p.period)
    .filter((T) => Number.isFinite(T) && T >= minT && T <= maxT && T > 0.01)
    .sort((a, b) => a - b);

  if (base.length === 0) return [];

  const periods: number[] = [];

  for (let i = 0; i < base.length; i++) {
    periods.push(base[i]);

    if (i < base.length - 1) {
      const T0 = base[i];
      const T1 = base[i + 1];
      if (T1 / T0 > 1.8) {
        const mid = Math.sqrt(T0 * T1);
        if (mid >= minT && mid <= maxT) periods.push(mid);
      }
    }
  }

  periods.sort((a, b) => a - b);

  const unique: number[] = [];
  for (const T of periods) {
    if (
      unique.length === 0 ||
      Math.abs(T - unique[unique.length - 1]) > 1e-6
    ) {
      unique.push(T);
    }
  }

  return unique;
}

/**
 * Zero-mean cosine-Gaussian wavelet.
 *
 * Important:
 * - centered at t0
 * - approximately zero mean
 * - normalized to peak absolute value = 1
 *
 * This is much safer than a raw sine/cosine pulse.
 */
function buildZeroMeanWavelet(
  t: number[],
  t0: number,
  T: number
): Float64Array {
  const n = t.length;
  const w = new Float64Array(n);

  const omega = (2 * Math.PI) / Math.max(T, 0.01);

  // Slightly narrower at short periods to target high-frequency content
  const sigma =
    T < 0.30 ? 0.18 * T :
    T < 1.00 ? 0.24 * T :
               0.32 * T;

  // Zero-mean correction term for Gaussian-windowed cosine
  const c = Math.exp(-0.5 * omega * omega * sigma * sigma);

  for (let i = 0; i < n; i++) {
    const tau = t[i] - t0;
    const g = Math.exp(-0.5 * (tau / sigma) * (tau / sigma));
    w[i] = (Math.cos(omega * tau) - c) * g;
  }

  const peak = maxAbs(w);
  if (peak > 0) {
    for (let i = 0; i < n; i++) w[i] /= peak;
  }

  return w;
}

/**
 * Evaluate Sa at a target period using nearest available spectral point.
 * This is more stable than trying to interpolate peak times / signs.
 */
function spectralSaAtPeriod(
  motion: GroundMotion,
  zeta: number,
  T: number
): { sa: number; idx: number; spectra: ReturnType<typeof calculateSpectra> | null } {
  const spectra = calculateSpectra(motion, zeta);
  if (!spectra || !spectra.periods || spectra.periods.length === 0) {
    return { sa: NaN, idx: -1, spectra: null };
  }
  const idx = nearestIndex(spectra.periods, T);
  return { sa: spectra.Sa[idx], idx, spectra };
}

/**
 * Mild global scale factor estimated from current/target spectrum ratios.
 * This is intentionally conservative and is the main fix for the
 * "down-scaling doesn't work" issue.
 */
function estimateGlobalScale(
  spectra: ReturnType<typeof calculateSpectra>,
  target: SpectrumPoint[]
): number {
  if (!spectra || !spectra.periods || spectra.periods.length === 0) return 1.0;

  const minT = spectra.periods[0];
  const maxT = spectra.periods[spectra.periods.length - 1];
  const periods = buildCorrectionPeriods(target, minT, maxT);

  const ratios: number[] = [];
  for (const T of periods) {
    const saTarget = interpolateSa(target, T);
    if (saTarget === null || saTarget <= 0) continue;

    const idx = nearestIndex(spectra.periods, T);
    const saCurrent = spectra.Sa[idx];
    if (!Number.isFinite(saCurrent) || saCurrent <= 0) continue;

    ratios.push(clamp(saTarget / saCurrent, 0.25, 4.0));
  }

  if (ratios.length === 0) return 1.0;

  ratios.sort((a, b) => a - b);
  const trim = Math.floor(ratios.length * 0.15);
  const usable =
    ratios.length - 2 * trim >= 1
      ? ratios.slice(trim, ratios.length - trim)
      : ratios;

  // Hard clamp so one iteration cannot blow up the record
  return clamp(geometricMean(usable), 0.96, 1.04);
}

/**
 * Stable wavelet-based spectral matching.
 *
 * Strategy:
 * 1) start from baseline-corrected motion
 * 2) each iteration apply a very mild global amplitude trim
 * 3) then apply only a few small local wavelet corrections
 * 4) choose local wavelet amplitude by discrete search, not derivative
 * 5) baseline-correct after accepted changes
 *
 * This is intentionally conservative to avoid spectrum blow-up.
 */
export function matchSpectrumWavelet(
  motion: GroundMotion,
  targetSpectrum: { period: number; sa: number }[],
  zeta: number,
  iterations = 15
): GroundMotion {
  if (!motion || !motion.t || !motion.ug || motion.t.length !== motion.ug.length) {
    return motion;
  }

  const cleanedTarget = sanitizeSpectrumPoints(targetSpectrum);
  if (!cleanedTarget || cleanedTarget.length === 0) {
    return motion;
  }

  const { t } = motion;
  const n = t.length;
  if (n < 4) return motion;

  const dt = (t[n - 1] - t[0]) / Math.max(1, n - 1);
  if (!Number.isFinite(dt) || dt <= 0) return motion;

  // Start from a baseline-corrected copy
  let currentUg = baselineCorrect(new Float64Array(motion.ug), dt);

  // Tolerances / controls
  const localTol = 0.04;      // local relative tolerance
  const globalTol = 0.06;     // overall stopping tolerance
  const maxLocalCorrections = 4;

  for (let iter = 0; iter < iterations; iter++) {
    const currentMotion: GroundMotion = { t, ug: Array.from(currentUg) };
    const currentSpectra = calculateSpectra(currentMotion, zeta);

    if (!currentSpectra || !currentSpectra.periods || currentSpectra.periods.length === 0) {
      break;
    }

    const minT = Math.max(0.01, currentSpectra.periods[0]);
    const maxT = currentSpectra.periods[currentSpectra.periods.length - 1];
    const correctionPeriods = buildCorrectionPeriods(cleanedTarget, minT, maxT);

    if (correctionPeriods.length === 0) break;

    // ----------------------------------------------------------------------
    // 1) Evaluate misfit
    // ----------------------------------------------------------------------
    const errors: {
      period: number;
      targetSa: number;
      currentSa: number;
      relError: number;
      score: number;
    }[] = [];

    let maxRelError = 0;

    for (const T of correctionPeriods) {
      const saTarget = interpolateSa(cleanedTarget, T);
      if (saTarget === null || saTarget <= 0) continue;

      const idx = nearestIndex(currentSpectra.periods, T);
      const saCurrent = currentSpectra.Sa[idx];
      if (!Number.isFinite(saCurrent) || saCurrent <= 0) continue;

      const relError = Math.abs(saTarget - saCurrent) / saTarget;
      maxRelError = Math.max(maxRelError, relError);

      // Slightly emphasize short periods because that was the weak point
      const weight = T < 0.40 ? 1.20 : T < 1.00 ? 1.10 : 1.00;
      const score = relError * weight;

      if (relError > localTol) {
        errors.push({
          period: T,
          targetSa: saTarget,
          currentSa: saCurrent,
          relError,
          score,
        });
      }
    }

    if (maxRelError < globalTol) {
      break;
    }

    // ----------------------------------------------------------------------
    // 2) Mild global trim
    // ----------------------------------------------------------------------
    // This addresses the broad "need to scale everything up/down" part
    // without relying on unstable local wavelets.
    const globalScale = estimateGlobalScale(currentSpectra, cleanedTarget);

    if (Math.abs(Math.log(globalScale)) > 0.003) {
      currentUg = baselineCorrect(scaleArray(currentUg, globalScale), dt);
    }

    // Recompute after global trim
    let workingMotion: GroundMotion = { t, ug: Array.from(currentUg) };
    let workingSpectra = calculateSpectra(workingMotion, zeta);

    if (!workingSpectra || !workingSpectra.periods || workingSpectra.periods.length === 0) {
      break;
    }

    // Rebuild error list after global trim
    const postTrimErrors: {
      period: number;
      targetSa: number;
      currentSa: number;
      relError: number;
      score: number;
    }[] = [];

    for (const T of correctionPeriods) {
      const saTarget = interpolateSa(cleanedTarget, T);
      if (saTarget === null || saTarget <= 0) continue;

      const idx = nearestIndex(workingSpectra.periods, T);
      const saCurrent = workingSpectra.Sa[idx];
      if (!Number.isFinite(saCurrent) || saCurrent <= 0) continue;

      const relError = Math.abs(saTarget - saCurrent) / saTarget;
      const weight = T < 0.40 ? 1.20 : T < 1.00 ? 1.10 : 1.00;

      if (relError > localTol) {
        postTrimErrors.push({
          period: T,
          targetSa: saTarget,
          currentSa: saCurrent,
          relError,
          score: relError * weight,
        });
      }
    }

    if (postTrimErrors.length === 0) {
      continue;
    }

    postTrimErrors.sort((a, b) => b.score - a.score);
    const selected = postTrimErrors.slice(0, maxLocalCorrections);

    let anyAccepted = false;

    // ----------------------------------------------------------------------
    // 3) Conservative local wavelet search
    // ----------------------------------------------------------------------
    for (const item of selected) {
      workingMotion = { t, ug: Array.from(currentUg) };
      workingSpectra = calculateSpectra(workingMotion, zeta);

      if (!workingSpectra || !workingSpectra.periods || workingSpectra.periods.length === 0) {
        continue;
      }

      const idx = nearestIndex(workingSpectra.periods, item.period);
      const Tuse = workingSpectra.periods[idx];
      const saCurrent = workingSpectra.Sa[idx];
      const tPeak = workingSpectra.peakTimes[idx];

      const saTarget = interpolateSa(cleanedTarget, Tuse);
      if (
        saTarget === null ||
        saTarget <= 0 ||
        !Number.isFinite(saCurrent) ||
        saCurrent <= 0 ||
        !Number.isFinite(tPeak)
      ) {
        continue;
      }

      const err0 = Math.abs(Math.log(saTarget / saCurrent));
      if (!Number.isFinite(err0) || err0 < 0.02) continue;

      const wavelet = buildZeroMeanWavelet(t, tPeak, Tuse);
      const pgaCurrent = maxAbs(currentUg);

      // Very hard amplitude caps — this is the critical anti-blow-up measure
      let Amax: number;
      if (Tuse < 0.30) {
        Amax = 0.020 * 9.81; // ~0.02g
      } else if (Tuse < 1.00) {
        Amax = 0.035 * 9.81; // ~0.035g
      } else {
        Amax = 0.050 * 9.81; // ~0.05g
      }

      // Also keep it bounded relative to current PGA
      Amax = Math.min(Amax, Math.max(0.10 * pgaCurrent, 0.015 * 9.81));

      // Discrete search around zero; derivative-free and robust
      const candidateScales = [-1.0, -0.5, -0.25, 0.0, 0.25, 0.5, 1.0];

      let bestUg = currentUg;
      let bestErr = err0;
      let bestAccepted = false;

      for (const s of candidateScales) {
        const A = s * Amax;
        if (Math.abs(A) < 1e-12) continue;

        const ugTrialRaw = addScaledArray(currentUg, wavelet, A);
        const ugTrial = baselineCorrect(ugTrialRaw, dt);

        const trialMotion: GroundMotion = { t, ug: Array.from(ugTrial) };
        const trialSpectra = calculateSpectra(trialMotion, zeta);

        if (!trialSpectra || !trialSpectra.periods || trialSpectra.periods.length === 0) {
          continue;
        }

        const idxTrial = nearestIndex(trialSpectra.periods, Tuse);
        const saTrial = trialSpectra.Sa[idxTrial];
        if (!Number.isFinite(saTrial) || saTrial <= 0) continue;

        const errTrial = Math.abs(Math.log(saTarget / saTrial));

        // Small regularization: prefer smaller amplitudes if improvement is similar
        const penalty = 0.03 * Math.abs(A) / Math.max(Amax, 1e-9);
        const score = errTrial + penalty;

        const bestScore = bestErr; // bestErr already unpenalized baseline; acceptable because penalty is small
        if (score < bestScore - 0.01) {
          bestErr = errTrial;
          bestUg = ugTrial;
          bestAccepted = true;
        }
      }

      if (bestAccepted && bestErr < err0 * 0.98) {
        currentUg = bestUg;
        anyAccepted = true;
      }
    }

    if (!anyAccepted && Math.abs(Math.log(globalScale)) < 0.003) {
      break;
    }

    currentUg = baselineCorrect(currentUg, dt);
  }

  return { t, ug: Array.from(currentUg) };
}