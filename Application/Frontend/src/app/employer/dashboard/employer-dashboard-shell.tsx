"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  EMPLOYER_REGISTRATION_KEY,
  EMPLOYER_NOTIFICATIONS_KEY,
  EMPLOYEES_KEY,
  type Employee,
  type EmployerRegistration,
  type ReportNotification,
} from "../employer-session";
import { API_BASE_URL, COMMON_HEADERS, getEmployerAuthToken, getEmployerId } from "@/lib/api-config";
import { Check, HelpCircle, User, X } from "lucide-react";

function loadNotifications(): ReportNotification[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(EMPLOYER_NOTIFICATIONS_KEY);
    if (raw !== null) {
      const parsed = JSON.parse(raw) as ReportNotification[];
      return Array.isArray(parsed) ? parsed : [];
    }
  } catch {
    /* ignore */
  }
  const seeded: ReportNotification[] = [
    {
      id: "seed-risk-summary",
      title: "New fleet risk summary",
      message: "Weekly aggregated driver risk scores are ready to review.",
      at: new Date().toISOString(),
      read: false,
    },
  ];
  try {
    localStorage.setItem(EMPLOYER_NOTIFICATIONS_KEY, JSON.stringify(seeded));
  } catch {
    /* ignore */
  }
  return seeded;
}

function saveNotifications(items: ReportNotification[]) {
  try {
    localStorage.setItem(EMPLOYER_NOTIFICATIONS_KEY, JSON.stringify(items));
  } catch {
    /* ignore */
  }
}

function parseRegistration(): EmployerRegistration | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(EMPLOYER_REGISTRATION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as EmployerRegistration;
  } catch {
    /* ignore */
  }
  return null;
}

/* ── Driver response notification ── */
interface DriverResponse {
  id: string;
  driver_name: string;
  driver_email: string;
  status: "accepted" | "rejected";
  responded_at: string;
  // full profile fields (populated when accepted)
  national_id?: string;
  phone_number?: string;
  license_expiration_date?: string;
  role?: string;
  safety_score?: number;
  trips?: number;
  incidents?: number;
}

function saveEmployeesLocal(items: Employee[]) {
  try { localStorage.setItem(EMPLOYEES_KEY, JSON.stringify(items)); } catch { /**/ }
}
function loadEmployeesLocal(): Employee[] {
  try {
    const raw = localStorage.getItem(EMPLOYEES_KEY);
    if (raw) { const p = JSON.parse(raw); return Array.isArray(p) ? p : []; }
  } catch { /**/ }
  return [];
}

function DriverResponsesPanel() {
  const [open, setOpen] = useState(false);
  const [responses, setResponses] = useState<DriverResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const wrapRef = useRef<HTMLDivElement>(null);

  /* fetch on open */
  useEffect(() => {
    if (!open) return;
    async function fetchResponses() {
      setLoading(true);
      try {
        const token = getEmployerAuthToken();
        const employerId = getEmployerId();
        const url = `${API_BASE_URL}/api/v1/employment/employer/responses${employerId ? `?employer_id=${employerId}` : ""}`;
        const res = await fetch(url, {
          headers: { "Authorization": token ? `Bearer ${token}` : "", ...COMMON_HEADERS },
        });
        if (!res.ok) throw new Error(`${res.status}`);
        const data = await res.json();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const list: DriverResponse[] = (Array.isArray(data) ? data : data.responses || data.data || []).map((r: any) => ({
          id: r.id ?? r.request_id ?? String(Math.random()),
          driver_name: r.driver_name ?? r.name ?? r.driver_email ?? "Unknown Driver",
          driver_email: r.driver_email ?? r.email ?? "",
          status: r.status === "accepted" ? "accepted" : "rejected",
          responded_at: r.responded_at ?? r.updated_at ?? new Date().toISOString(),
          national_id: r.national_id,
          phone_number: r.phone_number,
          license_expiration_date: r.license_expiration_date,
          role: r.role ?? "Driver",
          safety_score: r.safety_score ?? 100,
          trips: r.trips ?? 0,
          incidents: r.incidents ?? 0,
        }));
        setResponses(list);

        /* Auto-add accepted drivers to fleet directory */
        const accepted = list.filter(r => r.status === "accepted");
        if (accepted.length > 0) {
          const existing = loadEmployeesLocal();
          const existingIds = new Set(existing.map(e => e.email));
          const toAdd: Employee[] = accepted
            .filter(r => !existingIds.has(r.driver_email))
            .map(r => ({
              id: `driver-${r.id}`,
              email: r.driver_email,
              nationalId: r.national_id ?? "",
              name: r.driver_name,
              phoneNumber: r.phone_number ?? "",
              licenseExpiration: r.license_expiration_date ?? "",
              role: r.role ?? "Driver",
              safetyScore: r.safety_score ?? 100,
              trips: r.trips ?? 0,
              incidents: r.incidents ?? 0,
              lastActive: r.responded_at,
            }));
          if (toAdd.length > 0) saveEmployeesLocal([...existing, ...toAdd]);
        }
      } catch {
        /* Mock data for testing */
        setResponses([
          { id: "m1", driver_name: "Ahmed Al-Rashid",  driver_email: "ahmed@example.com",  status: "accepted", responded_at: new Date().toISOString(),                    national_id: "29402158801234", phone_number: "01012345678", license_expiration_date: "2027-06-01", role: "Driver", safety_score: 94, trips: 0, incidents: 0 },
          { id: "m2", driver_name: "Sara Mansour",      driver_email: "sara@example.com",   status: "rejected", responded_at: new Date(Date.now()-3600000).toISOString() },
        ]);
      } finally {
        setLoading(false);
      }
    }
    fetchResponses();
  }, [open]);

  /* close on outside click */
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const unseen = responses.filter(r => !seen.has(r.id));

  function handleOpen() {
    setOpen(o => !o);
    if (!open) setSeen(new Set(responses.map(r => r.id)));
  }

  return (
    <div className="relative" ref={wrapRef}>
      <button
        onClick={handleOpen}
        className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-blue-200/90 bg-white text-blue-900 transition hover:border-blue-400 hover:bg-blue-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50"
        aria-label="Driver responses"
      >
        <Building2 size={18} />
        {unseen.length > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-black text-white">
            {unseen.length > 9 ? "9+" : unseen.length}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-blue-100 bg-white shadow-2xl shadow-blue-900/10 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
          {/* header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-blue-50">
            <div>
              <p className="text-sm font-black text-blue-950 tracking-tight">Driver Responses</p>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">{responses.length} response{responses.length !== 1 ? "s" : ""}</p>
            </div>
            <button onClick={() => setOpen(false)} className="text-slate-300 hover:text-slate-500 transition"><X size={16} /></button>
          </div>

          <ul className="max-h-80 overflow-y-auto divide-y divide-blue-50/60">
            {loading && (
              <li className="px-5 py-8 text-center">
                <div className="w-5 h-5 rounded-full border-2 border-blue-500 border-t-transparent animate-spin mx-auto" />
                <p className="text-[11px] text-slate-400 font-bold mt-3 uppercase tracking-widest">Loading responses…</p>
              </li>
            )}
            {!loading && responses.length === 0 && (
              <li className="px-5 py-10 text-center">
                <Bell size={28} className="mx-auto text-slate-200 mb-3" />
                <p className="text-sm font-bold text-slate-400">No driver responses yet</p>
              </li>
            )}
            {!loading && responses.map(r => {
              const date = new Date(r.responded_at);
              const dateStr = date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
              const timeStr = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
              const accepted = r.status === "accepted";
              return (
                <li key={r.id} className="px-5 py-4">
                  <div className="flex items-start gap-3">
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
                      accepted ? "bg-emerald-50" : "bg-rose-50"
                    }`}>
                      {accepted
                        ? <UserCheck size={16} className="text-emerald-500" />
                        : <UserX    size={16} className="text-rose-400" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-black text-blue-950 truncate">{r.driver_name}</p>
                        <span className={`shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider ${
                          accepted ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-500"
                        }`}>
                          {accepted ? <Check size={9} strokeWidth={3} /> : <X size={9} strokeWidth={3} />}
                          {accepted ? "Accepted" : "Declined"}
                        </span>
                      </div>
                      <p className="text-[10px] text-slate-400 font-bold mt-0.5 truncate">{r.driver_email}</p>
                      <p className="text-[10px] font-bold text-slate-300 mt-0.5 uppercase tracking-wider">{dateStr} · {timeStr}</p>
                      {accepted && (
                        <p className="text-[10px] font-black text-emerald-600 mt-1.5">
                          ✓ Added to Fleet Directory
                        </p>
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

// Lucide icons used directly in the component

function SupportModal({ isOpen, onClose, initialCompany }: { isOpen: boolean; onClose: () => void; initialCompany: string }) {
  const [company, setCompany] = useState(initialCompany);
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
        body: JSON.stringify({ company, issue, type: "Employer" }),
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
              placeholder="Enter company name"
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

export function EmployerDashboardShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [registration, setRegistration] = useState<EmployerRegistration | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const accountWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRegistration(parseRegistration());
  }, []);




  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      const t = e.target as Node;
      if (accountWrapRef.current && !accountWrapRef.current.contains(t)) {
        setAccountOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, []);

  function logout() {
    try {
      sessionStorage.removeItem(EMPLOYER_REGISTRATION_KEY);
    } catch {
      /* ignore */
    }
    setAccountOpen(false);
    router.push("/employer");
  }

  const accountLabel = registration
    ? registration.kind === "enterprise"
      ? registration.companyName
      : registration.employerName
    : "Employer Account";

  const accountEmail = registration
    ? registration.kind === "enterprise"
      ? registration.companyEmail
      : registration.email || ""
    : "";

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <nav className="sticky top-0 z-40 border-b border-blue-200/90 bg-white/85 px-4 py-3 backdrop-blur-md sm:px-6">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-6">
            <Link
              href="/"
              className="font-display text-lg tracking-tight text-blue-950 transition hover:text-blue-800"
            >
              DARAS
            </Link>
            <div className="flex flex-wrap items-center gap-1">
              <Link
                href="/employer/dashboard"
                className={`rounded-lg px-2.5 py-1.5 text-xs font-medium sm:px-3 sm:py-2 sm:text-sm ${
                  pathname === "/employer/dashboard"
                    ? "bg-blue-100 text-blue-900 ring-1 ring-blue-200/90"
                    : "text-blue-600 hover:bg-blue-50 hover:text-blue-900"
                }`}
              >
                Dashboard
              </Link>
              <Link
                href="/employer/dashboard/reports"
                className={`rounded-lg px-2.5 py-1.5 text-xs font-medium sm:px-3 sm:py-2 sm:text-sm transition ${
                  pathname === "/employer/dashboard/reports"
                    ? "bg-blue-100 text-blue-900 ring-1 ring-blue-200/90"
                    : "text-blue-600 hover:bg-blue-50 hover:text-blue-900"
                }`}
              >
                Reports
              </Link>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={() => setSupportOpen(true)}
              className="flex h-10 items-center gap-2 rounded-xl border border-blue-200/90 bg-white px-3 text-blue-900 transition hover:border-blue-400 hover:bg-blue-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50"
              title="Contact Support"
            >
              <HelpCircle size={18} />
              <span className="hidden text-xs font-bold uppercase tracking-wider sm:inline">Support</span>
            </button>

            <div className="relative" ref={accountWrapRef}>
              <button
                type="button"
                onClick={() => setAccountOpen((o) => !o)}
                className="flex h-10 w-10 items-center justify-center rounded-xl border border-blue-200/90 bg-white text-blue-900 transition hover:border-blue-400 hover:bg-blue-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50"
                aria-expanded={accountOpen}
                aria-haspopup="dialog"
                aria-label="Account menu"
              >
                <User size={18} />
              </button>
              {accountOpen ? (
                <div
                  className="absolute right-0 z-50 mt-2 w-[min(20rem,calc(100vw-2rem))] rounded-xl border border-blue-200/90 bg-white p-4 shadow-[var(--shadow-soft)]"
                  role="dialog"
                  aria-label="Account"
                >
                  <p className="text-[11px] font-medium uppercase tracking-wider text-blue-600">Account</p>
                  <p className="mt-1 font-display text-lg text-blue-950">{accountLabel}</p>
                  {accountEmail ? (
                    <p className="mt-1 break-all text-sm text-blue-700">{accountEmail}</p>
                  ) : (
                    <p className="mt-1 text-sm text-blue-600">Email not on file</p>
                  )}
                  <div className="mt-4 border-t border-blue-200/80 pt-4">
                    <button
                      type="button"
                      onClick={logout}
                      className="w-full rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 text-sm font-medium text-blue-900 transition hover:border-red-300 hover:bg-red-50 hover:text-red-800"
                    >
                      Log out
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </nav>

      {children}
      
      <SupportModal 
        isOpen={supportOpen} 
        onClose={() => setSupportOpen(false)} 
        initialCompany={accountLabel}
      />
    </div>
  );
}
