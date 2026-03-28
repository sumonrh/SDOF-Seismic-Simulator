import React, { useRef, useEffect } from 'react';
import { SimulationResults, GroundMotion } from '../types';

interface SDOFAnimationProps {
  results: SimulationResults;
  groundMotion: GroundMotion;
  currentIndex: number;
}

export const SDOFAnimation: React.FC<SDOFAnimationProps> = ({ results, groundMotion, currentIndex }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    // ── Layout constants ────────────────────────────────────────────
    const groundSurfaceY = H - 56;   // top surface of the ground layer
    const groundDepth    = 56;        // thickness of the ground block
    const colH           = groundSurfaceY - 72; // column height (pixels)
    const massR          = 24;        // lumped mass radius
    const neutralX       = W / 2;    // neutral horizontal position

    // ── Ground acceleration & structural displacement ────────────────
    const ug_accel = groundMotion.ug[currentIndex] || 0;  // m/s² ground accel
    const u_rel    = results.u[currentIndex] || 0;         // m relative disp

    // Scale: peak structural disp AND peak ground disp both map to ±20% canvas width
    const maxU   = Math.max(results.pU, 1e-6);
    const maxUgd = Math.max(...results.ug_disp.map(Math.abs), 1e-6);
    const scale  = (W * 0.20) / Math.max(maxU, maxUgd);  // px per metre

    // Ground shifts as a whole by integrated ground displacement
    const groundShift = (results.ug_disp[currentIndex] || 0) * scale;

    // Column base X is the neutral center + ground shift
    const baseX = neutralX + groundShift;
    // Mass X = base + relative structural displacement
    const massX = baseX + u_rel * scale;
    // Mass Y is fixed (constant height from ground surface)
    const massY = groundSurfaceY - colH;

    // ════════════════════════════════════════════════════════════════
    //  1. SKY / BACKGROUND
    // ════════════════════════════════════════════════════════════════
    const skyGrad = ctx.createLinearGradient(0, 0, 0, groundSurfaceY);
    skyGrad.addColorStop(0, '#f0f9ff');
    skyGrad.addColorStop(1, '#e0f2fe');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, W, groundSurfaceY);

    // ════════════════════════════════════════════════════════════════
    //  2. MOVING GROUND — full canvas width block
    //     The entire ground layer translates horizontally together.
    //     We draw it offset by groundShift but still cover full width
    //     by extending it well past canvas edges.
    // ════════════════════════════════════════════════════════════════
    const overhang = Math.abs(groundShift) + 120; // ensure edges don't expose sky

    // Ground fill — earthy gradient
    const earthGrad = ctx.createLinearGradient(0, groundSurfaceY, 0, H);
    earthGrad.addColorStop(0,   '#78716c');  // top surface edge (dark tan)
    earthGrad.addColorStop(0.08,'#a78bfa');  // accent layer
    earthGrad.addColorStop(0.12,'#8b7355');  // dirt
    earthGrad.addColorStop(1,   '#5c4a32');  // deeper soil
    ctx.fillStyle = earthGrad;
    ctx.fillRect(groundShift - overhang, groundSurfaceY, W + overhang * 2, groundDepth);

    // Ground surface line
    ctx.beginPath();
    ctx.moveTo(groundShift - overhang, groundSurfaceY);
    ctx.lineTo(groundShift + W + overhang, groundSurfaceY);
    ctx.strokeStyle = '#44403c';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Crosshatch lines on ground surface (move with ground)
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, groundSurfaceY, W, groundDepth); // clip to canvas
    ctx.clip();
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 1;
    const hatchSpacing = 22;
    for (let x = groundShift - overhang - H; x < groundShift + W + overhang; x += hatchSpacing) {
      ctx.beginPath();
      ctx.moveTo(x,     groundSurfaceY);
      ctx.lineTo(x + H, groundSurfaceY + groundDepth);
      ctx.stroke();
    }
    ctx.restore();

    // ════════════════════════════════════════════════════════════════
    //  3. COLUMN — fixed (pinned) base at baseX on ground surface
    //     Bezier curve: base tangent is vertical, tip tangent toward mass
    // ════════════════════════════════════════════════════════════════
    // Pin at base
    ctx.beginPath();
    ctx.arc(baseX, groundSurfaceY, 6, 0, 2 * Math.PI);
    ctx.fillStyle = '#1e3a8a';
    ctx.fill();
    ctx.strokeStyle = '#bfdbfe';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Bezier column (cantilever shape: vertical at base, leans toward mass at top)
    const cp1x = baseX;
    const cp1y = groundSurfaceY - colH * 0.55;
    const cp2x = (baseX + massX) / 2;
    const cp2y = massY + colH * 0.15;

    ctx.beginPath();
    ctx.moveTo(baseX, groundSurfaceY - 2);
    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, massX, massY);
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 5.5;
    ctx.lineCap = 'round';
    ctx.shadowBlur = 8;
    ctx.shadowColor = 'rgba(0,0,0,0.20)';
    ctx.stroke();
    ctx.shadowBlur = 0;

    // ════════════════════════════════════════════════════════════════
    //  4. LUMPED MASS
    // ════════════════════════════════════════════════════════════════
    const mGrad = ctx.createRadialGradient(massX - 8, massY - 8, 4, massX, massY, massR);
    mGrad.addColorStop(0, '#93c5fd');
    mGrad.addColorStop(1, '#1d4ed8');
    ctx.beginPath();
    ctx.arc(massX, massY, massR, 0, 2 * Math.PI);
    ctx.fillStyle = mGrad;
    ctx.shadowBlur = 14;
    ctx.shadowColor = 'rgba(37,99,235,0.40)';
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // "m" label
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('m', massX, massY);

    // ════════════════════════════════════════════════════════════════
    //  5. NEUTRAL AXIS (dashed reference line)
    // ════════════════════════════════════════════════════════════════
    ctx.setLineDash([4, 7]);
    ctx.beginPath();
    ctx.moveTo(neutralX, groundSurfaceY - 6);
    ctx.lineTo(neutralX, massY - massR - 8);
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.setLineDash([]);

    // ════════════════════════════════════════════════════════════════
    //  6. GROUND ACCELERATION ARROW (on the ground surface)
    //     Points in direction of current ground acceleration
    // ════════════════════════════════════════════════════════════════
    const ug_g = ug_accel / 9.81; // in g
    if (Math.abs(ug_g) > 0.002) {
      const maxArrowPx = 80;
      const peakUg_g = Math.max(...groundMotion.ug.map(a => Math.abs(a / 9.81)), 0.01);
      const arrowLen = Math.min(Math.abs(ug_g) / peakUg_g * maxArrowPx, maxArrowPx);
      const dir = ug_accel > 0 ? 1 : -1;
      const arrowY = groundSurfaceY + groundDepth / 2;
      const startX = neutralX - dir * 20;
      const endX   = startX + dir * arrowLen;

      // Arrow shaft
      ctx.beginPath();
      ctx.moveTo(startX, arrowY);
      ctx.lineTo(endX, arrowY);
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.stroke();

      // Arrowhead
      const hw = 6, hl = 10;
      ctx.beginPath();
      ctx.moveTo(endX, arrowY);
      ctx.lineTo(endX - dir * hl, arrowY - hw);
      ctx.lineTo(endX - dir * hl, arrowY + hw);
      ctx.closePath();
      ctx.fillStyle = '#ef4444';
      ctx.fill();

      // Label
      ctx.fillStyle = '#ef4444';
      ctx.font = 'bold 9px Inter, system-ui, sans-serif';
      ctx.textAlign = dir > 0 ? 'left' : 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`${ug_g > 0 ? '+' : ''}${ug_g.toFixed(3)} g`, endX + dir * 4, arrowY - 3);
    }

    // ════════════════════════════════════════════════════════════════
    //  7. TEXT ANNOTATIONS (top-left HUD)
    // ════════════════════════════════════════════════════════════════
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const annos = [
      { label: 't',     val: `${results.t[currentIndex].toFixed(2)} s`,          color: '#475569' },
      { label: 'üg',    val: `${(ug_accel / 9.81).toFixed(3)} g`,                color: '#ef4444' },
      { label: 'u(t)',  val: `${(u_rel * 1000).toFixed(2)} mm (rel)`,            color: '#1d4ed8' },
      { label: 'dg',    val: `${((results.ug_disp[currentIndex] || 0) * 1000).toFixed(2)} mm`,  color: '#059669' },
    ];
    let ty = 10;
    for (const { label, val, color } of annos) {
      ctx.font = '10px Inter, system-ui, sans-serif';
      ctx.fillStyle = '#64748b';
      const lw = ctx.measureText(`${label}: `).width;
      ctx.fillText(`${label}: `, 10, ty);
      ctx.font = 'bold 10px Inter, system-ui, sans-serif';
      ctx.fillStyle = color;
      ctx.fillText(val, 10 + lw, ty);
      ty += 15;
    }

  }, [results, groundMotion, currentIndex]);

  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center gap-2">
      <canvas
        ref={canvasRef}
        width={580}
        height={320}
        className="w-full rounded-xl border border-slate-200 shadow-sm"
        style={{ background: 'linear-gradient(to bottom, #f0f9ff, #e0f2fe)' }}
      />
      <p className="text-[9px] text-slate-400 uppercase tracking-widest font-semibold">
        Ground moves as one body · Red arrow = ü<sub>g</sub> · Column bends = u(t)
      </p>
    </div>
  );
};
