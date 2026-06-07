"use client";

import { useEffect, useRef, useState } from "react";
import { EmployerDashboardShell } from "../employer-dashboard-shell";
import { EMPLOYEES_KEY, type Employee } from "../../employer-session";
import { API_ENDPOINTS, COMMON_HEADERS, getEmployerAuthToken, getEmployerId } from "@/lib/api-config";
import { Download, Users, AlertTriangle } from "lucide-react";
import { DateRangePicker, type PickerValue } from "@/app/components/date-range-picker";

function loadEmployees(): Employee[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(EMPLOYEES_KEY);
    if (raw) { const p = JSON.parse(raw); return Array.isArray(p) ? p : []; }
  } catch { /**/ }
  return [];
}

function avg(arr: number[]) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }

function grade(s: number) {
  if (s >= 85) return { label: "Elite",    color: "#1d4ed8", bg: "rgba(29,78,216,.15)",   text: "#1e3a8a" };
  if (s >= 70) return { label: "Verified", color: "#2563eb", bg: "rgba(37,99,235,.15)",   text: "#1d4ed8" };
  if (s >= 55) return { label: "Fair",     color: "#3b82f6", bg: "rgba(59,130,246,.15)",  text: "#1d4ed8" };
  if (s >= 40) return { label: "At Risk",  color: "#60a5fa", bg: "rgba(96,165,250,.15)",  text: "#2563eb" };
  return             { label: "Critical", color: "#93c5fd", bg: "rgba(147,197,253,.15)", text: "#3b82f6" };
}

/* ── Line Chart (fleet avg risk over time) ── */
function FleetLineChart({ trendChart, picker, onPickerChange, threshold, setThreshold }: {
  trendChart: any[];
  picker: PickerValue;
  onPickerChange: (v: PickerValue) => void;
  threshold: number;
  setThreshold: (n: number) => void;
}) {
  const { startDate, endDate } = picker;
  const W = 1000, H = 250;

  /* ── Zoom ───────────────────────────────────────────── */
  const svgRef   = useRef<SVGSVGElement>(null);
  const scrubRef = useRef<HTMLDivElement>(null);
  const vbRef    = useRef({ x: 0, y: 0, w: W, h: H });
  const [vb, setVb] = useState({ x: 0, y: 0, w: W, h: H });
  const scrubDrag = useRef<{ sx: number; ox: number } | null>(null);
  const isZoomed  = vb.w < W * 0.99;
  const zoomPct   = Math.round(W / vb.w * 100);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!scrubDrag.current || !scrubRef.current) return;
      const rect = scrubRef.current.getBoundingClientRect();
      const { w } = vbRef.current;
      const dx = (e.clientX - scrubDrag.current.sx) / rect.width * W;
      const next = { ...vbRef.current, x: Math.max(0, Math.min(W - w, scrubDrag.current.ox + dx)) };
      vbRef.current = next; setVb(next);
    }
    function onUp() { scrubDrag.current = null; }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, []);

  function zoomBy(factor: number) {
    const { x, y, w, h } = vbRef.current;
    const newW = Math.max(150, Math.min(W, w * factor));
    const newH = newW * (H / W);
    const next = {
      x: Math.max(0, Math.min(W - newW, (x + w/2) - newW/2)),
      y: Math.max(0, Math.min(H - newH, (y + h/2) - newH/2)),
      w: newW, h: newH,
    };
    vbRef.current = next; setVb(next);
  }

  function resetZoom() { const r={x:0,y:0,w:W,h:H}; vbRef.current=r; setVb(r); }
  /* ────────────────────────────────────────────────────── */

  const parsedTrends = trendChart && trendChart.length > 0 ? trendChart : [];
  
  const labels = parsedTrends.length > 0 ? parsedTrends.map((t: any) => t.name ? t.name.charAt(0) + t.name.slice(1).toLowerCase() : "") : ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
  const data = parsedTrends.length > 0 ? parsedTrends.map((t: any) => (100 - t.score) / 100) : [0,0,0,0,0,0,0];

  const PL = 90, PR = 40, PT = 20, PB = 55;
  const CW = W - PL - PR, CH = H - PT - PB;
  const maxVal = Math.max(...data, threshold / 100) > 0.5 ? 1.0 : (Math.max(...data, threshold / 100) > 0.3 ? 0.5 : 0.3);
  const thY = PT + CH - ((threshold / 100) / maxVal) * CH;
  const pts = data.map((v, i) => ({
    x: PL + (i / (data.length - 1 || 1)) * CW,
    y: PT + CH - (v / maxVal) * CH,
    label: labels[i] || "",
  }));
  const dLine = pts.reduce((acc, p, i) => i === 0 ? `M ${p.x} ${p.y}` : `${acc} L ${p.x} ${p.y}`, "");
  const dArea = `${dLine} L ${pts[pts.length-1]?.x || 0} ${PT+CH} L ${pts[0]?.x || 0} ${PT+CH} Z`;
  const ticks = maxVal === 1.0 ? [0,.2,.4,.6,.8,1.0] : maxVal === 0.5 ? [0,.1,.2,.3,.4,.5] : [0,.1,.2,.3];

  return (
    <div className="relative w-full h-full flex flex-col pt-4 min-h-0">
      <div className="flex flex-col sm:flex-row justify-between items-center px-4 sm:px-10 gap-3 shrink-0">
        <div className="flex items-center gap-2 relative">
          <span className="text-[10px] font-black text-blue-900/40 uppercase tracking-[0.2em]">Fleet Risk Projection</span>
          <DateRangePicker {...picker} onChange={onPickerChange} />
        </div>
        <div className="flex items-center gap-3 bg-rose-50 px-4 py-1.5 rounded-full border border-rose-100">
          <label className="text-[10px] font-black text-rose-500 uppercase tracking-widest whitespace-nowrap">
            Threshold = {threshold}%
          </label>
          <input type="range" min="0" max="100" step="1" value={threshold}
            onChange={e => setThreshold(Number(e.target.value))}
            className="w-24 h-1.5 bg-rose-200 rounded-lg appearance-none cursor-pointer accent-rose-500" />
        </div>
        <div className="flex items-center gap-1.5">
          <div className="flex items-center bg-slate-50 rounded-full border border-slate-100 overflow-hidden">
            <button onClick={() => zoomBy(1/0.6)} disabled={!isZoomed} className="w-7 h-7 flex items-center justify-center text-slate-400 hover:bg-blue-50 hover:text-blue-600 font-black text-base leading-none disabled:opacity-25 transition-colors">−</button>
            <span className="text-[9px] font-black text-slate-400 w-9 text-center tabular-nums">{zoomPct}%</span>
            <button onClick={() => zoomBy(0.6)} disabled={vb.w <= 155} className="w-7 h-7 flex items-center justify-center text-slate-400 hover:bg-blue-50 hover:text-blue-600 font-black text-base leading-none disabled:opacity-25 transition-colors">+</button>
          </div>
          {isZoomed && (
            <button onClick={resetZoom} className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-500 text-[9px] font-black uppercase tracking-widest border border-slate-200 hover:bg-blue-50 hover:text-blue-600 transition-colors">↺ Reset</button>
          )}
        </div>
      </div>
      <div className="relative flex-1 w-full mt-4 min-h-0">
        <svg ref={svgRef} viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} className="w-full h-full pb-4 px-4 sm:px-10 drop-shadow-sm overflow-visible">
          <defs>
            <linearGradient id="fleetGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3b82f6" />
              <stop offset="100%" stopColor="transparent" />
            </linearGradient>
          </defs>
          <path d={dArea} fill="url(#fleetGrad)" opacity="0.15" />
          {ticks.map(v => {
            const y = PT + CH - (v / maxVal) * CH;
            return <line key={v} x1={PL} y1={y} x2={W-PR} y2={y} stroke="#f1f5f9" strokeWidth="1" />;
          })}
          <line x1={PL} y1={thY} x2={W-PR} y2={thY} stroke="#f43f5e" strokeWidth="2" strokeDasharray="6,4" opacity="0.8" />
          <path d={dLine} fill="none" stroke="#3b82f6" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
          {pts.map((p, i) => (
            <g key={i}>
              <circle cx={p.x} cy={p.y} r="5" fill="white" stroke="#3b82f6" strokeWidth="3" />
              <line x1={p.x} y1={PT+CH} x2={p.x} y2={PT+CH+5} stroke="#cbd5e1" strokeWidth="2" />
              <text x={p.x} y={PT+CH+22} textAnchor="middle" fontSize="11" fill="#64748b" fontWeight="600">{p.label}</text>
            </g>
          ))}
          <line x1={PL} y1={PT} x2={PL} y2={PT+CH} stroke="#cbd5e1" strokeWidth="2" />
          <line x1={PL} y1={PT+CH} x2={W-PR} y2={PT+CH} stroke="#cbd5e1" strokeWidth="2" />
          {ticks.map(v => {
            const y = PT + CH - (v / maxVal) * CH;
            return (
              <g key={`lbl-${v}`}>
                <line x1={PL-5} y1={y} x2={PL} y2={y} stroke="#cbd5e1" strokeWidth="2" />
                <text x={PL-12} y={y} textAnchor="end" dominantBaseline="central" fontSize="11" fill="#64748b" fontWeight="600">{Math.round(v*100)}%</text>
              </g>
            );
          })}
          <text x={25} y={PT+CH/2} transform={`rotate(-90 25 ${PT+CH/2})`} textAnchor="middle" fontSize="12" fill="#94a3b8" fontWeight="700">Risk Score</text>
        </svg>
        {isZoomed && (
          <div ref={scrubRef} className="mx-10 mb-3 h-2 bg-slate-100 rounded-full relative cursor-pointer">
            <div
              className="absolute top-0 h-full bg-blue-400 rounded-full hover:bg-blue-500 cursor-grab active:cursor-grabbing transition-colors shadow-sm"
              style={{ left: `${(vb.x/W)*100}%`, width: `${(vb.w/W)*100}%` }}
              onMouseDown={e => { e.preventDefault(); scrubDrag.current = { sx: e.clientX, ox: vbRef.current.x }; }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function FleetDistractionsDonut({ distractions }: { distractions: any[] }) {
  const colorPalette = ["#3b82f6", "#ef4444", "#8b5cf6", "#f59e0b", "#06b6d4", "#ec4899"];
  const allDistractions = distractions && distractions.length > 0 ? distractions.map((d: any, i: number) => ({
    type: d.name ? d.name.charAt(0).toUpperCase() + d.name.slice(1) : "Unknown",
    value: d.value_percentage || 0,
    color: colorPalette[i % colorPalette.length]
  })) : [];

  let currentAngle = -Math.PI / 2;
  const cx = 150, cy = 150, R = 90, r = 35;
  const total = allDistractions.reduce((sum: number, d: any) => sum + d.value, 0);

  if (total === 0) return <div className="w-full h-full flex items-center justify-center text-slate-400 text-xs font-bold">No distraction data available.</div>;

  return (
    <div className="relative w-full h-full flex items-center justify-center">
      <svg viewBox="0 0 300 300" className="w-full h-full max-h-[220px] drop-shadow-md overflow-visible">
        {allDistractions.map((d: any, i: number) => {
           const angle = (d.value / total) * Math.PI * 2;
           const x1 = cx + R * Math.cos(currentAngle);
           const y1 = cy + R * Math.sin(currentAngle);
           const x2 = cx + R * Math.cos(currentAngle + angle);
           const y2 = cy + R * Math.sin(currentAngle + angle);
           
           const ix1 = cx + r * Math.cos(currentAngle);
           const iy1 = cy + r * Math.sin(currentAngle);
           const ix2 = cx + r * Math.cos(currentAngle + angle);
           const iy2 = cy + r * Math.sin(currentAngle + angle);
           
           const largeArc = angle > Math.PI ? 1 : 0;
           const pathD = `M ${x1} ${y1} A ${R} ${R} 0 ${largeArc} 1 ${x2} ${y2} L ${ix2} ${iy2} A ${r} ${r} 0 ${largeArc} 0 ${ix1} ${iy1} Z`;
           
           const midAngle = currentAngle + angle / 2;
           const labelR = R + 15;
           let lx = cx + labelR * Math.cos(midAngle);
           const ly = cy + labelR * Math.sin(midAngle);
           const isRight = lx > cx;
           lx += isRight ? 4 : -4;

           currentAngle += angle;

           return (
             <g key={i}>
               <path 
                 d={pathD} 
                 fill={d.color} 
                 stroke="#ffffff" 
                 strokeWidth="2"
                 className="transition-all hover:opacity-80 cursor-pointer hover:scale-[1.02] origin-center" 
               />
               {d.value >= 5 && (
                 <text 
                   x={lx} 
                   y={ly} 
                   textAnchor={isRight ? "start" : "end"} 
                   dominantBaseline="middle" 
                   fontSize="10" 
                   fontWeight="bold" 
                   fill="#1e293b" 
                   className="drop-shadow-sm pointer-events-none"
                 >
                   {d.type.split(" ")[0]} {d.value}%
                 </text>
               )}
             </g>
           );
        })}
        <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle" fontSize="24" fontWeight="900" className="fill-blue-950">{Math.round(total)}%</text>
      </svg>
    </div>
  );
}


/* ── Driver Score Bar Chart ── */
function DriverScoreBars({ employees }: { employees: Employee[] }) {
  const sorted = [...employees].sort((a, b) => b.safetyScore - a.safetyScore).slice(0, 6);
  if (sorted.length === 0) return <div className="text-center text-slate-400 text-xs font-bold py-10">No drivers ranked yet.</div>;
  return (
    <div className="w-full flex flex-col justify-center gap-3 py-1">
      {sorted.map(e => {
        const g = grade(e.safetyScore);
        const initials = e.name.split(" ").map(w => w[0]).slice(0,2).join("").toUpperCase();
        return (
          <div key={e.id} className="flex items-center gap-2">
            <div style={{ background: g.bg, color: g.color }}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-black shrink-0">
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex justify-between items-center mb-0.5">
                <span className="text-[11px] font-bold text-slate-700 truncate">{e.name.split(" ")[0]}</span>
                <span style={{ color: g.color }} className="text-[11px] font-black ml-2 shrink-0">{e.safetyScore}</span>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-1.5">
                <div style={{ width: `${e.safetyScore}%`, background: g.color }}
                  className="h-1.5 rounded-full transition-all duration-700" />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Main Page ── */
export default function ReportsPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [fleetAnalysis, setFleetAnalysis] = useState<any>(null);
  const [mounted, setMounted] = useState(false);
  const [picker, setPicker] = useState<PickerValue>({ startDate:null, endDate:null, timeframe:"week", hour:null });
  const [thresholdScore, setThresholdScore] = useState(15);
  const [debouncedThreshold, setDebouncedThreshold] = useState(15);

  const { startDate, endDate, timeframe: selectedTimeframe, hour: selectedHour } = picker;

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedThreshold(thresholdScore), 500);
    return () => clearTimeout(timer);
  }, [thresholdScore]);

  useEffect(() => {
    async function load() {
      try {
        const token = getEmployerAuthToken();
        const eid = getEmployerId();
        
        // 1. Fetch Rankings for Score Distribution & Top Drivers
        const urlR = eid ? `${API_ENDPOINTS.RANKINGS}?employer_id=${eid}` : API_ENDPOINTS.RANKINGS;
        const resR = await fetch(urlR, { headers: { "Authorization": token ? `Bearer ${token}` : "", ...COMMON_HEADERS } });
        if (resR.ok) {
          const data = await resR.json();
          const raw = Array.isArray(data) ? data : (data.ranked_employees || data.rankings || data.employees || []);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          setEmployees(raw.map((item: any) => ({
            id: item.id || item.driver_id || `r-${Math.random()}`,
            email: item.email || "",
            nationalId: item.national_id || "N/A",
            name: item.employee || item.driver_name || item.name || "Unknown",
            phoneNumber: item.phone_number || "N/A",
            licenseExpiration: item.license_expiration_date || "",
            role: item.role || "Driver",
            safetyScore: (item.safety_score ?? item.safetyScore ?? 0) <= 1 ? Math.round((item.safety_score ?? item.safetyScore ?? 0) * 100) : (item.safety_score ?? item.safetyScore ?? 0),
            trips: item.trips ?? 0,
            incidents: item.incidents ?? 0,
            lastActive: item.last_active || new Date().toISOString(),
          })));
        }

        // 2. Fetch new Fleet Analysis endpoint
        const baseUrl = new URL(eid ? `${API_ENDPOINTS.REPORTS}?employer_id=${eid}` : API_ENDPOINTS.REPORTS);
        baseUrl.searchParams.append("timeframe", selectedTimeframe);
        baseUrl.searchParams.append("threshold", (debouncedThreshold / 100).toString());
        if (startDate)             baseUrl.searchParams.append("start_date", startDate.toISOString().split("T")[0]);
        if (endDate)               baseUrl.searchParams.append("end_date",   endDate.toISOString().split("T")[0]);
        if (selectedHour !== null) baseUrl.searchParams.append("hour", String(selectedHour));

        const resF = await fetch(baseUrl.toString(), { headers: { "Authorization": token ? `Bearer ${token}` : "", ...COMMON_HEADERS } });
        if (resF.ok) {
          const fData = await resF.json();
          setFleetAnalysis(fData);
        }
      } catch { /**/ }
      if (employees.length === 0) {
        setEmployees(loadEmployees());
      }
    }
    load().finally(() => setMounted(true));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTimeframe, debouncedThreshold, startDate, endDate, selectedHour]);

  const fr = fleetAnalysis?.fleet_report;
  const summary = fleetAnalysis?.summary;

  const displayStats = {
    totalDrivers: summary?.total_employees ?? employees.length.toString(),
    avgSafetyScore: fr?.avg_fleet_score !== undefined ? `${fr.avg_fleet_score}%` : (avg(employees.map(e => e.safetyScore)).toFixed(1) + "%"),
    avgRiskScore: fr?.avg_fleet_score !== undefined ? `${(100 - fr.avg_fleet_score).toFixed(1)}%` : ((100 - avg(employees.map(e => e.safetyScore))).toFixed(1) + "%"),
    totalTrips: summary?.total_trips ?? employees.reduce((s, e) => s + e.trips, 0).toLocaleString(),
    percentile95: fr?.percentile_95th !== undefined ? `${fr.percentile_95th}th` : "N/A",
    eventRatio: fr?.event_ratio !== undefined ? `${fr.event_ratio}%` : "0.0%",
    statusLabel: fr?.significance || grade(avg(employees.map(e => e.safetyScore))).label,
    statusColor: grade(fr?.avg_fleet_score ?? avg(employees.map(e => e.safetyScore))).color,
  };

  const fleetGradeBg = grade(fr?.avg_fleet_score ?? avg(employees.map(e => e.safetyScore))).bg;

  function downloadReport() {
    const sorted = [...employees].sort((a,b) => b.safetyScore - a.safetyScore);
    const date = new Date().toLocaleString();
    const html = `<html><head><meta charset='utf-8'><style>
      body{font-family:'Segoe UI',Arial,sans-serif;color:#1e293b;line-height:1.5}
      .hdr{background:#1e40af;color:white;padding:28px;text-align:center;border-radius:10px}
      h1{margin:0;font-size:22pt} p.sub{margin:4px 0 0;font-size:9pt;opacity:.8;text-transform:uppercase}
      table{width:100%;border-collapse:collapse;margin-top:20px}
      th{background:#f1f5f9;padding:10px;font-size:9pt;color:#475569;border-bottom:2px solid #e2e8f0;text-align:left}
      td{padding:10px;font-size:9pt;border-bottom:1px solid #f1f5f9}
      .pill{padding:3px 8px;border-radius:10px;font-weight:700;font-size:8pt}
      .footer{margin-top:40px;text-align:center;font-size:8pt;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:16px}
    </style></head><body>
      <div class='hdr'><p class='sub'>Fleet Intelligence Systems</p><h1>DARAS Fleet Safety Report</h1><p class='sub'>${date}</p></div>
      <table><thead><tr><th>Rank</th><th>Driver</th><th>Score</th><th>Trips</th><th>Incidents</th><th>Status</th></tr></thead><tbody>
      ${sorted.map((e,i) => { const g=grade(e.safetyScore); return `<tr><td>#${i+1}</td><td><b>${e.name}</b></td><td style="color:${g.color};font-weight:700">${e.safetyScore}</td><td>${e.trips}</td><td>${e.incidents}</td><td><span class="pill" style="background:${g.bg};color:${g.text}">${g.label}</span></td></tr>`; }).join("")}
      </tbody></table>
      <div class='footer'>© 2026 DARAS Fleet Intelligence · Confidential</div>
    </body></html>`;
    const blob = new Blob(["\ufeff", html], { type: "application/msword" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `daras-fleet-${new Date().toISOString().slice(0,10)}.doc` });
    a.click(); URL.revokeObjectURL(a.href);
  }

  if (!mounted) return <EmployerDashboardShell><div className="flex-1" /></EmployerDashboardShell>;

  return (
    <EmployerDashboardShell>
      <style>{`
        @keyframes modal-pop { from { opacity:0; transform:scale(0.97) translateY(8px); } to { opacity:1; transform:scale(1) translateY(0); } }
        .fp { animation: modal-pop 0.4s cubic-bezier(0.16,1,0.3,1) both; }
      `}</style>

      <main style={{ maxWidth: 1200, margin: "0 auto", width: "100%", padding: "40px 24px 80px", flex: 1 }}>

        {/* ── Header ── */}
        <div className="bg-white rounded-[2rem] border border-blue-50 shadow-sm px-8 py-5 flex items-center justify-between mb-6 fp">
          <div className="flex items-center gap-5">
            <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center shadow-md shadow-blue-200">
              <Users size={26} className="text-white" />
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-xl font-black text-blue-950 tracking-tight">Fleet Analysis</h1>
                <div style={{ background: fleetGradeBg, color: displayStats.statusColor }}
                  className="px-2.5 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-[0.1em] shadow-sm">
                  {displayStats.statusLabel.split(" ")[0]}
                </div>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{displayStats.totalDrivers} Drivers</span>
                <span className="text-slate-300">•</span>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                  Avg Score: <span style={{ color: displayStats.statusColor }}>{displayStats.avgSafetyScore}</span>
                </span>
              </div>
            </div>
          </div>
          <button onClick={downloadReport}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-black uppercase tracking-wider shadow-lg shadow-blue-200 transition-all hover:-translate-y-0.5 active:translate-y-0">
            <Download size={14} /> Export Report
          </button>
        </div>

        {!fleetAnalysis && employees.length === 0 ? (
          <div className="bg-white rounded-[2rem] border border-blue-50 shadow-sm p-16 text-center fp">
            <Users size={48} className="mx-auto text-slate-200 mb-4" strokeWidth={1} />
            <h2 className="text-xl font-bold text-slate-700 mb-2">No fleet data yet</h2>
            <p className="text-sm text-slate-400">Add employees from the <a href="/employer/dashboard" className="text-blue-600 font-semibold hover:underline">Dashboard</a> to generate fleet analytics.</p>
          </div>
        ) : (
          <>
            {/* ── Line Chart Card ── */}
            <div className="bg-white rounded-[1.5rem] border border-blue-50 shadow-sm mb-6 overflow-hidden fp" style={{ height: 280 }}>
              <FleetLineChart trendChart={fleetAnalysis?.trend_chart || []} picker={picker} onPickerChange={setPicker} threshold={thresholdScore} setThreshold={setThresholdScore} />
            </div>

            {/* ── 3 Bottom Panels ── */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

              {/* Panel 1 – Fleet Stats */}
              <div className="bg-white rounded-[1.5rem] border border-blue-50 shadow-sm p-6 flex flex-col fp">
                <div className="flex items-center gap-2 mb-6">
                  <div className="w-1.5 h-4 bg-blue-500 rounded-full" />
                  <h2 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em]">Fleet Report</h2>
                </div>
                <div className="flex-1 flex flex-col justify-between text-[13px] font-bold text-slate-600">
                  {[
                    ["Total Drivers",   displayStats.totalDrivers],
                    ["Avg Safety Score", displayStats.avgSafetyScore],
                    ["Avg Risk Score",  displayStats.avgRiskScore],
                    ["Total Trips",     displayStats.totalTrips],
                    ["95th Percentile", displayStats.percentile95],
                    ["Event Ratio",     displayStats.eventRatio],
                  ].map(([k, v]) => (
                    <div key={k} className="flex justify-between py-2 border-b border-slate-50">
                      <span>{k}</span><span className="text-blue-950 font-black">{v}</span>
                    </div>
                  ))}
                  <div className="flex justify-between py-2 mt-2 bg-slate-50/60 rounded-lg px-3">
                    <span className="text-slate-500">Fleet Status</span>
                    <span style={{ color: displayStats.statusColor }} className="font-black">{displayStats.statusLabel}</span>
                  </div>
                </div>
              </div>
              
              {/* Panel 2 – Distractions Split Donut */}
              <div className="bg-white rounded-[1.5rem] border border-blue-50 shadow-sm p-6 flex flex-col fp">
                <div className="flex items-center gap-2 mb-3 z-10">
                  <div className="w-1.5 h-4 bg-rose-500 rounded-full" />
                  <h2 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em]">Distractions Split</h2>
                </div>
                <div className="flex-1 flex items-center justify-center">
                  <FleetDistractionsDonut distractions={fleetAnalysis?.distractions_split || []} />
                </div>
              </div>


              {/* Panel 4 – Driver Score Bars */}
              <div className="bg-white rounded-[1.5rem] border border-blue-50 shadow-sm p-6 flex flex-col fp">
                <div className="flex items-center gap-2 mb-4 z-10">
                  <div className="w-1.5 h-4 bg-emerald-500 rounded-full" />
                  <h2 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em]">Top Drivers</h2>
                </div>
                <div className="flex-1">
                  <DriverScoreBars employees={employees} />
                </div>
              </div>

            </div>
          </>
        )}
      </main>
    </EmployerDashboardShell>
  );
}
