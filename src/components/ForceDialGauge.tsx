import React from 'react';
import { motion } from 'framer-motion';
import { Minimize2, GripHorizontal } from 'lucide-react';

interface ForceDialGaugeProps {
  fma: number;
  fku: number;
  fcv: number;
  p: number;
  maxForce: number;
  onClose: () => void;
}

export const ForceDialGauge: React.FC<ForceDialGaugeProps> = ({ fma, fku, fcv, p, maxForce, onClose }) => {
  // SVG dimensions
  const size = 160;
  const center = size / 2;
  const radius = (size / 2) - 20; // 20px padding for labels

  // Helper to get hand end coordinates
  const getHandCoords = (force: number, baseAngleDeg: number) => {
    const magnitude = Math.abs(force);
    const direction = force >= 0 ? 1 : -1;
    
    // Scale length to max radius
    const length = maxForce > 0 ? (magnitude / maxForce) * radius : 0;
    
    // If negative, flip 180 degrees
    const angleDeg = direction === 1 ? baseAngleDeg : baseAngleDeg + 180;
    const angleRad = (angleDeg * Math.PI) / 180;
    
    return {
      x: center + length * Math.cos(angleRad),
      y: center + length * Math.sin(angleRad),
      length
    };
  };

  // Angles for each hand to prevent overlap
  const coordsP = getHandCoords(p, 0);
  const coordsFku = getHandCoords(fku, -12);
  const coordsFma = getHandCoords(fma, -24);
  const coordsFcv = getHandCoords(fcv, 12);

  return (
    <motion.div 
      drag 
      dragMomentum={false}
      className="flex flex-col items-center justify-center bg-white/90 backdrop-blur-sm rounded-xl border border-slate-200 shadow-lg p-3 cursor-move relative"
      style={{ touchAction: 'none' }}
    >
      <button 
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        className="absolute top-2 right-2 text-slate-400 hover:text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-full p-1 transition-colors cursor-pointer"
        title="Minimize Dial"
      >
        <Minimize2 size={12} />
      </button>
      <div className="flex items-center gap-1 text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">
        <GripHorizontal size={12} className="text-slate-300" />
        Force Dial
      </div>
      <svg width={size} height={size} className="overflow-visible">
        {/* Dial Background */}
        <circle cx={center} cy={center} r={radius} fill="#f8fafc" stroke="#e2e8f0" strokeWidth="2" />
        
        {/* Tick Marks */}
        {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => {
          const rad = (angle * Math.PI) / 180;
          const isMain = angle === 0 || angle === 180;
          const r1 = isMain ? radius - 8 : radius - 4;
          return (
            <line
              key={angle}
              x1={center + r1 * Math.cos(rad)}
              y1={center + r1 * Math.sin(rad)}
              x2={center + radius * Math.cos(rad)}
              y2={center + radius * Math.sin(rad)}
              stroke={isMain ? "#94a3b8" : "#cbd5e1"}
              strokeWidth={isMain ? "2" : "1"}
            />
          );
        })}

        {/* Labels */}
        <text x={center + radius + 12} y={center} dominantBaseline="middle" textAnchor="middle" className="text-[10px] font-bold fill-slate-400">+</text>
        <text x={center - radius - 12} y={center} dominantBaseline="middle" textAnchor="middle" className="text-[10px] font-bold fill-slate-400">-</text>

        {/* Hands */}
        {/* Total Load (p) */}
        <line x1={center} y1={center} x2={coordsP.x} y2={coordsP.y} stroke="#0f172a" strokeWidth="3" strokeDasharray="4 2" strokeLinecap="round" className="transition-all duration-75" />
        
        {/* Inertia (fma) */}
        <line x1={center} y1={center} x2={coordsFma.x} y2={coordsFma.y} stroke="#3b82f6" strokeWidth="2.5" strokeLinecap="round" className="transition-all duration-75" />
        
        {/* Stiffness (fku) */}
        <line x1={center} y1={center} x2={coordsFku.x} y2={coordsFku.y} stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" className="transition-all duration-75" />
        
        {/* Damping (fcv) */}
        <line x1={center} y1={center} x2={coordsFcv.x} y2={coordsFcv.y} stroke="#f59e0b" strokeWidth="2.5" strokeLinecap="round" className="transition-all duration-75" />

        {/* Center Pin */}
        <circle cx={center} cy={center} r="4" fill="#64748b" />
        <circle cx={center} cy={center} r="2" fill="#ffffff" />
      </svg>
    </motion.div>
  );
};
