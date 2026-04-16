import React, { useState, useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Download, Plus, RotateCcw, Trash2, MapPin, Search, Loader2, Copy, Check } from 'lucide-react';
import { cn } from '../utils/cn';
import { HazardPoint } from '../types';
import { DEFAULT_HAZARD, DEFAULT_PGA_REFS } from '../constants';

const TABLES: Record<string, Record<string, (number | string)[]>> = {
  F02: { A:[0.69,0.69,0.69,0.69,0.69], B:[0.77,0.77,0.77,0.77,0.77], C:[1.00,1.00,1.00,1.00,1.00], D:[1.24,1.09,1.00,0.94,0.90], E:[1.64,1.24,1.05,0.93,0.85], F:['*','*','*','*','*'] },
  F05: { A:[0.57,0.57,0.57,0.57,0.57], B:[0.65,0.65,0.65,0.65,0.65], C:[1.00,1.00,1.00,1.00,1.00], D:[1.47,1.30,1.20,1.14,1.10], E:[2.47,1.80,1.48,1.30,1.17], F:['*','*','*','*','*'] },
  F10: { A:[0.57,0.57,0.57,0.57,0.57], B:[0.63,0.63,0.63,0.63,0.63], C:[1.00,1.00,1.00,1.00,1.00], D:[1.55,1.39,1.31,1.25,1.21], E:[2.81,2.08,1.74,1.53,1.39], F:['*','*','*','*','*'] },
  F20: { A:[0.58,0.58,0.58,0.58,0.58], B:[0.63,0.63,0.63,0.63,0.63], C:[1.00,1.00,1.00,1.00,1.00], D:[1.57,1.44,1.36,1.31,1.27], E:[2.90,2.24,1.92,1.72,1.58], F:['*','*','*','*','*'] },
  F50: { A:[0.61,0.61,0.61,0.61,0.61], B:[0.64,0.64,0.64,0.64,0.64], C:[1.00,1.00,1.00,1.00,1.00], D:[1.58,1.48,1.41,1.37,1.34], E:[2.93,2.40,2.14,1.96,1.84], F:['*','*','*','*','*'] },
  F100:{ A:[0.67,0.67,0.67,0.67,0.67], B:[0.69,0.69,0.69,0.69,0.69], C:[1.00,1.00,1.00,1.00,1.00], D:[1.49,1.41,1.37,1.34,1.31], E:[2.52,2.18,2.00,1.88,1.79], F:['*','*','*','*','*'] },
  FPGA:{ A:[0.90,0.90,0.90,0.90,0.90], B:[0.87,0.87,0.87,0.87,0.87], C:[1.00,1.00,1.00,1.00,1.00], D:[1.29,1.10,0.99,0.93,0.88], E:[1.81,1.23,0.98,0.83,0.74], F:['*','*','*','*','*'] },
  FPGV:{ A:[0.62,0.62,0.62,0.62,0.62], B:[0.67,0.67,0.67,0.67,0.67], C:[1.00,1.00,1.00,1.00,1.00], D:[1.47,1.30,1.20,1.14,1.10], E:[2.47,1.80,1.48,1.30,1.17], F:['*','*','*','*','*'] }
};

const PGA_BINS = [0.1, 0.2, 0.3, 0.4, 0.5];
const G = 9.81;

const RP_LABELS = { rp2475: "2475Y", rp975: "975Y", rp475: "475Y" };

const lerp = (x: number, x1: number, x2: number, y1: number, y2: number) => x2 === x1 ? y1 : y1 + (x-x1)/(x2-x1)*(y2-y1);
const round = (n: number, d=3) => Math.round(n * Math.pow(10,d)) / Math.pow(10,d);

function getF(siteClass: string, key: string, pga: number) {
  const row = TABLES[key][siteClass];
  if (row[0] === '*') return NaN;
  const p = Math.max(0.1, Math.min(0.5, pga));
  let i = 0; while(i < 4 && p > PGA_BINS[i+1]) i++;
  return lerp(p, PGA_BINS[i], PGA_BINS[i+1]||0.5, Number(row[i]), Number(row[i+1]||row[i]));
}

function getFofT(T: number, siteClass: string, pga: number) {
  const anchors = [
    {t:0.2, f:getF(siteClass, 'F02', pga)},
    {t:0.5, f:getF(siteClass, 'F05', pga)},
    {t:1.0, f:getF(siteClass, 'F10', pga)},
    {t:2.0, f:getF(siteClass, 'F20', pga)},
    {t:5.0, f:getF(siteClass, 'F50', pga)},
    {t:10.0, f:getF(siteClass, 'F100', pga)}
  ];
  if (T <= 0.2) return anchors[0].f;
  for(let i=0; i<anchors.length-1; i++) {
    if (T >= anchors[i].t && T <= anchors[i+1].t) return lerp(T, anchors[i].t, anchors[i+1].t, anchors[i].f, anchors[i+1].f);
  }
  return anchors[anchors.length-1].f;
}

function getSaAt(curve: HazardPoint[], T: number) {
  if (!curve || curve.length === 0) return NaN;
  const pts = [...curve].sort((a,b)=>a.T-b.T);
  if (T <= pts[0].T) return pts[0].Sa;
  if (T >= pts[pts.length-1].T) return pts[pts.length-1].Sa;
  for(let i=0; i<pts.length-1; i++) {
    if (T >= pts[i].T && T <= pts[i+1].T) return lerp(T, pts[i].T, pts[i+1].T, pts[i].Sa, pts[i+1].Sa);
  }
  return pts[pts.length-1].Sa;
}

interface HazardCalculatorProps {
  siteClass: string;
  setSiteClass: (sc: string) => void;
  damping: number;
  setDamping: (d: number) => void;
  pgaRefs: { rp2475: number; rp975: number; rp475: number };
  setPgaRefs: (refs: { rp2475: number; rp975: number; rp475: number }) => void;
  hazard: Record<string, HazardPoint[]>;
  setHazard: (h: Record<string, HazardPoint[]>) => void;
}

export function HazardCalculator({
  siteClass,
  setSiteClass,
  damping,
  setDamping,
  pgaRefs,
  setPgaRefs,
  hazard,
  setHazard
}: HazardCalculatorProps) {
  const [activeRp, setActiveRp] = useState<keyof typeof RP_LABELS>("rp2475");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [outputCopied, setOutputCopied] = useState(false);

  // NRCAN API State
  const [lat, setLat] = useState<string>("43.701");
  const [lon, setLon] = useState<string>("-79.27");
  const [codeVersion, setCodeVersion] = useState<string>("NBC2025");
  const [isFetching, setIsFetching] = useState(false);
  const [zones, setZones] = useState<string[]>([]);

  const fetchHazardData = async () => {
    if (siteClass === 'F') {
      setError("Site Class F requires specific study and is not supported by the API.");
      return;
    }
    
    setIsFetching(true);
    setError(null);
    setZones([]);
    
    try {
      const query = `
        query GetHazard($lat: Float!, $lon: Float!) {
          ${codeVersion}(latitude: $lat, longitude: $lon) {
            metadata {
              zones
            }
            siteDesignationsXs(siteClass: C, poe50: [2.0, 5.0, 10.0]) {
              poe50
              pga
              sa0p2
              sa0p5
              sa1p0
              sa2p0
              sa5p0
              sa10p0
            }
          }
        }
      `;
      
      const response = await fetch('/api/nrcan-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          variables: {
            lat: parseFloat(lat),
            lon: parseFloat(lon)
          }
        })
      });
      
      const result = await response.json();
      
      if (result.errors) {
        throw new Error(result.errors[0].message);
      }
      
      const resultData = result.data?.[codeVersion];
      if (!resultData) {
        throw new Error("No hazard data found for this location.");
      }
      
      // Filter out model identifiers that aren't actually warnings (e.g., NBC_CNB2020_Canada)
      const filteredZones = (resultData.metadata?.zones || []).filter((z: string) => 
        !z.startsWith('NBC_CNB') && !z.toLowerCase().includes('canada')
      );
      setZones(filteredZones);
      
      const data = resultData.siteDesignationsXs;
      if (!data || data.length === 0) {
        throw new Error("No hazard data found for this location.");
      }
      
      const newPgaRefs = { ...pgaRefs };
      const newHazard = { ...hazard };
      
      data.forEach((item: any) => {
        let rpKey = "";
        // Mapping probabilities to return periods
        if (item.poe50 === 2.0) rpKey = "rp2475";
        else if (item.poe50 === 5.0) rpKey = "rp975";
        else if (item.poe50 === 10.0) rpKey = "rp475";
        
        if (rpKey) {
          newPgaRefs[rpKey as keyof typeof pgaRefs] = item.pga;
          newHazard[rpKey] = [
            { T: 0, Sa: item.sa0p2 },
            { T: 0.2, Sa: item.sa0p2 },
            { T: 0.5, Sa: item.sa0p5 },
            { T: 1.0, Sa: item.sa1p0 },
            { T: 2.0, Sa: item.sa2p0 },
            { T: 5.0, Sa: item.sa5p0 },
            { T: 10.0, Sa: item.sa10p0 }
          ];
        }
      });
      
      setPgaRefs(newPgaRefs);
      setHazard(newHazard);
      setError(null);
    } catch (err: any) {
      setError("API Error: " + err.message);
    } finally {
      setIsFetching(false);
    }
  };

  const results = useMemo(() => {
    try {
      if (siteClass === 'F') throw new Error("Site Class F requires specific study.");
      if (damping <= 0) throw new Error("Damping must be greater than zero.");
      
      const rd = Math.pow(0.05 / damping, 0.4);
      const allT = Array.from(new Set(Object.values(hazard).flat().map((p: HazardPoint) => p.T))).sort((a, b) => a - b);
      
      if (allT.length === 0) return { rows: [], rd };

      const rows = allT.map(T => {
        const res: any = { T };
        (["rp2475", "rp975", "rp475"] as const).forEach(rp => {
          const curve = hazard[rp];
          if (!curve || curve.length === 0) {
            res[rp] = { f: NaN, st: NaN, sd: NaN };
            return;
          }

          const sa = getSaAt(curve, T);
          const sa02_raw = getSaAt(curve, 0.2);
          const pga_input = pgaRefs[rp];
          
          // Clause 4.4.3.3: Calculate PGAref based on Sa(0.2)/PGA ratio
          const ratio = pga_input > 0 ? sa02_raw / pga_input : 0;
          const pga_ref = ratio < 2.0 ? 0.8 * pga_input : pga_input;

          const f = getFofT(T, siteClass, pga_ref);
          
          let st = sa * f * rd;
          
          // Apply the special rule for S(T) when T <= 0.2s
          if (T <= 0.2) {
            const sa02 = getSaAt(curve, 0.2);
            const f02 = getFofT(0.2, siteClass, pga_ref);
            const st02 = sa02 * f02 * rd;
            
            const sa05 = getSaAt(curve, 0.5);
            const f05 = getFofT(0.5, siteClass, pga_ref);
            const st05 = sa05 * f05 * rd;
            
            st = Math.max(st02, st05);
          }

          // Sd(T) = 250 * S(T) * T^2
          const sd = T > 0 ? (250 * st * Math.pow(T, 2)) : 0;
          res[rp] = { f, st, sd };
        });
        return res;
      });
      setError(null);
      return { rows, rd };
    } catch(e: any) {
      setError(e.message);
      return null;
    }
  }, [siteClass, damping, pgaRefs, hazard]);

  const handleHazardChange = (idx: number, field: 'T' | 'Sa', value: number) => {
    const newHazard = { ...hazard };
    newHazard[activeRp] = [...newHazard[activeRp]];
    newHazard[activeRp][idx] = { ...newHazard[activeRp][idx], [field]: value };
    setHazard(newHazard);
  };

  const handlePaste = (e: React.ClipboardEvent, startIdx: number, startCol: number) => {
    e.preventDefault();
    const clipboardData = e.clipboardData.getData('text');
    const rows = clipboardData.split(/\r?\n/).filter(row => row.trim() !== '');
    
    const newHazard = { ...hazard };
    const currentCurve = [...newHazard[activeRp]];
    
    rows.forEach((row, rowOffset) => {
      const cols = row.split(/\t/);
      const targetIdx = startIdx + rowOffset;
      
      // Ensure we have enough rows
      while (targetIdx >= currentCurve.length) {
        currentCurve.push({ T: 0, Sa: 0 });
      }
      
      cols.forEach((val, colOffset) => {
        const targetCol = startCol + colOffset;
        const numVal = Number(val.replace(/,/g, ''));
        if (!isNaN(numVal)) {
          if (targetCol === 0) currentCurve[targetIdx].T = numVal;
          else if (targetCol === 1) currentCurve[targetIdx].Sa = numVal;
        }
      });
    });
    
    newHazard[activeRp] = currentCurve;
    setHazard(newHazard);
  };

  const copyToClipboard = () => {
    const data = hazard[activeRp];
    const tsv = data.map(pt => `${pt.T}\t${pt.Sa}`).join('\n');
    navigator.clipboard.writeText(tsv).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const copyOutputToClipboard = () => {
    if (!results) return;
    const header = "T (s)\tF(T)2475\tST2475 (g)\tSd2475 (mm)\tF(T)975\tST975 (g)\tSd975 (mm)\tF(T)475\tST475 (g)\tSd475 (mm)";
    const rows = results.rows.map((r: any) => {
      return [
        r.T.toFixed(2),
        r.rp2475.f.toFixed(3), r.rp2475.st.toFixed(3), Math.round(r.rp2475.sd),
        r.rp975.f.toFixed(3), r.rp975.st.toFixed(3), Math.round(r.rp975.sd),
        r.rp475.f.toFixed(3), r.rp475.st.toFixed(3), Math.round(r.rp475.sd)
      ].join('\t');
    }).join('\n');
    
    navigator.clipboard.writeText(`${header}\n${rows}`).then(() => {
      setOutputCopied(true);
      setTimeout(() => setOutputCopied(false), 2000);
    });
  };

  const addPoint = () => {
    const currentCurve = hazard[activeRp];
    const maxT = currentCurve.length > 0 ? Math.max(...currentCurve.map(p=>p.T)) : 0;
    const newHazard = { ...hazard };
    newHazard[activeRp] = [...currentCurve, { T: round(maxT + 0.5), Sa: 0.1 }];
    setHazard(newHazard);
  };

  const removePoint = (idx: number) => {
    const newHazard = { ...hazard };
    newHazard[activeRp] = newHazard[activeRp].filter((_, i) => i !== idx);
    setHazard(newHazard);
  };

  const resetDefaults = () => {
    setHazard(JSON.parse(JSON.stringify(DEFAULT_HAZARD)));
    setSiteClass("C");
    setDamping(0.05);
    setPgaRefs(DEFAULT_PGA_REFS);
  };

  const exportCSV = () => {
    if (!results) return;
    const head = "T(s),F2475,ST2475(g),SD2475(mm),F975,ST975(g),SD975(mm),F475,ST475(g),SD475(mm)\n";
    const rows = results.rows.map((r: any) => {
      const f2475 = Number.isNaN(r.rp2475.f) ? "N/A" : r.rp2475.f;
      const st2475 = Number.isNaN(r.rp2475.st) ? "N/A" : r.rp2475.st;
      const sd2475 = Number.isNaN(r.rp2475.sd) ? "N/A" : r.rp2475.sd;
      const f975 = Number.isNaN(r.rp975.f) ? "N/A" : r.rp975.f;
      const st975 = Number.isNaN(r.rp975.st) ? "N/A" : r.rp975.st;
      const sd975 = Number.isNaN(r.rp975.sd) ? "N/A" : r.rp975.sd;
      const f475 = Number.isNaN(r.rp475.f) ? "N/A" : r.rp475.f;
      const st475 = Number.isNaN(r.rp475.st) ? "N/A" : r.rp475.st;
      const sd475 = Number.isNaN(r.rp475.sd) ? "N/A" : r.rp475.sd;
      return `${r.T},${f2475},${st2475},${sd2475},${f975},${st975},${sd975},${f475},${st475},${sd475}`;
    }).join("\n");
    const blob = new Blob([head + rows], { type: 'text/csv' });
    const a = document.createElement("a"); 
    a.href = URL.createObjectURL(blob); 
    a.download = "seismic_spectra_data.csv"; 
    a.click();
  };

  const chartData = useMemo(() => {
    if (!results) return [];
    return results.rows.map((r: any) => ({
      T: r.T,
      st2475: Number.isNaN(r.rp2475.st) ? null : r.rp2475.st,
      sd2475: Number.isNaN(r.rp2475.sd) ? null : r.rp2475.sd,
      st975: Number.isNaN(r.rp975.st) ? null : r.rp975.st,
      sd975: Number.isNaN(r.rp975.sd) ? null : r.rp975.sd,
      st475: Number.isNaN(r.rp475.st) ? null : r.rp475.st,
      sd475: Number.isNaN(r.rp475.sd) ? null : r.rp475.sd,
    }));
  }, [results]);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Response Spectra</h2>
          <p className="text-slate-500">for specified site class and PGA • CSA Standard</p>
        </div>
        <div className={cn(
          "px-3 py-1 rounded-full text-sm font-medium",
          error ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"
        )}>
          {error || "System Ready"}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Input Panel */}
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
            {/* NRCAN API Search Section */}
            <div className="bg-blue-50 p-4 rounded-xl border border-blue-100 mb-6">
              <div className="flex items-center gap-2 mb-3">
                <MapPin size={14} className="text-blue-600" />
                <h3 className="text-xs font-bold text-blue-800 uppercase tracking-wider">NRCAN Hazard Search</h3>
              </div>
              
              <div className="mb-3">
                <label className="block text-[10px] font-bold text-blue-700 uppercase mb-1">Code Version</label>
                <select 
                  className="w-full p-2 border border-blue-200 rounded-lg bg-white text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  value={codeVersion}
                  onChange={e => setCodeVersion(e.target.value)}
                >
                  <option value="NBC2025">NBCC 2025</option>
                  <option value="NBC2020">NBCC 2020</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="block text-[10px] font-bold text-blue-700 uppercase mb-1">Latitude</label>
                  <input 
                    type="number" step="0.001"
                    className="w-full p-2 border border-blue-200 rounded-lg bg-white text-sm focus:ring-2 focus:ring-blue-500 focus:bg-blue-50/30 outline-none transition-all"
                    value={lat}
                    onChange={e => setLat(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-blue-700 uppercase mb-1">Longitude</label>
                  <input 
                    type="number" step="0.001"
                    className="w-full p-2 border border-blue-200 rounded-lg bg-white text-sm focus:ring-2 focus:ring-blue-500 focus:bg-blue-50/30 outline-none transition-all"
                    value={lon}
                    onChange={e => setLon(e.target.value)}
                  />
                </div>
              </div>
              
              <button 
                onClick={fetchHazardData}
                disabled={isFetching || siteClass === 'F'}
                className="w-full flex items-center justify-center gap-2 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-xs font-bold rounded-lg transition-colors shadow-sm"
              >
                {isFetching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                Fetch Hazard Data
              </button>
              <p className="mt-2 text-[11px] text-blue-600/70 italic text-center">
                * Fetches Site Class C data. Adjust site class in detailed output table.
              </p>

              {zones.length > 0 && (
                <div className="mt-3 p-2 bg-amber-50 border border-amber-200 rounded-lg text-[10px] text-amber-800 space-y-1">
                  <p className="font-bold uppercase">Site Warnings:</p>
                  {zones.map((z, i) => (
                    <p key={i}>• {z.replace(/_/g, ' ')}</p>
                  ))}
                </div>
              )}
            </div>

            <div className="grid grid-cols-3 gap-2 mb-6">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">PGA 2475Y</label>
                <input 
                  type="number" step="0.001"
                  className="w-full p-2 border border-slate-200 rounded-lg bg-slate-50 text-sm focus:ring-2 focus:ring-blue-500 focus:bg-white outline-none transition-all"
                  value={pgaRefs.rp2475}
                  onChange={e => setPgaRefs({...pgaRefs, rp2475: Number(e.target.value)})}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">PGA 975Y</label>
                <input 
                  type="number" step="0.001"
                  className="w-full p-2 border border-slate-200 rounded-lg bg-slate-50 text-sm focus:ring-2 focus:ring-blue-500 focus:bg-white outline-none transition-all"
                  value={pgaRefs.rp975}
                  onChange={e => setPgaRefs({...pgaRefs, rp975: Number(e.target.value)})}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">PGA 475Y</label>
                <input 
                  type="number" step="0.001"
                  className="w-full p-2 border border-slate-200 rounded-lg bg-slate-50 text-sm focus:ring-2 focus:ring-blue-500 focus:bg-white outline-none transition-all"
                  value={pgaRefs.rp475}
                  onChange={e => setPgaRefs({...pgaRefs, rp475: Number(e.target.value)})}
                />
              </div>
            </div>

            <div className="flex gap-1 bg-slate-100 p-1 rounded-lg mb-4">
              {(Object.keys(RP_LABELS) as Array<keyof typeof RP_LABELS>).map(rp => (
                <button
                  key={rp}
                  onClick={() => setActiveRp(rp)}
                  className={cn(
                    "flex-1 py-1.5 text-xs font-semibold rounded-md transition-all",
                    activeRp === rp ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                  )}
                >
                  {RP_LABELS[rp]}
                </button>
              ))}
            </div>

            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Hazard Data (Site Class C)</label>
              <div className="flex items-center gap-3">
                <button 
                  onClick={copyToClipboard}
                  title="Copy table to clipboard"
                  className="text-slate-400 hover:text-blue-600 transition-colors flex items-center gap-1"
                >
                  {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                  <span className="text-[10px] font-medium uppercase tracking-wider">{copied ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
            </div>
            <div className="max-h-64 overflow-y-auto border border-slate-200 rounded-lg mb-4">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-slate-500 bg-slate-50 sticky top-0">
                  <tr>
                    <th className="px-3 py-2">T (s)</th>
                    <th className="px-3 py-2">Sa (g)</th>
                    <th className="px-3 py-2 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {hazard[activeRp].map((pt, idx) => (
                    <tr key={idx} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="px-3 py-1">
                        <input 
                          type="number" step="0.1" value={pt.T}
                          onChange={e => handleHazardChange(idx, 'T', Number(e.target.value))}
                          onPaste={e => handlePaste(e, idx, 0)}
                          className="w-full bg-transparent outline-none focus:bg-blue-50/50 focus:text-blue-600 font-medium px-1 rounded transition-colors"
                        />
                      </td>
                      <td className="px-3 py-1">
                        <input 
                          type="number" step="0.001" value={pt.Sa}
                          onChange={e => handleHazardChange(idx, 'Sa', Number(e.target.value))}
                          onPaste={e => handlePaste(e, idx, 1)}
                          className="w-full bg-transparent outline-none focus:bg-blue-50/50 focus:text-blue-600 font-medium px-1 rounded transition-colors"
                        />
                      </td>
                      <td className="px-3 py-1">
                        <button onClick={() => removePoint(idx)} className="text-red-400 hover:text-red-600">
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex gap-2 mb-6">
              <button onClick={addPoint} className="flex-1 flex items-center justify-center gap-1 py-2 bg-slate-50 hover:bg-slate-100 text-slate-600 text-sm font-medium rounded-lg border border-slate-200 transition-colors">
                <Plus size={16} /> Add Point
              </button>
              <button onClick={resetDefaults} className="flex-1 flex items-center justify-center gap-1 py-2 bg-slate-50 hover:bg-slate-100 text-slate-600 text-sm font-medium rounded-lg border border-slate-200 transition-colors">
                <RotateCcw size={16} /> Reset
              </button>
            </div>

            <button 
              onClick={exportCSV}
              disabled={!results}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-sm font-semibold rounded-lg transition-colors"
            >
              <Download size={16} /> Export Data (CSV)
            </button>

            {results && (
              <div className="mt-4 text-[10px] text-slate-400 font-mono leading-tight">
                Calc Log:<br/>
                Calculated RD: {results.rd.toFixed(4)} (ξ={damping})<br/>
                {(() => {
                  const sa02 = getSaAt(hazard[activeRp], 0.2);
                  const pga = pgaRefs[activeRp];
                  const ratio = pga > 0 ? sa02 / pga : 0;
                  const pgaRef = ratio < 2.0 ? 0.8 * pga : pga;
                  return (
                    <>
                      Sa(0.2)={sa02.toFixed(3)}, PGA={pga.toFixed(3)}<br/>
                      Ratio={ratio.toFixed(2)} {ratio < 2.0 ? '< 2.0' : '≥ 2.0'}<br/>
                      PGAref={pgaRef.toFixed(3)}
                    </>
                  );
                })()}
              </div>
            )}
          </div>
        </div>

        {/* Results Panel */}
        <div className="lg:col-span-2 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col">
              <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">Spectral Acceleration (ST)</h3>
              <div className="flex-1 min-h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 5, right: 5, bottom: 20, left: 15 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="T" type="number" domain={['dataMin', 'dataMax']} label={{ value: 'Period T (s)', position: 'bottom', offset: 0 }} tick={{fontSize: 12}} />
                    <YAxis label={{ value: 'Spectral Accel ST (g)', angle: -90, position: 'insideLeft', offset: -5, style: { fontSize: '12px' } }} tick={{fontSize: 12}} />
                    <Tooltip formatter={(val: number) => val.toFixed(3)} labelFormatter={(l) => `T = ${l}s`} />
                    <Legend verticalAlign="top" height={36} iconType="circle" />
                    <Line type="linear" dataKey="st2475" name="2475Y" stroke="#3b82f6" strokeWidth={2} dot={false} activeDot={{r: 6}} />
                    <Line type="linear" dataKey="st975" name="975Y" stroke="#10b981" strokeWidth={2} dot={false} activeDot={{r: 6}} />
                    <Line type="linear" dataKey="st475" name="475Y" stroke="#f59e0b" strokeWidth={2} dot={false} activeDot={{r: 6}} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col">
              <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">Spectral Displacement (Sd)</h3>
              <div className="flex-1 min-h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 5, right: 5, bottom: 20, left: 15 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="T" type="number" domain={['dataMin', 'dataMax']} label={{ value: 'Period T (s)', position: 'bottom', offset: 0 }} tick={{fontSize: 12}} />
                    <YAxis label={{ value: 'Spectral Displ Sd (mm)', angle: -90, position: 'insideLeft', offset: -5, style: { fontSize: '12px' } }} tick={{fontSize: 12}} />
                    <Tooltip formatter={(val: number) => Math.round(val)} labelFormatter={(l) => `T = ${l}s`} />
                    <Legend verticalAlign="top" height={36} iconType="circle" />
                    <Line type="linear" dataKey="sd2475" name="2475Y" stroke="#3b82f6" strokeWidth={2} dot={false} activeDot={{r: 6}} />
                    <Line type="linear" dataKey="sd975" name="975Y" stroke="#10b981" strokeWidth={2} dot={false} activeDot={{r: 6}} />
                    <Line type="linear" dataKey="sd475" name="475Y" stroke="#f59e0b" strokeWidth={2} dot={false} activeDot={{r: 6}} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider">Detailed Output</h3>
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-semibold text-slate-500 uppercase">Site Class</label>
                    <select 
                      className="p-1.5 border border-slate-200 rounded-lg bg-slate-50 text-xs focus:ring-2 focus:ring-blue-500 outline-none min-w-[60px]"
                      value={siteClass}
                      onChange={e => setSiteClass(e.target.value)}
                    >
                      {['A','B','C','D','E','F'].map(sc => <option key={sc} value={sc}>{sc}</option>)}
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-semibold text-slate-500 uppercase">Damping ξ</label>
                    <input 
                      type="number" step="0.001" min="0.001"
                      className="w-20 p-1.5 border border-slate-200 rounded-lg bg-slate-50 text-xs focus:ring-2 focus:ring-blue-500 focus:bg-white outline-none transition-all"
                      value={damping}
                      onChange={e => setDamping(Number(e.target.value))}
                    />
                  </div>
                </div>
                <button 
                  onClick={copyOutputToClipboard}
                  title="Copy detailed output to clipboard"
                  className="text-slate-400 hover:text-blue-600 transition-colors flex items-center gap-1"
                >
                  {outputCopied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                  <span className="text-[10px] font-medium uppercase tracking-wider">{outputCopied ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
            </div>
            <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
              <table className="w-full text-sm text-right">
                <thead className="text-xs text-slate-500 bg-slate-50 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left">T (s)</th>
                    <th className="px-3 py-2">F(T)₂₄₇₅</th>
                    <th className="px-3 py-2">ST₂₄₇₅ (g)</th>
                    <th className="px-3 py-2">Sd₂₄₇₅ (mm)</th>
                    <th className="px-3 py-2">F(T)₉₇₅</th>
                    <th className="px-3 py-2">ST₉₇₅ (g)</th>
                    <th className="px-3 py-2">Sd₉₇₅ (mm)</th>
                    <th className="px-3 py-2">F(T)₄₇₅</th>
                    <th className="px-3 py-2">ST₄₇₅ (g)</th>
                    <th className="px-3 py-2">Sd₄₇₅ (mm)</th>
                  </tr>
                </thead>
                <tbody>
                  {results?.rows.map((r: any, i: number) => (
                    <tr key={i} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="px-3 py-2 text-left font-semibold">{r.T.toFixed(2)}</td>
                      <td className="px-3 py-2">{Number.isNaN(r.rp2475.f) ? "N/A" : r.rp2475.f.toFixed(3)}</td>
                      <td className="px-3 py-2">{Number.isNaN(r.rp2475.st) ? "N/A" : r.rp2475.st.toFixed(3)}</td>
                      <td className="px-3 py-2">{Number.isNaN(r.rp2475.sd) ? "N/A" : Math.round(r.rp2475.sd)}</td>
                      <td className="px-3 py-2">{Number.isNaN(r.rp975.f) ? "N/A" : r.rp975.f.toFixed(3)}</td>
                      <td className="px-3 py-2">{Number.isNaN(r.rp975.st) ? "N/A" : r.rp975.st.toFixed(3)}</td>
                      <td className="px-3 py-2">{Number.isNaN(r.rp975.sd) ? "N/A" : Math.round(r.rp975.sd)}</td>
                      <td className="px-3 py-2">{Number.isNaN(r.rp475.f) ? "N/A" : r.rp475.f.toFixed(3)}</td>
                      <td className="px-3 py-2">{Number.isNaN(r.rp475.st) ? "N/A" : r.rp475.st.toFixed(3)}</td>
                      <td className="px-3 py-2">{Number.isNaN(r.rp475.sd) ? "N/A" : Math.round(r.rp475.sd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          
          <p className="text-xs text-slate-400 text-center">
            Calculations follow standard site amplification methods. S<sub>d</sub> = 250 · S<sub>T</sub> · T². R<sub>D</sub> = (0.05/ξ)<sup>0.4</sup>
          </p>
        </div>
      </div>
    </div>
  );
}
