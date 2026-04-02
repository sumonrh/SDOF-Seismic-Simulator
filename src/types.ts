export interface GroundMotion {
  t: number[];
  ug: number[]; // acceleration in m/s^2
}

export interface SimulationResults {
  t: number[];
  p: number[]; // applied load (effective earthquake load -m*ug)
  ug_disp: number[]; // ground displacement in m
  u: number[]; // relative displacement in m
  v: number[]; // relative velocity in m/s
  a: number[]; // relative acceleration in m/s^2
  a_abs: number[]; // absolute acceleration in m/s^2
  Vb: number[]; // base shear (restoring force k*u + c*v) in N
  fma: number[]; // inertia force (relative)
  fcv: number[]; // damping force
  fku: number[]; // stiffness force
  fs: number[]; // total force (sum of components)
  residual: number[]; // equilibrium residual (p - (fma + fcv + fku))
  s_ma: number[]; // share of inertia (%)
  s_ku: number[]; // share of stiffness (%)
  s_cv: number[]; // share of damping (%)
  tMa: number; // total inertia share
  tKu: number; // total stiffness share
  tCv: number; // total damping share
  pU: number; // peak relative displacement
  pUgd: number; // peak ground displacement
  pVb: number; // peak base shear
  pAabs: number; // peak absolute acceleration
  fn: number; // natural frequency
  Tn: number; // natural period
}

export interface SpectraData {
  periods: number[];
  Sa: number[]; // Pseudo-Spectral acceleration (g)
  Sv: number[]; // Pseudo-Spectral velocity (m/s)
  Sd: number[]; // Spectral displacement (m)
  peakTimes: number[]; // Time of peak response for each period
  peakSigns?: number[]; // Sign of peak response for each period
  peakT: number;
  peakSa: number;
}
