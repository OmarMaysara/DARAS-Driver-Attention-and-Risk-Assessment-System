"use client";

import { useEffect, useState } from "react";
import { X, ChevronDown } from "lucide-react";
import { createPortal } from "react-dom";
import { type Employee } from "../employer-session";

interface DriverAnalysisModalProps {
  employee: Employee;
  onClose: () => void;
}

export function DriverAnalysisModal({ employee, onClose }: DriverAnalysisModalProps) {
  const [mounted, setMounted] = useState(false);
  const [thresholdScore, setThresholdScore] = useState(15);
  const [debouncedThreshold, setDebouncedThreshold] = useState(15);
  const [timeRange, setTimeRange] = useState<"Day" | "Week" | "Month">("Week");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [reportData, setReportData] = useState<any>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedThreshold(thresholdScore), 500);
    return () => clearTimeout(timer);
  }, [thresholdScore]);

  useEffect(() => {
    setMounted(true);
    const originalStyle = window.getComputedStyle(document.body).overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalStyle;
    };
  }, []);

  useEffect(() => {
    // Fetch real driver report data
    async function fetchReport() {
      try {
        const { getEmployerAuthToken, API_ENDPOINTS, COMMON_HEADERS } = await import("@/lib/api-config");
        const token = getEmployerAuthToken();
        const baseUrl = new URL(API_ENDPOINTS.DRIVER_DETAILS(employee.email || "unknown"));
        baseUrl.searchParams.append("timeframe", timeRange.toLowerCase());
        baseUrl.searchParams.append("threshold", (debouncedThreshold / 100).toString());
        
        const res = await fetch(baseUrl.toString(), {
          headers: {
            "Authorization": token ? `Bearer ${token}` : "",
            ...COMMON_HEADERS
          }
        });
        if (res.ok) {
          const data = await res.json();
          setReportData(data);
        }
      } catch (err) {
        console.error("Failed to fetch driver report:", err);
      }
    }
    
    fetchReport();
  }, [employee.email, debouncedThreshold, timeRange]);

  if (!mounted) return null;

  // --- Dynamic Data based on employee or fetched report ---
  const analysis = reportData?.analysis;
  
  // Use fetched risk trends if available, else fallback
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let riskTrends = analysis?.trend_chart?.map((t: any) => ({
    label: t.name ? t.name.charAt(0) + t.name.slice(1).toLowerCase() : "Day",
    score: t.score || 0
  })) || reportData?.trend_chart?.map((t: any) => ({
    label: t.name ? t.name.charAt(0) + t.name.slice(1).toLowerCase() : "Day",
    score: t.score || 0
  })) || reportData?.risk_trends || reportData?.riskTrends;
  
  if (!riskTrends) {
    if (timeRange === "Day") {
      riskTrends = [
        { label: "8am", score: 92 }, { label: "10am", score: 88 }, { label: "12pm", score: 95 },
        { label: "2pm", score: 84 }, { label: "4pm", score: 89 }, { label: "6pm", score: 91 },
      ];
    } else if (timeRange === "Month") {
      riskTrends = [
        { label: "W1", score: 85 }, { label: "W2", score: 89 },
        { label: "W3", score: 94 }, { label: "W4", score: 91 },
      ];
    } else {
      riskTrends = [
        { label: "Mon", score: 92 }, { label: "Tue", score: 88 }, { label: "Wed", score: 95 },
        { label: "Thu", score: 84 }, { label: "Fri", score: 89 }, { label: "Sat", score: 91 }, { label: "Sun", score: 94 },
      ];
    }
  }

  const defaultDistractions = [
    { type: "Phone call", value: 35, color: "#3b82f6", duration: 420 },
    { type: "Texting", value: 25, color: "#ef4444", duration: 180 },
    { type: "Talking", value: 15, color: "#8b5cf6", duration: 150 },
    { type: "Reaching Behind", value: 12, color: "#f59e0b", duration: 95 },
    { type: "Drinking water", value: 8, color: "#06b6d4", duration: 65 },
    { type: "Operating Radio", value: 5, color: "#ec4899", duration: 55 },
  ];
  
  // Standardize distractions data structure from backend
  const colorPalette = ["#3b82f6", "#ef4444", "#8b5cf6", "#f59e0b", "#06b6d4", "#ec4899"];
  let allDistractions = defaultDistractions;
  
  const rawSplit = analysis?.distractions_split || reportData?.distractions_split || [];
  
  if (rawSplit.length > 0) {
    allDistractions = rawSplit.map((d: any, i: number) => ({
      type: d.name ? d.name.charAt(0).toUpperCase() + d.name.slice(1) : "Unknown",
      value: d.value_percentage || d.value || 0,
      duration: d.duration_minutes !== undefined ? Math.round(d.duration_minutes * 60) : (d.duration || 0),
      color: colorPalette[i % colorPalette.length]
    }));
  }

  const dr = analysis?.daily_report || reportData?.daily_report;
  const stats = {
    totalDriveTime: dr?.total_drive_time_mins !== undefined ? `${dr.total_drive_time_mins} Minutes` : reportData?.stats?.totalDriveTime || `${Math.max(employee.trips * 45, 120)} Minutes`,
    avgDriverScore: dr?.avg_driver_score !== undefined ? `${dr.avg_driver_score}%` : reportData?.stats?.avgDriverScore || employee.safetyScore + "%",
    avgRoadScore: dr?.avg_road_score !== undefined ? `${dr.avg_road_score}%` : reportData?.stats?.avgRoadScore || "91%",
    avgRiskScore: dr?.avg_risk_score !== undefined ? `${dr.avg_risk_score}%` : reportData?.stats?.avgRiskScore || `${(100 - employee.safetyScore).toFixed(1)}%`,
    percentile95: dr?.percentile_95th !== undefined ? `${dr.percentile_95th}th` : reportData?.stats?.percentile95 || "96th",
    eventRatio: dr?.event_ratio !== undefined ? `${dr.event_ratio}%` : reportData?.stats?.eventRatio || `${((employee.incidents / (employee.trips || 1)) * 100).toFixed(1)}%`,
    significance: dr?.significance || reportData?.stats?.significance || (employee.safetyScore < 75 ? "Not Safe" : "Safe")
  };

  // --- Line Chart Component (Risk Score / Time) ---
  const LineChart = () => {
    const W = 1000, H = 250;
    const PAD_L = 90, PAD_R = 40, PAD_T = 20, PAD_B = 55;
    const chartW = W - PAD_L - PAD_R;
    const chartH = H - PAD_T - PAD_B;
    
    // Convert safety score (0-100) to a risk factor (0-1) for the chart
    // 92 -> risk 0.08
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = riskTrends.map((d: any) => (100 - d.score) / 100);
    const threshold = thresholdScore / 100;
    const maxData = Math.max(...data, threshold);
    const maxVal = maxData > 0.5 ? 1.0 : (maxData > 0.3 ? 0.5 : 0.3);
    const thresholdY = PAD_T + chartH - (threshold / maxVal) * chartH;

    const points = data.map((val: number, i: number) => {
      const x = PAD_L + (i / (data.length - 1)) * chartW;
      const y = PAD_T + chartH - (val / maxVal) * chartH;
      return { x, y, label: riskTrends[i].label };
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = points.reduce((acc: string, p: any, i: number) => 
      i === 0 ? `M ${p.x} ${p.y}` : `${acc} L ${p.x} ${p.y}`, ""
    );

    const areaD = `${d} L ${points[points.length-1].x} ${PAD_T + chartH} L ${points[0].x} ${PAD_T + chartH} Z`;

    return (
      <div className="relative w-full h-full flex flex-col pt-4 min-h-0">
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
                   {["Day", "Week", "Month"].map(r => (
                     <div 
                       key={r} 
                       className="px-3 py-1.5 text-[10px] font-bold text-slate-600 hover:bg-blue-50 hover:text-blue-600 cursor-pointer"
                       onClick={() => { setTimeRange(r as "Day" | "Week" | "Month"); setIsDropdownOpen(false); }}
                     >
                       This {r}
                     </div>
                   ))}
                 </div>
               )}
             </div>
           </div>
           <div className="flex items-center gap-3 bg-rose-50 px-4 py-1.5 rounded-full border border-rose-100">
             <label htmlFor="threshold-slider" className="text-[10px] font-black text-rose-500 uppercase tracking-widest whitespace-nowrap">
               Threshold = {thresholdScore}%
             </label>
             <input 
               id="threshold-slider"
               type="range" 
               min="0" 
               max="100" 
               step="1"
               value={thresholdScore}
               onChange={(e) => setThresholdScore(Number(e.target.value))}
               className="w-24 h-1.5 bg-rose-200 rounded-lg appearance-none cursor-pointer accent-rose-500"
             />
           </div>
        </div>
        
        <div className="relative flex-1 w-full mt-4 min-h-0">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full pb-4 px-4 sm:px-10 drop-shadow-sm overflow-visible">
            {/* Area under the line */}
            <defs>
              <linearGradient id="lineGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3b82f6" />
                <stop offset="100%" stopColor="transparent" />
              </linearGradient>
            </defs>
            <path d={areaD} fill="url(#lineGradient)" opacity="0.15" />

            {/* Grid lines (horizontal) */}
            {(maxVal === 1.0 ? [0, 0.2, 0.4, 0.6, 0.8, 1.0] : maxVal === 0.5 ? [0, 0.1, 0.2, 0.3, 0.4, 0.5] : [0, 0.1, 0.2, 0.3]).map((val) => {
              const y = PAD_T + chartH - (val / maxVal) * chartH;
              return (
                <line key={`grid-${val}`} x1={PAD_L} y1={y} x2={W-PAD_R} y2={y} stroke="#f1f5f9" strokeWidth="1" />
              );
            })}

            {/* Threshold Line */}
            <line x1={PAD_L} y1={thresholdY} x2={W-PAD_R} y2={thresholdY} stroke="#f43f5e" strokeWidth="2" strokeDasharray="6,4" opacity="0.8" />
            
            {/* Data Line */}
            <path d={d} fill="none" stroke="#3b82f6" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />

            {/* Points and X-axis Labels */}
            {points.map((p: {x: number, y: number, label: string}, i: number) => (
              <g key={`pt-${i}`}>
                <circle cx={p.x} cy={p.y} r="5" fill="#white" stroke="#3b82f6" strokeWidth="3" className="transition-all hover:r-6 hover:fill-blue-100 cursor-pointer" />
                {/* Small tick mark on the X axis */}
                <line x1={p.x} y1={PAD_T + chartH} x2={p.x} y2={PAD_T + chartH + 5} stroke="#cbd5e1" strokeWidth="2" />
                <text x={p.x} y={PAD_T + chartH + 22} textAnchor="middle" fontSize="11" className="fill-slate-500 font-bold uppercase tracking-wider">{p.label}</text>
              </g>
            ))}

            {/* Y Axis Line */}
            <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={PAD_T + chartH} stroke="#cbd5e1" strokeWidth="2" strokeLinecap="round" />
            
            {/* X Axis Line */}
            <line x1={PAD_L} y1={PAD_T + chartH} x2={W-PAD_R} y2={PAD_T + chartH} stroke="#cbd5e1" strokeWidth="2" strokeLinecap="round" />

            {/* Y Axis Ticks and Labels (Drawn last so they are on top) */}
            {(maxVal === 1.0 ? [0, 0.2, 0.4, 0.6, 0.8, 1.0] : maxVal === 0.5 ? [0, 0.1, 0.2, 0.3, 0.4, 0.5] : [0, 0.1, 0.2, 0.3]).map((val) => {
              const y = PAD_T + chartH - (val / maxVal) * chartH;
              return (
                <g key={`label-${val}`}>
                  <line x1={PAD_L - 5} y1={y} x2={PAD_L} y2={y} stroke="#cbd5e1" strokeWidth="2" />
                  <text x={PAD_L - 12} y={y} textAnchor="end" dominantBaseline="central" fontSize="11" className="fill-slate-600 font-black">{Math.round(val * 100)}%</text>
                </g>
              );
            })}
            
            {/* Y Axis Label */}
            <text x={25} y={PAD_T + chartH / 2} transform={`rotate(-90 25 ${PAD_T + chartH / 2})`} textAnchor="middle" fontSize="12" className="fill-slate-400 font-black uppercase tracking-[0.2em]">
              Risk Score
            </text>
          </svg>
        </div>
      </div>
    );
  };

  // --- Donut Chart Component ---
  const DonutChart = () => {
    let currentAngle = -Math.PI / 2;
    const cx = 150, cy = 150, R = 90, r = 35;
    const total = allDistractions.reduce((sum, d) => sum + d.value, 0);

    return (
      <div className="relative w-full h-full flex items-center justify-center">
        <svg viewBox="0 0 300 300" className="w-full h-full max-h-[220px] drop-shadow-md overflow-visible">
          {allDistractions.map((d, i) => {
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
          {/* Center text */}
          <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle" fontSize="24" fontWeight="900" className="fill-blue-950">{total}%</text>
        </svg>
      </div>
    );
  };

  // --- Horizontal Bar Chart ---
  const HorizontalBarChart = () => {
    const maxVal = Math.max(...allDistractions.map(d => d.duration));
    
    return (
      <div className="w-full h-full flex flex-col justify-center py-2">
         <div className="flex-1 flex flex-col justify-center gap-4 relative">
           {allDistractions.slice(0, 5).map((d, i) => (
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
         {/* X Axis */}
         <div className="flex text-[10px] font-bold text-slate-400 mt-6 border-t border-slate-200 pt-3 w-full">
            <div className="flex-1 flex justify-between px-1">
              <span>0s</span>
              <span>100s</span>
              <span>200s</span>
              <span>300s</span>
              <span>400s+</span>
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
        {/* Top Header */}
        <div className="bg-white px-8 py-5 flex items-center justify-between border-b border-blue-50/50">
          <div className="flex items-center gap-5">
            <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center text-lg font-black text-white shadow-md shadow-blue-200">
              {employee.name.split(" ").map(w => w[0]).join("").toUpperCase()}
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-black text-blue-950 tracking-tight">{employee.name}</h2>
                <div className={`px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-[0.1em] shadow-sm ring-1 ${
                  employee.safetyScore >= 85 ? "bg-emerald-50 text-emerald-600 ring-emerald-100" :
                  employee.safetyScore >= 70 ? "bg-amber-50 text-amber-600 ring-amber-100" :
                  "bg-rose-50 text-rose-600 ring-rose-100"
                }`}>
                  {employee.safetyScore >= 85 ? "Elite" : employee.safetyScore >= 70 ? "Verified" : "Restricted"}
                </div>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{employee.role}</span>
                <span className="text-slate-300">•</span>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">ID: {employee.nationalId}</span>
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
          
          {/* Top Chart Section */}
          <div className="h-[280px] w-full rounded-[1.5rem] bg-white border border-blue-50 shadow-sm mb-6 overflow-hidden relative group transition-shadow hover:shadow-md">
             <LineChart />
          </div>

          {/* Bottom Panels Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 auto-rows-fr">
             
             {/* Panel 1: Daily Report */}
             <div className="rounded-[1.5rem] bg-white border border-blue-50 shadow-sm p-6 flex flex-col transition-shadow hover:shadow-md">
                <div className="flex items-center gap-2 mb-6">
                  <div className="w-1.5 h-4 bg-blue-500 rounded-full" />
                  <h2 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em]">Daily Report</h2>
                </div>
                
                <div className="flex-1 flex flex-col justify-between text-[13px] font-bold text-slate-600">
                  <div className="flex justify-between py-2 border-b border-slate-50">
                    <span>Total Drive Time</span>
                    <span className="text-blue-950 font-black">{stats.totalDriveTime}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-slate-50">
                    <span>Avg Driver Score</span>
                    <span className="text-blue-950 font-black">{stats.avgDriverScore}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-slate-50">
                    <span>Avg Road Score</span>
                    <span className="text-blue-950 font-black">{stats.avgRoadScore}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-slate-50">
                    <span>Avg Risk Score</span>
                    <span className="text-blue-950 font-black">{stats.avgRiskScore}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-slate-50">
                    <span>95<sup className="text-[9px]">th</sup> Percentile</span>
                    <span className="text-blue-950 font-black">{stats.percentile95}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-slate-50">
                    <span>Event Ratio</span>
                    <span className="text-blue-950 font-black">{stats.eventRatio}</span>
                  </div>
                  <div className="flex justify-between py-2 mt-2 bg-slate-50/50 rounded-lg px-3">
                    <span className="text-slate-500">Significance</span>
                    <span className={`font-black ${stats.significance === "Safe" ? "text-emerald-500" : "text-rose-500"}`}>
                      {stats.significance}
                    </span>
                  </div>
                </div>
             </div>

             {/* Panel 2: Distractions Donut */}
             <div className="rounded-[1.5rem] bg-white border border-blue-50 shadow-sm p-6 flex flex-col relative transition-shadow hover:shadow-md overflow-hidden">
                <div className="flex items-center gap-2 mb-2 z-10">
                  <div className="w-1.5 h-4 bg-indigo-500 rounded-full" />
                  <h2 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em]">Distractions Split</h2>
                </div>
                
                <div className="flex-1 w-full flex items-center justify-start pl-4 relative">
                   <DonutChart />
                </div>
             </div>

             {/* Panel 3: Duration Bar Chart */}
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



