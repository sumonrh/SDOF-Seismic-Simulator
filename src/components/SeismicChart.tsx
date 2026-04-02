import React, { useState, useCallback } from 'react';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer,
  AreaChart,
  Area,
  ReferenceArea,
  ReferenceLine
} from 'recharts';
import { Maximize2, RefreshCcw } from 'lucide-react';

interface ChartProps {
  data: any[];
  title: string;
  xKey: string;
  yKeys: { key: string; name: string; color: string; strokeDasharray?: string; strokeWidth?: number; type?: "monotone" | "linear" | "step" | "stepBefore" | "stepAfter" }[];
  xAxisLabel?: string;
  yAxisLabel?: string;
  isArea?: boolean;
  highlightIndex?: number | null;
  xTicks?: number[];
  referenceLines?: { x?: number; y?: number; label?: string; color?: string; strokeDasharray?: string }[];
}

export const SeismicChart: React.FC<ChartProps> = ({ 
  data, 
  title, 
  xKey, 
  yKeys, 
  xAxisLabel, 
  yAxisLabel,
  isArea = false,
  highlightIndex = null,
  xTicks,
  referenceLines = []
}) => {
  const [left, setLeft] = useState<string | number>('auto');
  const [right, setRight] = useState<string | number>('auto');
  const [top, setTop] = useState<string | number>('auto');
  const [bottom, setBottom] = useState<string | number>('auto');
  const [refAreaLeft, setRefAreaLeft] = useState<string | number>('');
  const [refAreaRight, setRefAreaRight] = useState<string | number>('');
  const [refAreaTop, setRefAreaTop] = useState<number | null>(null);
  const [refAreaBottom, setRefAreaBottom] = useState<number | null>(null);

  const ChartComponent = isArea ? AreaChart : LineChart;

  const highlightX = highlightIndex !== null && data[highlightIndex] ? data[highlightIndex][xKey] : null;

  const zoom = useCallback(() => {
    if (refAreaLeft === refAreaRight || refAreaRight === '') {
      setRefAreaLeft('');
      setRefAreaRight('');
      setRefAreaTop(null);
      setRefAreaBottom(null);
      return;
    }

    let [l, r] = [refAreaLeft, refAreaRight];
    if (l > r) [l, r] = [r, l];

    let [t, b] = [refAreaTop, refAreaBottom];
    if (t !== null && b !== null) {
      if (b > t) [b, t] = [t, b];
      const diff = t - b;
      const padding = diff === 0 ? 1 : diff * 0.05;
      setTop(t + padding);
      setBottom(b - padding);
    }

    setLeft(l);
    setRight(r);
    setRefAreaLeft('');
    setRefAreaRight('');
    setRefAreaTop(null);
    setRefAreaBottom(null);
  }, [refAreaLeft, refAreaRight, refAreaTop, refAreaBottom]);

  const zoomOut = useCallback(() => {
    setLeft('auto');
    setRight('auto');
    setTop('auto');
    setBottom('auto');
    setRefAreaLeft('');
    setRefAreaRight('');
    setRefAreaTop(null);
    setRefAreaBottom(null);
  }, []);

  return (
    <div className="w-full h-full flex flex-col group relative">
      <div className="flex items-center justify-between mb-2 px-2">
        <h3 className="text-sm font-bold text-slate-700">{title}</h3>
        {(left !== 'auto' || top !== 'auto') && (
          <button 
            onClick={zoomOut}
            className="p-1 hover:bg-slate-100 rounded-md text-slate-400 hover:text-blue-600 transition-colors flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest"
            title="Reset Zoom"
          >
            <RefreshCcw size={12} />
            Reset
          </button>
        )}
      </div>
      <div className="flex-1 min-h-0 select-none">
        <ResponsiveContainer width="100%" height="100%">
          <ChartComponent 
            data={data} 
            margin={{ top: 5, right: 20, left: 10, bottom: 20 }}
            onMouseDown={(e: any) => {
              if (e && e.activeLabel !== undefined) {
                setRefAreaLeft(e.activeLabel);
                const val = e.activePayload?.[0]?.value;
                if (typeof val === 'number') setRefAreaTop(val);
              }
            }}
            onMouseMove={(e: any) => {
              if (refAreaLeft !== '' && e && e.activeLabel !== undefined) {
                setRefAreaRight(e.activeLabel);
                const val = e.activePayload?.[0]?.value;
                if (typeof val === 'number') setRefAreaBottom(val);
              }
            }}
            onMouseUp={zoom}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis 
              dataKey={xKey} 
              label={{ value: xAxisLabel, position: 'insideBottom', offset: -10, fontSize: 10 }}
              tick={{ fontSize: 10 }}
              type="number"
              domain={[left, right]}
              allowDataOverflow
              ticks={xTicks}
            />
            <YAxis 
              label={{ value: yAxisLabel, angle: -90, position: 'insideLeft', fontSize: 10 }}
              tick={{ fontSize: 10 }}
              domain={[bottom, top]}
              allowDataOverflow
            />
            <Tooltip 
              contentStyle={{ fontSize: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}
              labelFormatter={(value) => `${xAxisLabel}: ${value}`}
            />
            <Legend wrapperStyle={{ fontSize: '10px', paddingTop: '10px' }} />
            {referenceLines.map((rl, idx) => (
              <ReferenceLine 
                key={idx}
                x={rl.x} 
                y={rl.y} 
                stroke={rl.color || "#ef4444"} 
                strokeWidth={1} 
                strokeDasharray={rl.strokeDasharray || "3 3"}
                label={rl.label ? { value: rl.label, position: 'insideTopLeft', fontSize: 10, fill: rl.color || "#ef4444", offset: 10 } : undefined}
              />
            ))}
            {yKeys.map((yk) => (
              isArea ? (
                <Area
                  key={yk.key}
                  type="monotone"
                  dataKey={yk.key}
                  name={yk.name}
                  stroke={yk.color}
                  fill={yk.color}
                  stackId="1"
                  dot={false}
                  isAnimationActive={false}
                />
              ) : (
                <Line
                  key={yk.key}
                  type={yk.type || "monotone"}
                  dataKey={yk.key}
                  name={yk.name}
                  stroke={yk.color}
                  strokeWidth={yk.strokeWidth || 2}
                  dot={false}
                  strokeDasharray={yk.strokeDasharray}
                  isAnimationActive={false}
                  connectNulls={true}
                />
              )
            ))}
            {highlightX !== null && (
              <ReferenceLine x={highlightX} stroke="#ef4444" strokeWidth={2} strokeDasharray="3 3" />
            )}
            {refAreaLeft !== '' && refAreaRight !== '' ? (
              <ReferenceArea 
                {...({
                  x1: refAreaLeft,
                  x2: refAreaRight,
                  y1: refAreaTop !== null ? refAreaTop : undefined,
                  y2: refAreaBottom !== null ? refAreaBottom : undefined,
                  fill: "#2563eb",
                  fillOpacity: 0.1,
                  stroke: "#2563eb",
                  strokeOpacity: 0.3
                } as any)}
              />
            ) : null}
          </ChartComponent>
        </ResponsiveContainer>
        <div className="absolute top-10 right-4 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
          <div className="bg-white/90 backdrop-blur-sm border border-slate-200 px-2 py-1 rounded text-[9px] font-bold text-slate-400 uppercase tracking-tighter flex items-center gap-1">
            <Maximize2 size={10} />
            Drag to Zoom
          </div>
        </div>
      </div>
    </div>
  );
};
