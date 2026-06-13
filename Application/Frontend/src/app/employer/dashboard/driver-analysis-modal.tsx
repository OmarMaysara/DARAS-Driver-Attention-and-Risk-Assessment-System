"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { DateRangePicker, type PickerValue } from "@/app/components/date-range-picker";
import { createPortal } from "react-dom";
import { type Employee } from "../employer-session";

interface DriverAnalysisModalProps {
  employee: Employee;
  onClose: () => void;
}

export function DriverAnalysisModal({ employee, onClose }: DriverAnalysisModalProps) {
  const [mounted, setMounted] = useState(false);
  const [reportData, setReportData] = useState<any>(null);
  const [thresholdScore, setThresholdScore] = useState(15);
  const [debouncedThreshold, setDebouncedThreshold] = useState(15);
  const [picker, setPicker] = useState<PickerValue>({ startDate:null, endDate:null, timeframe:"week", hour:null });

  const { startDate, endDate, timeframe: selectedTimeframe, hour: selectedHour } = picker;
  const timeRange = (selectedTimeframe.charAt(0).toUpperCase() + selectedTimeframe.slice(1)) as "Hour"|"Day"|"Week"|"Month";

  function handleDateRangeChange(v: PickerValue) { setPicker(v); }

  /* ── Chart zoom ── */
  const CHART_W = 1000, CHART_H = 250;
  const svgRef   = useRef<SVGSVGElement>(null);
  const scrubRef = useRef<HTMLDivElement>(null);
  const vbRef    = useRef({ x: 0, y: 0, w: CHART_W, h: CHART_H });
  const [vb, setVb] = useState({ x: 0, y: 0, w: CHART_W, h: CHART_H });
  const scrubDrag = useRef<{ sx: number; ox: number } | null>(null);
  const isZoomed  = vb.w < CHART_W * 0.99;
  const zoomPct   = Math.round(CHART_W / vb.w * 100);

  function zoomBy(factor: number) {
    const { x, y, w, h } = vbRef.current;
    const newW = Math.max(150, Math.min(CHART_W, w * factor));
    const newH = newW * (CHART_H / CHART_W);
    const next = {
      x: Math.max(0, Math.min(CHART_W - newW, (x + w/2) - newW/2)),
      y: Math.max(0, Math.min(CHART_H - newH, (y + h/2) - newH/2)),
      w: newW, h: newH,
    };
    vbRef.current = next; setVb(next);
  }

  function resetZoom() { const r={x:0,y:0,w:CHART_W,h:CHART_H}; vbRef.current=r; setVb(r); }

  /* ── Debounce threshold ── */
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedThreshold(thresholdScore), 500);
    return () => clearTimeout(timer);
  }, [thresholdScore]);

  /* ── Lock body scroll while modal is open ── */
  useEffect(() => {
    setMounted(true);
    const originalStyle = window.getComputedStyle(document.body).overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = originalStyle; };
  }, []);

  /* ── Fetch driver report ── */
  useEffect(() => {
    setReportData(null);

    const controller = new AbortController();

    async function fetchReport() {
      try {
        const { getEmployerAuthToken, API_ENDPOINTS, COMMON_HEADERS } = await import("@/lib/api-config");
        const token = getEmployerAuthToken();
        const url = new URL(API_ENDPOINTS.DRIVER_DETAILS(employee.email || "unknown"));
        url.searchParams.append("timeframe", selectedTimeframe);
        url.searchParams.append("threshold", (debouncedThreshold / 100).toString());
        if (startDate)             url.searchParams.append("start_date", startDate.toISOString().split("T")[0]);
        if (endDate)               url.searchParams.append("end_date",   endDate.toISOString().split("T")[0]);
        if (selectedHour !== null) url.searchParams.append("hour", String(selectedHour));

        const res = await fetch(url.toString(), {
          signal: controller.signal,
          headers: { "Authorization": token ? `Bearer ${token}` : "", ...COMMON_HEADERS },
        });
        if (res.ok) setReportData(await res.json());
      } catch (err: any) {
        if (err.name !== "AbortError") console.error("Failed to fetch driver report:", err);
      }
    }

    fetchReport();
    return () => controller.abort();
  }, [employee.email, debouncedThreshold, selectedTimeframe, startDate, endDate, selectedHour]);

  if (!mounted) return null;

  /* ── Data processing ── */
  const analysis = reportData?.analysis;

  const riskTrends = (() => {
    const raw = analysis?.trend_chart ?? reportData?.trend_chart ?? [];
    if (!raw.length) return [];

    if (timeRange === "Hour") {
      const seen = new Set<string>();
      return raw.map((t: any) => {
        const [datePart, timePart] = (t.timestamp ?? "").split(" ");
        const [hh, mm] = (timePart ?? "00:00").split(":");
        const label = `${hh}:${mm}`;
        const minNum = parseInt(mm ?? "0", 10);
        const key = `${datePart} ${hh}:${mm}`;
        let showLabel = false;
        if (minNum % 5 === 0 && !seen.has(key)) { seen.add(key); showLabel = true; }
        return { label, score: (t.score ?? t.value ?? 0) * 100, showLabel };
      });
    }

    const timestamps: string[] = raw.map((t: any) => t.timestamp ?? "");
    const uniqueDates = new Set(timestamps.map((ts: string) => ts.split(" ")[0]));
    const multiDay = uniqueDates.size > 1 || timeRange === "Week" || timeRange === "Month";
    return raw.map((t: any) => {
      const [datePart, timePart] = (t.timestamp ?? "").split(" ");
      let label = "–";
      if (!multiDay && timePart) {
        label = timePart.substring(0, 5);
      } else if (datePart) {
        const d = new Date(datePart);
        const mon = d.toLocaleDateString("en-US", { month: "short" });
        label = (timePart && timeRange !== "Week") ? `${mon} ${d.getDate()} ${timePart.substring(0, 5)}` : `${mon} ${d.getDate()}`;
      }
      return { label, score: (t.score ?? t.value ?? 0) * 100, showLabel: true };
    });
  })();

  const defaultDistractions = [
    { type: "Phone call",      value: 35, color: "#3b82f6", duration: 420 },
    { type: "Texting",         value: 25, color: "#ef4444", duration: 180 },
    { type: "Talking",         value: 15, color: "#8b5cf6", duration: 150 },
    { type: "Reaching Behind", value: 12, color: "#f59e0b", duration: 95  },
    { type: "Drinking water",  value: 8,  color: "#06b6d4", duration: 65  },
    { type: "Operating Radio", value: 5,  color: "#ec4899", duration: 55  },
  ];

  const colorPalette = ["#3b82f6", "#ef4444", "#8b5cf6", "#f59e0b", "#06b6d4", "#ec4899"];
  let allDistractions = defaultDistractions;

  const rawSplit = analysis?.distractions_split || reportData?.distractions_split || [];
  if (rawSplit.length > 0) {
    allDistractions = rawSplit.map((d: any, i: number) => {
      const name = d.name ? d.name.charAt(0).toUpperCase() + d.name.slice(1) : "Unknown";
      return {
        type:     name,
        value:    d.value_percentage || d.value || 0,
        duration: d.duration_minutes !== undefined ? Math.round(d.duration_minutes * 60) : (d.duration || 0),
        color:    name.toLowerCase().includes("safe") ? "#22c55e" : colorPalette[i % colorPalette.length],
      };
    });
  }

  const driverInfo = reportData?.driver_info ?? null;
  const dr = reportData?.summary_report ?? null;
  const fmtPct = (v: number | undefined, fallback: string) =>
    v !== undefined ? `${Math.round(v * 100)}%` : fallback;
  const stats = {
    totalTrips:     dr?.total_trips                 !== undefined ? `${dr.total_trips} Trips`               : `${employee.trips} Trips`,
    totalDriveTime: dr?.total_drive_time_mins       !== undefined ? `${dr.total_drive_time_mins} Min`       : `${Math.max(employee.trips * 45, 120)} Min`,
    riskyDriveTime: dr?.total_risky_drive_time_mins !== undefined ? `${dr.total_risky_drive_time_mins} Min` : "–",
    alerts:         dr?.alerts                      !== undefined ? `${dr.alerts} Alert${dr.alerts !== 1 ? "s" : ""}` : "–",
    avgDriverScore: fmtPct(dr?.avg_driver_score, employee.safetyScore + "%"),
    avgRoadScore:   fmtPct(dr?.avg_road_score,   "–"),
    avgRiskScore:   fmtPct(dr?.avg_risk_score,   `${(100 - employee.safetyScore).toFixed(1)}%`),
    percentile95:   dr?.percentile_95th !== undefined ? `${Math.round(dr.percentile_95th * 100)}%` : "–",
    eventRatio:     dr?.event_ratio     !== undefined ? `${Math.round(dr.event_ratio * 100)}%`     : "–",
    significance:   dr?.significance    ?? (employee.safetyScore < 75 ? "Not Safe" : "Safe"),
  };
  const isSafe = stats.significance.toLowerCase().includes("safe") && !stats.significance.toLowerCase().includes("not safe");
  const displayName       = driverInfo?.name        ?? employee.name;
  const displayNationalId = driverInfo?.national_id ?? employee.nationalId;
  const displayStatus     = driverInfo?.status      ?? (employee.safetyScore >= 85 ? "Elite" : employee.safetyScore >= 70 ? "Verified" : "Restricted");

  /* ── Line Chart ── */
  const LineChart = () => {
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
      const x = data.length > 1 ? PAD_L + (i / (data.length - 1)) * chartW : PAD_L + chartW / 2;
      const y = PAD_T + chartH - (val / maxVal) * chartH;
      return { x, y, label: riskTrends[i].label };
    });

    const labelStep = Math.max(1, Math.ceil(points.length / 8));

    const d = points.reduce((acc: string, p: any, i: number) =>
      i === 0 ? `M ${p.x} ${p.y}` : `${acc} L ${p.x} ${p.y}`, ""
    );

    const areaD = points.length > 0
      ? `${d} L ${points[points.length-1].x} ${PAD_T + chartH} L ${points[0].x} ${PAD_T + chartH} Z`
      : "";

    if (data.length === 0) {
      return (
        <div className="relative w-full h-full flex flex-col pt-4 min-h-0">
          <div className="flex items-center gap-2 px-4 sm:px-10 shrink-0">
            <span className="text-[10px] font-black text-blue-900/40 uppercase tracking-[0.2em]">Risk Projection</span>
            <DateRangePicker {...picker} onChange={handleDateRangeChange} />
          </div>
          <div className="flex-1 flex flex-col items-center justify-center gap-2">
            <span className="text-slate-300 text-4xl">📊</span>
            <span className="text-slate-400 text-[13px] font-bold uppercase tracking-widest">No data for this period</span>
            <span className="text-slate-300 text-[10px] font-medium">Pick a date range above to load trip data</span>
          </div>
        </div>
      );
    }

    return (
      <div className="relative w-full h-full flex flex-col pt-4 min-h-0">
        <div className="flex flex-col sm:flex-row justify-between items-center px-4 sm:px-10 gap-4 sm:gap-0 shrink-0">
           <div className="flex items-center gap-2 relative">
             <span className="text-[10px] font-black text-blue-900/40 uppercase tracking-[0.2em]">Risk Projection</span>
             <DateRangePicker {...picker} onChange={handleDateRangeChange} />
           </div>
           <div className="flex items-center gap-3 bg-rose-50 px-4 py-1.5 rounded-full border border-rose-100">
             <label htmlFor="threshold-slider" className="text-[10px] font-black text-rose-500 uppercase tracking-widest whitespace-nowrap">
               Threshold = {thresholdScore}%
             </label>
             <input
               id="threshold-slider" type="range" min="0" max="100" step="1"
               value={thresholdScore}
               onChange={(e) => setThresholdScore(Number(e.target.value))}
               className="w-24 h-1.5 bg-rose-200 rounded-lg appearance-none cursor-pointer accent-rose-500"
             />
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
            <path d={d} fill="none" stroke="#3b82f6" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />

            {points.map((p: {x: number, y: number, label: string}, i: number) => {
              const showLabel = timeRange === "Hour"
                ? (riskTrends[i] as any).showLabel === true
                : i % labelStep === 0 || i === points.length - 1;
              return (
                <g key={`pt-${i}`}>
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
          {isZoomed && (
            <div ref={scrubRef} className="mx-10 mb-3 h-2 bg-slate-100 rounded-full relative cursor-pointer">
              <div
                className="absolute top-0 h-full bg-blue-400 rounded-full hover:bg-blue-500 cursor-grab active:cursor-grabbing transition-colors shadow-sm"
                style={{ left: `${(vb.x/CHART_W)*100}%`, width: `${(vb.w/CHART_W)*100}%` }}
                onMouseDown={e => { e.preventDefault(); scrubDrag.current = { sx: e.clientX, ox: vbRef.current.x }; }}
              />
            </div>
          )}
        </div>
      </div>
    );
  };

  /* ── Donut Chart ── */
  const DonutChart = () => {
    let currentAngle = -Math.PI / 2;
    const cx = 150, cy = 150, R = 90, r = 35;
    const total = allDistractions.reduce((sum, d) => sum + d.value, 0);
    return (
      <div className="relative w-full h-full flex items-center justify-center">
        <svg viewBox="0 0 300 300" className="w-full h-full max-h-[220px] drop-shadow-md overflow-visible">
          {allDistractions.map((d, i) => {
             const angle = (d.value / total) * Math.PI * 2;
             const x1 = cx + R * Math.cos(currentAngle), y1 = cy + R * Math.sin(currentAngle);
             const x2 = cx + R * Math.cos(currentAngle + angle), y2 = cy + R * Math.sin(currentAngle + angle);
             const ix1 = cx + r * Math.cos(currentAngle), iy1 = cy + r * Math.sin(currentAngle);
             const ix2 = cx + r * Math.cos(currentAngle + angle), iy2 = cy + r * Math.sin(currentAngle + angle);
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
                 <path d={pathD} fill={d.color} stroke="#ffffff" strokeWidth="2" className="transition-all hover:opacity-80 cursor-pointer hover:scale-[1.02] origin-center" />
                 {d.value >= 5 && (
                   <text x={lx} y={ly} textAnchor={isRight ? "start" : "end"} dominantBaseline="middle" fontSize="10" fontWeight="bold" fill="#1e293b" className="drop-shadow-sm pointer-events-none">
                     {d.type.split(" ")[0]} {d.value}%
                   </text>
                 )}
               </g>
             );
          })}
        </svg>
      </div>
    );
  };

  /* ── Horizontal Bar Chart — safe driving excluded ── */
  const HorizontalBarChart = () => {
    const filtered = allDistractions.filter(d => !d.type.toLowerCase().includes("safe"));
    const maxVal = Math.max(...filtered.map(d => d.duration), 1);
    return (
      <div className="w-full h-full flex flex-col justify-center py-2">
         <div className="flex-1 flex flex-col justify-center gap-4 relative">
           {filtered.slice(0, 5).map((d, i) => (
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
  };

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-6 bg-slate-900/40 backdrop-blur-2xl animate-fade-in">
      <div
        className="relative w-full max-w-[1200px] max-h-[95vh] flex flex-col rounded-[2rem] bg-slate-50 shadow-[0_32px_64px_-12px_rgba(0,0,0,0.3)] ring-1 ring-white/20 animate-modal-pop overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-white px-8 py-5 flex items-center justify-between border-b border-blue-50/50">
          <div className="flex items-center gap-5">
            <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center text-lg font-black text-white shadow-md shadow-blue-200">
              {employee.name.split(" ").map(w => w[0]).join("").toUpperCase()}
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-black text-blue-950 tracking-tight">{displayName}</h2>
                <div className={`px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-[0.1em] shadow-sm ring-1 ${
                  displayStatus === "ACTIVE" || employee.safetyScore >= 70
                    ? "bg-emerald-50 text-emerald-600 ring-emerald-100"
                    : "bg-rose-50 text-rose-600 ring-rose-100"
                }`}>
                  {displayStatus}
                </div>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{employee.role}</span>
                <span className="text-slate-300">•</span>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">ID: {displayNationalId}</span>
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2.5 text-slate-400 hover:text-blue-600 bg-slate-50 rounded-xl hover:bg-blue-50 transition-all active:scale-95 border border-slate-100"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6 sm:p-8 overflow-y-auto flex-1">
          {/* Chart */}
          <div className="h-[280px] w-full rounded-[1.5rem] bg-white border border-blue-50 shadow-sm mb-6 overflow-hidden relative group transition-shadow hover:shadow-md">
             <LineChart />
          </div>

          {/* Panels */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 auto-rows-fr">
             {/* Daily Report */}
             <div className="rounded-[1.5rem] bg-white border border-blue-50 shadow-sm p-6 flex flex-col transition-shadow hover:shadow-md">
                <div className="flex items-center gap-2 mb-6">
                  <div className="w-1.5 h-4 bg-blue-500 rounded-full" />
                  <h2 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em]">Daily Report</h2>
                </div>
                <div className="flex-1 flex flex-col justify-between text-[13px] font-bold text-slate-600">
                  {[
                    ["Total Trips",      stats.totalTrips],
                    ["Total Drive Time", stats.totalDriveTime],
                    ["Risky Drive Time", stats.riskyDriveTime],
                    ["Alerts",           stats.alerts],
                    ["Avg Driver Score", stats.avgDriverScore],
                    ["Avg Road Score",   stats.avgRoadScore],
                    ["Avg Risk Score",   stats.avgRiskScore],
                    ["95th Percentile",  stats.percentile95],
                    ["Event Ratio",      stats.eventRatio],
                  ].map(([label, value]) => (
                    <div key={label} className="flex justify-between py-2 border-b border-slate-50">
                      <span>{label}</span>
                      <span className="text-blue-950 font-black">{value}</span>
                    </div>
                  ))}
                  <div className={`flex justify-between py-3 mt-4 rounded-xl px-4 ring-1 ${
                    isSafe ? "bg-emerald-50/50 ring-emerald-100" : "bg-rose-50/50 ring-rose-100"
                  }`}>
                    <span className={`font-bold uppercase text-[10px] tracking-wider ${isSafe ? "text-emerald-700" : "text-rose-600"}`}>Significance</span>
                    <span className={`font-black ${isSafe ? "text-emerald-600" : "text-rose-600"}`}>{stats.significance}</span>
                  </div>
                </div>
             </div>

             {/* Distractions Donut */}
             <div className="rounded-[1.5rem] bg-white border border-blue-50 shadow-sm p-6 flex flex-col relative transition-shadow hover:shadow-md overflow-hidden">
                <div className="flex items-center gap-2 mb-2 z-10">
                  <div className="w-1.5 h-4 bg-indigo-500 rounded-full" />
                  <h2 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em]">Distractions Split</h2>
                </div>
                <div className="flex-1 w-full flex items-center justify-start pl-4 relative">
                   <DonutChart />
                </div>
             </div>

             {/* Duration Bar Chart */}
             <div className="rounded-[1.5rem] bg-white border border-blue-50 shadow-sm p-6 flex flex-col transition-shadow hover:shadow-md">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-1.5 h-4 bg-emerald-500 rounded-full" />
                  <h2 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em]">Duration per Type</h2>
                </div>
                <div className="flex-1 w-full relative">
                   <HorizontalBarChart />
                </div>
             </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
