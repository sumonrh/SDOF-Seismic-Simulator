import { GroundMotion, SimulationResults, SpectraData } from "../types";

/**
 * Validates the ground motion data for consistency and physical usability.
 */
export function validateGroundMotion(motion: GroundMotion): void {
  if (!motion || !motion.t || !motion.ug || !motion.t.length || !motion.ug.length) {
    throw new Error("Empty ground motion record.");
  }
  if (motion.t.length !== motion.ug.length) {
    throw new Error("Time and acceleration arrays must have the same length.");
  }
  for (let i = 0; i < motion.t.length; i++) {
    if (!Number.isFinite(motion.t[i]) || !Number.isFinite(motion.ug[i])) {
      throw new Error(`Non-finite value detected at index ${i}.`);
    }
    if (i > 0 && motion.t[i] <= motion.t[i - 1]) {
      throw new Error(`Time values must be strictly increasing (error at index ${i}).`);
    }
  }
}

/**
 * Numerical solver for SDOF response using Newmark-beta method
 * (Constant Average Acceleration: beta=0.25, gamma=0.5)
 */
export function solveSDOF(
  m: number,
  k: number,
  zeta: number,
  motion: GroundMotion
): SimulationResults | null {
  if (!motion || !motion.t || !motion.ug || motion.t.length < 2) return null;
  const { t, ug } = motion;
  const n = t.length;

  const dt = (t[n - 1] - t[0]) / (n - 1);
  const wn = Math.sqrt(k / m);
  const fn = wn / (2 * Math.PI);
  const Tn = 1 / fn;
  const c = 2 * zeta * Math.sqrt(k * m);

  const beta = 0.25;
  const gamma = 0.5;

  const u = new Float64Array(n);
  const v = new Float64Array(n);
  const a = new Float64Array(n);
  const p = new Float64Array(n);
  const a_abs = new Float64Array(n);
  const Vb = new Float64Array(n);

  for (let i = 0; i < n; i++) {
    p[i] = -m * ug[i];
  }

  // Initial acceleration
  a[0] = (p[0] - c * v[0] - k * u[0]) / m;
  a_abs[0] = a[0] + ug[0];
  Vb[0] = k * u[0] + c * v[0];

  // Newmark constants
  const a0 = 1 / (beta * dt * dt);
  const a1 = gamma / (beta * dt);
  const a2 = 1 / (beta * dt);
  const a3 = 1 / (2 * beta) - 1;
  const a4 = gamma / beta - 1;
  const a5 = dt * (gamma / (2 * beta) - 1);
  const a6 = dt * (1 - gamma);
  const a7 = gamma * dt;

  const ke = k + a0 * m + a1 * c;

  for (let i = 0; i < n - 1; i++) {
    const pe =
      p[i + 1] +
      m * (a0 * u[i] + a2 * v[i] + a3 * a[i]) +
      c * (a1 * u[i] + a4 * v[i] + a5 * a[i]);
    u[i + 1] = pe / ke;
    a[i + 1] = a0 * (u[i + 1] - u[i]) - a2 * v[i] - a3 * a[i];
    v[i + 1] = v[i] + a6 * a[i] + a7 * a[i + 1];
    a_abs[i + 1] = a[i + 1] + ug[i + 1];
    Vb[i + 1] = k * u[i + 1] + c * v[i + 1];
  }

  const fma = new Float64Array(n);
  const fcv = new Float64Array(n);
  const fku = new Float64Array(n);
  const fs = new Float64Array(n);
  const residual = new Float64Array(n);
  const s_ma = new Float64Array(n);
  const s_ku = new Float64Array(n);
  const s_cv = new Float64Array(n);
  const ug_v = new Float64Array(n);
  const ug_disp = new Float64Array(n);

  let pU = 0;
  let pUgd = 0;
  let pVb = 0;
  let pAabs = 0;
  let sumMa = 0;
  let sumKu = 0;
  let sumCv = 0;

  for (let i = 0; i < n; i++) {
    // Integrate ground motion (trapezoidal) - basic estimation for visualization
    if (i > 0) {
      const dt_i = t[i] - t[i-1];
      ug_v[i] = ug_v[i-1] + 0.5 * (ug[i] + ug[i-1]) * dt_i;
      ug_disp[i] = ug_disp[i-1] + 0.5 * (ug_v[i] + ug_v[i-1]) * dt_i;
    }

    fma[i] = m * a[i];
    fcv[i] = c * v[i];
    fku[i] = k * u[i];
    fs[i] = fma[i] + fcv[i] + fku[i];
    residual[i] = p[i] - fs[i];

    const ama = Math.abs(fma[i]);
    const acv = Math.abs(fcv[i]);
    const aku = Math.abs(fku[i]);
    const tot = Math.max(ama + acv + aku, 1e-6);

    s_ma[i] = (ama / tot) * 100;
    s_ku[i] = (aku / tot) * 100;
    s_cv[i] = (acv / tot) * 100;

    sumMa += ama;
    sumKu += aku;
    sumCv += acv;

    if (Math.abs(u[i]) > pU) pU = Math.abs(u[i]);
    if (Math.abs(ug_disp[i]) > pUgd) pUgd = Math.abs(ug_disp[i]);
    if (Math.abs(Vb[i]) > pVb) pVb = Math.abs(Vb[i]);
    if (Math.abs(a_abs[i]) > pAabs) pAabs = Math.abs(a_abs[i]);
  }

  const den = Math.max(sumMa + sumKu + sumCv, 1e-6);

  return {
    t: Array.from(t),
    p: Array.from(p),
    ug_disp: Array.from(ug_disp),
    u: Array.from(u),
    v: Array.from(v),
    a: Array.from(a),
    a_abs: Array.from(a_abs),
    Vb: Array.from(Vb),
    fma: Array.from(fma),
    fcv: Array.from(fcv),
    fku: Array.from(fku),
    fs: Array.from(fs),
    residual: Array.from(residual),
    s_ma: Array.from(s_ma),
    s_ku: Array.from(s_ku),
    s_cv: Array.from(s_cv),
    tMa: (sumMa / den) * 100,
    tKu: (sumKu / den) * 100,
    tCv: (sumCv / den) * 100,
    pU,
    pUgd,
    pVb,
    pAabs,
    fn,
    Tn,
  };
}

export function calculateSpectra(
  motion: GroundMotion,
  zeta: number
): SpectraData {
  if (!motion || !motion.t || !motion.ug || motion.t.length < 2) {
    return { periods: [], Sa: [], Sv: [], Sd: [], peakTimes: [], peakT: 0, peakSa: 0 };
  }
  const { t, ug } = motion;
  const n = t.length;
  const dt = (t[n - 1] - t[0]) / (n - 1);
  const m = 1.0;

  const periods: number[] = [];
  const Sa: number[] = [];
  const Sv: number[] = [];
  const Sd: number[] = [];
  const peakTimes: number[] = [];
  const peakSigns: number[] = [];

  let peakT = 0;
  let peakSa = 0;

  // Newmark constants (reused)
  const beta = 0.25;
  const gamma = 0.5;
  const a0b = 1 / (beta * dt * dt);
  const a1b = gamma / (beta * dt);
  const a2 = 1 / (beta * dt);
  const a3 = 1 / (2 * beta) - 1;
  const a4 = gamma / beta - 1;
  const a5 = dt * (gamma / (2 * beta) - 1);
  const a6 = dt * (1 - gamma);
  const a7 = gamma * dt;

  const p = new Float64Array(n);
  for (let i = 0; i < n; i++) p[i] = -m * ug[i];

  for (let T = 0.05; T <= 4.0; T += 0.05) {
    periods.push(T);
    const wn = (2 * Math.PI) / T;
    const k = m * wn * wn;
    const c = 2 * zeta * Math.sqrt(k * m);

    const u = new Float64Array(n);
    const v = new Float64Array(n);
    const a = new Float64Array(n);

    a[0] = (p[0] - c * v[0] - k * u[0]) / m;
    const ke = k + a0b * m + a1b * c;

    let maxU = 0;
    let tPeak = 0;
    let signPeak = 1;
    for (let i = 0; i < n - 1; i++) {
      const pe =
        p[i + 1] +
        m * (a0b * u[i] + a2 * v[i] + a3 * a[i]) +
        c * (a1b * u[i] + a4 * v[i] + a5 * a[i]);
      u[i + 1] = pe / ke;
      a[i + 1] = a0b * (u[i + 1] - u[i]) - a2 * v[i] - a3 * a[i];
      v[i + 1] = v[i] + a6 * a[i] + a7 * a[i + 1];
      if (Math.abs(u[i + 1]) > maxU) {
        maxU = Math.abs(u[i + 1]);
        tPeak = t[i + 1];
        signPeak = Math.sign(u[i + 1]) || 1;
      }
    }

    const curSa = (wn * wn * maxU) / 9.81; // Pseudo-spectral acceleration (g)
    Sa.push(curSa);
    Sv.push(wn * maxU); // Pseudo-spectral velocity (m/s)
    Sd.push(maxU); // Spectral displacement (m)
    peakTimes.push(tPeak);
    peakSigns.push(signPeak);

    if (curSa > peakSa) {
      peakSa = curSa;
      peakT = T;
    }
  }

  return { periods, Sa, Sv, Sd, peakTimes, peakSigns, peakT, peakSa };
}

/**
 * Sanitizes spectrum points by filtering out invalid values and sorting by period.
 */
export function sanitizeSpectrumPoints(points: { period: number; sa: number }[]): { period: number; sa: number }[] {
  const valid = points.filter(p => Number.isFinite(p.period) && Number.isFinite(p.sa) && p.period >= 0);
  const sorted = [...valid].sort((a, b) => a.period - b.period);
  
  const deduped: { period: number; sa: number }[] = [];
  for (const point of sorted) {
    const last = deduped[deduped.length - 1];
    if (last && Math.abs(last.period - point.period) < 1e-12) {
      deduped[deduped.length - 1] = point;
    } else {
      deduped.push(point);
    }
  }
  return deduped;
}

/**
 * Interpolates the spectral acceleration (Sa) for a given period (T) from a set of spectrum points.
 */
export function interpolateSa(points: { period: number; sa: number }[], T: number): number | null {
  const spec = sanitizeSpectrumPoints(points);
  if (!spec.length || !Number.isFinite(T)) return null;

  if (T <= spec[0].period) return spec[0].sa;
  if (T >= spec[spec.length - 1].period) return spec[spec.length - 1].sa;

  for (let i = 1; i < spec.length; i++) {
    const p0 = spec[i - 1];
    const p1 = spec[i];

    if (p1.period <= p0.period) continue;

    if (T <= p1.period) {
      const ratio = (T - p0.period) / (p1.period - p0.period);
      return p0.sa + (p1.sa - p0.sa) * ratio;
    }
  }

  return spec[spec.length - 1].sa;
}

// Wavelet matching logic moved to waveletMatcher.ts


/**
 * Simple baseline correction to ensure zero final velocity and displacement.
 */
export function baselineCorrect(ug: Float64Array, dt: number): Float64Array {
  const n = ug.length;
  const corrected = new Float64Array(ug);
  const T = (n - 1) * dt;

  // Pass 1: Zero velocity (subtract constant offset)
  let velFinal = 0;
  for (let i = 0; i < n; i++) {
    velFinal += (i === 0 || i === n - 1 ? 0.5 : 1.0) * corrected[i] * dt;
  }
  const c0 = velFinal / T;
  for (let i = 0; i < n; i++) {
    corrected[i] -= c0;
  }

  // Pass 2: Zero displacement (subtract function with zero integral)
  // a_corr(t) = c1*t + c2*t^2
  // This correction ensures final displacement is zero without changing final velocity.
  const vel = new Float64Array(n);
  const disp = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    vel[i] = vel[i - 1] + 0.5 * (corrected[i] + corrected[i - 1]) * dt;
    disp[i] = disp[i - 1] + 0.5 * (vel[i] + vel[i - 1]) * dt;
  }
  const dispFinal = disp[n - 1];
  const c1 = 24.0 * dispFinal / Math.pow(T, 3);
  const c2 = -36.0 * dispFinal / Math.pow(T, 4);
  
  for (let i = 0; i < n; i++) {
    const ti = i * dt;
    corrected[i] -= (c1 * ti + c2 * ti * ti);
  }

  return corrected;
}

/**
 * Calculates strong motion parameters for verification.
 */
export function calculateStrongMotionParameters(motion: GroundMotion) {
  const { t, ug } = motion;
  const n = t.length;
  const dt = (t[n - 1] - t[0]) / (n - 1);
  const g = 9.81;

  // 1. PGA
  let pga = 0;
  for (const a of ug) if (Math.abs(a) > pga) pga = Math.abs(a);

  // 2. Arias Intensity (Ia)
  // Ia = (pi / 2g) * integral(a(t)^2 dt)
  const aSquared = ug.map(a => a * a);
  let totalIa = 0;
  const iaTimeHistory = new Float64Array(n);
  
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      const stepIa = (Math.PI / (2 * g)) * 0.5 * (aSquared[i] + aSquared[i-1]) * dt;
      totalIa += stepIa;
    }
    iaTimeHistory[i] = totalIa;
  }

  // 3. Significant Duration (D5-95)
  let t5 = 0;
  let t95 = 0;
  for (let i = 0; i < n; i++) {
    if (iaTimeHistory[i] >= 0.05 * totalIa && t5 === 0) t5 = t[i];
    if (iaTimeHistory[i] >= 0.95 * totalIa && t95 === 0) t95 = t[i];
  }

  return {
    pga: pga / g, // in g
    ariasIntensity: totalIa, // in m/s
    significantDuration: t95 - t5 // in s
  };
}

/**
 * Stochastic synthetic ground motion generator.
 *
 * Algorithm:
 *  1. Generate band-limited white noise in frequency domain across [0.1, 25] Hz
 *     with random independent phases per frequency (Boore 1983 approach).
 *  2. Apply a Kanai-Tajimi resonant filter to give realistic spectral shape
 *     (soil resonance at fg ≈ 1-3 Hz).
 *  3. Modulate with a Jennings-Housner trapezoidal envelope scaled to duration.
 *  4. Apply two-pass baseline correction so integrated velocity and displacement
 *     both return to zero, eliminating artificial residual drift.
 *  5. Scale to target PGA.
 */
export function generateSyntheticMotion(
  duration = 20,
  dt = 0.01,
  targetPGA?: number
): GroundMotion {
  const t: number[] = [];
  const raw: number[] = [];
  // --- Step 1: Build time axis ---
  const n = Math.floor(duration / dt) + 1; // total samples
  for (let i = 0; i < n; i++) t.push(i * dt);

  // --- Step 2: Stochastic band-limited signal (Boore 1983) ---
  // Sum many sinusoids across [0.1, 25 Hz] with random independent phases.
  // Amplitude spectral shape follows Kanai-Tajimi soil filter:
  //   H(f) = sqrt((1 + 4*zetag^2*(f/fg)^2) / ((1-(f/fg)^2)^2 + 4*zetag^2*(f/fg)^2))
  const fMin = 0.1;          // Hz
  const fMax = 25.0;         // Hz
  const nFreq = 300;         // number of sinusoidal components
  const df = (fMax - fMin) / (nFreq - 1);
  const fg = 1.5 + Math.random() * 1.5;  // soil frequency 1.5–3 Hz
  const zetag = 0.6;         // soil damping

  const freqs: number[] = [];
  const amps: number[] = [];
  const phases: number[] = [];
  for (let j = 0; j < nFreq; j++) {
    const f = fMin + j * df;
    const r = f / fg;
    // Kanai-Tajimi filter magnitude
    const kt = Math.sqrt((1 + 4 * zetag * zetag * r * r) /
                         (Math.pow(1 - r * r, 2) + 4 * zetag * zetag * r * r));
    freqs.push(f);
    // Amplitude = kt * sqrt(df) gives equal energy per octave before normalisation
    amps.push(kt * Math.sqrt(df));
    phases.push(Math.random() * 2 * Math.PI);
  }

  // --- Step 3: Jennings-Housner trapezoidal envelope, duration-scaled ---
  const tRise    = Math.min(0.15 * duration, 4.0);   // rise portion
  const tDecay   = Math.min(0.20 * duration, 6.0);   // decay portion
  const tPlateau = duration - tRise - tDecay;         // strong-motion plateau

  for (let i = 0; i < n; i++) {
    const ti = t[i];
    let env: number;
    if      (ti < tRise)               env = Math.pow(ti / tRise, 2);
    else if (ti < tRise + tPlateau)    env = 1.0;
    else {
      const trel = ti - tRise - tPlateau;
      env = Math.exp(-2.5 * trel / tDecay);
    }

    let signal = 0;
    for (let j = 0; j < nFreq; j++) {
      signal += amps[j] * Math.sin(2 * Math.PI * freqs[j] * ti + phases[j]);
    }
    raw.push(signal * env);
  }

  // --- Step 4: Two-pass baseline correction ---
  // Pass A: subtract linear ramp so that final velocity = 0.
  //   v(T) = integral(a dt) ≈ sum(a[i]*dt) = 0
  //   Remove: a_corr = a - (a[0] + (a[N-1]-a[0])/(N-1)*i)  → ramp from a[0] to a[N-1]
  //   Simpler: subtract linear trend that forces trapezoidal integral to zero.
  let velFinal = 0;
  for (let i = 0; i < n; i++) {
    velFinal += (i === 0 || i === n - 1 ? 0.5 : 1.0) * raw[i] * dt;
  }
  // The correction ramp has the same integral as velFinal; ramp = c * (T - t)
  // integral of c*(T-t) dt from 0 to T = c*T^2/2  → c = 2*velFinal / T^2
  const T = t[n - 1];
  const cA = 2.0 * velFinal / (T * T);
  for (let i = 0; i < n; i++) {
    raw[i] -= cA * (T - t[i]);  // ramp that decays to 0 at t=T
  }

  // Pass B: subtract a parabola so that final displacement = 0.
  //   After pass A, velocity is zero-mean-terminal; now integrate to get displacement
  //   and subtract a parabolic correction.
  const vel = new Float64Array(n);
  const disp = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    vel[i]  = vel[i-1]  + 0.5 * (raw[i] + raw[i-1]) * dt;
    disp[i] = disp[i-1] + 0.5 * (vel[i] + vel[i-1]) * dt;
  }
  const dispFinal = disp[n - 1];
  // Parabolic correction: c*t*(t-T); integral = c*(-T^3/6); adjust acceleration by 2c
  const cB = dispFinal / (T * T * T / 6.0);
  for (let i = 0; i < n; i++) {
    raw[i] -= cB * t[i]; // linear acceleration correction that handles displacement offset
  }

  // --- Step 5: Normalise to target PGA ---
  let currentMax = 0;
  for (let i = 0; i < n; i++) if (Math.abs(raw[i]) > currentMax) currentMax = Math.abs(raw[i]);

  const pga = (targetPGA !== undefined && targetPGA > 0) ? targetPGA * 9.81 : 0.3 * 9.81;
  const factor = currentMax > 0 ? pga / currentMax : 1;
  const ug = raw.map(v => v * factor);

  return { t, ug };
}

/**
 * Calculates a scaling factor to match a target response spectrum.
 * Uses a simple ratio of average spectral accelerations at target periods.
 */
export function calculateScalingFactor(
  motion: GroundMotion,
  targetSpectrum: { period: number; sa: number }[],
  zeta: number
): number {
  if (!motion || !motion.ug || targetSpectrum.length === 0) return 1.0;

  // 1. Calculate current spectrum
  const currentSpectra = calculateSpectra(motion, zeta);
  
  // 2. Compare average Sa at target periods
  let sumTarget = 0;
  let sumCurrent = 0;
  let count = 0;
  
  for (const targetPoint of targetSpectrum) {
    const t = targetPoint.period;
    const saTarget = targetPoint.sa;
    
    // Linear interpolation of current spectrum
    let saCurrent = 0;
    const periods = currentSpectra.periods;
    const Sa = currentSpectra.Sa;
    
    const idx = periods.findIndex(p => p >= t);
    if (idx === 0) {
      saCurrent = Sa[0];
    } else if (idx === -1) {
      saCurrent = Sa[Sa.length - 1];
    } else {
      const p0 = periods[idx - 1];
      const p1 = periods[idx];
      const s0 = Sa[idx - 1];
      const s1 = Sa[idx];
      saCurrent = s0 + (s1 - s0) * (t - p0) / (p1 - p0);
    }
    
    if (saCurrent > 0) {
      sumTarget += saTarget;
      sumCurrent += saCurrent;
      count++;
    }
  }
  
  if (count === 0 || sumCurrent === 0) return 1.0;
  return sumTarget / sumCurrent;
}

export function parseMotionFile(text: string): GroundMotion {
  const lines = text.trim().split("\n");
  const t: number[] = [];
  const ug: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (i === 0 && line.toLowerCase().includes("time")) continue;
    if (!line) continue;
    const parts = line.split(/[,\s\t]+/).filter((x) => x !== "");
    if (parts.length >= 2) {
      const tv = parseFloat(parts[0]);
      const av = parseFloat(parts[1]);
      if (!isNaN(tv) && !isNaN(av)) {
        t.push(tv);
        ug.push(av * 9.81); // Assume input is in g
      }
    }
  }
  return { t, ug };
}

export function parseTargetSpectrum(text: string): { period: number; sa: number }[] {
  const lines = text.trim().split("\n");
  const data: { period: number; sa: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.toLowerCase().includes("period")) continue;
    const parts = line.split(/[,\s\t]+/).filter((x) => x !== "");
    if (parts.length >= 2) {
      const p = parseFloat(parts[0]);
      const s = parseFloat(parts[1]);
      if (!isNaN(p) && !isNaN(s)) {
        data.push({ period: p, sa: s });
      }
    }
  }
  return data;
}
