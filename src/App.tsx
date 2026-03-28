import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
  RotateCcw
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  SimulationResults, 
  SpectraData, 
  GroundMotion 
} from './types';
import { 
  solveSDOF, 
  calculateSpectra, 
  generateSyntheticMotion, 
  parseMotionFile,
  validateGroundMotion
} from './utils/seismicSolver';
import { SeismicChart } from './components/SeismicChart';
import { SDOFAnimation } from './components/SDOFAnimation';
import { cn } from './utils/cn';

export default function App() {
  // Input State
  const [mass, setMass] = useState<number>(1000);
  const [stiffness, setStiffness] = useState<number>(40); // kN/m
  const [dampingRatioPercent, setDampingRatioPercent] = useState<number>(5);
  const [usePeriodMode, setUsePeriodMode] = useState<boolean>(false);
  const [targetPeriod, setTargetPeriod] = useState<number>(1.0);
  const [targetPGA, setTargetPGA] = useState<number>(0.3);
  const [syntheticDuration, setSyntheticDuration] = useState<number>(20);

  // Data State
  const [groundMotion, setGroundMotion] = useState<GroundMotion>(generateSyntheticMotion(20, 0.01, 0.3));
  const [results, setResults] = useState<SimulationResults | null>(null);
  const [spectra, setSpectra] = useState<SpectraData | null>(null);
  const [activeTab, setActiveTab] = useState<'response' | 'spectra'>('response');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  // Animation State
  const [currentTimeIndex, setCurrentTimeIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);

  // Derived Stiffness
  const effectiveStiffness = useMemo(() => {
    if (usePeriodMode) {
      const wn = (2 * Math.PI) / Math.max(targetPeriod, 0.01);
      return (mass * wn * wn) / 1000; // kN/m
    }
    return stiffness;
  }, [usePeriodMode, targetPeriod, mass, stiffness]);

  // Run Simulation
  const runSimulation = useCallback(() => {
    const m = mass;
    const k = effectiveStiffness * 1000;
    const zeta = dampingRatioPercent / 100;
    
    const res = solveSDOF(m, k, zeta, groundMotion);
    const spec = calculateSpectra(groundMotion, zeta);

    setResults(res);
    setSpectra(spec);
  }, [mass, effectiveStiffness, dampingRatioPercent, groundMotion]);

  // Auto-run simulation when inputs change
  useEffect(() => {
    runSimulation();
  }, [runSimulation]);

  // Animation Playback Effect
  useEffect(() => {
    let interval: any;
    if (isPlaying && results) {
      interval = setInterval(() => {
        setCurrentTimeIndex((prev) => {
          if (prev >= results.t.length - 1) {
            setIsPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, 10 / playbackSpeed); // Approx 100fps at 1x if steps allow
    }
    return () => clearInterval(interval);
  }, [isPlaying, results, playbackSpeed]);

  const resetAnimation = () => {
    setIsPlaying(false);
    setCurrentTimeIndex(0);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const motion = parseMotionFile(text);
        validateGroundMotion(motion);
        setGroundMotion(motion);
      } catch (err) {
        alert(err instanceof Error ? err.message : "Error parsing file. Please check the format.");
      }
    };
    reader.readAsText(file);
  };

  const handleGenerateSynthetic = () => {
    setGroundMotion(generateSyntheticMotion(syntheticDuration, 0.01, targetPGA));
  };

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
      period: parseFloat(T.toFixed(2)),
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

  const groundMotionData = useMemo(() => {
    const data = [];
    let vel = 0;   // ground velocity (m/s)
    let disp = 0;  // ground displacement (m)
    let prevT = 0;
    let prevUg = 0;
    let prevVel = 0;
    for (let i = 0; i < groundMotion.t.length; i++) {
      const t_i = groundMotion.t[i];
      const ug_i = groundMotion.ug[i];
      if (i > 0) {
        const dt_i = t_i - prevT;
        vel  = prevVel + 0.5 * (ug_i + prevUg) * dt_i;   // trapz: accel → vel
        disp += 0.5 * (vel + prevVel) * dt_i;             // trapz: vel → disp
      }
      prevT   = t_i;
      prevUg  = ug_i;
      prevVel = vel;
      if (i % groundMotionStep === 0) {
        data.push({
          time: parseFloat(t_i.toFixed(3)),
          ug:   parseFloat((ug_i / 9.81).toFixed(4)),   // g
          ugv:  parseFloat((vel * 100).toFixed(4)),     // cm/s
          ugd:  parseFloat((disp * 1000).toFixed(4)),   // mm
        });
      }
    }
    return data;
  }, [groundMotion, groundMotionStep]);

  // Chart highlight index: maps raw time index → downsampled chart array index
  const chartHighlightIndex = useMemo(() => {
    return Math.floor(currentTimeIndex / chartStep);
  }, [currentTimeIndex, chartStep]);

  const groundHighlightIndex = useMemo(() => {
    return Math.floor(currentTimeIndex / groundMotionStep);
  }, [currentTimeIndex, groundMotionStep]);

  const peakResidual = useMemo(() => {
    if (!results?.residual?.length) return 0;
    return results.residual.reduce((max, r) => Math.max(max, Math.abs(r)), 0);
  }, [results]);

  return (
    <div className="flex h-screen bg-slate-50 text-slate-900 overflow-hidden font-sans">
      {/* Sidebar */}
      <motion.aside 
        initial={false}
        animate={{ width: isSidebarOpen ? '320px' : '0px', opacity: isSidebarOpen ? 1 : 0 }}
        className="bg-white border-r border-slate-200 flex flex-col shadow-xl z-30 overflow-hidden"
      >
        <div className="p-6 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-2 text-blue-600 mb-1">
            <Activity size={24} strokeWidth={2.5} />
            <h1 className="text-xl font-black tracking-tight uppercase">Seismic SDOF</h1>
          </div>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Structural Dynamics Lab</p>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* System Properties */}
          <section className="space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <Settings size={14} className="text-slate-400" />
              <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider">System Parameters</h2>
            </div>

            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-4">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-600">Period Mode</label>
                <button 
                  onClick={() => setUsePeriodMode(!usePeriodMode)}
                  className={cn(
                    "w-10 h-5 rounded-full transition-colors relative",
                    usePeriodMode ? "bg-blue-600" : "bg-slate-300"
                  )}
                >
                  <div className={cn(
                    "absolute top-1 w-3 h-3 bg-white rounded-full transition-all",
                    usePeriodMode ? "left-6" : "left-1"
                  )} />
                </button>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase">Mass (m)</label>
                <div className="flex items-center bg-white border border-slate-200 rounded-lg overflow-hidden focus-within:ring-2 ring-blue-500/20 transition-all">
                  <input 
                    type="number" 
                    value={mass} 
                    onChange={(e) => setMass(Math.max(0.1, parseFloat(e.target.value) || 0))}
                    className="w-full p-2 text-sm outline-none"
                  />
                  <span className="px-3 text-xs font-bold text-slate-400 bg-slate-50 border-l border-slate-200">kg</span>
                </div>
              </div>

              {usePeriodMode ? (
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase">Target Period (Tn)</label>
                  <div className="flex items-center bg-white border border-slate-200 rounded-lg overflow-hidden focus-within:ring-2 ring-blue-500/20 transition-all">
                    <input 
                      type="number" 
                      value={targetPeriod} 
                      onChange={(e) => setTargetPeriod(Math.max(0.01, parseFloat(e.target.value) || 0.01))}
                      className="w-full p-2 text-sm outline-none"
                      step="0.1"
                    />
                    <span className="px-3 text-xs font-bold text-slate-400 bg-slate-50 border-l border-slate-200">s</span>
                  </div>
                </div>
              ) : null}

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase">Stiffness (k)</label>
                <div className={cn(
                  "flex items-center bg-white border border-slate-200 rounded-lg overflow-hidden transition-all",
                  usePeriodMode ? "bg-slate-50 opacity-70" : "focus-within:ring-2 ring-blue-500/20"
                )}>
                  <input 
                    type="number" 
                    value={effectiveStiffness.toFixed(2)} 
                    onChange={(e) => !usePeriodMode && setStiffness(Math.max(0.1, parseFloat(e.target.value) || 0))}
                    disabled={usePeriodMode}
                    className="w-full p-2 text-sm outline-none bg-transparent"
                  />
                  <span className="px-3 text-xs font-bold text-slate-400 bg-slate-50 border-l border-slate-200">kN/m</span>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase">Damping Ratio (ζ)</label>
                <div className="flex items-center bg-white border border-slate-200 rounded-lg overflow-hidden focus-within:ring-2 ring-blue-500/20 transition-all">
                  <input 
                    type="number" 
                    value={dampingRatioPercent} 
                    onChange={(e) => setDampingRatioPercent(Math.max(0, parseFloat(e.target.value) || 0))}
                    className="w-full p-2 text-sm outline-none"
                    step="1"
                    min="0"
                    max="100"
                  />
                  <span className="px-3 text-xs font-bold text-slate-400 bg-slate-50 border-l border-slate-200">%</span>
                </div>
              </div>
            </div>
          </section>

          {/* Ground Motion */}
          <section className="space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <Zap size={14} className="text-slate-400" />
              <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Input Record</h2>
            </div>

            <div className="space-y-3">
              <label className="group relative flex flex-col items-center justify-center w-full h-24 border-2 border-dashed border-slate-200 rounded-xl cursor-pointer hover:bg-slate-50 hover:border-blue-400 transition-all">
                <div className="flex flex-col items-center justify-center pt-5 pb-6 text-center px-4">
                  <Upload size={20} className="text-slate-400 group-hover:text-blue-500 mb-2 transition-colors" />
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-tighter">Upload CSV/TXT</p>
                  <p className="text-[8px] text-slate-400 mt-1 uppercase leading-tight font-medium">Format: Time vs Accel (g)<br/>Comma or Space Separated</p>
                </div>
                <input type="file" className="hidden" onChange={handleFileUpload} accept=".csv,.txt" />
              </label>

              <div className="relative flex items-center py-2">
                <div className="flex-grow border-t border-slate-200"></div>
                <span className="flex-shrink mx-4 text-[10px] font-black text-slate-300 uppercase tracking-widest">OR</span>
                <div className="flex-grow border-t border-slate-200"></div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase">Target PGA (g)</label>
                <div className="flex items-center bg-white border border-slate-200 rounded-lg overflow-hidden focus-within:ring-2 ring-emerald-500/20 transition-all">
                  <input 
                    type="number" 
                    value={targetPGA} 
                    onChange={(e) => setTargetPGA(Math.max(0, parseFloat(e.target.value) || 0))}
                    className="w-full p-2 text-sm outline-none"
                    step="0.05"
                    min="0"
                  />
                  <span className="px-3 text-xs font-bold text-slate-400 bg-slate-50 border-l border-slate-200">g</span>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase">Synthetic Duration (s)</label>
                <div className="flex items-center bg-white border border-slate-200 rounded-lg overflow-hidden focus-within:ring-2 ring-emerald-500/20 transition-all">
                  <input 
                    type="number" 
                    value={syntheticDuration} 
                    onChange={(e) => setSyntheticDuration(Math.min(120, Math.max(1, parseFloat(e.target.value) || 1)))}
                    className="w-full p-2 text-sm outline-none"
                    step="5"
                    min="1"
                    max="120"
                  />
                  <span className="px-3 text-xs font-bold text-slate-400 bg-slate-50 border-l border-slate-200">s</span>
                </div>
                <p className="text-[9px] text-slate-400 mt-0.5">Max 120 s to avoid browser slowdown</p>
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

        <div className="p-6 border-t border-slate-100">
          <button 
            onClick={runSimulation}
            className="w-full py-4 bg-blue-600 text-white rounded-xl font-black uppercase tracking-widest shadow-lg shadow-blue-200 hover:bg-blue-700 hover:-translate-y-0.5 active:translate-y-0 transition-all"
          >
            Compute Response
          </button>
        </div>
      </motion.aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 relative">
        {/* Toggle Sidebar Button */}
        <button 
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          className="absolute left-0 top-1/2 -translate-y-1/2 z-40 bg-white border border-slate-200 p-1 rounded-r-lg shadow-md text-slate-400 hover:text-blue-600 transition-colors"
        >
          <ChevronRight size={16} className={cn("transition-transform", isSidebarOpen && "rotate-180")} />
        </button>

        {/* Header / Tabs */}
        <header className="bg-white border-b border-slate-200 px-8 flex items-center justify-between shrink-0">
          <nav className="flex gap-8">
            <button 
              onClick={() => setActiveTab('response')}
              className={cn(
                "py-5 text-xs font-black uppercase tracking-widest border-b-2 transition-all",
                activeTab === 'response' ? "border-blue-600 text-blue-600" : "border-transparent text-slate-400 hover:text-slate-600"
              )}
            >
              Structural Response
            </button>
            <button 
              onClick={() => setActiveTab('spectra')}
              className={cn(
                "py-5 text-xs font-black uppercase tracking-widest border-b-2 transition-all",
                activeTab === 'spectra' ? "border-blue-600 text-blue-600" : "border-transparent text-slate-400 hover:text-slate-600"
              )}
            >
              Demand Spectra
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
          {!results ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-4">
              <RefreshCw className="animate-spin" size={48} />
              <p className="text-sm font-bold uppercase tracking-widest">Initializing Simulation...</p>
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
                    <StatCard label="Nat. Frequency" value={`${results.fn.toFixed(2)} Hz`} icon={<Activity size={16} />} />
                    <StatCard label="Nat. Period" value={`${results.Tn.toFixed(2)} s`} icon={<ChevronRight size={16} />} />
                    <StatCard label="Peak Disp (Rel)" value={`${(results.pU * 1000).toFixed(2)} mm`} icon={<BarChart3 size={16} />} highlight="blue" />
                    <StatCard label="Peak Accel (Abs)" value={`${(results.pAabs / 9.81).toFixed(2)} g`} icon={<Activity size={16} />} highlight="purple" />
                    <StatCard label="Peak Base Shear" value={`${(results.pVb / 1000).toFixed(2)} kN`} icon={<Zap size={16} />} highlight="red" />
                    <StatCard label="Peak Residual" value={`${peakResidual.toExponential(2)} N`} icon={<Info size={16} />} />
                  </div>

                  {/* Animation & Ground Motion Control */}
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div className="lg:col-span-1 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col gap-4">
                      <div className="flex items-center justify-between">
                        <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest">Real-time Visualization</h3>
                        <div className="flex items-center gap-1">
                          <button 
                            onClick={resetAnimation}
                            className="p-1.5 text-slate-400 hover:text-red-500 transition-colors"
                            title="Reset"
                          >
                            <RotateCcw size={16} />
                          </button>
                        </div>
                      </div>
                      
                      <div className="flex-1 min-h-[250px] flex items-center justify-center">
                        <SDOFAnimation results={results} groundMotion={groundMotion} currentIndex={currentTimeIndex} />
                      </div>

                      <div className="flex flex-col gap-4 mt-auto">
                        <div className="flex items-center gap-4">
                          <button 
                            onClick={() => setIsPlaying(!isPlaying)}
                            className={cn(
                              "flex-1 py-3 rounded-xl flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-widest transition-all",
                              isPlaying ? "bg-amber-100 text-amber-700 hover:bg-amber-200" : "bg-blue-600 text-white hover:bg-blue-700"
                            )}
                          >
                            {isPlaying ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
                            {isPlaying ? "Pause" : "Play Motion"}
                          </button>
                          
                          <select 
                            value={playbackSpeed}
                            onChange={(e) => setPlaybackSpeed(parseFloat(e.target.value))}
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
                            <span>{((currentTimeIndex / (results.t.length - 1)) * 100).toFixed(0)}%</span>
                          </div>
                          <input 
                            type="range"
                            min={0}
                            max={results.t.length - 1}
                            value={currentTimeIndex}
                            onChange={(e) => setCurrentTimeIndex(parseInt(e.target.value))}
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
                        yKeys={[{ key: 'u', name: 'Relative Displacement', color: '#2563eb' }]}
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
                        yKeys={[{ key: 'a_abs', name: 'Absolute Acceleration', color: '#8b5cf6' }]}
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
                          { key: 'p', name: 'Total Load (-m·ug)', color: '#0f172a', strokeDasharray: '5 5' }
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
                          { key: 's_cv', name: 'Damping', color: '#f59e0b' }
                        ]}
                      />
                      <p className="text-[10px] text-slate-400 mt-1 italic text-center">Percentages normalized by the sum of instantaneous absolute component magnitudes</p>
                    </div>

                    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                      <div className="flex items-center justify-between mb-6">
                        <h3 className="text-sm font-bold text-slate-700 uppercase tracking-tight">Cumulative Absolute Force Contribution</h3>
                        <Info size={14} className="text-slate-300" />
                      </div>
                      <div className="grid grid-cols-3 gap-8">
                        <ContributionBar label="Inertia" value={results.tMa} color="bg-blue-500" />
                        <ContributionBar label="Stiffness" value={results.tKu} color="bg-emerald-500" />
                        <ContributionBar label="Damping" value={results.tCv} color="bg-amber-500" />
                      </div>
                    </div>
                  </div>
                </motion.div>
              ) : (
                <motion.div 
                  key="spectra"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="space-y-8"
                >
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <StatCard label="Dominant Period" value={spectra ? `${spectra.peakT.toFixed(2)} s` : "--"} icon={<Activity size={16} />} />
                    <StatCard label="Peak Spectral Accel" value={spectra ? `${spectra.peakSa.toFixed(2)} g` : "--"} icon={<Zap size={16} />} highlight="purple" />
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
                          title="Ground Velocity (vg)"
                          xKey="time"
                          xAxisLabel="Time (s)"
                          yAxisLabel="Vel (cm/s)"
                          yKeys={[{ key: 'ugv', name: 'Ground Velocity', color: '#0891b2' }]}
                        />
                      </div>
                      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm h-[280px]">
                        <SeismicChart 
                          data={groundMotionData}
                          title="Ground Displacement (dg)"
                          xKey="time"
                          xAxisLabel="Time (s)"
                          yAxisLabel="Disp (mm)"
                          yKeys={[{ key: 'ugd', name: 'Ground Displacement', color: '#059669' }]}
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
                          yKeys={[{ key: 'Sa', name: 'Spectral Accel', color: '#8b5cf6' }]}
                        />
                      </div>
                      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm h-[350px]">
                        <SeismicChart 
                          data={spectraChartData}
                          title="Displacement Response Spectrum (Sd)"
                          xKey="period"
                          xAxisLabel="Period (s)"
                          yAxisLabel="Sd (mm)"
                          yKeys={[{ key: 'Sd', name: 'Spectral Disp', color: '#06b6d4' }]}
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
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          )}
        </div>
      </main>

      {/* Footer Info */}
      <footer className="fixed bottom-4 right-4 z-50">
        <div className="bg-white/80 backdrop-blur-md border border-slate-200 px-4 py-2 rounded-full shadow-lg flex items-center gap-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">
          <span>v1.0.4 Stable</span>
          <div className="w-px h-3 bg-slate-200" />
          <span>Newmark-Beta Solver</span>
        </div>
      </footer>
    </div>
  );
}

function StatCard({ label, value, icon, highlight }: { label: string; value: string; icon: React.ReactNode; highlight?: 'blue' | 'red' | 'purple' }) {
  const colors = {
    blue: "text-blue-600 bg-blue-50",
    red: "text-red-600 bg-red-50",
    purple: "text-purple-600 bg-purple-50",
    default: "text-slate-600 bg-slate-50"
  };

  return (
    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{label}</span>
        <div className={cn("p-2 rounded-lg", highlight ? colors[highlight] : colors.default)}>
          {icon}
        </div>
      </div>
      <span className={cn("text-2xl font-black tracking-tight", highlight ? colors[highlight].split(' ')[0] : "text-slate-900")}>
        {value}
      </span>
    </div>
  );
}

function ContributionBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-wider">
        <span className="text-slate-500">{label}</span>
        <span className="text-slate-900">{value.toFixed(1)}%</span>
      </div>
      <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
        <motion.div 
          initial={{ width: 0 }}
          animate={{ width: `${value}%` }}
          className={cn("h-full rounded-full", color)}
        />
      </div>
    </div>
  );
}
