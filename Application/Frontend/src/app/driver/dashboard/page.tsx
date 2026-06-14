"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState, Suspense, useRef } from "react";
import Link from "next/link";
import { DriverAnalytics } from "./driver-analytics";
import { Camera, HelpCircle, User, X, Bell, Check, Building2, Play, Square, Cpu, LogOut } from "lucide-react";
import { API_BASE_URL, COMMON_HEADERS, getDriverAuthToken } from "@/lib/api-config";

/* ── Types ── */
interface EmployerRequest {
  id: string;
  company_name: string;
  requested_at: string; // ISO date string
  status: "pending" | "accepted" | "rejected";
}

/* ── Notifications Panel ── */
function RequestsPanel({ driverId }: { driverId: string }) {
  const [open, setOpen] = useState(false);
  const [requests, setRequests] = useState<EmployerRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  /* fetch on open */
  useEffect(() => {
    if (!open) return;
    async function fetchRequests() {
      setLoading(true);
      try {
        const { API_ENDPOINTS } = await import("@/lib/api-config");
        const token = getDriverAuthToken();
        const res = await fetch(API_ENDPOINTS.DRIVER_DASHBOARD_DETAILS, {
          headers: { "Authorization": token ? `Bearer ${token}` : "", ...COMMON_HEADERS },
        });
        if (!res.ok) throw new Error(`${res.status}`);
        const data = await res.json();
        
        // Extract from the new schema: data.pending_requests
        const rawRequests = data.pending_requests || data.requests || data.data || [];
        
        const list: EmployerRequest[] = rawRequests.map((r: any) => ({
          id: r.id ?? r.request_id ?? String(Math.random()),
          company_name: r.company_name ?? r.employer_name ?? r.name ?? "Unknown Company",
          requested_at: r.requested_at ?? r.created_at ?? new Date().toISOString(),
          status: r.status ?? "pending",
        }));
        setRequests(list);
      } catch {
        /* Backend not yet live – show a mock request for testing */
        setRequests([
          { id: "mock-1", company_name: "Nile Logistics Co.", requested_at: new Date().toISOString(), status: "pending" },
          { id: "mock-2", company_name: "Cairo Express Fleet", requested_at: new Date(Date.now() - 86400000).toISOString(), status: "pending" },
        ]);
      } finally {
        setLoading(false);
      }
    }
    fetchRequests();
  }, [open, driverId]);

  /* close on outside click */
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  async function handleAction(reqId: string, action: "accept" | "reject") {
    setActing(reqId);
    try {
      const { API_ENDPOINTS } = await import("@/lib/api-config");
      const token = getDriverAuthToken();
      
      const res = await fetch(API_ENDPOINTS.DRIVER_RESPOND_REQUEST(reqId), {
        method: "POST", // Note: you might need to change this to PUT/PATCH depending on the backend
        headers: { 
          "Authorization": token ? `Bearer ${token}` : "", 
          "Content-Type": "application/json",
          ...COMMON_HEADERS 
        },
        body: JSON.stringify({
          status: action === "accept" ? "Accepted" : "Rejected"
        })
      });
      
      if (!res.ok) throw new Error("Failed to update status");
      
      setRequests(prev => prev.map(r =>
        r.id === reqId ? { ...r, status: action === "accept" ? "accepted" : "rejected" } : r
      ));
    } catch { /* ignore – keep UI unchanged if it fails, or show error */ }
    setActing(null);
  }

  const pending = requests.filter(r => r.status === "pending");

  return (
    <div className="relative" ref={wrapRef}>
      <button
        onClick={() => setOpen(o => !o)}
        className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-blue-200/90 bg-white text-blue-900 transition hover:border-blue-400 hover:bg-blue-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50"
        aria-label="Employment requests"
      >
        <Bell size={18} />
        {pending.length > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-black text-white">
            {pending.length > 9 ? "9+" : pending.length}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-blue-100 bg-white shadow-2xl shadow-blue-900/10 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
          {/* header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-blue-50">
            <div>
              <p className="text-sm font-black text-blue-950 tracking-tight">Employment Requests</p>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">{pending.length} pending</p>
            </div>
            <button onClick={() => setOpen(false)} className="text-slate-300 hover:text-slate-500 transition">
              <X size={16} />
            </button>
          </div>

          {/* list */}
          <ul className="max-h-80 overflow-y-auto divide-y divide-blue-50/60">
            {loading && (
              <li className="px-5 py-8 text-center">
                <div className="w-5 h-5 rounded-full border-2 border-blue-500 border-t-transparent animate-spin mx-auto" />
                <p className="text-[11px] text-slate-400 font-bold mt-3 uppercase tracking-widest">Loading requests…</p>
              </li>
            )}
            {!loading && requests.length === 0 && (
              <li className="px-5 py-10 text-center">
                <Bell size={28} className="mx-auto text-slate-200 mb-3" />
                <p className="text-sm font-bold text-slate-400">No employment requests</p>
              </li>
            )}
            {!loading && requests.map(req => {
              const date = new Date(req.requested_at);
              const dateStr = date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
              const timeStr = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
              return (
                <li key={req.id} className="px-5 py-4">
                  <div className="flex items-start gap-3">
                    {/* company icon */}
                    <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center shrink-0 mt-0.5">
                      <Building2 size={16} className="text-blue-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-black text-blue-950 truncate">{req.company_name}</p>
                      <p className="text-[10px] font-bold text-slate-400 mt-0.5 uppercase tracking-wider">{dateStr} · {timeStr}</p>

                      {req.status === "pending" ? (
                        <div className="flex gap-2 mt-3">
                          <button
                            onClick={() => handleAction(req.id, "reject")}
                            disabled={acting === req.id}
                            className="flex-1 py-2 rounded-xl border border-rose-200 text-rose-600 text-[11px] font-black uppercase tracking-wider hover:bg-rose-50 transition-all active:scale-95 disabled:opacity-50"
                          >
                            Decline
                          </button>
                          <button
                            onClick={() => handleAction(req.id, "accept")}
                            disabled={acting === req.id}
                            className="flex-1 py-2 rounded-xl bg-blue-600 text-white text-[11px] font-black uppercase tracking-wider hover:bg-blue-700 transition-all active:scale-95 disabled:opacity-50 shadow-sm shadow-blue-200"
                          >
                            {acting === req.id ? "…" : "Accept"}
                          </button>
                        </div>
                      ) : (
                        <div className={`inline-flex items-center gap-1.5 mt-2 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${
                          req.status === "accepted"
                            ? "bg-emerald-50 text-emerald-600"
                            : "bg-rose-50 text-rose-500"
                        }`}>
                          {req.status === "accepted" ? <Check size={10} strokeWidth={3} /> : <X size={10} strokeWidth={3} />}
                          {req.status === "accepted" ? "Accepted" : "Declined"}
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function SupportModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [company, setCompany] = useState("");
  const [issue, setIssue] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isSent, setIsSent] = useState(false);

  if (!isOpen) return null;

  const handleSend = async () => {
    setIsSending(true);
    try {
      const res = await fetch("/api/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company, issue, type: "Driver" }),
      });
      if (res.ok) {
        setIsSent(true);
        setTimeout(() => {
          onClose();
          setIsSent(false);
          setIssue("");
        }, 2000);
      } else {
        alert("Failed to send email. Opening your email app instead...");
        window.location.href = `mailto:darascomp@gmail.com?subject=Support&body=${issue}`;
      }
    } catch (err) {
      console.error(err);
      window.location.href = `mailto:darascomp@gmail.com?subject=Support&body=${issue}`;
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-blue-950/20 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-md bg-white rounded-[2rem] border border-blue-100 p-8 shadow-2xl animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-black text-blue-950 tracking-tight">Support Request</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition">
            <X size={20} />
          </button>
        </div>
        
        <div className="space-y-5">
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Company Name</label>
            <input 
              type="text" 
              value={company} 
              onChange={(e) => setCompany(e.target.value)}
              placeholder="e.g. Logistics Inc."
              className="w-full px-5 py-3.5 rounded-2xl border border-blue-50 bg-blue-50/30 text-sm font-bold text-blue-950 placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition"
            />
          </div>
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Describe the Issue</label>
            <textarea 
              rows={4}
              value={issue} 
              onChange={(e) => setIssue(e.target.value)}
              placeholder="What can we help you with?"
              className="w-full px-5 py-3.5 rounded-2xl border border-blue-50 bg-blue-50/30 text-sm font-bold text-blue-950 placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition resize-none"
            />
          </div>
          
          <button 
            onClick={handleSend}
            disabled={!issue.trim() || isSending || isSent}
            className="w-full py-4 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 text-white text-xs font-black uppercase tracking-[0.15em] rounded-2xl shadow-lg shadow-blue-600/20 transition-all hover:-translate-y-0.5 active:translate-y-0"
          >
            {isSent ? "✓ Message Sent!" : isSending ? "Sending Message..." : "Send Support Request"}
          </button>
          
          <p className="text-[10px] text-center font-bold text-slate-400 uppercase tracking-tighter">
            {isSent ? "We'll get back to you shortly." : "Response usually within 2-4 hours"}
          </p>
        </div>
      </div>
    </div>
  );
}

/* ── Profile Panel ── */
function ProfilePanel({ onSerialChange }: { onSerialChange: (serial: string) => void }) {
  const [open, setOpen] = useState(false);
  const [driverInfo, setDriverInfo] = useState<any>(null);
  const [serialInput, setSerialInput] = useState("");
  const [serialSaved, setSerialSaved] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Load serial from sessionStorage (per-session) + profile from localStorage on mount
  useEffect(() => {
    // Serial is session-scoped: cleared on logout / new session
    const savedSerial = sessionStorage.getItem("daras_device_serial") || "";
    setSerialInput(savedSerial);
    if (savedSerial) onSerialChange(savedSerial);

    // Read registration profile (permanent — from localStorage)
    try {
      const raw = localStorage.getItem("daras_driver_profile");
      if (raw) {
        setDriverInfo(JSON.parse(raw));
        return;
      }
    } catch { /**/ }
    // Fallback: build minimal profile from stored email
    const email = localStorage.getItem("daras_driver_email") || "";
    if (email) setDriverInfo({ email, name: email.split("@")[0] });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* close on outside click */
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  function saveSerial() {
    const trimmed = serialInput.trim();
    // Store in sessionStorage so it expires when the session ends / driver logs out
    sessionStorage.setItem("daras_device_serial", trimmed);
    onSerialChange(trimmed);
    setSerialSaved(true);
    setTimeout(() => setSerialSaved(false), 2000);
  }

  function handleLogout() {
    localStorage.removeItem("daras_driver_token");
    localStorage.removeItem("daras_driver_profile");
    localStorage.removeItem("daras_driver_email");
    // Clear session-scoped serial so the next driver must enter their own
    sessionStorage.removeItem("daras_device_serial");
    window.location.href = "/driver";
  }

  const name = driverInfo?.name || driverInfo?.username || "Driver";
  const email = driverInfo?.email || "—";
  const nationalId = driverInfo?.national_id || driverInfo?.nationalId || "—";
  const licenseExp = driverInfo?.license_expiration_date || driverInfo?.licenseExpirationDate || "—";
  const initials = name.split(" ").map((w: string) => w[0]).slice(0, 2).join("").toUpperCase() || "D";

  return (
    <div className="relative" ref={wrapRef}>
      <button
        id="driver-profile-btn"
        onClick={() => setOpen(o => !o)}
        className="flex h-10 w-10 items-center justify-center rounded-xl border border-blue-200/90 bg-white text-blue-900 transition hover:border-blue-400 hover:bg-blue-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50"
        aria-label="Driver profile"
      >
        <User size={18} />
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-blue-100 bg-white shadow-2xl shadow-blue-900/10 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
          
          {/* Avatar + Name Header */}
          <div className="px-5 pt-5 pb-4 border-b border-blue-50 flex items-center gap-4">
            <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center text-white font-black text-base shadow-md shadow-blue-200 shrink-0">
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-black text-blue-950 truncate">{name}</p>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">{email}</p>
            </div>
            <button onClick={() => setOpen(false)} className="text-slate-300 hover:text-slate-500 transition shrink-0">
              <X size={16} />
            </button>
          </div>

          {/* Driver Details */}
          <div className="px-5 py-4 space-y-3 border-b border-blue-50">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-1">Driver Info</p>
            {[
              ["National ID", nationalId, false],
              ["License Expiry", licenseExp, false],
            ].map(([label, value]) => (
              <div key={String(label)} className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-500">{label}</span>
                <span className="text-[11px] font-black text-blue-950 font-mono">{value}</span>
              </div>
            ))}
          </div>

          {/* Device Serial Input */}
          <div className="px-5 py-4 border-b border-blue-50">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-3">Device Serial Number</p>
            <div className="flex gap-2">
              <div className="flex-1 flex items-center gap-2 px-3 py-2.5 rounded-xl border border-blue-100 bg-blue-50/40 focus-within:border-blue-400 focus-within:bg-white transition">
                <Cpu size={14} className="text-blue-400 shrink-0" />
                <input
                  id="device-serial-input"
                  type="text"
                  value={serialInput}
                  onChange={e => setSerialInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && saveSerial()}
                  placeholder="e.g. SN-20241101"
                  className="flex-1 bg-transparent text-[11px] font-bold text-blue-950 placeholder:text-slate-300 outline-none min-w-0"
                />
              </div>
              <button
                id="save-serial-btn"
                onClick={saveSerial}
                disabled={!serialInput.trim()}
                className={`px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all ${
                  serialSaved
                    ? "bg-emerald-500 text-white"
                    : "bg-blue-600 hover:bg-blue-700 text-white disabled:bg-slate-200 disabled:text-slate-400"
                }`}
              >
                {serialSaved ? "✓ Saved" : "Save"}
              </button>
            </div>
            <p className="text-[9px] font-bold text-slate-400 mt-2 uppercase tracking-wider">Session-scoped · Resets on sign out</p>
          </div>

          {/* Logout */}
          <div className="px-5 py-3">
            <button
              id="driver-logout-btn"
              onClick={handleLogout}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-wider text-rose-500 hover:bg-rose-50 transition"
            >
              <LogOut size={13} /> Sign Out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function TripButton({ serialNumber }: { serialNumber: string }) {
  const [isActive, setIsActive] = useState(false);
  const [loading, setLoading] = useState(false);

  const toggleTrip = async () => {
    setLoading(true);
    try {
      const { API_ENDPOINTS, getDriverAuthToken, COMMON_HEADERS } = await import("@/lib/api-config");
      const token = getDriverAuthToken();
      
      const endpoint = !isActive ? API_ENDPOINTS.DRIVER_START_TRIP : API_ENDPOINTS.DRIVER_END_TRIP;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Authorization": token ? `Bearer ${token}` : "",
          "Content-Type": "application/json",
          ...COMMON_HEADERS,
        },
        body: JSON.stringify({ serial_number: serialNumber }),
      });
      
      if (!res.ok) throw new Error(`Failed to ${!isActive ? "start" : "end"} trip`);
      
      setIsActive(!isActive);
    } catch (err) {
      console.error(err);
      alert("There was an issue updating your trip status. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <button 
      onClick={toggleTrip}
      disabled={loading}
      className={`flex h-10 items-center gap-2 rounded-xl px-4 text-[11px] font-black uppercase tracking-wider transition-all shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:opacity-50 ${
        isActive 
          ? "bg-rose-500 text-white hover:bg-rose-600 focus-visible:ring-rose-500 shadow-rose-200"
          : "bg-emerald-500 text-white hover:bg-emerald-600 focus-visible:ring-emerald-500 shadow-emerald-200"
      }`}
    >
      {loading ? (
        <div className="w-4 h-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
      ) : isActive ? (
        <>
          <Square size={14} className="fill-current" />
          <span className="hidden sm:inline">End Trip</span>
        </>
      ) : (
        <>
          <Play size={14} className="fill-current" />
          <span className="hidden sm:inline">Start Trip</span>
        </>
      )}
    </button>
  );
}

function DriverDashboardContent() {
  const searchParams = useSearchParams();
  const driverId = searchParams.get("driverId") || "DRV-1337";
  const [deviceSerial, setDeviceSerial] = useState(searchParams.get("device") || "");
  const [isLoading, setIsLoading] = useState(true);
  const [supportOpen, setSupportOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  void notifRef;

  // Load session-scoped serial on mount (cleared on logout)
  useEffect(() => {
    const saved = sessionStorage.getItem("daras_device_serial");
    if (saved) setDeviceSerial(saved);
  }, []);

  useEffect(() => {
    // Simulate initial data fetch
    const timer = setTimeout(() => setIsLoading(false), 800);
    return () => clearTimeout(timer);
  }, []);

  if (isLoading) {
    return (
      <div className="flex min-h-screen flex-col bg-white px-6 py-12 animate-pulse">
        <div className="mx-auto w-full max-w-7xl">
          <div className="flex items-center justify-between mb-12">
            <div className="h-8 w-48 bg-blue-100 rounded-xl" />
            <div className="h-10 w-10 rounded-xl bg-blue-100" />
          </div>
          <div className="h-80 rounded-[2rem] bg-slate-50 border border-blue-50 mb-8" />
          <div className="grid gap-8 grid-cols-1 md:grid-cols-3">
            <div className="h-64 rounded-[2rem] bg-slate-50 border border-blue-50 shadow-sm" />
            <div className="h-64 rounded-[2rem] bg-slate-50 border border-blue-50 shadow-sm" />
            <div className="h-64 rounded-[2rem] bg-slate-50 border border-blue-50 shadow-sm" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-white text-blue-950 font-sans">
      {/* Header */}
      <nav className="sticky top-0 z-50 border-b border-blue-200/90 bg-white/85 px-4 py-3 backdrop-blur-md sm:px-6">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <Link href="/" className="font-display text-lg tracking-tight text-blue-950 transition hover:text-blue-800">DARAS</Link>
            <div className="h-6 w-px bg-blue-100" />
            <span className="text-[10px] font-bold text-blue-600 uppercase tracking-widest">Driver Portal</span>
          </div>
          
          <div className="flex items-center gap-2">
            <TripButton serialNumber={deviceSerial} />
            
            <Link href="/driver/dashboard/calibration" className="flex h-10 items-center gap-2 rounded-xl border border-blue-200/90 bg-white px-3 text-blue-900 transition hover:border-blue-400 hover:bg-blue-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50">
              <Camera size={18} />
              <span className="hidden text-xs font-bold uppercase tracking-wider sm:inline">Calibrate</span>
            </Link>
            
            <RequestsPanel driverId={driverId} />

            <button 
              onClick={() => setSupportOpen(true)}
              className="flex h-10 items-center gap-2 rounded-xl border border-blue-200/90 bg-white px-3 text-blue-900 transition hover:border-blue-400 hover:bg-blue-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50"
            >
              <HelpCircle size={18} />
              <span className="hidden text-xs font-bold uppercase tracking-wider sm:inline">Support</span>
            </button>

            <div className="h-10 w-px bg-blue-100 mx-2" />

            <ProfilePanel onSerialChange={setDeviceSerial} />
          </div>
        </div>
      </nav>

      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col px-6 py-12 animate-in fade-in slide-in-from-bottom-4 duration-700">
        {/* Detailed Analytics Integration */}
        <DriverAnalytics driverId={driverId} deviceSerial={deviceSerial} />
      </main>

      <footer className="py-12 text-center text-[10px] font-bold uppercase tracking-[0.45em] text-blue-200">
        © 2026 DARAS INTELLIGENCE · SECURE DRIVER ENVIRONMENT
      </footer>

      <SupportModal isOpen={supportOpen} onClose={() => setSupportOpen(false)} />
    </div>
  );
}

export default function DriverDashboardPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center bg-[#f8fbff]">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
          <p className="text-[10px] font-bold text-blue-400 uppercase tracking-widest">Synchronizing Safety Portal...</p>
        </div>
      </div>
    }>
      <DriverDashboardContent />
    </Suspense>
  );
}

