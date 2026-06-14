"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Calendar, Clock, ArrowLeft } from "lucide-react";

export type TimeframeMode = "hour" | "day" | "week" | "month";

export interface PickerValue {
  startDate: Date | null;
  endDate:   Date | null;
  timeframe: TimeframeMode;
  hour:      number | null;
}

interface DateRangePickerProps extends PickerValue {
  onChange: (v: PickerValue) => void;
}

/* ── helpers ─────────────────────────────────────────────── */
const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONTHS_FULL  = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAYS_SHORT   = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

function isSameDay(a: Date, b: Date) {
  return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate();
}

function weekBounds(d: Date): [Date, Date] {
  const base = new Date(d); base.setHours(0,0,0,0);
  const dow  = base.getDay(); // 0=Sun
  const toMon = dow===0 ? -6 : 1-dow;
  const mon = new Date(base); mon.setDate(base.getDate()+toMon);
  const sun = new Date(mon);  sun.setDate(mon.getDate()+6); sun.setHours(23,59,59,999);
  return [mon, sun];
}

/** Formats a Date as YYYY-MM-DD using LOCAL date components — avoids the
 *  off-by-one-day shift toISOString() introduces for positive UTC offsets. */
export function toLocalDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isInWeek(day: Date, anchor: Date) {
  const [s, e] = weekBounds(anchor);
  const d = new Date(day); d.setHours(12);
  return d >= s && d <= e;
}

/* ── calendar sub-component ──────────────────────────────── */
function CalendarGrid({
  year, month, mode, startDate, endDate, hoverDay,
  onPrev, onNext, onDay, onHover, onLeave,
}: {
  year: number; month: number;
  mode: "day" | "week";
  startDate: Date | null; endDate: Date | null; hoverDay: Date | null;
  onPrev: ()=>void; onNext: ()=>void;
  onDay: (d:Date)=>void;
  onHover?: (d:Date)=>void; onLeave?: ()=>void;
}) {
  const first = (new Date(year, month, 1).getDay()+6)%7;
  const total = new Date(year, month+1, 0).getDate();
  const today = new Date();

  return (
    <>
      {/* month/year nav */}
      <div className="flex items-center justify-between mb-3">
        <button onClick={onPrev} className="p-1.5 rounded-lg hover:bg-blue-50 text-slate-400 hover:text-blue-600 transition-colors"><ChevronLeft size={13}/></button>
        <span className="text-[11px] font-black text-blue-950 uppercase tracking-widest">{MONTHS_FULL[month]} {year}</span>
        <button onClick={onNext} className="p-1.5 rounded-lg hover:bg-blue-50 text-slate-400 hover:text-blue-600 transition-colors"><ChevronRight size={13}/></button>
      </div>
      {/* day headers */}
      <div className="grid grid-cols-7 mb-1">
        {DAYS_SHORT.map(d=>(
          <div key={d} className="text-center text-[9px] font-black text-slate-400 uppercase tracking-wider py-0.5">{d}</div>
        ))}
      </div>
      {/* days */}
      <div className="grid grid-cols-7 gap-y-0.5">
        {Array.from({length:first}).map((_,i)=><div key={`e${i}`}/>)}
        {Array.from({length:total}).map((_,i)=>{
          const day = new Date(year, month, i+1);
          const isToday = isSameDay(day, today);

          /* day-mode highlight */
          const isDaySelected = mode==="day" && !!startDate && isSameDay(day, startDate);

          /* week-mode highlight */
          const inSelectedWeek = mode==="week" && !!startDate && isInWeek(day, startDate);
          const inHoverWeek    = mode==="week" && !!hoverDay  && isInWeek(day, hoverDay);
          const [ws, we]       = mode==="week" && startDate ? weekBounds(startDate) : [null, null];
          const isWeekStart    = !!ws && isSameDay(day, ws);
          const isWeekEnd      = !!we && isSameDay(day, we);
          const [hs, he]       = mode==="week" && hoverDay ? weekBounds(hoverDay) : [null, null];
          const isHoverStart   = !!hs && isSameDay(day, hs);
          const isHoverEnd     = !!he && isSameDay(day, he);

          const solidBlue  = isDaySelected || isWeekStart || isWeekEnd || isHoverStart || isHoverEnd;
          const lightBlue  = !solidBlue && (inSelectedWeek || inHoverWeek);
          const noHighlight= !solidBlue && !lightBlue;

          return (
            <div
              key={i}
              onClick={()=>onDay(day)}
              onMouseEnter={()=>onHover?.(day)}
              onMouseLeave={()=>onLeave?.()}
              className={[
                "h-8 flex items-center justify-center text-[11px] font-bold cursor-pointer transition-all",
                solidBlue  ? "bg-blue-600 text-white rounded-xl shadow-sm" : "",
                lightBlue  ? "bg-blue-100 text-blue-700" : "",
                noHighlight && isToday  ? "ring-1 ring-blue-300 rounded-xl text-slate-700 hover:bg-blue-50" : "",
                noHighlight && !isToday ? "text-slate-700 hover:bg-blue-50 hover:text-blue-600 rounded-xl" : "",
              ].filter(Boolean).join(" ")}
            >
              {i+1}
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ── main component ──────────────────────────────────────── */
export function DateRangePicker({ startDate, endDate, timeframe, hour, onChange }: DateRangePickerProps) {
  const [open, setOpen]         = useState(false);
  const [mode, setMode]         = useState<TimeframeMode>(timeframe || "week");
  const [viewDate, setViewDate] = useState(()=> startDate ?? new Date());
  const [hourDay, setHourDay]   = useState<Date|null>(null); // day chosen in hour-mode step1
  const [hoverDay, setHoverDay] = useState<Date|null>(null);
  const [dropPos, setDropPos]   = useState({ top: 0, left: 0 });
  const ref     = useRef<HTMLDivElement>(null);
  const trigRef = useRef<HTMLDivElement>(null);

  const reposition = useCallback(() => {
    if (!trigRef.current) return;
    const r = trigRef.current.getBoundingClientRect();
    setDropPos({ top: r.bottom + 8, left: r.left });
  }, []);

  /* sync mode with incoming prop */
  useEffect(()=>{ setMode(timeframe || "week"); }, [timeframe]);

  /* reposition and close on outside click */
  useEffect(()=>{
    if(open) reposition();
    function handler(e: MouseEvent){
      const t = e.target as Node;
      const inTrig = trigRef.current?.contains(t);
      const inDrop = ref.current?.contains(t);
      if(!inTrig && !inDrop){ setOpen(false); setHourDay(null); }
    }
    if(open) document.addEventListener("mousedown", handler);
    return ()=> document.removeEventListener("mousedown", handler);
  },[open, reposition]);

  const y = viewDate.getFullYear();
  const m = viewDate.getMonth();
  const prevMonth = ()=> setViewDate(new Date(y, m-1, 1));
  const nextMonth = ()=> setViewDate(new Date(y, m+1, 1));
  const prevYear  = ()=> setViewDate(new Date(y-1, m, 1));
  const nextYear  = ()=> setViewDate(new Date(y+1, m, 1));

  /* ── selection handlers ── */
  function pickDay(day: Date){
    if(mode==="hour"){
      setHourDay(day);      // go to step 2
    } else if(mode==="day"){
      const s = new Date(day); s.setHours(0,0,0,0);
      const e = new Date(day); e.setHours(23,59,59,999);
      onChange({ startDate: s, endDate: e, timeframe:"day", hour:null });
      setOpen(false);
    } else if(mode==="week"){
      const [s, e] = weekBounds(day);
      onChange({ startDate: s, endDate: e, timeframe:"week", hour:null });
      setOpen(false); setHoverDay(null);
    }
  }

  function pickHour(h: number){
    if(!hourDay) return;
    const s = new Date(hourDay); s.setHours(h,0,0,0);
    const e = new Date(hourDay); e.setHours(h,59,59,999);
    onChange({ startDate: s, endDate: e, timeframe:"hour", hour: h });
    setOpen(false); setHourDay(null);
  }

  function pickMonth(mi: number){
    const s = new Date(y, mi, 1, 0,0,0,0);
    const e = new Date(y, mi+1, 0, 23,59,59,999);
    onChange({ startDate: s, endDate: e, timeframe:"month", hour:null });
    setOpen(false);
  }

  /* ── label ── */
  function label(){
    if(!startDate) return "Select Period";
    const fmt = (d: Date)=> d.toLocaleDateString("en-US",{month:"short",day:"numeric"});
    if(timeframe==="hour" && hour!==null && hour!==undefined)
      return `${fmt(startDate)}, ${String(hour).padStart(2,"0")}:00`;
    if(timeframe==="day")   return fmt(startDate);
    if(timeframe==="week"){
      if(!endDate) return fmt(startDate);
      return startDate.getMonth()===endDate.getMonth()
        ? `${fmt(startDate)} – ${endDate.getDate()}`
        : `${fmt(startDate)} – ${fmt(endDate)}`;
    }
    if(timeframe==="month")
      return startDate.toLocaleDateString("en-US",{month:"long",year:"numeric"});
    return "Select Period";
  }

  const TABS: {label:string; key:TimeframeMode}[] = [
    {label:"Hour", key:"hour"},
    {label:"Day",  key:"day"},
    {label:"Week", key:"week"},
    {label:"Month",key:"month"},
  ];

  return (
    <div className="relative">
      {/* trigger */}
      <div
        ref={trigRef}
        onClick={()=>{ setOpen(!open); setHourDay(null); }}
        className="px-3 py-1 rounded-full bg-blue-50 text-blue-600 text-[10px] font-bold border border-blue-100 flex items-center gap-1.5 cursor-pointer hover:bg-blue-100 transition-colors whitespace-nowrap"
      >
        <Calendar size={10}/>
        {label()}
      </div>

      {open && typeof document !== "undefined" && createPortal(
        <div
          ref={ref}
          style={{ position: "fixed", top: dropPos.top, left: dropPos.left, zIndex: 9999 }}
          className="bg-white border border-blue-100 rounded-2xl shadow-xl p-4 w-[280px] select-none">

          {/* mode tabs */}
          <div className="flex gap-1 mb-4 bg-slate-50 rounded-xl p-1">
            {TABS.map(t=>(
              <button
                key={t.key}
                onClick={()=>{ setMode(t.key); setHourDay(null); setHoverDay(null); }}
                className={[
                  "flex-1 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all",
                  mode===t.key ? "bg-blue-600 text-white shadow-sm" : "text-slate-400 hover:text-blue-600",
                ].join(" ")}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* ── MONTH mode ── */}
          {mode==="month" && (
            <>
              <div className="flex items-center justify-between mb-3">
                <button onClick={prevYear} className="p-1.5 rounded-lg hover:bg-blue-50 text-slate-400 hover:text-blue-600 transition-colors"><ChevronLeft size={13}/></button>
                <span className="text-[11px] font-black text-blue-950 uppercase tracking-widest">{y}</span>
                <button onClick={nextYear} className="p-1.5 rounded-lg hover:bg-blue-50 text-slate-400 hover:text-blue-600 transition-colors"><ChevronRight size={13}/></button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {MONTHS_SHORT.map((mn,i)=>{
                  const sel = !!startDate && startDate.getFullYear()===y && startDate.getMonth()===i && timeframe==="month";
                  return (
                    <button key={mn} onClick={()=>pickMonth(i)}
                      className={["py-2.5 rounded-xl text-[11px] font-bold transition-all",
                        sel ? "bg-blue-600 text-white shadow-sm" : "text-slate-600 hover:bg-blue-50 hover:text-blue-600 border border-slate-100",
                      ].join(" ")}>
                      {mn}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {/* ── WEEK mode ── */}
          {mode==="week" && (
            <CalendarGrid
              year={y} month={m} mode="week"
              startDate={startDate} endDate={endDate} hoverDay={hoverDay}
              onPrev={prevMonth} onNext={nextMonth}
              onDay={pickDay}
              onHover={setHoverDay} onLeave={()=>setHoverDay(null)}
            />
          )}

          {/* ── DAY mode ── */}
          {mode==="day" && (
            <CalendarGrid
              year={y} month={m} mode="day"
              startDate={startDate} endDate={endDate} hoverDay={null}
              onPrev={prevMonth} onNext={nextMonth}
              onDay={pickDay}
            />
          )}

          {/* ── HOUR mode – step 1: pick a day ── */}
          {mode==="hour" && !hourDay && (
            <>
              <CalendarGrid
                year={y} month={m} mode="day"
                startDate={startDate} endDate={endDate} hoverDay={null}
                onPrev={prevMonth} onNext={nextMonth}
                onDay={pickDay}
              />
              <p className="mt-2 text-center text-[9px] font-bold text-slate-400 uppercase tracking-wider">
                Step 1 — pick a day
              </p>
            </>
          )}

          {/* ── HOUR mode – step 2: pick an hour ── */}
          {mode==="hour" && hourDay && (
            <>
              <div className="flex items-center gap-2 mb-3">
                <button onClick={()=>setHourDay(null)}
                  className="p-1.5 rounded-lg hover:bg-blue-50 text-slate-400 hover:text-blue-600 transition-colors">
                  <ArrowLeft size={13}/>
                </button>
                <span className="flex-1 text-center text-[11px] font-black text-blue-950 uppercase tracking-widest">
                  {hourDay.toLocaleDateString("en-US",{month:"short",day:"numeric"})}
                </span>
                <Clock size={13} className="text-slate-300"/>
              </div>
              <div className="grid grid-cols-4 gap-1.5 max-h-52 overflow-y-auto pr-0.5">
                {Array.from({length:24},(_,h)=>{
                  const sel = !!startDate && isSameDay(startDate, hourDay) && hour===h && timeframe==="hour";
                  return (
                    <button key={h} onClick={()=>pickHour(h)}
                      className={["py-2 rounded-xl text-[10px] font-bold transition-all",
                        sel ? "bg-blue-600 text-white shadow-sm"
                            : "text-slate-600 hover:bg-blue-50 hover:text-blue-600 border border-slate-100",
                      ].join(" ")}>
                      {String(h).padStart(2,"0")}:00
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-center text-[9px] font-bold text-slate-400 uppercase tracking-wider">
                Step 2 — pick an hour
              </p>
            </>
          )}

          {/* footer */}
          <div className="mt-3 pt-3 border-t border-blue-50 flex items-center justify-between">
            <span className="text-[9px] font-bold text-slate-300 uppercase tracking-wider">
              {mode==="hour" ? (hourDay?"Pick hour":"Pick day first") : `Pick a ${mode}`}
            </span>
            {startDate && (
              <button
                onClick={e=>{ e.stopPropagation(); onChange({startDate:null,endDate:null,timeframe:"week",hour:null}); setOpen(false); }}
                className="text-[9px] font-black text-slate-300 hover:text-rose-500 transition-colors uppercase tracking-wider"
              >
                Clear
              </button>
            )}
          </div>

        </div>,
        document.body
      )}
    </div>
  );
}
