"use client";

import { useEffect, useRef, useState } from "react";
import { PlusCircle, Trash2, Trophy } from "lucide-react";
import { createPortal } from "react-dom";
import { EMPLOYEES_KEY, EMPLOYER_REGISTRATION_KEY, type Employee, type EmployerRegistration } from "../employer-session";
import { DriverAnalysisModal } from "./driver-analysis-modal";
import { API_ENDPOINTS, COMMON_HEADERS, getEmployerAuthToken, getEmployerId } from "@/lib/api-config";


/* ---- helpers ---- */
function loadEmployees(): Employee[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(EMPLOYEES_KEY);
    if (raw !== null) {
      const parsed = JSON.parse(raw) as Employee[];
      return Array.isArray(parsed) ? parsed : [];
    }
  } catch {
    /* ignore */
  }
  return [];
}

function saveEmployees(items: Employee[]) {
  try {
    localStorage.setItem(EMPLOYEES_KEY, JSON.stringify(items));
  } catch {
    /* ignore */
  }
}


/* ---- Fixed score color tiers (blue shades) ---- */
function scoreColor(score: number): { bar: string; badge: string; text: string; label: string } {
  if (score >= 85) return { bar: "#1d4ed8", badge: "rgba(29,78,216,0.12)",  text: "#1e3a8a", label: "Excellent" };
  if (score >= 70) return { bar: "#2563eb", badge: "rgba(37,99,235,0.12)",  text: "#1d4ed8", label: "Good" };
  if (score >= 55) return { bar: "#3b82f6", badge: "rgba(59,130,246,0.12)", text: "#1d4ed8", label: "Fair" };
  if (score >= 40) return { bar: "#60a5fa", badge: "rgba(96,165,250,0.12)", text: "#2563eb", label: "At Risk" };
  return              { bar: "#93c5fd", badge: "rgba(147,197,253,0.12)", text: "#3b82f6", label: "Critical" };
}

const EMPTY_FORM = {

  email: "",
};

type FormState = typeof EMPTY_FORM;

function AddEmployeeModal({
  onClose,
}: {
  onClose: () => void;
}) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<Partial<FormState>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [invited, setInvited] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    emailRef.current?.focus();
  }, []);

  function validate(): boolean {
    const errs: Partial<FormState> = {};
    const email = form.email.trim();
    if (!email) {
      errs.email = "Email is required";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errs.email = "Please enter a valid email address";
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate() || isSubmitting) return;

    setIsSubmitting(true);
    const email = form.email.trim();

    try {
      const token = getEmployerAuthToken();
      let employerId = 999999;
      try {
        const rawReg = sessionStorage.getItem(EMPLOYER_REGISTRATION_KEY);
        if (rawReg) {
          const reg = JSON.parse(rawReg) as EmployerRegistration;
          if (reg.id) employerId = reg.id;
        }
      } catch { /* use fallback */ }

      const response = await fetch(API_ENDPOINTS.ADD_EMPLOYEE, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": token ? `Bearer ${token}` : "",
          "ngrok-skip-browser-warning": "true",
          "Accept": "application/json",
        },
        body: JSON.stringify({ driver_email: email, employer_id: employerId }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`Server returned ${response.status}: ${JSON.stringify(errorData)}`);
      }

      setInvited(true);
    } catch (err) {
      console.error("Invite Failed:", err);
      alert(`Failed to send invite: ${err instanceof Error ? err.message : "Unknown error"}.`);
    } finally {
      setIsSubmitting(false);
    }
  }

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="animate-fade-in"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem",
        background: "rgba(15,23,42,0.45)",
        backdropFilter: "blur(16px)",
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="animate-modal-pop"
        style={{
          background: "#fff",
          borderRadius: 20,
          padding: "2rem",
          width: "100%",
          maxWidth: 480,
          boxShadow:
            "0 24px 64px rgba(15,23,42,0.18), 0 0 0 1px rgba(148,163,184,0.15)",
        }}
      >
        {invited ? (
          <div style={{ textAlign: "center", padding: "8px 0 16px" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>✉️</div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#0f172a", marginBottom: 8 }}>
              Invitation sent!
            </h2>
            <p style={{ margin: "0 0 24px", fontSize: 13, color: "#64748b", lineHeight: 1.6 }}>
              The driver will appear in your fleet roster once they accept the invitation.
            </p>
            <button
              onClick={onClose}
              style={{
                width: "100%",
                border: "none",
                background: "linear-gradient(135deg,#2563eb,#1d4ed8)",
                borderRadius: 10,
                padding: "11px 16px",
                fontSize: 14,
                fontWeight: 700,
                color: "#fff",
                cursor: "pointer",
                boxShadow: "0 4px 12px rgba(37,99,235,0.30)",
              }}
            >
              Done
            </button>
          </div>
        ) : (
        <>
        <h2
          style={{
            margin: 0,
            fontSize: 20,
            fontWeight: 700,
            color: "#0f172a",
            marginBottom: 6,
          }}
        >
          Add Employee
        </h2>
        <p style={{ margin: 0, fontSize: 13, color: "#64748b", marginBottom: 24 }}>
          Enter the employee&apos;s email address to add them to your fleet.
        </p>

        <form onSubmit={handleSubmit} noValidate>
          <div style={{ marginBottom: 14 }}>
            <label
              htmlFor="add-emp-email"
              style={{
                display: "block",
                fontSize: 12,
                fontWeight: 600,
                color: "#475569",
                marginBottom: 4,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              Email Address
            </label>
            <input
              id="add-emp-email"
              ref={emailRef}
              type="email"
              placeholder="e.g. driver@example.com"
              value={form.email}
              onChange={(e) => setForm({ email: e.target.value })}
              style={{
                width: "100%",
                boxSizing: "border-box",
                border: errors.email
                  ? "1.5px solid #ef4444"
                  : "1.5px solid #e2e8f0",
                borderRadius: 10,
                padding: "10px 14px",
                fontSize: 14,
                color: "#0f172a",
                outline: "none",
                background: "#f8fafc",
                transition: "border-color 0.15s",
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = "#3b82f6")}
              onBlur={(e) =>
                (e.currentTarget.style.borderColor = errors.email
                  ? "#ef4444"
                  : "#e2e8f0")
              }
            />
            {errors.email && (
              <p style={{ margin: "4px 0 0", fontSize: 12, color: "#ef4444" }}>
                {errors.email}
              </p>
            )}
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                flex: 1,
                border: "1.5px solid #e2e8f0",
                background: "#f8fafc",
                borderRadius: 10,
                padding: "11px 16px",
                fontSize: 14,
                fontWeight: 600,
                color: "#475569",
                cursor: "pointer",
                transition: "background 0.15s",
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.background = "#f1f5f9")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.background = "#f8fafc")
              }
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              style={{
                flex: 2,
                border: "none",
                background: "linear-gradient(135deg,#2563eb,#1d4ed8)",
                borderRadius: 10,
                padding: "11px 16px",
                fontSize: 14,
                fontWeight: 700,
                color: "#fff",
                cursor: isSubmitting ? "not-allowed" : "pointer",
                boxShadow: "0 4px 12px rgba(37,99,235,0.30)",
                transition: "opacity 0.15s",
                opacity: isSubmitting ? 0.7 : 1,
              }}
              onMouseEnter={(e) => {
                if (!isSubmitting) e.currentTarget.style.opacity = "0.88";
              }}
              onMouseLeave={(e) => {
                if (!isSubmitting) e.currentTarget.style.opacity = "1";
              }}
            >
              {isSubmitting ? "Sending invite..." : "Add Employee"}
            </button>
          </div>
        </form>
        </>
        )}
      </div>
    </div>,
    document.body
  );
}



/* ---- Main ranking table ---- */
export function EmployeeRankingTable() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // 1. Migration/Consistency check FIRST
    try {
      const rawReg = sessionStorage.getItem(EMPLOYER_REGISTRATION_KEY) || localStorage.getItem(EMPLOYER_REGISTRATION_KEY);
      if (rawReg) {
        const reg = JSON.parse(rawReg);
        if (!reg.id || typeof reg.id !== "number") {
          const newId = parseInt(Date.now().toString().slice(-6));
          reg.id = newId;
          sessionStorage.setItem(EMPLOYER_REGISTRATION_KEY, JSON.stringify(reg));
          localStorage.setItem(EMPLOYER_REGISTRATION_KEY, JSON.stringify(reg));
          localStorage.setItem("current_employer_id", newId.toString());
        } else {
          // Sync sessionStorage to localStorage for persistence
          localStorage.setItem(EMPLOYER_REGISTRATION_KEY, rawReg);
          localStorage.setItem("current_employer_id", reg.id.toString());
        }
      }
    } catch { /* ignore */ }

    async function fetchRankings() {
      try {
        const token = getEmployerAuthToken();
        const employerId = getEmployerId();
        
        console.log("[CRITICAL] Syncing with Employer ID:", employerId);
        
        const baseUrl = API_ENDPOINTS.RANKINGS;
        const url = employerId ? `${baseUrl}?employer_id=${employerId}` : baseUrl;
        
        console.log("Attempting fetch from:", url);
        
        const response = await fetch(url, {
          headers: {
            "Authorization": token ? `Bearer ${token}` : "",
            ...COMMON_HEADERS,
          }
        });

        console.log("Rankings response status:", response.status);

        if (!response.ok) {
          const errText = await response.text();
          console.error("Rankings fetch failed:", errText);
          
          if (errText.includes("Employer no longer exists")) {
            console.warn("Stale Employer ID detected. Clearing storage to allow recovery.");
            localStorage.removeItem("current_employer_id");
            localStorage.removeItem(EMPLOYER_REGISTRATION_KEY);
            sessionStorage.removeItem(EMPLOYER_REGISTRATION_KEY);
            // Optionally redirect to login
            // router.push("/employer"); 
          }
          
          throw new Error(`Status: ${response.status}`);
        }

        const data = await response.json();
        console.log("Raw rankings data received:", data);

        // Flexible data extraction - ADDED data.ranked_employees based on logs
        const rawList = Array.isArray(data) 
          ? data 
          : (data.ranked_employees || data.rankings || data.employees || data.data || []);
        
        console.log("Extracted raw list count:", rawList.length);

        // Map backend snake_case to frontend camelCase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mapped: Employee[] = rawList.map((item: any) => ({
          id: item.id || item.driver_id || `remote-${Math.random()}`,
          email: item.email || item.driver_email || "",
          nationalId: item.national_id || item.nationalId || "N/A",
          name: item.employee || item.driver_name || item.name || item.email || "Unknown Driver",
          phoneNumber: item.phone_number || item.phoneNumber || "N/A",
          licenseExpiration: item.license_expiration_date || item.license_expiration || item.licenseExpiration || "",
          role: item.role || "Driver",
          safetyScore: (item.safety_score ?? item.safetyScore ?? 0) <= 1 ? Math.round((item.safety_score ?? item.safetyScore ?? 0) * 100) : (item.safety_score ?? item.safetyScore ?? 0),
          trips: item.trips ?? 0,
          incidents: item.incidents ?? 0,
          lastActive: item.last_active || item.lastActive || new Date().toISOString(),
        }));

        setEmployees(mapped);
        saveEmployees(mapped); 
      } catch (err) {
        console.error("Dashboard Ranking Fetch Failed:", err);
        const local = loadEmployees();
        setEmployees(local);
      } finally {
        setMounted(true);
      }
    }

    fetchRankings();
  }, []);

  const sorted = [...employees].sort((a, b) => a.name.localeCompare(b.name));

  async function removeEmployee(id: string) {
    try {
      const { API_ENDPOINTS, getEmployerAuthToken, COMMON_HEADERS } = await import("@/lib/api-config");
      const token = getEmployerAuthToken();
      await fetch(API_ENDPOINTS.EMPLOYER_SEVER_DRIVER(id), {
        method: "DELETE", // Or POST if backend prefers
        headers: {
          "Authorization": token ? `Bearer ${token}` : "",
          ...COMMON_HEADERS,
        },
      });
    } catch {
      console.error("Failed to sever driver connection.");
    }

    const next = employees.filter((e) => e.id !== id);
    setEmployees(next);
    saveEmployees(next);
    setDeleteId(null);
  }

  if (!mounted) return null;

  return (
    <>
      <style>{`
        @keyframes modal-in {
          from { opacity: 0; transform: scale(0.96) translateY(8px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes row-in {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {showModal && (
        <AddEmployeeModal
          onClose={() => setShowModal(false)}
        />
      )}

      {selectedEmployee && (
        <DriverAnalysisModal
          employee={selectedEmployee}
          onClose={() => setSelectedEmployee(null)}
        />
      )}


      {/* confirm delete */}
      {deleteId && typeof document !== 'undefined' && createPortal(
        <div
          className="animate-fade-in"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "1rem",
            background: "rgba(15,23,42,0.45)",
            backdropFilter: "blur(16px)",
          }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setDeleteId(null);
          }}
        >
          <div
            className="animate-modal-pop"
            style={{
              background: "#fff",
              borderRadius: 20,
              padding: "2rem",
              maxWidth: 380,
              width: "100%",
              boxShadow: "0 24px 64px rgba(15,23,42,0.18)",
            }}
          >
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#0f172a" }}>
              Remove employee?
            </h3>
            <p style={{ margin: "8px 0 24px", fontSize: 14, color: "#64748b" }}>
              This will delete{" "}
              <strong>
                {employees.find((e) => e.id === deleteId)?.name}
              </strong>{" "}
              from your fleet roster.
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() => setDeleteId(null)}
                style={{
                  flex: 1,
                  border: "1.5px solid #e2e8f0",
                  background: "#f8fafc",
                  borderRadius: 10,
                  padding: "11px 16px",
                  fontSize: 14,
                  fontWeight: 600,
                  color: "#475569",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => removeEmployee(deleteId)}
                style={{
                  flex: 1,
                  border: "none",
                  background: "linear-gradient(135deg,#ef4444,#dc2626)",
                  borderRadius: 10,
                  padding: "11px 16px",
                  fontSize: 14,
                  fontWeight: 700,
                  color: "#fff",
                  cursor: "pointer",
                  boxShadow: "0 4px 12px rgba(239,68,68,0.30)",
                }}
              >
                Remove
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ---- card ---- */}
      <div
        style={{
          marginTop: 32,
          background: "#fff",
          border: "1px solid #dbeafe",
          borderRadius: 20,
          overflow: "visible",
          boxShadow: "0 4px 24px rgba(15,23,42,0.04)",
        }}
      >
        {/* header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "18px 24px",
            borderBottom: "1px solid #f1f5f9",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 38,
                height: 38,
                borderRadius: 12,
                background: "linear-gradient(135deg,#dbeafe,#eff6ff)",
                color: "#2563eb",
              }}
            >
              <Trophy size={20} />
            </span>
            <div>
              <h2
                style={{
                  margin: 0,
                  fontSize: 17,
                  fontWeight: 700,
                  color: "#0f172a",
                }}
              >
                Fleet Directory
              </h2>
              <p
                style={{
                  margin: 0,
                  fontSize: 12,
                  color: "#64748b",
                  marginTop: 2,
                }}
              >
                {employees.length} employee{employees.length !== 1 ? "s" : ""} ·
                registered in your network
              </p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-4">
            <button
              id="add-employee-btn"
              onClick={() => setShowModal(true)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                border: "none",
                background: "linear-gradient(135deg,#2563eb,#1d4ed8)",
                borderRadius: 10,
                padding: "9px 18px",
                fontSize: 13,
                fontWeight: 700,
                color: "#fff",
                cursor: "pointer",
                boxShadow: "0 4px 12px rgba(37,99,235,0.28)",
                transition: "opacity 0.15s, transform 0.15s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.opacity = "0.88";
                e.currentTarget.style.transform = "translateY(-1px)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.opacity = "1";
                e.currentTarget.style.transform = "translateY(0)";
              }}
            >
              <PlusCircle size={14} />
              Add Employee
            </button>
          </div>

        </div>

        {/* table wrapper with overflow hidden to clip table corners */}
        <div style={{ overflow: "hidden", borderRadius: "0 0 20px 20px" }}>
          {/* table */}
        {sorted.length === 0 ? (
          <div
            style={{
              padding: "48px 24px",
              textAlign: "center",
              color: "#64748b",
              fontSize: 14,
            }}
          >
            No employees yet. Click{" "}
            <strong style={{ color: "#2563eb" }}>Add Employee</strong> to get
            started.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 14,
              }}
            >
              <thead>
                <tr style={{ background: "#f8fafc" }}>
                  {["Employee", "Email", "National ID", "Role", "Safety Score", "Trips", "License Expiration", "Last Active", ""].map(
                    (h) => (
                      <th
                        key={h}
                        style={{
                          padding: "11px 16px",
                          textAlign: "left",
                          fontSize: 11,
                          fontWeight: 600,
                          color: "#94a3b8",
                          textTransform: "uppercase",
                          letterSpacing: "0.06em",
                          borderBottom: "1px solid rgba(148,163,184,0.15)",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {h}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {sorted.map((emp, idx) => {
                  const sc = scoreColor(emp.safetyScore);

                  return (
                    <tr
                      key={emp.id}
                      style={{
                        borderBottom: "1px solid rgba(148,163,184,0.10)",
                        animation: `row-in 0.3s ease ${idx * 0.04}s both`,
                        transition: "background 0.15s",
                      }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.background = "#f8fafc")
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.background = "transparent")
                      }
                    >

                      {/* name */}
                      <td style={{ padding: "14px 16px", whiteSpace: "nowrap" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div
                            style={{
                              width: 36,
                              height: 36,
                              borderRadius: "50%",
                              background: `linear-gradient(135deg,${sc.bar}33,${sc.bar}66)`,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontWeight: 700,
                              fontSize: 14,
                              color: sc.text,
                              flexShrink: 0,
                            }}
                          >
                            {emp.name
                              .split(" ")
                              .map((w) => w[0])
                              .slice(0, 2)
                              .join("")
                              .toUpperCase()}
                          </div>
                          <button 
                            onClick={() => setSelectedEmployee(emp)}
                            className="font-bold text-blue-950 hover:text-blue-600 hover:underline transition-all text-left group"
                          >
                            <span className="relative">
                              {emp.name}
                              <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-blue-600 transition-all group-hover:w-full"></span>
                            </span>
                          </button>
                        </div>

                      </td>

                      {/* email */}
                      <td style={{ padding: "14px 16px", color: "#64748b", whiteSpace: "nowrap" }}>
                        {emp.email || "N/A"}
                      </td>

                      {/* national id */}
                      <td
                        style={{
                          padding: "14px 16px",
                          color: "#64748b",
                          fontSize: 12,
                          fontFamily: "monospace",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {emp.nationalId}
                      </td>

                      {/* role */}
                      <td
                        style={{
                          padding: "14px 16px",
                          color: "#64748b",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {emp.role}
                      </td>

                      {/* score */}
                      <td style={{ padding: "14px 16px", minWidth: 160 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div
                            style={{
                              flex: 1,
                              height: 6,
                              borderRadius: 999,
                              background: "#e2e8f0",
                              overflow: "hidden",
                              minWidth: 64,
                            }}
                          >
                            <div
                              style={{
                                height: "100%",
                                width: `${emp.safetyScore}%`,
                                borderRadius: 999,
                                background: sc.bar,
                                transition: "width 0.6s ease",
                              }}
                            />
                          </div>
                          <span
                            style={{
                              fontSize: 12,
                              fontWeight: 700,
                              color: sc.text,
                              whiteSpace: "nowrap",
                              minWidth: 28,
                              textAlign: "right",
                            }}
                          >
                            {emp.safetyScore}
                          </span>
                        </div>
                      </td>

                      {/* trips */}
                      <td
                        style={{
                          padding: "14px 16px",
                          color: "#334155",
                          fontWeight: 500,
                        }}
                      >
                        {emp.trips.toLocaleString()}
                      </td>

                      {/* license expiration */}
                      <td style={{ padding: "14px 16px" }}>
                        <span
                          style={{
                            fontSize: 12,
                            fontWeight: 600,
                            color: "#475569",
                            background: "#f1f5f9",
                            borderRadius: 6,
                            padding: "2px 10px",
                          }}
                        >
                          {emp.licenseExpiration ? emp.licenseExpiration.substring(0, 10) : "N/A"}
                        </span>
                      </td>

                      {/* last active */}
                      <td
                        style={{
                          padding: "14px 16px",
                          color: "#94a3b8",
                          fontSize: 12,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {new Date(emp.lastActive).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </td>

                      {/* actions */}
                      <td style={{ padding: "14px 16px" }}>
                        <button
                          title="Remove employee"
                          onClick={() => setDeleteId(emp.id)}
                          style={{
                            border: "none",
                            background: "transparent",
                            cursor: "pointer",
                            padding: 6,
                            borderRadius: 8,
                            color: "#94a3b8",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            transition: "background 0.15s, color 0.15s",
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background =
                              "rgba(239,68,68,0.08)";
                            e.currentTarget.style.color = "#ef4444";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = "transparent";
                            e.currentTarget.style.color = "#94a3b8";
                          }}
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
    </>
  );
}
