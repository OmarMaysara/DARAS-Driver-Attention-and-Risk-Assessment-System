"use client";

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, ShieldCheck, Loader2, AlertCircle, Camera } from "lucide-react";
import { FloatingNav } from "../../../components/floating-nav";
import { NeuralNetCanvas } from "../../../components/neural-net-canvas";
import { API_ENDPOINTS, COMMON_HEADERS, getDriverAuthToken } from "@/lib/api-config";

type Point = { x: number; y: number };
type Step = "marking" | "bbox" | "dimensions";

interface BBox {
  id: string;
  x1: number;  // absolute pixels
  y1: number;
  x2: number;
  y2: number;
  label?: string;
}

/* ── Step indicator ── */
function StepBar({ step }: { step: Step }) {
  const steps: { key: Step; label: string }[] = [
    { key: "marking",    label: "Road Marking" },
    { key: "bbox",       label: "Select Car" },
    { key: "dimensions", label: "Attributes" },
  ];
  const idx = steps.findIndex(s => s.key === step);
  return (
    <div className="flex items-center gap-3">
      {steps.map((s, i) => (
        <div key={s.key} className="flex items-center gap-3">
          <div className={`flex items-center gap-2`}>
            <div className={`w-7 h-7 rounded-xl flex items-center justify-center text-[11px] font-black transition-all ${
              i < idx  ? "bg-emerald-50 text-emerald-600 border border-emerald-100" :
              i === idx ? "bg-blue-600 text-white shadow-lg shadow-blue-200" :
                          "bg-slate-50 text-slate-300 border border-slate-100"
            }`}>
              {i < idx ? <Check size={13} strokeWidth={3} /> : `0${i+1}`}
            </div>
            <span className={`text-[10px] font-black uppercase tracking-widest hidden sm:inline ${
              i === idx ? "text-blue-950" : i < idx ? "text-emerald-600" : "text-slate-300"
            }`}>{s.label}</span>
          </div>
          {i < steps.length - 1 && <div className="w-6 h-px bg-blue-100" />}
        </div>
      ))}
    </div>
  );
}

export default function CalibrationPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Serial is session-scoped: set by the driver in their profile panel each login
  const serialNumber = searchParams.get("device") ||
    (typeof window !== "undefined" ? sessionStorage.getItem("daras_device_serial") || "" : "");

  const [step, setStep] = useState<Step>("marking");

  /* ── snapshot flow state ── */
  type SnapState = "idle" | "requesting" | "polling" | "ready" | "error";
  const [snapState, setSnapState]   = useState<SnapState>("idle");
  const [snapError, setSnapError]   = useState<string | null>(null);
  const [pollCount, setPollCount]   = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* ── backend data ── */
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [bboxes, setBboxes]     = useState<BBox[]>([]);
  // natural pixel dimensions of the snapshot image — used to convert bbox px → %
  const [imgDims, setImgDims]   = useState({ w: 640, h: 480 });

  /* ── road marking ── */
  const [points, setPoints] = useState<Point[]>([
    { x: 45, y: 55 }, { x: 55, y: 55 },
    { x: 80, y: 88 }, { x: 20, y: 88 },
  ]);
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  /* ── bbox selection ── */
  const [selectedCar, setSelectedCar] = useState<string | null>(null);

  /* ── dimensions ── */
  const [dims, setDims] = useState({ height: "1.2", distance: "5.0" });
  const [submitting, setSubmitting] = useState(false);

  /* ── STEP 1: POST snapshot request, then poll for image ── */
  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  async function requestSnapshot() {
    setSnapState("requesting");
    setSnapError(null);
    setPollCount(0);
    try {
      const token = getDriverAuthToken();

      // TODO: replace "string" with real serial number from UI input
      const res = await fetch(API_ENDPOINTS.CALIB_SNAPSHOT_REQUEST, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": token ? `Bearer ${token}` : "", ...COMMON_HEADERS },
        body: JSON.stringify({ serial_number: serialNumber }),
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);

      // Start polling
      setSnapState("polling");
      pollRef.current = setInterval(async () => {
        try {
          const pollRes = await fetch(API_ENDPOINTS.CALIB_SNAPSHOT_POLL(serialNumber || "unknown"), {
            headers: { "Authorization": token ? `Bearer ${token}` : "", ...COMMON_HEADERS },
          });

          if (pollRes.status === 202 || pollRes.status === 404 || pollRes.status === 425) {
            // Still waiting for the device to send the image (425 = Too Early)
            setPollCount(c => c + 1);
            return;
          }

          if (!pollRes.ok) throw new Error(`Poll failed (${pollRes.status})`);

          const data = await pollRes.json();
          const rawUrl = data.snapshot_base64 || data.image_url || data.image || data.url || null;
          if (!rawUrl) { setPollCount(c => c + 1); return; } // no image yet
          
          let url = rawUrl;
          if (data.snapshot_base64 && !url.startsWith("data:image")) {
            url = `data:image/jpeg;base64,${url}`;
          }

          stopPolling();

          // Parse bounding boxes — API returns {x1,y1,x2,y2} in absolute pixels under "detections"
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const raw = data.detections || data.bounding_boxes || data.boxes || [];
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const boxes: BBox[] = raw.map((b: any, i: number) => ({
            id: b.id ?? `box-${i}`,
            x1: b.x1 ?? 0,
            y1: b.y1 ?? 0,
            x2: b.x2 ?? 0,
            y2: b.y2 ?? 0,
            label: b.label ?? b.class ?? `Vehicle ${i + 1}`,
          }));
          setImageUrl(url);
          setBboxes(boxes);
          setSnapState("ready");
        } catch (err) {
          stopPolling();
          setSnapError(err instanceof Error ? err.message : "Polling failed");
          setSnapState("error");
        }
      }, 2000);

    } catch (err) {
      setSnapError(err instanceof Error ? err.message : "Snapshot request failed");
      setSnapState("error");
    }
  }

  // Cleanup polling on unmount
  useEffect(() => () => stopPolling(), [stopPolling]);


  /* ── pixel coords for display ── */
  const pixelCoords = useMemo(() =>
    points.map(p => ({ x: Math.round((p.x / 100) * imgDims.w), y: Math.round((p.y / 100) * imgDims.h) })),
    [points, imgDims]
  );

  /* ── drag handlers ── */
  const handlePointerMove = (e: React.PointerEvent) => {
    if (activeIdx === null || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const newX = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
    const newY = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));

    setPoints(prev => {
      const next = [...prev];
      next[activeIdx] = { x: newX, y: newY };

      // Nodes 0 & 1 form the horizon — keep them on the same Y at all times
      if (activeIdx === 0) next[1] = { ...next[1], y: newY };
      if (activeIdx === 1) next[0] = { ...next[0], y: newY };

      return next;
    });
  };

  /* ── submit ── */
  async function handleSubmit() {
    setSubmitting(true);
    try {
      const token = getDriverAuthToken();

      // Build the selected_bbox — round floats to ints to match the API schema
      let selected_bbox = { x1: 0, y1: 0, x2: 0, y2: 0 };
      const selectedBox = bboxes.find(b => b.id === selectedCar);
      if (selectedBox) {
        selected_bbox = {
          x1: Math.round(selectedBox.x1),
          y1: Math.round(selectedBox.y1),
          x2: Math.round(selectedBox.x2),
          y2: Math.round(selectedBox.y2),
        };
      }

      // Payload matches /calibration/save schema exactly
      // TODO: replace "string" with real serial number from UI input
      const payload = {
        serial_number: serialNumber,
        calibration: {
          mounting_height: parseFloat(dims.height),
          focal_distance:  parseFloat(dims.distance),
          ego_lane_nodes:  pixelCoords,   // [{x, y}, ...] — 4 integer-coord points
          selected_bbox,
        },
      };

      const res = await fetch(API_ENDPOINTS.CALIB_SUBMIT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": token ? `Bearer ${token}` : "",
          ...COMMON_HEADERS,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Server ${res.status}`);
      }
      router.push("/driver/dashboard");
    } catch (err) {
      alert(`Calibration failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSubmitting(false);
    }
  }

  const polyStr = points.map(p => `${p.x},${p.y}`).join(" ");

  /* ── STEP 1: "Get Photo" screen ── */
  if (snapState !== "ready") {
    return (
      <div className="relative flex min-h-screen flex-col overflow-hidden bg-white">
        <NeuralNetCanvas />
        <FloatingNav showLogo={true} />
        <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-4 pt-32 pb-20">
          <div className="w-full max-w-lg animate-in fade-in slide-in-from-bottom-4 duration-700">

            {/* Step header */}
            <div className="text-center mb-12">
              <p className="text-[10px] font-black uppercase tracking-[0.4em] text-blue-600/70 mb-3">Spatial Intelligence Config</p>
              <h1 className="text-4xl font-black text-blue-950 tracking-tight italic">Device Calibration</h1>
              <div className="mt-4 flex items-center justify-center gap-4">
                <div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-widest text-blue-600">
                  <div className="w-2 h-2 rounded-full bg-blue-600 animate-pulse" /> Step 1: Capture
                </div>
                <div className="w-6 h-px bg-blue-100" />
                <div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-widest text-slate-300">
                  <div className="w-2 h-2 rounded-full bg-slate-200" /> Step 2: Select Car
                </div>
                <div className="w-6 h-px bg-blue-100" />
                <div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-widest text-slate-300">
                  <div className="w-2 h-2 rounded-full bg-slate-200" /> Step 3: Attributes
                </div>
              </div>
            </div>

            {/* Card */}
            <div className="bg-white rounded-[2.5rem] border border-blue-100 shadow-2xl shadow-blue-900/5 p-10 text-center">

              {snapState === "idle" && (
                <>
                  <div className="w-20 h-20 rounded-3xl bg-blue-50 flex items-center justify-center mx-auto mb-8">
                    <Camera size={36} className="text-blue-500" />
                  </div>
                  <h2 className="text-xl font-black text-blue-950 mb-3 tracking-tight">Request Calibration Frame</h2>
                  <p className="text-sm text-slate-400 font-bold mb-8 leading-relaxed">
                    Press the button below to signal your DARAS device to capture a road snapshot.
                    {serialNumber && <span className="block mt-2 text-[11px] text-blue-400 uppercase tracking-widest">Device: {serialNumber}</span>}
                  </p>
                  <button
                    onClick={requestSnapshot}
                    className="w-full py-5 rounded-2xl bg-blue-600 text-white font-black uppercase text-xs tracking-[0.25em] hover:bg-blue-700 active:scale-95 transition-all shadow-xl shadow-blue-200 flex items-center justify-center gap-3">
                    <Camera size={18} /> Get Photo
                  </button>
                </>
              )}

              {snapState === "requesting" && (
                <>
                  <Loader2 size={48} className="text-blue-500 animate-spin mx-auto mb-6" />
                  <h2 className="text-lg font-black text-blue-950 mb-2">Sending Request…</h2>
                  <p className="text-sm text-slate-400 font-bold">Signalling device to capture a frame.</p>
                </>
              )}

              {snapState === "polling" && (
                <>
                  <div className="relative w-20 h-20 mx-auto mb-8">
                    <div className="absolute inset-0 rounded-full border-4 border-blue-100" />
                    <div className="absolute inset-0 rounded-full border-4 border-blue-500 border-t-transparent animate-spin" />
                    <Camera size={24} className="absolute inset-0 m-auto text-blue-400" />
                  </div>
                  <h2 className="text-lg font-black text-blue-950 mb-2">Waiting for Snapshot…</h2>
                  <p className="text-sm text-slate-400 font-bold mb-4">The device is capturing the frame. Please wait.</p>
                  <div className="flex items-center justify-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                    <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                    <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: "300ms" }} />
                  </div>
                  <p className="text-[10px] text-slate-300 font-bold mt-4 uppercase tracking-widest">Poll #{pollCount + 1}</p>
                </>
              )}

              {snapState === "error" && (
                <>
                  <AlertCircle size={48} className="text-rose-400 mx-auto mb-6" />
                  <h2 className="text-lg font-black text-blue-950 mb-2">Snapshot Failed</h2>
                  <p className="text-sm text-slate-400 font-bold mb-8">{snapError}</p>
                  <div className="flex gap-3">
                    <button onClick={() => router.push("/driver/dashboard")}
                      className="flex-1 py-4 rounded-2xl border border-blue-100 text-blue-600 text-xs font-black uppercase tracking-wider hover:bg-blue-50 transition-all">
                      Back
                    </button>
                    <button onClick={() => { setSnapState("idle"); setSnapError(null); }}
                      className="flex-1 py-4 rounded-2xl bg-blue-600 text-white text-xs font-black uppercase tracking-wider hover:bg-blue-700 transition-all shadow-lg shadow-blue-200">
                      Retry
                    </button>
                  </div>
                </>
              )}

            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen flex-col bg-slate-50/50">
      <NeuralNetCanvas />

      {/* ── Header ── */}
      <header className="fixed top-0 left-0 right-0 z-[60] bg-white/80 backdrop-blur-xl border-b border-blue-100 px-4 sm:px-8 py-4 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-4 sm:gap-8">
          <Link href="/driver/dashboard"
            className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 hover:text-blue-600 transition-colors flex items-center gap-2 group">
            <ArrowLeft size={14} className="group-hover:-translate-x-1 transition-transform" />
            <span className="hidden sm:inline">Back to Hub</span>
          </Link>
          <div className="h-4 w-px bg-blue-100" />
          <StepBar step={step} />
        </div>
        <button onClick={() => { setStep("marking"); setSelectedCar(null); }}
          className="px-3 sm:px-5 py-2 bg-slate-50 hover:bg-blue-50 text-[9px] font-black uppercase tracking-[0.15em] text-blue-600 rounded-lg transition-all border border-blue-100/50 active:scale-95">
          Restart
        </button>
      </header>

      <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-4 sm:px-8 pt-28 pb-20">
        <div className="w-full max-w-5xl">

          {/* ── STEP TITLE ── */}
          <div className="mb-6 animate-in fade-in slide-in-from-top-2 duration-500">
            {step === "marking" && (
              <>
                <h1 className="text-2xl sm:text-3xl font-black text-blue-950 tracking-tight italic uppercase">
                  Ego Lane Alignment
                </h1>
                <p className="text-[11px] text-slate-400 font-bold uppercase tracking-[0.15em] mt-1">
                  Drag the 4 corner nodes to outline your active driving lane on the image below.
                </p>
              </>
            )}
            {step === "bbox" && (
              <>
                <h1 className="text-2xl sm:text-3xl font-black text-blue-950 tracking-tight italic uppercase">
                  Select Reference Vehicle
                </h1>
                <p className="text-[11px] text-slate-400 font-bold uppercase tracking-[0.15em] mt-1">
                  Tap the highlighted vehicle whose height &amp; distance you will use for calibration.
                  {selectedCar && <span className="text-emerald-500 ml-2">✓ Selected</span>}
                </p>
              </>
            )}
            {step === "dimensions" && (
              <>
                <h1 className="text-2xl sm:text-3xl font-black text-blue-950 tracking-tight italic uppercase">
                  Physical Attributes
                </h1>
                <p className="text-[11px] text-slate-400 font-bold uppercase tracking-[0.15em] mt-1">
                  Enter the measured height and distance of the selected vehicle.
                </p>
              </>
            )}
          </div>

          {/* ── IMAGE WORKSPACE (Steps 1 & 2) ── */}
          {(step === "marking" || step === "bbox") && (
            <div
              ref={containerRef}
              className="relative mx-auto rounded-[2rem] overflow-hidden border border-blue-100 shadow-2xl bg-slate-900 touch-none select-none"
              style={{ width: "640px", height: "480px", maxWidth: "100%" }}
              onPointerMove={handlePointerMove}
              onPointerUp={() => setActiveIdx(null)}
              onPointerLeave={() => setActiveIdx(null)}
            >
              {/* Base image */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {imageUrl && (
                <img
                  src={imageUrl}
                  alt="Calibration frame"
                  className="absolute inset-0 w-full h-full object-cover"
                  draggable={false}
                  onLoad={e => {
                    const img = e.currentTarget;
                    if (img.naturalWidth && img.naturalHeight) {
                      setImgDims({ w: img.naturalWidth, h: img.naturalHeight });
                    }
                  }}
                />
              )}
              {/* Dark gradient overlay */}
              <div className="absolute inset-0 bg-gradient-to-t from-blue-950/20 to-transparent pointer-events-none" />

              {/* ── STEP 1: Ego lane polygon + draggable nodes ── */}
              {step === "marking" && (
                <>
                  <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full pointer-events-none">
                    <polygon
                      points={polyStr}
                      fill="rgba(59,130,246,0.22)"
                      stroke="#3b82f6"
                      strokeWidth="0.4"
                      vectorEffect="non-scaling-stroke"
                    />
                  </svg>
                  {points.map((pt, i) => (
                    <div
                      key={i}
                      className="absolute w-10 h-10 -ml-5 -mt-5 rounded-xl bg-white border-2 border-blue-600 shadow-xl cursor-grab active:cursor-grabbing flex items-center justify-center z-30 hover:scale-110 active:scale-95 transition-transform group"
                      style={{ left: `${pt.x}%`, top: `${pt.y}%` }}
                      onPointerDown={e => { e.preventDefault(); setActiveIdx(i); }}
                    >
                      <div className="w-2.5 h-2.5 rounded-full bg-blue-600" />
                      <div className="absolute -top-9 whitespace-nowrap bg-blue-600 px-2.5 py-1 rounded-lg text-[9px] text-white font-black opacity-0 group-hover:opacity-100 transition-all pointer-events-none uppercase tracking-widest">
                        Node {i+1} · {pixelCoords[i].x}:{pixelCoords[i].y}
                      </div>
                    </div>
                  ))}
                </>
              )}

              {/* ── STEP 2: Bounding boxes for car selection ── */}
              {step === "bbox" && bboxes.map(box => {
                const isSelected = selectedCar === box.id;
                // Convert absolute pixel coords → percentages relative to image dimensions
                const left  = (box.x1 / imgDims.w) * 100;
                const top   = (box.y1 / imgDims.h) * 100;
                const width = ((box.x2 - box.x1) / imgDims.w) * 100;
                const height= ((box.y2 - box.y1) / imgDims.h) * 100;
                return (
                  <div
                    key={box.id}
                    onClick={() => setSelectedCar(box.id)}
                    className="absolute cursor-pointer transition-all duration-200 group"
                    style={{ left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%` }}
                  >
                    {/* Box border */}
                    <div className={`absolute inset-0 rounded-xl border-2 transition-all duration-200 ${
                      isSelected
                        ? "border-emerald-400 bg-emerald-400/15 shadow-[0_0_20px_rgba(52,211,153,0.4)]"
                        : "border-yellow-400 bg-yellow-400/10 group-hover:border-white group-hover:bg-white/10"
                    }`} />
                    {/* Corner accents */}
                    <div className={`absolute -top-0.5 -left-0.5 w-3 h-3 border-t-2 border-l-2 rounded-tl ${isSelected ? "border-emerald-400" : "border-yellow-400"}`} />
                    <div className={`absolute -top-0.5 -right-0.5 w-3 h-3 border-t-2 border-r-2 rounded-tr ${isSelected ? "border-emerald-400" : "border-yellow-400"}`} />
                    <div className={`absolute -bottom-0.5 -left-0.5 w-3 h-3 border-b-2 border-l-2 rounded-bl ${isSelected ? "border-emerald-400" : "border-yellow-400"}`} />
                    <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 border-b-2 border-r-2 rounded-br ${isSelected ? "border-emerald-400" : "border-yellow-400"}`} />
                    {/* Label */}
                    <div className={`absolute -top-7 left-0 px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-wider whitespace-nowrap ${
                      isSelected ? "bg-emerald-500 text-white" : "bg-yellow-400 text-slate-900"
                    }`}>
                      {isSelected ? "✓ Selected" : box.label}
                    </div>
                  </div>
                );
              })}

              {step === "bbox" && bboxes.length === 0 && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="bg-white/90 backdrop-blur-md rounded-2xl px-8 py-6 text-center border border-blue-100 shadow-lg">
                    <ShieldCheck size={32} className="mx-auto text-slate-300 mb-3" />
                    <p className="text-sm font-black text-slate-600">No vehicles detected in frame</p>
                    <p className="text-[11px] text-slate-400 mt-1">The backend returned no bounding boxes.</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── STEP 3: Dimensions form ── */}
          {step === "dimensions" && (
            <div className="w-full max-w-lg mx-auto bg-white rounded-[2.5rem] border border-blue-50 shadow-2xl shadow-blue-900/5 p-10 animate-in fade-in zoom-in-95 duration-500">
              <div className="space-y-8">
                {[
                  { key: "height",   label: "Mounting Height",  unit: "Meters (M)", step: "0.1", icon: "↕" },
                  { key: "distance", label: "Focal Distance",   unit: "Meters (M)", step: "0.5", icon: "↔" },
                ].map(field => (
                  <div key={field.key} className="space-y-3">
                    <div className="flex justify-between items-center px-1">
                      <label className="text-[10px] font-black text-blue-600 uppercase tracking-[0.2em]">{field.label}</label>
                      <span className="text-[10px] font-bold text-slate-400 italic">{field.unit}</span>
                    </div>
                    <div className="relative">
                      <input
                        type="number"
                        step={field.step}
                        value={dims[field.key as "height" | "distance"]}
                        onChange={e => setDims({ ...dims, [field.key]: e.target.value })}
                        className="w-full bg-slate-50 border border-blue-50 rounded-2xl px-6 py-5 text-xl font-black text-blue-950 outline-none focus:border-blue-500/30 focus:bg-white focus:ring-4 focus:ring-blue-500/5 transition-all"
                      />
                      <span className="absolute right-6 top-1/2 -translate-y-1/2 text-2xl text-blue-200">{field.icon}</span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-10 flex gap-4">
                <button onClick={() => setStep("bbox")}
                  className="flex-1 py-4 rounded-2xl bg-slate-50 hover:bg-blue-50 border border-blue-100 text-blue-600 font-black uppercase text-[10px] tracking-widest transition-all active:scale-95">
                  ← Edit Selection
                </button>
                <button onClick={handleSubmit} disabled={submitting}
                  className="flex-[2] py-4 rounded-2xl bg-blue-600 text-white font-black uppercase text-[10px] tracking-[0.2em] transition-all hover:bg-blue-700 active:scale-95 shadow-xl shadow-blue-200 flex items-center justify-center gap-3 disabled:opacity-60 disabled:cursor-not-allowed">
                  {submitting ? <><Loader2 size={16} className="animate-spin" /> Saving…</> : <>Finalize Config <Check size={16} strokeWidth={3} /></>}
                </button>
              </div>
            </div>
          )}

          {/* ── Navigation buttons ── */}
          {step !== "dimensions" && (
            <div className="flex justify-end mt-6 gap-3">
              {step === "marking" && (
                <button
                  onClick={() => setStep("bbox")}
                  className="px-8 py-4 bg-blue-600 text-white font-black uppercase text-xs tracking-[0.2em] rounded-2xl shadow-xl shadow-blue-200 transition-all hover:bg-blue-700 active:scale-95 flex items-center gap-3">
                  Confirm Lane <ArrowRight size={16} strokeWidth={3} />
                </button>
              )}
              {step === "bbox" && (
                <>
                  <button onClick={() => setStep("marking")}
                    className="px-6 py-4 rounded-2xl bg-slate-50 hover:bg-blue-50 border border-blue-100 text-blue-600 font-black uppercase text-xs tracking-wider transition-all active:scale-95">
                    ← Edit Lane
                  </button>
                  <button
                    onClick={() => { if (selectedCar || bboxes.length === 0) setStep("dimensions"); }}
                    disabled={bboxes.length > 0 && !selectedCar}
                    className="px-8 py-4 bg-blue-600 text-white font-black uppercase text-xs tracking-[0.2em] rounded-2xl shadow-xl shadow-blue-200 transition-all hover:bg-blue-700 active:scale-95 flex items-center gap-3 disabled:opacity-40 disabled:cursor-not-allowed">
                    Confirm Vehicle <ArrowRight size={16} strokeWidth={3} />
                  </button>
                </>
              )}
            </div>
          )}

        </div>
      </main>
    </div>
  );
}
export default function CalibrationPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center bg-white">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
          <p className="text-[10px] font-bold text-blue-400 uppercase tracking-widest">Loading Calibration...</p>
        </div>
      </div>
    }>
      <CalibrationPageContent />
    </Suspense>
  );
}
