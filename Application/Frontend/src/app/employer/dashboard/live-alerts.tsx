"use client";

import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { EMPLOYEES_KEY, type Employee } from "../employer-session";

interface Alert {
  id: string;
  driverName: string;
  type: "Fatigue" | "Distraction" | "Phone usage" | "Dangerous Lane Change";
  time: string;
  severity: "high" | "medium" | "low";
}

export function LiveAlerts() {
  const [alerts, setAlerts] = useState<Alert[]>([]);

  useEffect(() => {
    // 1. Get real driver names from storage
    const getDriverNames = () => {
      try {
        const raw = localStorage.getItem(EMPLOYEES_KEY);
        if (raw) {
          const employees = JSON.parse(raw) as Employee[];
          if (employees.length > 0) return employees.map(e => e.name);
        }
      } catch { /* ignore */ }
      return ["Active Driver"];
    };

    const names = getDriverNames();

    // Simulated real-time alerts
    const initialAlerts: Alert[] = [
      { id: "1", driverName: names[0], type: "Phone usage", time: "2 min ago", severity: "high" },
      { id: "2", driverName: names[Math.min(1, names.length - 1)], type: "Fatigue", time: "15 min ago", severity: "medium" },
    ];
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAlerts(initialAlerts);

    const interval = setInterval(() => {
      const currentNames = getDriverNames();
      const types: Alert["type"][] = ["Fatigue", "Distraction", "Phone usage", "Dangerous Lane Change"];
      const severities: Alert["severity"][] = ["high", "medium", "low"];
      
      const newAlert: Alert = {
        id: Math.random().toString(),
        driverName: currentNames[Math.floor(Math.random() * currentNames.length)],
        type: types[Math.floor(Math.random() * types.length)],
        time: "Just now",
        severity: severities[Math.floor(Math.random() * severities.length)]
      };

      setAlerts(prev => [newAlert, ...prev].slice(0, 5));
    }, 15000); 

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="rounded-3xl border border-blue-100 bg-white p-8 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between mb-8">
        <h2 className="font-display text-xl font-bold text-blue-950 flex items-center gap-3">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-rose-500"></span>
          </span>
          Live Safety Feed
        </h2>
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-none bg-slate-50 px-3 py-1 rounded-full">REAL-TIME AI</span>
      </div>

      <div className="space-y-4">
        {alerts.map((alert) => (
          <div 
            key={alert.id} 
            className={`
              flex items-center justify-between p-4 rounded-2xl border transition-all animate-fade-in
              ${alert.severity === "high" ? "bg-rose-50/50 border-rose-100" : "bg-blue-50/30 border-blue-50"}
            `}
          >
            <div className="flex items-center gap-4">
              <div className={`
                w-10 h-10 rounded-full flex items-center justify-center font-bold text-xs
                ${alert.severity === "high" ? "bg-rose-500 text-white" : "bg-blue-500 text-white"}
              `}>
                {alert.driverName[0]}
              </div>
              <div>
                <p className="text-sm font-bold text-blue-950">{alert.driverName}</p>
                <p className={`text-[10px] font-bold uppercase tracking-wider ${alert.severity === "high" ? "text-rose-600" : "text-blue-600"}`}>
                  {alert.type}
                </p>
              </div>
            </div>
            <p className="text-[10px] font-bold text-slate-400 uppercase whitespace-nowrap">{alert.time}</p>
          </div>
        ))}
        {alerts.length === 0 && (
          <div className="text-center py-8 text-sm text-slate-400 font-medium">
            Waiting for device telemetry...
          </div>
        )}
      </div>
      
      <button className="w-full mt-6 text-[10px] font-bold text-blue-600 uppercase tracking-widest hover:text-blue-800 transition flex items-center justify-center gap-2">
        View All History Activity <ArrowRight size={12} />
      </button>
    </div>
  );
}
