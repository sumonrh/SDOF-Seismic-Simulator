import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import {
  Activity,
  Settings,
  Upload,
  Zap,
  BarChart3,
  Info,
  ChevronRight,
  RefreshCw,
  Play,
  Pause,
  RotateCcw,
  Download,
  Maximize2,
  X,
  Check,
  AlertTriangle,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  SimulationResults,
  SpectraData,
  GroundMotion,
} from './types';
import {
  solveSDOF,
  calculateSpectra,
  generateSyntheticMotion,
  parseMotionFile,
  validateGroundMotion,
  calculateScalingFactor,
  parseTargetSpectrum,
  calculateStrongMotionParameters,
  sanitizeSpectrumPoints,
  interpolateSa,
} from './utils/seismicSolver';
import { matchSpectrumWavelet } from './utils/waveletMatcher';
import { SeismicChart } from './components/SeismicChart';
import { SDOFAnimation } from './components/SDOFAnimation';
import { cn } from './utils/cn';

type AppTab = 'response' | 'spectra' | 'scaling' | 'help';
type ScalingMethod = 'linear' | 'wavelet';
type SpectrumPoint = { period: number; sa: number };

const DEFAULT_TARGET_SPECTRUM: SpectrumPoint[] = [
  { period: 0, sa: 0.5065 },
  { period: 0.2, sa: 0.5065 },
  { period: 0.5, sa: 0.5065 },
  { period: 1, sa: 0.3445 },
  { period: 2, sa: 0.2294 },
  { period: 5, sa: 0.0855 },
  { period: 10, sa: 0.0281 },
];

// Spectrum utilities moved to seismicSolver.ts


function saToSdMm(saInG: number | null, period: number): number | null {
  if (
    saInG === null ||
    !Number.isFinite(saInG) ||
    !Number.isFinite(period) ||
    period <= 0
  ) {
    return null;
  }

  const omega = (2 * Math.PI) / Math.max(period, 0.01);
  const sdMeters = (saInG * 9.81) / (omega * omega);
  return sdMeters * 1000;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function generatePeriodTicks(maxPeriod: number): number[] {
  const maxP = Math.max(1, Math.ceil(maxPeriod));
  let step = 0.5;

  if (maxP > 4) step = 1;
  if (maxP > 10) step = 2;
  if (maxP > 20) step = 5;

  const ticks: number[] = [];
  for (let t = 0; t <= maxP + 1e-9; t += step) {
    ticks.push(Number(t.toFixed(2)));
  }
  return ticks;
}

function removeMean(values: number[]): number[] {
  if (!values.length) return [];
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  return values.map((v) => v - mean);
}

function buildReferenceLines(lines: Array<{ x?: number; y?: number; label: string; color: string; strokeDasharray?: string }>) {
  return lines.filter(
    (line) =>
      (typeof line.x === 'number' && Number.isFinite(line.x)) ||
      (typeof line.y === 'number' && Number.isFinite(line.y))
  );
}

export default function App() {
  const initialMotionRef = useRef<GroundMotion | null>(null);
  if (!initialMotionRef.current) {
    initialMotionRef.current = generateSyntheticMotion(20, 0.01, 0.3);
  }

  // Input State
  const [mass, setMass] = useState<number>(1000);
  const [stiffness, setStiffness] = useState<number>(100000); // kN/m
  const [dampingRatioPercent, setDampingRatioPercent] = useState<number>(5);
  const [usePeriodMode, setUsePeriodMode] = useState<boolean>(false);
  const [targetPeriod, setTargetPeriod] = useState<number>(1.0);
  const [targetPGA, setTargetPGA] = useState<number>(0.3);
  const [syntheticDuration, setSyntheticDuration] = useState<number>(20);

  // Data State
  const [baseGroundMotion, setBaseGroundMotion] = useState<GroundMotion>(
    initialMotionRef.current
  );
  const [groundMotion, setGroundMotion] = useState<GroundMotion>(
    initialMotionRef.current
  );
  const [results, setResults] = useState<SimulationResults | null>(null);
  const [spectra, setSpectra] = useState<SpectraData | null>(null);
  const [activeTab, setActiveTab] = useState<AppTab>('response');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isMaximized, setIsMaximized] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Scaling State
  const [targetSpectrum, setTargetSpectrum] = useState<SpectrumPoint[]>(
    DEFAULT_TARGET_SPECTRUM
  );
  const validatedTargetSpectrum = useMemo(
    () => sanitizeSpectrumPoints(targetSpectrum),
    [targetSpectrum]
  );

  const [calculatedScale, setCalculatedScale] = useState<number>(1.0);
  const [isManualScale, setIsManualScale] = useState(false);
  const [scalingMethod, setScalingMethod] = useState<ScalingMethod>('linear');
  const [isMatching, setIsMatching] = useState(false);
  const [isWaveletMatched, setIsWaveletMatched] = useState(false);

  // Animation State
  const [currentTimeIndex, setCurrentTimeIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);

  const previewScale = useMemo(() => {
    return Number.isFinite(calculatedScale) && calculatedScale > 0
      ? calculatedScale
      : 1.0;
  }, [calculatedScale]);

  // Derived Stiffness
  const effectiveStiffness = useMemo(() => {
    if (usePeriodMode) {
      const wn = (2 * Math.PI) / Math.max(targetPeriod, 0.01);
      return mass * wn * wn; // kN/m when mass is in metric ton
    }
    return stiffness;
  }, [usePeriodMode, targetPeriod, mass, stiffness]);

  // Run Simulation
  const runSimulation = useCallback(() => {
    try {
      setError(null);

      const m = mass * 1000; // metric ton -> kg
      const k = effectiveStiffness * 1000; // kN/m -> N/m
      const zeta = dampingRatioPercent / 100;

      if (!Number.isFinite(m) || m <= 0) {
        throw new Error('Mass must be a positive finite value.');
      }
      if (!Number.isFinite(k) || k <= 0) {
        throw new Error('Stiffness must be a positive finite value.');
      }
      if (!Number.isFinite(zeta) || zeta < 0 || zeta > 1.5) {
        throw new Error('Damping ratio must be between 0% and 150%.');
      }

      validateGroundMotion(groundMotion);

      const res = solveSDOF(m, k, zeta, groundMotion);
      const spec = calculateSpectra(groundMotion, zeta);

      setResults(res);
      setSpectra(spec);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Simulation failed.';
      setError(message);
      setResults(null);
      setSpectra(null);
      setIsPlaying(false);
    }
  }, [mass, effectiveStiffness, dampingRatioPercent, groundMotion]);

  // Auto-run simulation when analysis inputs change
  useEffect(() => {
    runSimulation();
  }, [runSimulation]);

  // Reset wavelet match status when the basis changes
  useEffect(() => {
    setIsWaveletMatched(false);
  }, [validatedTargetSpectrum, dampingRatioPercent, baseGroundMotion]);

  // Reset playback when record changes materially
  useEffect(() => {
    setIsPlaying(false);
    setCurrentTimeIndex(0);
  }, [groundMotion]);

  // Clamp animation index to valid range when results update
  useEffect(() => {
    if (!results) {
      setCurrentTimeIndex(0);
      return;
    }
    setCurrentTimeIndex((prev) => clamp(prev, 0, results.t.length - 1));
  }, [results]);

  // Playback using actual simulation time steps
  useEffect(() => {
    if (!isPlaying || !results || results.t.length < 2) return;

    let rafId = 0;
    let lastTimestamp: number | null = null;
    let accumulatedSimTime = 0;

    const tick = (timestamp: number) => {
      if (lastTimestamp == null) {
        lastTimestamp = timestamp;
      }

      const deltaRealSec = (timestamp - lastTimestamp) / 1000;
      lastTimestamp = timestamp;
      accumulatedSimTime += deltaRealSec * playbackSpeed;

      setCurrentTimeIndex((prev) => {
        let next = prev;

        while (next < results.t.length - 1) {
          const dt = results.t[next + 1] - results.t[next];
          if (accumulatedSimTime + 1e-12 < dt) break;
          accumulatedSimTime -= dt;
          next += 1;
        }

        if (next >= results.t.length - 1) {
          setIsPlaying(false);
          return results.t.length - 1;
        }

        return next;
      });

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, results, playbackSpeed]);

  const resetAnimation = () => {
    setIsPlaying(false);
    setCurrentTimeIndex(0);
  };

  const togglePlayback = () => {
    if (!results) return;
    if (!isPlaying && currentTimeIndex >= results.t.length - 1) {
      setCurrentTimeIndex(0);
    }
    setIsPlaying((prev) => !prev);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const file = input.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        setError(null);
        const text = String(event.target?.result ?? '');
        const motion = parseMotionFile(text);
        validateGroundMotion(motion);

        setBaseGroundMotion(motion);
        setGroundMotion(motion);
        setCalculatedScale(1.0);
        setIsWaveletMatched(false);
        setIsManualScale(false);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : 'Error parsing file. Please check the format.'
        );
      }
    };
    reader.onerror = () => {
      setError('Could not read the selected file.');
    };
    reader.readAsText(file);

    // allow re-selecting the same file later
    input.value = '';
  };

  const handleGenerateSynthetic = () => {
    try {
      setError(null);
      const motion = generateSyntheticMotion(syntheticDuration, 0.01, targetPGA);
      validateGroundMotion(motion);

      setBaseGroundMotion(motion);
      setGroundMotion(motion);
      setCalculatedScale(1.0);
      setIsWaveletMatched(false);
      setIsManualScale(false);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to generate synthetic motion.'
      );
    }
  };

  const applyScaleToAnalysis = () => {
    try {
      setError(null);

      if (!Number.isFinite(calculatedScale) || calculatedScale <= 0) {
        throw new Error('Scale factor must be a positive finite number.');
      }

      const newUg = groundMotion.ug.map((v) => v * calculatedScale);
      const scaledMotion = { ...groundMotion, ug: [...newUg] };

      validateGroundMotion(scaledMotion);
      setGroundMotion(scaledMotion);

      // Once applied, the current record is the analysis record.
      // Reset preview scale to unity to avoid a second implicit scaling preview.
      setCalculatedScale(1.0);
      setIsWaveletMatched(false);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to apply scale factor.'
      );
    }
  };

  const downloadGroundMotion = () => {
    try {
      setError(null);

      validateGroundMotion(groundMotion);

      let content = 'Time (s),Acceleration (g)\n';
      for (let i = 0; i < groundMotion.t.length; i++) {
        const accelG = groundMotion.ug[i] / 9.81;
        content += `${groundMotion.t[i].toFixed(4)},${accelG.toFixed(6)}\n`;
      }

      const blob = new Blob([content], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `ground_motion_${Date.now()}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to download record.'
      );
    }
  };

  const strongMotionParams = useMemo(() => {
    try {
      return calculateStrongMotionParameters(groundMotion);
    } catch {
      return {
        pga: 0,
        ariasIntensity: 0,
        significantDuration: 0,
      };
    }
  }, [groundMotion]);

  // Memoized Chart Data
  const chartStep = useMemo(() => {
    if (!results) return 1;
    return Math.max(1, Math.floor(results.t.length / 1000));
  }, [results]);

  const chartData = useMemo(() => {
    if (!results) return [];
    const data = [];

    for (let i = 0; i < results.t.length; i += chartStep) {
      data.push({
        time: parseFloat(results.t[i].toFixed(3)),
        u: parseFloat((results.u[i] * 1000).toFixed(3)), // mm
        a_abs: parseFloat((results.a_abs[i] / 9.81).toFixed(3)), // g
        p: parseFloat(results.p[i].toFixed(1)),
        fma: parseFloat(results.fma[i].toFixed(1)),
        fku: parseFloat(results.fku[i].toFixed(1)),
        fcv: parseFloat(results.fcv[i].toFixed(1)),
        Vb: parseFloat(results.Vb[i].toFixed(1)),
        s_ma: parseFloat(results.s_ma[i].toFixed(1)),
        s_ku: parseFloat(results.s_ku[i].toFixed(1)),
        s_cv: parseFloat(results.s_cv[i].toFixed(1)),
      });
    }

    return data;
  }, [results, chartStep]);

  const spectraChartData = useMemo(() => {
    if (!spectra) return [];
    return spectra.periods.map((T, i) => ({
      period: parseFloat(T.toFixed(3)),
      Sa: parseFloat(spectra.Sa[i].toFixed(3)),
      Sv: parseFloat((spectra.Sv[i] * 100).toFixed(2)), // cm/s
      Sd: parseFloat((spectra.Sd[i] * 1000).toFixed(2)), // mm
    }));
  }, [spectra]);

  const adrsData = useMemo(() => {
    if (!spectra) return [];
    return spectra.Sd.map((sd, i) => ({
      Sd: parseFloat((sd * 1000).toFixed(2)), // mm
      Sa: parseFloat(spectra.Sa[i].toFixed(3)),
    }));
  }, [spectra]);

  const groundMotionStep = useMemo(() => {
    return Math.max(1, Math.floor(groundMotion.t.length / 1000));
  }, [groundMotion]);

  const meanCorrectedUg = useMemo(() => removeMean(groundMotion.ug), [groundMotion]);

  const groundMotionData = useMemo(() => {
    const data = [];
    let vel = 0; // m/s
    let disp = 0; // m
    let prevT = 0;
    let prevUgCorrected = 0;
    let prevVel = 0;

    for (let i = 0; i < groundMotion.t.length; i++) {
      const t_i = groundMotion.t[i];
      const ug_i_raw = groundMotion.ug[i];
      const ug_i_corrected = meanCorrectedUg[i] ?? ug_i_raw;

      if (i > 0) {
        const dt_i = t_i - prevT;
        vel = prevVel + 0.5 * (ug_i_corrected + prevUgCorrected) * dt_i; // accel -> vel
        disp += 0.5 * (vel + prevVel) * dt_i; // vel -> disp
      }

      prevT = t_i;
      prevUgCorrected = ug_i_corrected;
      prevVel = vel;

      if (i % groundMotionStep === 0) {
        data.push({
          time: parseFloat(t_i.toFixed(3)),
          ug: parseFloat((ug_i_raw / 9.81).toFixed(4)), // g
          ugv: parseFloat((vel * 100).toFixed(4)), // cm/s
          ugd: parseFloat((disp * 1000).toFixed(4)), // mm
        });
      }
    }

    return data;
  }, [groundMotion, groundMotionStep, meanCorrectedUg]);

  const chartHighlightIndex = useMemo(() => {
    return Math.floor(currentTimeIndex / chartStep);
  }, [currentTimeIndex, chartStep]);

  const groundHighlightIndex = useMemo(() => {
    return Math.floor(currentTimeIndex / groundMotionStep);
  }, [currentTimeIndex, groundMotionStep]);

  const scalingComparisonData = useMemo(() => {
    if (!spectra) return [];

    return spectra.periods.map((T, i) => {
      const saTarget = interpolateSa(validatedTargetSpectrum, T);
      const sdTarget = saToSdMm(saTarget, T);

      return {
        period: parseFloat(T.toFixed(3)),
        Sa_current: spectra.Sa[i],
        Sa_scaled: spectra.Sa[i] * previewScale,
        Sa_target: saTarget,
        Sd_current: spectra.Sd[i] * 1000,
        Sd_scaled: spectra.Sd[i] * 1000 * previewScale,
        Sd_target: sdTarget,
      };
    });
  }, [spectra, validatedTargetSpectrum, previewScale]);

  const structuralPeriodResponse = useMemo(() => {
    if (!spectra || !results) return null;

    const Tn = results.Tn;
    const periods = spectra.periods;
    const Sa = spectra.Sa;
    const Sd = spectra.Sd;

    let saCurrent = 0;
    let sdCurrent = 0;

    const idx = periods.findIndex((p) => p >= Tn);
    if (idx === 0) {
      saCurrent = Sa[0];
      sdCurrent = Sd[0];
    } else if (idx === -1) {
      saCurrent = Sa[Sa.length - 1];
      sdCurrent = Sd[Sd.length - 1];
    } else {
      const p0 = periods[idx - 1];
      const p1 = periods[idx];
      const s0 = Sa[idx - 1];
      const s1 = Sa[idx];
      const d0 = Sd[idx - 1];
      const d1 = Sd[idx];

      const ratio = (Tn - p0) / (p1 - p0);
      saCurrent = s0 + (s1 - s0) * ratio;
      sdCurrent = d0 + (d1 - d0) * ratio;
    }

    const saTarget = interpolateSa(validatedTargetSpectrum, Tn);

    return {
      Tn,
      sa_current: saCurrent,
      sd_current: sdCurrent * 1000,
      sa_scaled: saCurrent * previewScale,
      sd_scaled: sdCurrent * 1000 * previewScale,
      sa_target: saTarget,
      sd_target: saToSdMm(saTarget, Tn),
    };
  }, [spectra, results, validatedTargetSpectrum, previewScale]);

  const maxPeriod = useMemo(() => {
    let maxP = 4;

    if (spectra?.periods?.length) {
      maxP = Math.max(maxP, spectra.periods[spectra.periods.length - 1]);
    }
    if (validatedTargetSpectrum.length) {
      maxP = Math.max(
        maxP,
        validatedTargetSpectrum[validatedTargetSpectrum.length - 1].period
      );
    }
    return maxP;
  }, [spectra, validatedTargetSpectrum]);

  const periodTicks = useMemo(() => generatePeriodTicks(maxPeriod), [maxPeriod]);

  const dafData = useMemo(() => {
    const data = [];
    const dampingRatios = [0.02, 0.05, 0.1, 0.2, 0.5, 1.0, 1.5];
    const currentZeta = dampingRatioPercent / 100;

    if (!dampingRatios.some((z) => Math.abs(z - currentZeta) < 1e-12)) {
      dampingRatios.push(currentZeta);
    }
    dampingRatios.sort((a, b) => a - b);

    for (let r = 0; r <= 3.5 + 1e-12; r += 0.05) {
      const point: Record<string, number> = { r: parseFloat(r.toFixed(2)) };
      dampingRatios.forEach((zeta) => {
        const daf =
          1 /
          Math.sqrt(
            Math.pow(1 - r * r, 2) + Math.pow(2 * zeta * r, 2)
          );
        point[`zeta_${zeta}`] = parseFloat(daf.toFixed(3));
      });
      data.push(point);
    }

    return data;
  }, [dampingRatioPercent]);

  const dafKeys = useMemo(() => {
    const dampingRatios = [0.02, 0.05, 0.1, 0.2, 0.5, 1.0, 1.5];
    const currentZeta = dampingRatioPercent / 100;

    if (!dampingRatios.some((z) => Math.abs(z - currentZeta) < 1e-12)) {
      dampingRatios.push(currentZeta);
    }
    dampingRatios.sort((a, b) => a - b);

    const colors = [
      '#2563eb',
      '#dc2626',
      '#84cc16',
      '#7c3aed',
      '#0891b2',
      '#ea580c',
      '#1e293b',
      '#0f766e',
    ];

    return dampingRatios.map((zeta, i) => ({
      key: `zeta_${zeta}`,
      name: `ζ = ${zeta.toFixed(2)}`,
      color: Math.abs(zeta - currentZeta) < 1e-12 ? '#ef4444' : colors[i % colors.length],
      strokeWidth: Math.abs(zeta - currentZeta) < 1e-12 ? 3 : 1,
    }));
  }, [dampingRatioPercent]);

  const accelerationSpectrumReferenceLines = useMemo(() => {
    if (!results) return [];
    return buildReferenceLines([
      {
        x: results.Tn,
        label: `Tn = ${results.Tn.toFixed(2)} s`,
        color: '#ef4444',
      },
      ...(structuralPeriodResponse?.sa_current != null
        ? [
            {
              y: structuralPeriodResponse.sa_current,
              label: `Sa = ${structuralPeriodResponse.sa_current.toFixed(2)} g`,
              color: '#ef4444',
            },
          ]
        : []),
    ]);
  }, [results, structuralPeriodResponse]);

  const displacementSpectrumReferenceLines = useMemo(() => {
    if (!results) return [];
    return buildReferenceLines([
      {
        x: results.Tn,
        label: `Tn = ${results.Tn.toFixed(2)} s`,
        color: '#ef4444',
      },
      ...(structuralPeriodResponse?.sd_current != null
        ? [
            {
              y: structuralPeriodResponse.sd_current,
              label: `Sd = ${structuralPeriodResponse.sd_current.toFixed(2)} mm`,
              color: '#ef4444',
            },
          ]
        : []),
    ]);
  }, [results, structuralPeriodResponse]);

  const scalingSaReferenceLines = useMemo(() => {
    if (!results) return [];
    return buildReferenceLines([
      {
        x: results.Tn,
        label: `Tn = ${results.Tn.toFixed(2)} s`,
        color: '#ef4444',
      },
      ...(structuralPeriodResponse?.sa_scaled != null
        ? [
            {
              y: structuralPeriodResponse.sa_scaled,
              label: `Sa (Preview) = ${structuralPeriodResponse.sa_scaled.toFixed(2)} g`,
              color: '#2563eb',
            },
          ]
        : []),
      ...(structuralPeriodResponse?.sa_target != null
        ? [
            {
              y: structuralPeriodResponse.sa_target,
              label: `Sa (Target) = ${structuralPeriodResponse.sa_target.toFixed(2)} g`,
              color: '#10b981',
            },
          ]
        : []),
    ]);
  }, [results, structuralPeriodResponse]);

  const scalingSdReferenceLines = useMemo(() => {
    if (!results) return [];
    return buildReferenceLines([
      {
        x: results.Tn,
        label: `Tn = ${results.Tn.toFixed(2)} s`,
        color: '#ef4444',
      },
      ...(structuralPeriodResponse?.sd_scaled != null
        ? [
            {
              y: structuralPeriodResponse.sd_scaled,
              label: `Sd (Preview) = ${structuralPeriodResponse.sd_scaled.toFixed(2)} mm`,
              color: '#2563eb',
            },
          ]
        : []),
      ...(structuralPeriodResponse?.sd_target != null
        ? [
            {
              y: structuralPeriodResponse.sd_target,
              label: `Sd (Target) = ${structuralPeriodResponse.sd_target.toFixed(2)} mm`,
              color: '#10b981',
            },
          ]
        : []),
    ]);
  }, [results, structuralPeriodResponse]);

  const addTargetSpectrumPoint = () => {
    const lastPeriod =
      targetSpectrum.length > 0
        ? targetSpectrum[targetSpectrum.length - 1].period
        : 0;
    const nextPeriod = Number((Math.max(0, lastPeriod) + 0.1).toFixed(2));
    setTargetSpectrum((prev) => [...prev, { period: nextPeriod, sa: 0 }]);
  };

  const updateTargetSpectrumPoint = (
    idx: number,
    key: 'period' | 'sa',
    rawValue: string
  ) => {
    const value = Number(rawValue);
    if (!Number.isFinite(value)) return;

    setTargetSpectrum((prev) =>
      prev.map((point, i) =>
        i === idx
          ? {
              ...point,
              [key]: key === 'period' ? Math.max(0, value) : Math.max(0, value),
            }
          : point
      )
    );
  };

  return (
    <div className="flex h-screen bg-slate-50 text-slate-900 overflow-hidden font-sans">
      {/* Sidebar */}
      <motion.aside
        initial={false}
        animate={{
          width: isSidebarOpen ? '320px' : '0px',
          opacity: isSidebarOpen ? 1 : 0,
        }}
        className="bg-white border-r border-slate-200 flex flex-col shadow-xl z-30 overflow-hidden"
      >
        <div className="p-6 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-2 text-blue-600 mb-1">
            <Activity size={24} strokeWidth={2.5} />
            <h1 className="text-xl font-black tracking-tight uppercase">
              Seismic SDOF
            </h1>
          </div>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
            Structural Dynamics Lab
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* System Properties */}
          <section className="space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <Settings size={14} className="text-slate-400" />
              <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                System Parameters
              </h2>
            </div>

            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-4">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-600">
                  Period Mode
                </label>
                <button
                  type="button"
                  role="switch"
                  aria-checked={usePeriodMode}
                  aria-label="Toggle period mode"
                  onClick={() => setUsePeriodMode(!usePeriodMode)}
                  className={cn(
                    'w-10 h-5 rounded-full transition-colors relative',
                    usePeriodMode ? 'bg-blue-600' : 'bg-slate-300'
                  )}
                >
                  <div
                    className={cn(
                      'absolute top-1 w-3 h-3 bg-white rounded-full transition-all',
                      usePeriodMode ? 'left-6' : 'left-1'
                    )}
                  />
                </button>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase">
                  Mass (Metric Ton)
                </label>
                <div className="flex items-center bg-white border border-slate-200 rounded-lg overflow-hidden focus-within:ring-2 ring-blue-500/20 transition-all">
                  <input
                    type="number"
                    value={mass}
                    onChange={(e) =>
                      setMass(Math.max(0.1, Number(e.target.value) || 0))
                    }
                    className="w-full p-2 text-sm outline-none"
                  />
                  <span className="px-3 text-xs font-bold text-slate-400 bg-slate-50 border-l border-slate-200">
                    MT
                  </span>
                </div>
              </div>

              {usePeriodMode ? (
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase">
                    Target Period (Tn)
                  </label>
                  <div className="flex items-center bg-white border border-slate-200 rounded-lg overflow-hidden focus-within:ring-2 ring-blue-500/20 transition-all">
                    <input
                      type="number"
                      value={targetPeriod}
                      onChange={(e) =>
                        setTargetPeriod(
                          Math.max(0.01, Number(e.target.value) || 0.01)
                        )
                      }
                      className="w-full p-2 text-sm outline-none"
                      step="0.1"
                    />
                    <span className="px-3 text-xs font-bold text-slate-400 bg-slate-50 border-l border-slate-200">
                      s
                    </span>
                  </div>
                </div>
              ) : null}

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase">
                  Stiffness (k)
                </label>
                <div
                  className={cn(
                    'flex items-center bg-white border border-slate-200 rounded-lg overflow-hidden transition-all',
                    usePeriodMode
                      ? 'bg-slate-50 opacity-70'
                      : 'focus-within:ring-2 ring-blue-500/20'
                  )}
                >
                  <input
                    type="number"
                    value={Number(effectiveStiffness.toFixed(2))}
                    onChange={(e) =>
                      !usePeriodMode &&
                      setStiffness(Math.max(0.1, Number(e.target.value) || 0))
                    }
                    disabled={usePeriodMode}
                    className="w-full p-2 text-sm outline-none bg-transparent"
                  />
                  <span className="px-3 text-xs font-bold text-slate-400 bg-slate-50 border-l border-slate-200">
                    kN/m
                  </span>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase">
                  Damping Ratio (ζ)
                </label>
                <div className="flex items-center bg-white border border-slate-200 rounded-lg overflow-hidden focus-within:ring-2 ring-blue-500/20 transition-all">
                  <input
                    type="number"
                    value={dampingRatioPercent}
                    onChange={(e) =>
                      setDampingRatioPercent(
                        Math.max(0, Math.min(150, Number(e.target.value) || 0))
                      )
                    }
                    className="w-full p-2 text-sm outline-none"
                    step="1"
                    min="0"
                    max="150"
                  />
                  <span className="px-3 text-xs font-bold text-slate-400 bg-slate-50 border-l border-slate-200">
                    %
                  </span>
                </div>
              </div>
            </div>
          </section>

          {/* Ground Motion */}
          <section className="space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <Zap size={14} className="text-slate-400" />
              <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                Input Record
              </h2>
            </div>

            <div className="space-y-3">
              <label className="group relative flex flex-col items-center justify-center w-full h-24 border-2 border-dashed border-slate-200 rounded-xl cursor-pointer hover:bg-slate-50 hover:border-blue-400 transition-all">
                <div className="flex flex-col items-center justify-center pt-5 pb-6 text-center px-4">
                  <Upload
                    size={20}
                    className="text-slate-400 group-hover:text-blue-500 mb-2 transition-colors"
                  />
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-tighter">
                    Upload CSV/TXT
                  </p>
                  <p className="text-[8px] text-slate-400 mt-1 uppercase leading-tight font-medium">
                    Format: Time vs Accel (g)
                    <br />
                    Comma or Space Separated
                  </p>
                </div>
                <input
                  type="file"
                  className="hidden"
                  onChange={handleFileUpload}
                  accept=".csv,.txt"
                />
              </label>

              <div className="relative flex items-center py-2">
                <div className="flex-grow border-t border-slate-200"></div>
                <span className="flex-shrink mx-4 text-[10px] font-black text-slate-300 uppercase tracking-widest">
                  OR
                </span>
                <div className="flex-grow border-t border-slate-200"></div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase">
                  Target PGA (g)
                </label>
                <div className="flex items-center bg-white border border-slate-200 rounded-lg overflow-hidden focus-within:ring-2 ring-emerald-500/20 transition-all">
                  <input
                    type="number"
                    value={targetPGA}
                    onChange={(e) =>
                      setTargetPGA(Math.max(0, Number(e.target.value) || 0))
                    }
                    className="w-full p-2 text-sm outline-none"
                    step="0.05"
                    min="0"
                  />
                  <span className="px-3 text-xs font-bold text-slate-400 bg-slate-50 border-l border-slate-200">
                    g
                  </span>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase">
                  Synthetic Duration (s)
                </label>
                <div className="flex items-center bg-white border border-slate-200 rounded-lg overflow-hidden focus-within:ring-2 ring-emerald-500/20 transition-all">
                  <input
                    type="number"
                    value={syntheticDuration}
                    onChange={(e) =>
                      setSyntheticDuration(
                        Math.min(120, Math.max(1, Number(e.target.value) || 1))
                      )
                    }
                    className="w-full p-2 text-sm outline-none"
                    step="5"
                    min="1"
                    max="120"
                  />
                  <span className="px-3 text-xs font-bold text-slate-400 bg-slate-50 border-l border-slate-200">
                    s
                  </span>
                </div>
                <p className="text-[9px] text-slate-400 mt-0.5">
                  Max 120 s to avoid browser slowdown
                </p>
              </div>

              <button
                onClick={handleGenerateSynthetic}
                className="w-full py-3 px-4 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-emerald-100 transition-all flex items-center justify-center gap-2"
              >
                <RefreshCw size={14} />
                Generate Synthetic
              </button>
            </div>
          </section>
        </div>
      </motion.aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 relative">
        {/* Toggle Sidebar Button */}
        <button
          aria-label={isSidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          className="absolute left-0 top-1/2 -translate-y-1/2 z-40 bg-white border border-slate-200 p-1 rounded-r-lg shadow-md text-slate-400 hover:text-blue-600 transition-colors"
        >
          <ChevronRight
            size={16}
            className={cn('transition-transform', isSidebarOpen && 'rotate-180')}
          />
        </button>

        {/* Header / Tabs */}
        <header className="bg-white border-b border-slate-200 px-8 flex items-center justify-between shrink-0">
          <nav className="flex gap-8">
            <button
              onClick={() => setActiveTab('response')}
              className={cn(
                'py-5 text-xs font-black uppercase tracking-widest border-b-2 transition-all',
                activeTab === 'response'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-400 hover:text-slate-600'
              )}
            >
              Structural Response
            </button>
            <button
              onClick={() => setActiveTab('spectra')}
              className={cn(
                'py-5 text-xs font-black uppercase tracking-widest border-b-2 transition-all',
                activeTab === 'spectra'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-400 hover:text-slate-600'
              )}
            >
              Demand Spectra
            </button>
            <button
              onClick={() => setActiveTab('scaling')}
              className={cn(
                'py-5 text-xs font-black uppercase tracking-widest border-b-2 transition-all',
                activeTab === 'scaling'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-400 hover:text-slate-600'
              )}
            >
              Scaling
            </button>
            <button
              onClick={() => setActiveTab('help')}
              className={cn(
                'py-5 text-xs font-black uppercase tracking-widest border-b-2 transition-all',
                activeTab === 'help'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-400 hover:text-slate-600'
              )}
            >
              Help &amp; Info
            </button>
          </nav>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 rounded-full text-[10px] font-bold text-slate-500">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              Solver Active
            </div>
          </div>
        </header>

        {/* Dashboard Area */}
        <div className="flex-1 overflow-y-auto p-8 space-y-8">
          {error ? (
            <div className="bg-red-50 border border-red-200 text-red-800 rounded-2xl p-4 flex items-start gap-3">
              <AlertTriangle className="shrink-0 mt-0.5" size={18} />
              <div className="space-y-1">
                <p className="text-sm font-bold">Analysis / Input Error</p>
                <p className="text-sm leading-relaxed">{error}</p>
              </div>
            </div>
          ) : null}

          {!results ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-4">
              <RefreshCw className="animate-spin" size={48} />
              <p className="text-sm font-bold uppercase tracking-widest">
                Initializing Simulation...
              </p>
              <button
                onClick={runSimulation}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg text-xs font-bold uppercase tracking-widest"
              >
                Force Run
              </button>
            </div>
          ) : (
            <AnimatePresence mode="wait">
              {activeTab === 'response' ? (
                <motion.div
                  key="response"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="space-y-8"
                >
                  {/* Stats Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
                    <StatCard
                      label="Nat. Frequency"
                      value={`${results.fn.toFixed(2)} Hz`}
                      icon={<Activity size={16} />}
                    />
                    <StatCard
                      label="Nat. Period"
                      value={`${results.Tn.toFixed(2)} s`}
                      icon={<ChevronRight size={16} />}
                    />
                    <StatCard
                      label="Peak Disp (Rel)"
                      value={`${(results.pU * 1000).toFixed(2)} mm`}
                      icon={<BarChart3 size={16} />}
                      highlight="blue"
                    />
                    <StatCard
                      label="Peak Accel (Abs)"
                      value={`${(results.pAabs / 9.81).toFixed(2)} g`}
                      icon={<Activity size={16} />}
                      highlight="purple"
                    />
                    <StatCard
                      label="Peak Base Shear"
                      value={`${(results.pVb / 1000).toFixed(2)} kN`}
                      icon={<Zap size={16} />}
                      highlight="red"
                    />
                    <StatCard
                      label="Peak Spectral Period"
                      value={spectra ? `${spectra.peakT.toFixed(2)} s` : '--'}
                      icon={<Activity size={16} />}
                      highlight="purple"
                    />
                  </div>

                  {/* Animation & Ground Motion Control */}
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div className="lg:col-span-1 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col gap-4">
                      <div className="flex items-center justify-between">
                        <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest">
                          Real-time Visualization
                        </h3>
                        <div className="flex items-center gap-1">
                          <button
                            aria-label="Maximize visualization"
                            onClick={() => setIsMaximized(true)}
                            className="p-1.5 text-slate-400 hover:text-blue-600 transition-colors"
                            title="Maximize"
                          >
                            <Maximize2 size={16} />
                          </button>
                          <button
                            aria-label="Reset animation"
                            onClick={resetAnimation}
                            className="p-1.5 text-slate-400 hover:text-red-500 transition-colors"
                            title="Reset"
                          >
                            <RotateCcw size={16} />
                          </button>
                        </div>
                      </div>

                      <div className="flex-1 min-h-[250px] flex items-center justify-center">
                        <SDOFAnimation
                          results={results}
                          groundMotion={groundMotion}
                          currentIndex={currentTimeIndex}
                        />
                      </div>

                      <div className="flex flex-col gap-4 mt-auto">
                        <div className="flex items-center gap-4">
                          <button
                            onClick={togglePlayback}
                            className={cn(
                              'flex-1 py-3 rounded-xl flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-widest transition-all',
                              isPlaying
                                ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                                : 'bg-blue-600 text-white hover:bg-blue-700'
                            )}
                          >
                            {isPlaying ? (
                              <Pause size={16} fill="currentColor" />
                            ) : (
                              <Play size={16} fill="currentColor" />
                            )}
                            {isPlaying ? 'Pause' : 'Play Motion'}
                          </button>

                          <select
                            value={playbackSpeed}
                            onChange={(e) =>
                              setPlaybackSpeed(Number(e.target.value))
                            }
                            className="p-3 bg-slate-100 border-none rounded-xl text-xs font-bold text-slate-600 outline-none"
                          >
                            <option value={0.5}>0.5x</option>
                            <option value={1}>1.0x</option>
                            <option value={2}>2.0x</option>
                            <option value={5}>5.0x</option>
                          </select>
                        </div>

                        <div className="space-y-1">
                          <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase">
                            <span>Progress</span>
                            <span>
                              {(
                                (currentTimeIndex / Math.max(1, results.t.length - 1)) *
                                100
                              ).toFixed(0)}
                              %
                            </span>
                          </div>
                          <input
                            type="range"
                            min={0}
                            max={results.t.length - 1}
                            value={currentTimeIndex}
                            onChange={(e) =>
                              setCurrentTimeIndex(Number(e.target.value))
                            }
                            className="w-full h-1 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-blue-600 outline-none"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="lg:col-span-2 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm h-[400px]">
                      <SeismicChart
                        data={groundMotionData}
                        title="Input Ground Acceleration (ug)"
                        xKey="time"
                        xAxisLabel="Time (s)"
                        yAxisLabel="Accel (g)"
                        yKeys={[{ key: 'ug', name: 'Ground Accel', color: '#64748b' }]}
                        highlightIndex={groundHighlightIndex}
                      />
                    </div>
                  </div>

                  {/* Charts Grid */}
                  <div className="grid grid-cols-1 gap-8">
                    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm h-[400px]">
                      <SeismicChart
                        data={chartData}
                        title="Displacement Time History (Relative)"
                        xKey="time"
                        xAxisLabel="Time (s)"
                        yAxisLabel="Disp (mm)"
                        yKeys={[
                          {
                            key: 'u',
                            name: 'Relative Displacement',
                            color: '#2563eb',
                          },
                        ]}
                        highlightIndex={chartHighlightIndex}
                      />
                    </div>

                    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm h-[400px]">
                      <SeismicChart
                        data={chartData}
                        title="Absolute Acceleration Time History"
                        xKey="time"
                        xAxisLabel="Time (s)"
                        yAxisLabel="Accel (g)"
                        yKeys={[
                          {
                            key: 'a_abs',
                            name: 'Absolute Acceleration',
                            color: '#8b5cf6',
                          },
                        ]}
                        highlightIndex={chartHighlightIndex}
                      />
                    </div>

                    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm h-[400px]">
                      <SeismicChart
                        data={chartData}
                        title="Force Balance (Inertia, Damping, Stiffness)"
                        xKey="time"
                        xAxisLabel="Time (s)"
                        yAxisLabel="Force (N)"
                        yKeys={[
                          { key: 'fma', name: 'Inertia (m·a)', color: '#3b82f6' },
                          { key: 'fku', name: 'Stiffness (k·u)', color: '#10b981' },
                          { key: 'fcv', name: 'Damping (c·v)', color: '#f59e0b' },
                          {
                            key: 'p',
                            name: 'Total Load (-m·ug)',
                            color: '#0f172a',
                            strokeDasharray: '5 5',
                          },
                        ]}
                        highlightIndex={chartHighlightIndex}
                      />
                    </div>

                    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm h-[400px]">
                      <SeismicChart
                        data={chartData}
                        title="Normalized Force Component Magnitudes (%)"
                        xKey="time"
                        xAxisLabel="Time (s)"
                        yAxisLabel="Share %"
                        isArea={true}
                        yKeys={[
                          { key: 's_ma', name: 'Inertia', color: '#3b82f6' },
                          { key: 's_ku', name: 'Stiffness', color: '#10b981' },
                          { key: 's_cv', name: 'Damping', color: '#f59e0b' },
                        ]}
                      />
                      <p className="text-[10px] text-slate-400 mt-1 italic text-center">
                        Percentages normalized by the sum of instantaneous absolute
                        component magnitudes
                      </p>
                    </div>

                    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                      <div className="flex items-center justify-between mb-6">
                        <h3 className="text-sm font-bold text-slate-700 uppercase tracking-tight">
                          Cumulative Absolute Force Contribution
                        </h3>
                        <Info size={14} className="text-slate-300" />
                      </div>
                      <div className="grid grid-cols-3 gap-8">
                        <ContributionBar
                          label="Inertia"
                          value={results.tMa}
                          color="bg-blue-500"
                        />
                        <ContributionBar
                          label="Stiffness"
                          value={results.tKu}
                          color="bg-emerald-500"
                        />
                        <ContributionBar
                          label="Damping"
                          value={results.tCv}
                          color="bg-amber-500"
                        />
                      </div>
                    </div>
                  </div>
                </motion.div>
              ) : activeTab === 'spectra' ? (
                <motion.div
                  key="spectra"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="space-y-8"
                >
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <StatCard
                      label="Peak Spectral Period"
                      value={spectra ? `${spectra.peakT.toFixed(2)} s` : '--'}
                      icon={<Activity size={16} />}
                    />
                    <StatCard
                      label="Peak Spectral Accel"
                      value={spectra ? `${spectra.peakSa.toFixed(2)} g` : '--'}
                      icon={<Zap size={16} />}
                      highlight="purple"
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-8">
                    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm h-[280px]">
                      <SeismicChart
                        data={groundMotionData}
                        title="Ground Acceleration (ug)"
                        xKey="time"
                        xAxisLabel="Time (s)"
                        yAxisLabel="Accel (g)"
                        yKeys={[{ key: 'ug', name: 'Ground Accel', color: '#64748b' }]}
                      />
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm h-[280px]">
                        <SeismicChart
                          data={groundMotionData}
                          title="Ground Velocity (estimated, mean-corrected)"
                          xKey="time"
                          xAxisLabel="Time (s)"
                          yAxisLabel="Vel (cm/s)"
                          yKeys={[
                            { key: 'ugv', name: 'Ground Velocity', color: '#0891b2' },
                          ]}
                        />
                      </div>
                      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm h-[280px]">
                        <SeismicChart
                          data={groundMotionData}
                          title="Ground Displacement (estimated, mean-corrected)"
                          xKey="time"
                          xAxisLabel="Time (s)"
                          yAxisLabel="Disp (mm)"
                          yKeys={[
                            {
                              key: 'ugd',
                              name: 'Ground Displacement',
                              color: '#059669',
                            },
                          ]}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm h-[350px]">
                        <SeismicChart
                          data={spectraChartData}
                          title="Acceleration Response Spectrum (Sa)"
                          xKey="period"
                          xAxisLabel="Period (s)"
                          yAxisLabel="Sa (g)"
                          xTicks={periodTicks}
                          yKeys={[
                            {
                              key: 'Sa',
                              name: 'Spectral Accel',
                              color: '#8b5cf6',
                            },
                          ]}
                          referenceLines={accelerationSpectrumReferenceLines}
                        />
                      </div>
                      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm h-[350px]">
                        <SeismicChart
                          data={spectraChartData}
                          title="Displacement Response Spectrum (Sd)"
                          xKey="period"
                          xAxisLabel="Period (s)"
                          yAxisLabel="Sd (mm)"
                          xTicks={periodTicks}
                          yKeys={[
                            { key: 'Sd', name: 'Spectral Disp', color: '#06b6d4' },
                          ]}
                          referenceLines={displacementSpectrumReferenceLines}
                        />
                      </div>
                    </div>

                    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm h-[450px]">
                      <SeismicChart
                        data={adrsData}
                        title="ADRS Plot (Acceleration-Displacement Response Spectrum)"
                        xKey="Sd"
                        xAxisLabel="Sd (mm)"
                        yAxisLabel="Sa (g)"
                        yKeys={[{ key: 'Sa', name: 'ADRS Curve', color: '#ec4899' }]}
                      />
                    </div>

                    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm h-[500px]">
                      <SeismicChart
                        data={dafData}
                        title="Dynamic Amplification Factor"
                        xKey="r"
                        xAxisLabel="Frequency Ratio r = ω / ωn"
                        yAxisLabel="DAF"
                        yKeys={dafKeys}
                        referenceLines={[
                          {
                            x: 1.0,
                            label: 'r = 1.0 (Resonance)',
                            color: '#ef4444',
                            strokeDasharray: '3 3',
                          },
                        ]}
                      />
                      <div className="grid grid-cols-3 gap-4 mt-4 text-center">
                        <div className="p-2 bg-slate-50 rounded-lg">
                          <p className="text-[10px] font-black text-slate-400 uppercase">
                            kx: Spring
                          </p>
                          <p className="text-[8px] text-slate-500">
                            Stiffness Controlled (r ≪ 1)
                          </p>
                        </div>
                        <div className="p-2 bg-slate-50 rounded-lg">
                          <p className="text-[10px] font-black text-slate-400 uppercase">
                            cv: Damping
                          </p>
                          <p className="text-[8px] text-slate-500">
                            Damping Controlled (r ≈ 1)
                          </p>
                        </div>
                        <div className="p-2 bg-slate-50 rounded-lg">
                          <p className="text-[10px] font-black text-slate-400 uppercase">
                            ma: Inertia
                          </p>
                          <p className="text-[8px] text-slate-500">
                            Mass Controlled (r ≫ 1)
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              ) : activeTab === 'scaling' ? (
                <motion.div
                  key="scaling"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="space-y-8"
                >
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Target Spectrum Input */}
                    <div className="lg:col-span-1 space-y-6">
                      <div
                        className={cn(
                          'bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4 transition-opacity',
                          isManualScale && 'opacity-50 pointer-events-none'
                        )}
                      >
                        <div className="flex items-center justify-between">
                          <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest">
                            Target Spectrum
                          </h3>
                          <label
                            className={cn(
                              'cursor-pointer p-2 bg-slate-50 hover:bg-slate-100 rounded-lg transition-colors group',
                              isManualScale && 'cursor-not-allowed'
                            )}
                          >
                            <Upload
                              size={14}
                              className="text-slate-400 group-hover:text-blue-600"
                            />
                            <input
                              type="file"
                              className="hidden"
                              accept=".csv,.txt"
                              disabled={isManualScale}
                              onChange={(e) => {
                                const input = e.currentTarget;
                                const file = input.files?.[0];
                                if (!file) return;

                                const reader = new FileReader();
                                reader.onload = (event) => {
                                  try {
                                    setError(null);
                                    const text = String(event.target?.result ?? '');
                                    const parsed = parseTargetSpectrum(text);
                                    const cleaned = sanitizeSpectrumPoints(parsed);

                                    if (!cleaned.length) {
                                      throw new Error(
                                        'Target spectrum file does not contain any valid non-negative period/Sa pairs.'
                                      );
                                    }

                                    setTargetSpectrum(cleaned);
                                  } catch (err) {
                                    setError(
                                      err instanceof Error
                                        ? err.message
                                        : 'Failed to parse target spectrum file.'
                                    );
                                  }
                                };
                                reader.onerror = () => {
                                  setError('Could not read the target spectrum file.');
                                };
                                reader.readAsText(file);
                                input.value = '';
                              }}
                            />
                          </label>
                        </div>

                        <div className="max-h-[300px] overflow-y-auto border border-slate-100 rounded-xl">
                          <table className="w-full text-left text-xs">
                            <thead className="bg-slate-50 sticky top-0">
                              <tr>
                                <th className="px-4 py-2 font-bold text-slate-500 uppercase tracking-wider">
                                  Period (s)
                                </th>
                                <th className="px-4 py-2 font-bold text-slate-500 uppercase tracking-wider">
                                  Sa (g)
                                </th>
                                <th className="px-4 py-2"></th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                              {targetSpectrum.map((point, idx) => (
                                <tr
                                  key={idx}
                                  className="hover:bg-slate-50/50 transition-colors"
                                >
                                  <td className="px-4 py-2">
                                    <input
                                      type="number"
                                      value={point.period}
                                      step="0.05"
                                      min="0"
                                      disabled={isManualScale}
                                      onChange={(e) =>
                                        updateTargetSpectrumPoint(
                                          idx,
                                          'period',
                                          e.target.value
                                        )
                                      }
                                      className="w-full bg-transparent outline-none focus:text-blue-600 font-medium"
                                    />
                                  </td>
                                  <td className="px-4 py-2">
                                    <input
                                      type="number"
                                      value={point.sa}
                                      step="0.05"
                                      min="0"
                                      disabled={isManualScale}
                                      onChange={(e) =>
                                        updateTargetSpectrumPoint(
                                          idx,
                                          'sa',
                                          e.target.value
                                        )
                                      }
                                      className="w-full bg-transparent outline-none focus:text-blue-600 font-medium"
                                    />
                                  </td>
                                  <td className="px-4 py-2 text-right">
                                    <button
                                      onClick={() =>
                                        setTargetSpectrum((prev) =>
                                          prev.filter((_, i) => i !== idx)
                                        )
                                      }
                                      disabled={isManualScale}
                                      className="text-slate-300 hover:text-red-500 transition-colors disabled:hover:text-slate-300"
                                    >
                                      ×
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                        {validatedTargetSpectrum.length < 2 ? (
                          <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3">
                            Provide at least two valid target spectrum points for reliable interpolation and scaling.
                          </div>
                        ) : null}

                        <div className="flex gap-2">
                          <button
                            onClick={addTargetSpectrumPoint}
                            disabled={isManualScale || isMatching}
                            className="flex-1 py-2 bg-slate-50 hover:bg-slate-100 text-slate-600 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all disabled:opacity-50"
                          >
                            + Add Point
                          </button>
                        </div>

                        <div className="space-y-3 pt-2">
                          <div className="flex p-1 bg-slate-100 rounded-xl">
                            <button
                              onClick={() => setScalingMethod('linear')}
                              className={cn(
                                'flex-1 py-2 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all',
                                scalingMethod === 'linear'
                                  ? 'bg-white text-blue-600 shadow-sm'
                                  : 'text-slate-500 hover:text-slate-700'
                              )}
                            >
                              Linear Scaling
                            </button>
                            <button
                              onClick={() => setScalingMethod('wavelet')}
                              className={cn(
                                'flex-1 py-2 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all',
                                scalingMethod === 'wavelet'
                                  ? 'bg-white text-blue-600 shadow-sm'
                                  : 'text-slate-500 hover:text-slate-700'
                              )}
                            >
                              Wavelet Matching
                            </button>
                          </div>

                          {scalingMethod === 'linear' ? (
                            <button
                              onClick={() => {
                                try {
                                  setError(null);
                                  if (validatedTargetSpectrum.length < 2) {
                                    throw new Error(
                                      'At least two valid target spectrum points are required.'
                                    );
                                  }
                                  const factor = calculateScalingFactor(
                                    groundMotion,
                                    validatedTargetSpectrum,
                                    dampingRatioPercent / 100
                                  );

                                  if (!Number.isFinite(factor) || factor <= 0) {
                                    throw new Error(
                                      'Calculated scaling factor is invalid.'
                                    );
                                  }

                                  setCalculatedScale(factor);
                                } catch (err) {
                                  setError(
                                    err instanceof Error
                                      ? err.message
                                      : 'Could not calculate linear scale factor.'
                                  );
                                }
                              }}
                              disabled={isManualScale || isMatching}
                              className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                            >
                              <Zap size={14} />
                              Calculate Linear Scale
                            </button>
                          ) : (
                            <button
                              onClick={async () => {
                                try {
                                  setError(null);

                                  if (validatedTargetSpectrum.length < 2) {
                                    throw new Error(
                                      'At least two valid target spectrum points are required.'
                                    );
                                  }

                                  setIsMatching(true);

                                  // small yield to allow loading state paint
                                  await new Promise((r) => setTimeout(r, 100));

                                  const matched = matchSpectrumWavelet(
                                    baseGroundMotion,
                                    validatedTargetSpectrum,
                                    dampingRatioPercent / 100,
                                    30
                                  );

                                  validateGroundMotion(matched);
                                  setGroundMotion(matched);
                                  setCalculatedScale(1.0);
                                  setIsWaveletMatched(true);
                                } catch (err) {
                                  setError(
                                    err instanceof Error
                                      ? err.message
                                      : 'Wavelet matching failed.'
                                  );
                                } finally {
                                  setIsMatching(false);
                                }
                              }}
                              disabled={isMatching || isWaveletMatched}
                              className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg shadow-indigo-200"
                            >
                              {isMatching ? (
                                <>
                                  <RefreshCw size={14} className="animate-spin" />
                                  Matching Spectrum...
                                </>
                              ) : isWaveletMatched ? (
                                <>
                                  <Check size={14} />
                                  Spectrum Matched
                                </>
                              ) : (
                                <>
                                  <Zap size={14} />
                                  Perform Wavelet Matching
                                </>
                              )}
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                        <div
                          className={cn(
                            'space-y-4 transition-opacity',
                            scalingMethod === 'wavelet' && 'opacity-50 pointer-events-none'
                          )}
                        >
                          <div className="flex items-center justify-between">
                            <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest">
                              Scaling Factor
                            </h3>
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={isManualScale}
                                onChange={(e) => setIsManualScale(e.target.checked)}
                                className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                              />
                              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                                Manual Input
                              </span>
                            </label>
                          </div>

                          <div className="flex items-center gap-4">
                            <input
                              type="number"
                              value={calculatedScale}
                              step="0.0001"
                              disabled={!isManualScale}
                              onChange={(e) =>
                                setCalculatedScale(Number(e.target.value) || 0)
                              }
                              className={cn(
                                'flex-1 p-3 bg-slate-50 border-none rounded-xl text-lg font-black outline-none transition-all',
                                isManualScale
                                  ? 'text-blue-600 ring-2 ring-blue-500/20'
                                  : 'text-slate-400 cursor-not-allowed'
                              )}
                            />
                          </div>
                          <p className="text-[10px] text-slate-400 italic">
                            Applying the scale permanently modifies the current
                            analysis record. After applying, the preview factor resets
                            to 1.0 to avoid accidental double scaling.
                          </p>

                          <div className="space-y-3 pt-2">
                            <button
                              onClick={applyScaleToAnalysis}
                              className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold uppercase tracking-widest transition-all shadow-lg shadow-emerald-200 flex items-center justify-center gap-2"
                            >
                              <RefreshCw size={14} />
                              Apply scale to analysis
                            </button>
                          </div>
                        </div>

                        <div className="pt-2">
                          <button
                            onClick={downloadGroundMotion}
                            className="w-full py-3 bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 rounded-xl flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-widest transition-all"
                          >
                            <Download size={14} />
                            Download Current Record
                          </button>
                        </div>
                      </div>

                      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                        <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest">
                          Verification Parameters
                        </h3>
                        <div className="grid grid-cols-3 gap-4">
                          <div className="p-3 bg-slate-50 rounded-xl">
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                              PGA
                            </p>
                            <p className="text-sm font-black text-slate-700">
                              {strongMotionParams.pga.toFixed(3)} g
                            </p>
                          </div>
                          <div className="p-3 bg-slate-50 rounded-xl">
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                              Arias Int. (SI)
                            </p>
                            <p className="text-sm font-black text-slate-700">
                              {strongMotionParams.ariasIntensity.toFixed(2)} m/s
                            </p>
                          </div>
                          <div className="p-3 bg-slate-50 rounded-xl">
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                              Duration
                            </p>
                            <p className="text-sm font-black text-slate-700">
                              {strongMotionParams.significantDuration.toFixed(2)} s
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Comparison Chart */}
                    <div className="lg:col-span-2 space-y-8">
                      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm h-[500px]">
                        <SeismicChart
                          data={scalingComparisonData}
                          title="Acceleration Spectrum Comparison & Scaling Preview"
                          xKey="period"
                          xAxisLabel="Period (s)"
                          yAxisLabel="Sa (g)"
                          xTicks={periodTicks}
                          yKeys={[
                            {
                              key: 'Sa_current',
                              name: 'Current Spectrum',
                              color: '#94a3b8',
                            },
                            {
                              key: 'Sa_scaled',
                              name: 'Scaled Preview',
                              color: '#2563eb',
                              strokeWidth: 3,
                            },
                            {
                              key: 'Sa_target',
                              name: 'Target Spectrum',
                              color: '#10b981',
                              strokeDasharray: '5 5',
                              type: 'linear',
                            },
                          ]}
                          referenceLines={scalingSaReferenceLines}
                        />
                      </div>

                      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm h-[500px]">
                        <SeismicChart
                          data={scalingComparisonData}
                          title="Displacement Spectrum Comparison & Scaling Preview"
                          xKey="period"
                          xAxisLabel="Period (s)"
                          yAxisLabel="Sd (mm)"
                          xTicks={periodTicks}
                          yKeys={[
                            {
                              key: 'Sd_current',
                              name: 'Current Spectrum',
                              color: '#94a3b8',
                            },
                            {
                              key: 'Sd_scaled',
                              name: 'Scaled Preview',
                              color: '#2563eb',
                              strokeWidth: 3,
                            },
                            {
                              key: 'Sd_target',
                              name: 'Target Spectrum',
                              color: '#10b981',
                              strokeDasharray: '5 5',
                              type: 'linear',
                            },
                          ]}
                          referenceLines={scalingSdReferenceLines}
                        />
                      </div>

                      <div className="bg-blue-50 border border-blue-100 p-6 rounded-2xl flex gap-4 items-start">
                        <Info className="text-blue-500 shrink-0" size={20} />
                        <div className="space-y-1">
                          <h4 className="text-xs font-bold text-blue-900 uppercase tracking-tight">
                            About Scaling & Matching
                          </h4>
                          <p className="text-xs text-blue-700 leading-relaxed">
                            {scalingMethod === 'linear'
                              ? 'Linear scaling applies a constant factor to the current analysis record, preserving its frequency content while shifting its response spectrum amplitude.'
                              : 'Wavelet matching iteratively modifies the source record to improve agreement with the target spectrum. It changes the frequency content of the motion and should be treated as a different record from the original input.'}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="help"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="max-w-4xl mx-auto space-y-12 py-8"
                >
                  <section className="space-y-6">
                    <h2 className="text-3xl font-black text-slate-900 tracking-tight uppercase">
                      How to use this app
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      <div className="space-y-4">
                        <h3 className="text-xs font-black text-blue-600 uppercase tracking-widest">
                          1. Define Structure
                        </h3>
                        <p className="text-sm text-slate-600 leading-relaxed">
                          Use the sidebar to input the <strong>Mass</strong> and{' '}
                          <strong>Stiffness</strong> of your Single Degree of Freedom
                          (SDOF) system. You can also define the system by its{' '}
                          <strong>Natural Period</strong>.
                        </p>
                      </div>
                      <div className="space-y-4">
                        <h3 className="text-xs font-black text-blue-600 uppercase tracking-widest">
                          2. Input Ground Motion
                        </h3>
                        <p className="text-sm text-slate-600 leading-relaxed">
                          Upload a <strong>CSV or TXT</strong> file containing Time vs
                          Acceleration data, or generate a{' '}
                          <strong>Synthetic Motion</strong> based on a target PGA.
                        </p>
                      </div>
                      <div className="space-y-4">
                        <h3 className="text-xs font-black text-blue-600 uppercase tracking-widest">
                          3. Analyze Results
                        </h3>
                        <p className="text-sm text-slate-600 leading-relaxed">
                          View the <strong>Structural Response</strong> tab for
                          time-history plots and real-time animation. Switch to{' '}
                          <strong>Demand Spectra</strong> to see Sa, Sv, Sd, and ADRS
                          plots.
                        </p>
                      </div>
                      <div className="space-y-4">
                        <h3 className="text-xs font-black text-blue-600 uppercase tracking-widest">
                          4. Scale or Match
                        </h3>
                        <p className="text-sm text-slate-600 leading-relaxed">
                          Use the <strong>Scaling</strong> tab to linearly scale the
                          current record or perform <strong>Wavelet Matching</strong>{' '}
                          against a target spectrum. You can download the resulting
                          current record directly from that tab.
                        </p>
                      </div>
                    </div>
                  </section>

                  <div className="h-px bg-slate-200" />

                  <section className="bg-amber-50 border border-amber-200 p-8 rounded-3xl space-y-4">
                    <div className="flex items-center gap-3 text-amber-700">
                      <Info size={24} />
                      <h2 className="text-lg font-black uppercase tracking-tight">
                        Disclaimer
                      </h2>
                    </div>
                    <p className="text-sm text-amber-800 leading-relaxed font-medium">
                      This application is a <strong>demo version</strong> and is
                      currently <strong>under development</strong>. The results
                      provided by this solver are for educational and illustrative
                      purposes only. It <strong>should not be used</strong> for any
                      real-world engineering projects, design, or safety-critical
                      applications without independent verification. Velocity and
                      displacement derived from uploaded acceleration records may
                      require baseline correction and filtering for engineering-grade
                      interpretation.
                    </p>
                  </section>

                  <section className="space-y-4 pt-4">
                    <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest">
                      Contact Information
                    </h2>
                    <div className="bg-white border border-slate-200 p-6 rounded-2xl shadow-sm inline-block">
                      <p className="text-sm font-bold text-slate-900">
                        Rafiqul Haque, PhD, P.Eng.
                      </p>
                      <p className="text-sm text-blue-600 hover:underline cursor-pointer">
                        rafiqulhaque25@gmail.com
                      </p>
                    </div>
                  </section>
                </motion.div>
              )}
            </AnimatePresence>
          )}
        </div>
      </main>

      {/* Footer Info */}
      <footer className="fixed bottom-4 right-4 z-50">
        <div className="bg-white/80 backdrop-blur-md border border-slate-200 px-4 py-2 rounded-full shadow-lg flex items-center gap-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">
          <span>v1.0.5</span>
          <div className="w-px h-3 bg-slate-200" />
          <span>Newmark-Beta Solver</span>
        </div>
      </footer>

      {/* Maximized Visualization Modal */}
      <AnimatePresence>
        {isMaximized && results && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-slate-900/90 backdrop-blur-lg flex items-center justify-center p-8"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white w-full max-w-6xl h-full max-h-[80vh] rounded-3xl shadow-2xl overflow-hidden flex flex-col"
            >
              <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-600 text-white rounded-lg">
                    <Activity size={20} />
                  </div>
                  <div>
                    <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight">
                      Real-time Visualization
                    </h3>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                      Full Screen Analysis Mode
                    </p>
                  </div>
                </div>
                <button
                  aria-label="Close maximized visualization"
                  onClick={() => setIsMaximized(false)}
                  className="p-2 hover:bg-slate-200 rounded-full text-slate-400 hover:text-slate-900 transition-all"
                >
                  <X size={24} />
                </button>
              </div>

              <div className="flex-1 flex items-center justify-center p-12 bg-white relative overflow-hidden">
                <div
                  className="absolute inset-0 opacity-[0.03]"
                  style={{
                    backgroundImage:
                      'radial-gradient(#000 1px, transparent 1px)',
                    backgroundSize: '40px 40px',
                  }}
                />

                <div className="w-full h-full max-w-4xl max-h-[600px]">
                  <SDOFAnimation
                    results={results}
                    groundMotion={groundMotion}
                    currentIndex={currentTimeIndex}
                  />
                </div>
              </div>

              <div className="p-8 border-t border-slate-100 bg-slate-50/50">
                <div className="max-w-3xl mx-auto flex items-center gap-8">
                  <div className="flex-1 flex flex-col gap-4">
                    <div className="flex items-center justify-between text-[10px] font-black text-slate-400 uppercase tracking-widest">
                      <span>Simulation Progress</span>
                      <span>
                        {(
                          (currentTimeIndex / Math.max(1, results.t.length - 1)) *
                          100
                        ).toFixed(1)}
                        %
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max={results.t.length - 1}
                      value={currentTimeIndex}
                      onChange={(e) =>
                        setCurrentTimeIndex(Number(e.target.value))
                      }
                      className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                    />
                  </div>

                  <div className="flex items-center gap-4">
                    <button
                      onClick={togglePlayback}
                      className={cn(
                        'w-16 h-16 rounded-2xl flex items-center justify-center shadow-xl transition-all hover:scale-105 active:scale-95',
                        isPlaying
                          ? 'bg-amber-500 text-white shadow-amber-200'
                          : 'bg-blue-600 text-white shadow-blue-200'
                      )}
                    >
                      {isPlaying ? (
                        <Pause size={32} fill="currentColor" />
                      ) : (
                        <Play
                          size={32}
                          fill="currentColor"
                          className="ml-1"
                        />
                      )}
                    </button>

                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                        Speed
                      </span>
                      <select
                        value={playbackSpeed}
                        onChange={(e) =>
                          setPlaybackSpeed(Number(e.target.value))
                        }
                        className="p-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-600 outline-none shadow-sm"
                      >
                        <option value={0.5}>0.5x</option>
                        <option value={1}>1.0x</option>
                        <option value={2}>2.0x</option>
                        <option value={5}>5.0x</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  highlight,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  highlight?: 'blue' | 'red' | 'purple';
}) {
  const colors = {
    blue: 'text-blue-600 bg-blue-50',
    red: 'text-red-600 bg-red-50',
    purple: 'text-purple-600 bg-purple-50',
    default: 'text-slate-600 bg-slate-50',
  };

  return (
    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
          {label}
        </span>
        <div
          className={cn(
            'p-2 rounded-lg',
            highlight ? colors[highlight] : colors.default
          )}
        >
          {icon}
        </div>
      </div>
      <span
        className={cn(
          'text-2xl font-black tracking-tight',
          highlight ? colors[highlight].split(' ')[0] : 'text-slate-900'
        )}
      >
        {value}
      </span>
    </div>
  );
}

function ContributionBar({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  const safeValue = Number.isFinite(value) ? clamp(value, 0, 100) : 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-wider">
        <span className="text-slate-500">{label}</span>
        <span className="text-slate-900">{safeValue.toFixed(1)}%</span>
      </div>
      <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${safeValue}%` }}
          className={cn('h-full rounded-full', color)}
        />
      </div>
    </div>
  );
}