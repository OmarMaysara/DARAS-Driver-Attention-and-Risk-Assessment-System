"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Download, Clock, MapPin, AlertTriangle, Route } from "lucide-react";

/* ─── Types ─────────────────────────────────────────────────────────── */
interface DriverData {
  safetyScore: number;
  trips: number;
  incidents: number;
  nationalId: string;
  role: string;
  name: string;
}

/* ─── Score Helpers ─── */
function scoreColor(score: number) {
  if (score >= 85) return { bar: "#22c55e", text: "#15803d", label: "Excellent", bg: "bg-emerald-50", ring: "ring-emerald-100", textClass: "text-emerald-600" };
  if (score >= 70) return { bar: "#84cc16", text: "#3f6212", label: "Verified", bg: "bg-amber-50", ring: "ring-amber-100", textClass: "text-amber-600" };
  if (score >= 55) return { bar: "#f59e0b", text: "#92400e", label: "Fair", bg: "bg-orange-50", ring: "ring-orange-100", textClass: "text-orange-600" };
  if (score >= 40) return { bar: "#f97316", text: "#c2410c", label: "At Risk", bg: "bg-rose-50", ring: "ring-rose-100", textClass: "text-rose-600" };
  return { bar: "#ef4444", text: "#991b1b", label: "Critical", bg: "bg-rose-100", ring: "ring-rose-200", textClass: "text-rose-700" };
}

/* ─── Components ─── */

interface LineChartProps {
  riskTrends: { label: string; score: number; showLabel?: boolean }[];
  thresholdScore: number;
  timeRange: "Hour" | "Day" | "Week" | "Month";
  onTimeRangeChange: (r: "Hour" | "Day" | "Week" | "Month") => void;
  onThresholdChange: (t: number) => void;
}

function LineChart({ riskTrends, thresholdScore, timeRange, onTimeRangeChange, onThresholdChange }: LineChartProps) {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const W = 1000, H = 250;
  const PAD_L = 90, PAD_R = 40, PAD_T = 20, PAD_B = 55;
  const chartW = W - PAD_L - PAD_R;
  const chartH = H - PAD_T - PAD_B;
  
  const data = riskTrends.map((d: any) => (100 - d.score) / 100);
  const threshold = thresholdScore / 100;
  const maxData = data.length > 0 ? Math.max(...data, threshold) : threshold;
  const maxVal = maxData > 0.5 ? 1.0 : (maxData > 0.3 ? 0.5 : 0.3);
  const thresholdY = PAD_T + chartH - (threshold / maxVal) * chartH;

  const points = data.map((val: number, i: number) => {
    const x = data.length > 1
      ? PAD_L + (i / (data.length - 1)) * chartW
      : PAD_L + chartW / 2;
    const y = PAD_T + chartH - (val / maxVal) * chartH;
    return { x, y, label: riskTrends[i].label };
  });

  const labelStep = Math.max(1, Math.ceil(points.length / 8));

  const dPath = points.reduce((acc: string, p: any, i: number) =>
    i === 0 ? `M ${p.x} ${p.y}` : `${acc} L ${p.x} ${p.y}`, ""
  );

  const areaD = points.length > 0
    ? `${dPath} L ${points[points.length-1].x} ${PAD_T + chartH} L ${points[0].x} ${PAD_T + chartH} Z`
    : "";

  if (data.length === 0) {
    return (
      <div className="relative w-full h-full flex flex-col pt-4 min-h-0 bg-white border border-blue-100 rounded-[1.5rem] shadow-sm transition-shadow hover:shadow-md">
        <div className="flex flex-col sm:flex-row justify-between items-center px-4 sm:px-10 gap-4 sm:gap-0 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-black text-blue-900/40 uppercase tracking-[0.2em]">Risk Projection</span>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center text-slate-400 text-[13px] font-bold uppercase tracking-widest">
          No data available
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full flex flex-col pt-4 min-h-0 bg-white border border-blue-100 rounded-[1.5rem] shadow-sm transition-shadow hover:shadow-md">
      <div className="flex flex-col sm:flex-row justify-between items-center px-4 sm:px-10 gap-4 sm:gap-0 shrink-0">
         <div className="flex items-center gap-2 relative">
           <span className="text-[10px] font-black text-blue-900/40 uppercase tracking-[0.2em]">Risk Projection</span>
           <div className="relative">
              <div 
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                className="px-3 py-1 rounded-full bg-blue-50 text-blue-600 text-[10px] font-bold border border-blue-100 flex items-center gap-1 cursor-pointer hover:bg-blue-100 transition-colors"
              >
                This {timeRange} <ChevronDown size={10} />
              </div>
             {isDropdownOpen && (
               <div className="absolute top-full left-0 mt-1 w-24 bg-white border border-blue-100 rounded-lg shadow-lg overflow-hidden z-50 animate-fade-in">
                 {["Hour", "Day", "Week", "Month"].map(r => (
                   <div 
                     key={r} 
                     className="px-3 py-1.5 text-[10px] font-bold text-slate-600 hover:bg-blue-50 hover:text-blue-600 cursor-pointer"
                     onClick={() => { onTimeRangeChange(r as any); setIsDropdownOpen(false); }}
                   >
                     This {r}
                   </div>
                 ))}
               </div>
             )}
           </div>
         </div>
         <div className="flex items-center gap-3 bg-rose-50 px-4 py-1.5 rounded-full border border-rose-100">
           <label className="text-[10px] font-black text-rose-500 uppercase tracking-widest whitespace-nowrap">
             Threshold = {thresholdScore}%
           </label>
           <input 
             type="range" min="0" max="100" step="1"
             value={thresholdScore}
             onChange={(e) => onThresholdChange(Number(e.target.value))}
             className="w-24 h-1.5 bg-rose-200 rounded-lg appearance-none cursor-pointer accent-rose-500"
           />
         </div>
      </div>
      
      <div className="relative flex-1 w-full mt-4 min-h-0">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full pb-4 px-4 sm:px-10 drop-shadow-sm overflow-visible">
          <defs>
            <linearGradient id="lineGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3b82f6" />
              <stop offset="100%" stopColor="transparent" />
            </linearGradient>
          </defs>
          <path d={areaD} fill="url(#lineGradient)" opacity="0.15" />

          {(maxVal === 1.0 ? [0, 0.2, 0.4, 0.6, 0.8, 1.0] : maxVal === 0.5 ? [0, 0.1, 0.2, 0.3, 0.4, 0.5] : [0, 0.1, 0.2, 0.3]).map((val) => {
            const y = PAD_T + chartH - (val / maxVal) * chartH;
            return <line key={`grid-${val}`} x1={PAD_L} y1={y} x2={W-PAD_R} y2={y} stroke="#f1f5f9" strokeWidth="1" />;
          })}

          <line x1={PAD_L} y1={thresholdY} x2={W-PAD_R} y2={thresholdY} stroke="#f43f5e" strokeWidth="2" strokeDasharray="6,4" opacity="0.8" />
          <path d={dPath} fill="none" stroke="#3b82f6" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />

          {points.map((p: any, i: number) => {
            const showLabel = timeRange === "Hour"
              ? riskTrends[i].showLabel === true
              : i % labelStep === 0 || i === points.length - 1;
            return (
              <g key={`pt-${i}`}>
                <circle cx={p.x} cy={p.y} r="5" fill="#fff" stroke="#3b82f6" strokeWidth="3" className="transition-all hover:r-6 hover:fill-blue-100 cursor-pointer" />
                {showLabel && <line x1={p.x} y1={PAD_T + chartH} x2={p.x} y2={PAD_T + chartH + 5} stroke="#cbd5e1" strokeWidth="2" />}
                {showLabel && <text x={p.x} y={PAD_T + chartH + 22} textAnchor="middle" fontSize="11" className="fill-slate-500 font-bold uppercase tracking-wider">{p.label}</text>}
              </g>
            );
          })}

          <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={PAD_T + chartH} stroke="#cbd5e1" strokeWidth="2" strokeLinecap="round" />
          <line x1={PAD_L} y1={PAD_T + chartH} x2={W-PAD_R} y2={PAD_T + chartH} stroke="#cbd5e1" strokeWidth="2" strokeLinecap="round" />

          {(maxVal === 1.0 ? [0, 0.2, 0.4, 0.6, 0.8, 1.0] : maxVal === 0.5 ? [0, 0.1, 0.2, 0.3, 0.4, 0.5] : [0, 0.1, 0.2, 0.3]).map((val) => {
            const y = PAD_T + chartH - (val / maxVal) * chartH;
            return (
              <g key={`label-${val}`}>
                <line x1={PAD_L - 5} y1={y} x2={PAD_L} y2={y} stroke="#cbd5e1" strokeWidth="2" />
                <text x={PAD_L - 12} y={y} textAnchor="end" dominantBaseline="central" fontSize="11" className="fill-slate-600 font-black">{Math.round(val * 100)}%</text>
              </g>
            );
          })}
          <text x={25} y={PAD_T + chartH / 2} transform={`rotate(-90 25 ${PAD_T + chartH / 2})`} textAnchor="middle" fontSize="12" className="fill-slate-400 font-black uppercase tracking-[0.2em]">Risk Score</text>
        </svg>
      </div>
    </div>
  );
}

function DonutChart({ distractions, centerPct }: { distractions: any[]; centerPct?: number }) {
  let currentAngle = -Math.PI / 2;
  const cx = 150, cy = 150, R = 90, r = 35;
  const total = distractions.reduce((sum, d) => sum + d.value, 0);
  const displayPct = centerPct !== undefined ? centerPct.toFixed(2) : total;

  return (
    <div className="relative w-full h-full flex items-center justify-center">
      <svg viewBox="0 0 300 300" className="w-full h-full max-h-[220px] drop-shadow-md overflow-visible">
        {distractions.map((d, i) => {
           const angle = (d.value / total) * Math.PI * 2;
           const x1 = cx + R * Math.cos(currentAngle), y1 = cy + R * Math.sin(currentAngle);
           const x2 = cx + R * Math.cos(currentAngle + angle), y2 = cy + R * Math.sin(currentAngle + angle);
           const ix1 = cx + r * Math.cos(currentAngle), iy1 = cy + r * Math.sin(currentAngle);
           const ix2 = cx + r * Math.cos(currentAngle + angle), iy2 = cy + r * Math.sin(currentAngle + angle);
           const largeArc = angle > Math.PI ? 1 : 0;
           const pathD = `M ${x1} ${y1} A ${R} ${R} 0 ${largeArc} 1 ${x2} ${y2} L ${ix2} ${iy2} A ${r} ${r} 0 ${largeArc} 0 ${ix1} ${iy1} Z`;
           const midAngle = currentAngle + angle / 2;
           const labelR = R + 15;
           let lx = cx + labelR * Math.cos(midAngle), ly = cy + labelR * Math.sin(midAngle);
           const isRight = lx > cx;
           lx += isRight ? 4 : -4;
           currentAngle += angle;
           return (
             <g key={i}>
               <path d={pathD} fill={d.color} stroke="#fff" strokeWidth="2" className="transition-all hover:opacity-80 cursor-pointer hover:scale-[1.02] origin-center" />
               {d.value >= 5 && (
                 <text x={lx} y={ly} textAnchor={isRight ? "start" : "end"} dominantBaseline="middle" fontSize="10" fontWeight="bold" fill="#1e293b" className="drop-shadow-sm pointer-events-none">
                   {d.type.split(" ")[0]} {d.value}%
                 </text>
               )}
             </g>
           );
        })}
        <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle" fontSize="24" fontWeight="900" className="fill-blue-950">{displayPct}%</text>
      </svg>
    </div>
  );
}

function HorizontalBarChart({ distractions }: { distractions: any[] }) {
  const maxVal = Math.max(...distractions.map(d => d.duration));
  return (
    <div className="w-full h-full flex flex-col justify-center py-2">
       <div className="flex-1 flex flex-col justify-center gap-4 relative">
         {distractions.slice(0, 5).map((d, i) => (
           <div key={i} className="flex items-center h-8 group w-full">
             <div 
               className="h-full rounded-r-lg flex items-center px-3 text-white text-[11px] font-black transition-all shadow-sm whitespace-nowrap overflow-visible" 
               style={{ width: `${Math.max((d.duration / maxVal) * 100, 15)}%`, backgroundColor: d.color }}
             >
               <span className="drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)] z-10">{d.type}</span>
               <span className="ml-auto pl-3 drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)] z-10">{d.duration}s</span>
             </div>
           </div>
         ))}
       </div>
       <div className="flex text-[10px] font-bold text-slate-400 mt-6 border-t border-slate-200 pt-3 w-full">
          <div className="flex-1 flex justify-between px-1">
            <span>0s</span><span>100s</span><span>200s</span><span>300s</span><span>400s+</span>
          </div>
       </div>
    </div>
  );
}

/* ─── Main Component ─── */

export function DriverAnalytics({ driverId, deviceSerial }: { driverId: string; deviceSerial: string }) {
  const [mounted, setMounted] = useState(false);
  const [reportData, setReportData] = useState<any>(null);
  const [timeRange, setTimeRange] = useState<"Hour" | "Day" | "Week" | "Month">("Week");
  const [thresholdScore, setThresholdScore] = useState(15);

  const [debouncedThreshold, setDebouncedThreshold] = useState(thresholdScore);

  // Debounce the slider value so we don't spam the API on every pixel drag
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedThreshold(thresholdScore), 500);
    return () => clearTimeout(timer);
  }, [thresholdScore]);

  useEffect(() => {
    setMounted(true);
    async function fetchReport() {
      try {
        const { API_ENDPOINTS, COMMON_HEADERS, getDriverAuthToken } = await import("@/lib/api-config");
        const token = getDriverAuthToken();
        
        // Append dynamic filters to the endpoint
        const url = new URL(API_ENDPOINTS.DRIVER_DASHBOARD_DETAILS);
        url.searchParams.append("timeframe", timeRange.toLowerCase());
        url.searchParams.append("threshold", (debouncedThreshold / 100).toString());

        const res = await fetch(url.toString(), {
          headers: {
            "Authorization": token ? `Bearer ${token}` : "",
            ...COMMON_HEADERS,
          },
        });
        if (res.ok) setReportData(await res.json());
      } catch (err) { console.error(err); }
    }
    fetchReport();
  }, [timeRange, debouncedThreshold]);

  if (!mounted) return <div className="p-20 text-center animate-pulse text-slate-400 font-black uppercase tracking-[0.3em]">Decoding Telemetry...</div>;

  // ── Pull nested sections from API response ────────────────────────────
  const profile  = reportData?.profile  ?? null;
  const apiStats = reportData?.stats    ?? null;
  const analysis = reportData?.analysis ?? null;

  // ── Risk Projection Graph  (analysis.trend_chart) ─────────────────────
  const rawTrend = analysis?.trend_chart ?? null;
  const riskTrends = (() => {
    if (!rawTrend?.length) return [];

    if (timeRange === "Hour") {
      const seen = new Set<string>();
      return rawTrend.map((t: any) => {
        const [datePart, timePart] = (t.timestamp ?? "").split(" ");
        const [hh, mm] = (timePart ?? "00:00").split(":");
        const label = `${hh}:${mm}`;
        const minNum = parseInt(mm ?? "0", 10);
        const key = `${datePart} ${hh}:${mm}`;
        let showLabel = false;
        if (minNum % 5 === 0 && !seen.has(key)) {
          seen.add(key);
          showLabel = true;
        }
        return { label, score: (t.score ?? t.value ?? 0) * 100, showLabel };
      });
    }

    const timestamps: string[] = rawTrend.map((t: any) => t.timestamp ?? "");
    const uniqueDates = new Set(timestamps.map((ts: string) => ts.split(" ")[0]));
    const multiDay = uniqueDates.size > 1;
    return rawTrend.map((t: any) => {
      const [datePart, timePart] = (t.timestamp ?? "").split(" ");
      let label = "–";
      if (!multiDay && timePart) {
        label = timePart.substring(0, 5);
      } else if (datePart) {
        const d = new Date(datePart);
        const mon = d.toLocaleDateString("en-US", { month: "short" });
        label = timePart ? `${mon} ${d.getDate()} ${timePart.substring(0, 5)}` : `${mon} ${d.getDate()}`;
      }
      return { label, score: (t.score ?? t.value ?? 0) * 100, showLabel: true };
    });
  })();

  // ── Distractions (analysis.distractions_split) ────────────────────────
  const colorPalette = ["#3b82f6", "#ef4444", "#8b5cf6", "#f59e0b", "#06b6d4", "#ec4899"];
  const rawDistractions = analysis?.distractions_split ?? null;

  const defaultDistractions = [
    { type: "Phone call",      value: 35, color: "#3b82f6", duration: 420 },
    { type: "Texting",         value: 25, color: "#ef4444", duration: 180 },
    { type: "Talking",         value: 15, color: "#8b5cf6", duration: 150 },
    { type: "Reaching Behind", value: 12, color: "#f59e0b", duration: 95  },
    { type: "Drinking water",  value: 8,  color: "#06b6d4", duration: 65  },
  ];

  const distractions = (rawDistractions && rawDistractions.length > 0)
    ? rawDistractions.map((d: any, i: number) => ({
        type:     d.name     ?? d.type  ?? d.label ?? `Type ${i + 1}`,
        value:    d.value_percentage ?? d.value ?? d.percentage ?? d.risk ?? 0,
        color:    colorPalette[i % colorPalette.length],
        // Convert duration_minutes to seconds for the UI
        duration: d.duration_minutes !== undefined ? Math.round(d.duration_minutes * 60) : (d.duration ?? 0),
      }))
    : defaultDistractions;

  // ── Daily Report  (analysis.daily_report) ─────────────────────────────
  const dr = analysis?.daily_report ?? null;
  const significance = dr?.significance ?? null;

  const distractionCenterPct =
    dr?.total_driving_time != null && dr?.safe_driving_time != null
      ? (dr.total_driving_time - dr.safe_driving_time) * 100
      : undefined;
  
  const reportStats = [
    { label: "Total Drive Time", value: dr?.total_drive_time_mins !== undefined ? `${dr.total_drive_time_mins} Min` : "– Min" },
    { label: "Avg Driver Score", value: dr?.avg_driver_score      !== undefined ? `${dr.avg_driver_score}%`        : "–%"   },
    { label: "95th Percentile",  value: dr?.percentile_95th       !== undefined ? `${dr.percentile_95th}th`        : "–"    },
    { label: "Event Ratio",      value: dr?.event_ratio           !== undefined ? `${dr.event_ratio}%`            : "–%"   },
  ];

  const download = () => {
    const html = `
      <html>
      <head>
        <style>
          body { font-family: sans-serif; color: #1e293b; line-height: 1.6; padding: 20px; }
          h1 { color: #1e3a8a; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px; }
          h2 { color: #2563eb; margin-top: 30px; }
          table { width: 100%; border-collapse: collapse; margin-top: 15px; }
          th, td { border: 1px solid #cbd5e1; padding: 10px; text-align: left; }
          th { background-color: #f8fafc; font-weight: bold; }
          .stats-grid { display: flex; gap: 20px; margin-bottom: 30px; }
          .stat-box { background: #f1f5f9; padding: 15px; border-radius: 8px; text-align: center; border: 1px solid #e2e8f0; min-width: 120px; }
          .stat-value { font-size: 24px; font-weight: bold; color: #1e3a8a; }
          .stat-label { font-size: 12px; color: #64748b; text-transform: uppercase; }
        </style>
      </head>
      <body>
        <h1>Personnel Dossier: ${profile?.driver_name ?? driverId}</h1>
        <p><strong>Email:</strong> ${profile?.email ?? "N/A"}</p>
        <p><strong>Report Generated:</strong> ${new Date().toLocaleString()}</p>

        <h2>Overview Stats</h2>
        <div class="stats-grid">
          <table style="border:none; width:auto; border-collapse: separate; border-spacing: 15px;">
            <tr>
              <td class="stat-box"><div class="stat-label">Safety Score</div><div class="stat-value">${apiStats?.score ?? "–"}%</div></td>
              <td class="stat-box"><div class="stat-label">Total Trips</div><div class="stat-value">${apiStats?.total_trips ?? "–"}</div></td>
              <td class="stat-box"><div class="stat-label">Safe Hours</div><div class="stat-value">${apiStats?.safe_hours ?? "–"}</div></td>
              <td class="stat-box"><div class="stat-label">Alerts</div><div class="stat-value">${apiStats?.alerts ?? "–"}</div></td>
            </tr>
          </table>
        </div>

        <h2>Daily Report</h2>
        <table>
          <tbody>
            ${reportStats.map(s => `<tr><th>${s.label}</th><td>${s.value}</td></tr>`).join('')}
            ${significance ? `<tr><th>Significance</th><td>${significance}</td></tr>` : ''}
          </tbody>
        </table>

        <h2>Distractions Breakdown</h2>
        <table>
          <thead>
            <tr><th>Type</th><th>Risk Value</th><th>Duration</th></tr>
          </thead>
          <tbody>
            ${distractions.map((d: any) => `<tr><td>${d.type}</td><td>${d.value}%</td><td>${d.duration}s</td></tr>`).join('')}
          </tbody>
        </table>

        <h2>Risk Trend</h2>
        <table>
          <thead>
            <tr><th>Day / Time</th><th>Score</th></tr>
          </thead>
          <tbody>
            ${riskTrends.map((t: any) => `<tr><td>${t.label}</td><td>${t.score}</td></tr>`).join('')}
          </tbody>
        </table>
      </body>
      </html>
    `;
    const b = new Blob(['\ufeff', html], { type: "application/msword" }), u = URL.createObjectURL(b), a = document.createElement("a");
    a.href = u; a.download = "Driver-Report.doc"; a.click();
  };

  return (
    <div className="space-y-12 pb-24">
      {/* Dossier Header */}
      <section className="bg-white border border-blue-100 rounded-[2rem] p-6 sm:p-8 shadow-sm flex flex-col md:flex-row items-center gap-8 transition-shadow hover:shadow-md mx-2 sm:mx-0">
        <div className="h-24 w-24 rounded-3xl bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center text-3xl font-black text-white shadow-xl shadow-blue-200 shrink-0">
          {(profile?.driver_name ?? driverId).slice(0, 2).toUpperCase()}
        </div>
        <div className="flex-1 text-center md:text-left">
          <div className="flex flex-wrap items-center justify-center md:justify-start gap-3 mb-2">
            <h1 className="text-3xl font-black text-blue-950 tracking-tight">
              {profile?.driver_name ?? "Personnel Dossier"}
            </h1>
            <div className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest shadow-sm ring-1 ${
              (apiStats?.score ?? 0) >= 85
                ? "bg-emerald-50 text-emerald-600 ring-emerald-100"
                : "bg-rose-50 text-rose-600 ring-rose-100"
            }`}>
              {(apiStats?.score ?? 0) >= 85 ? "Elite Standing" : "Review Status"}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-center md:justify-start gap-4 text-[11px] font-bold text-slate-400 uppercase tracking-[0.15em]">
            <span className="flex items-center gap-1.5"><AlertTriangle size={14} className="text-blue-200" /> {profile?.email ?? driverId}</span>
            <span className="hidden md:block opacity-30">|</span>
            <span className="flex items-center gap-1.5"><Clock size={14} className="text-blue-200" /> Last Sync: Just Now</span>
          </div>
        </div>
        <button onClick={download} className="px-6 py-3 bg-blue-600 text-white rounded-xl text-[10px] font-black tracking-widest uppercase shadow-lg shadow-blue-200 flex items-center gap-2 transition-all hover:bg-blue-700 hover:-translate-y-0.5 active:translate-y-0 active:scale-95">
          <Download size={14} /> Export Report
        </button>
      </section>

      {/* Top Chart Section */}
      <div className="h-[320px]">
        <LineChart 
          riskTrends={riskTrends} 
          thresholdScore={thresholdScore} 
          timeRange={timeRange}
          onTimeRangeChange={setTimeRange}
          onThresholdChange={setThresholdScore}
        />
      </div>

      {/* Panels Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Panel 1: Metrics */}
        <div className="rounded-[1.5rem] bg-white border border-blue-100 shadow-sm p-8 flex flex-col transition-shadow hover:shadow-md">
           <div className="flex items-center gap-2 mb-8">
             <div className="w-1.5 h-4 bg-blue-500 rounded-full" />
             <h2 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em]">Daily Report</h2>
           </div>
           <div className="flex-1 flex flex-col justify-between text-[13px] font-bold text-slate-600">
             {reportStats.map(s => (
               <div key={s.label} className="flex justify-between py-2.5 border-b border-blue-50/50">
                 <span>{s.label}</span>
                 <span className="text-blue-950 font-black">{s.value}</span>
               </div>
             ))}
             {significance && (
               <div className={`flex justify-between py-3 mt-4 rounded-xl px-4 ring-1 ${
                 significance.toLowerCase().includes("improvement") || significance.toLowerCase().includes("risk")
                   ? "bg-rose-50/50 ring-rose-100"
                   : "bg-emerald-50/50 ring-emerald-100"
               }`}>
                 <span className={`font-bold uppercase text-[10px] tracking-wider ${
                   significance.toLowerCase().includes("improvement") || significance.toLowerCase().includes("risk")
                     ? "text-rose-600" : "text-emerald-700"
                 }`}>Significance</span>
                 <span className={`font-black ${
                   significance.toLowerCase().includes("improvement") || significance.toLowerCase().includes("risk")
                     ? "text-rose-600" : "text-emerald-600"
                 }`}>{significance}</span>
               </div>
             )}
           </div>
        </div>

        {/* Panel 2: Distractions */}
        <div className="rounded-[1.5rem] bg-white border border-blue-100 shadow-sm p-8 flex flex-col transition-shadow hover:shadow-md overflow-hidden">
           <div className="flex items-center gap-2 mb-4">
             <div className="w-1.5 h-4 bg-indigo-500 rounded-full" />
             <h2 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em]">Distractions Split</h2>
           </div>
           <div className="flex-1 flex items-center justify-center">
              <DonutChart distractions={distractions} centerPct={distractionCenterPct} />
           </div>
        </div>

        {/* Panel 3: Durations */}
        <div className="rounded-[1.5rem] bg-white border border-blue-100 shadow-sm p-8 flex flex-col transition-shadow hover:shadow-md">
           <div className="flex items-center gap-2 mb-6">
             <div className="w-1.5 h-4 bg-emerald-500 rounded-full" />
             <h2 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em]">Duration per Type</h2>
           </div>
           <div className="flex-1">
              <HorizontalBarChart distractions={distractions} />
           </div>
        </div>
      </div>

      {/* Quick Access Info — live from stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
          { icon: <Route className="text-blue-500" />,         label: "Safety Score",  val: apiStats?.score       !== undefined ? `${apiStats.score}%`               : "–" },
          { icon: <MapPin className="text-blue-500" />,        label: "Total Trips",   val: apiStats?.total_trips !== undefined ? `${apiStats.total_trips} Trips`      : "–" },
          { icon: <Clock className="text-blue-500" />,         label: "Safe Hours",    val: apiStats?.safe_hours  !== undefined ? `${apiStats.safe_hours} Hrs`         : "–" },
          { icon: <AlertTriangle className="text-blue-500" />, label: "Alerts Today",  val: apiStats?.alerts      !== undefined ? `${apiStats.alerts} Alert${apiStats.alerts !== 1 ? "s" : ""}` : "–" },
        ].map(i => (
          <div key={i.label} className="bg-white/50 border border-blue-50 rounded-2xl p-4 flex items-center gap-4">
            <div className="p-2 bg-white rounded-xl shadow-sm">{i.icon}</div>
            <div>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">{i.label}</p>
              <p className="text-xs font-bold text-blue-950">{i.val}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
