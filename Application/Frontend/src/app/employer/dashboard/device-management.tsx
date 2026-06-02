"use client";

import { useEffect, useState } from "react";
import { Cpu, Plus } from "lucide-react";
import { createPortal } from "react-dom";
import { API_ENDPOINTS, COMMON_HEADERS, getEmployerAuthToken, getEmployerId } from "@/lib/api-config";

interface Device {
  id: string;
  manufacturingDate: string;
  activeEmployee: string;
}

export function DeviceManagementTable() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [serialNumber, setSerialNumber] = useState("");
  const [pinCode, setPinCode] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchDevices();
  }, []);

  async function fetchDevices() {
    try {
      const token = getEmployerAuthToken();
      const employerId = getEmployerId();
      const baseUrl = API_ENDPOINTS.DEVICES;
      const url = employerId ? `${baseUrl}?employer_id=${employerId}` : baseUrl;

      console.log("Fetching devices from:", url);

      const response = await fetch(url, {
        headers: {
          "Authorization": token ? `Bearer ${token}` : "",
          ...COMMON_HEADERS,
        },
      });

      if (response.ok) {
        const data = await response.json();
        console.log("Raw devices data received:", data);
        
        // Flexible extraction - check for ranked_devices, devices, etc.
        const rawList = Array.isArray(data) 
          ? data 
          : (data.ranked_devices || data.devices || data.data || []);
          
        console.log("Extracted devices count:", rawList.length);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mapped: Device[] = rawList.map((d: any) => ({
          id: d.id || d.device_id || d.serial_number || "N/A",
          manufacturingDate: d.manufacturing_date || d.manufacturingDate || d.created_at || new Date().toISOString().split('T')[0],
          activeEmployee: d.active_employee_email || "Inactive"
        }));
        setDevices(mapped);
      }
    } catch (err) {
      console.error("Failed to fetch devices:", err);
    }
  }

  async function handleAddDevice(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!serialNumber.trim()) {
      setError("Serial number is required.");
      return;
    }
    if (!/^\d{6}$/.test(pinCode)) {
      setError("PIN code must be exactly 6 digits.");
      return;
    }

    setIsSubmitting(true);
    try {
      const token = getEmployerAuthToken();
      const employerId = getEmployerId();

      const response = await fetch(API_ENDPOINTS.REGISTER_DEVICE || API_ENDPOINTS.DEVICES.replace("/dashboard/employer/devices", "/devices"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": token ? `Bearer ${token}` : "",
          ...COMMON_HEADERS,
        },
        body: JSON.stringify({
          serial_number: serialNumber.trim(),
          pin_code: pinCode,
          employer_id: employerId ? parseInt(employerId) : null,
          status: "active"
        }),
      });

      console.log("Device registration status:", response.status);

      if (!response.ok) {
        let errData;
        const errText = await response.text();
        try { errData = JSON.parse(errText); } catch { errData = errText; }
        console.error("Device registration error:", errData);
        throw new Error(typeof errData === "string" ? errData : JSON.stringify(errData));
      }

      setSerialNumber("");
      setPinCode("");
      setIsModalOpen(false);
      fetchDevices();
    } catch {
      setError("Failed to add device. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div style={{
      background: "#fff",
      borderRadius: 20,
      border: "1px solid #dbeafe",
      boxShadow: "0 4px 24px rgba(15,23,42,0.04)",
      overflow: "hidden",
      marginTop: 24
    }}>
      <div style={{
        padding: "18px 24px",
        borderBottom: "1px solid #f1f5f9",
        display: "flex",
        alignItems: "center",
        justifyContent: "between",
        gap: 12
      }}>
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#0f172a" }}>Hardware Inventory</h2>
          <p style={{ margin: 0, fontSize: 12, color: "#64748b", marginTop: 2 }}>
            Manage your DARAS / Raspberry Pi edge devices
          </p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            background: "linear-gradient(135deg,#2563eb,#1d4ed8)",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            padding: "8px 16px",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            boxShadow: "0 4px 12px rgba(37,99,235,0.2)"
          }}
        >
          <Plus size={14} />
          Add Device
        </button>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ background: "#f8fafc" }}>
              {["Device ID", "Manufacturing Date", "Active Employee"].map((h) => (
                <th key={h} style={{
                  padding: "12px 24px",
                  textAlign: "left",
                  fontSize: 11,
                  fontWeight: 600,
                  color: "#94a3b8",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  borderBottom: "1px solid rgba(0,0,0,0.05)"
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {devices.length === 0 ? (
              <tr>
                <td colSpan={3} style={{ padding: "40px", textAlign: "center", color: "#94a3b8" }}>
                  No devices registered yet.
                </td>
              </tr>
            ) : (
              devices.map((d) => (
                <tr key={d.id} style={{ borderBottom: "1px solid rgba(0,0,0,0.03)" }}>
                  <td style={{ padding: "16px 24px", fontWeight: 600, color: "#1e293b", fontFamily: "monospace" }}>{d.id}</td>
                  <td style={{ padding: "16px 24px", color: "#64748b" }}>{d.manufacturingDate}</td>
                  <td style={{ padding: "16px 24px" }}>
                    <span style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      background: d.activeEmployee === "Inactive" ? "#fef2f2" : "#f0fdf4",
                      color: d.activeEmployee === "Inactive" ? "#b91c1c" : "#15803d",
                      padding: "2px 10px",
                      borderRadius: 99,
                      fontSize: 12,
                      fontWeight: 600
                    }}>
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor" }} />
                      {d.activeEmployee === "Inactive" ? "INACTIVE" : d.activeEmployee}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {isModalOpen && typeof document !== 'undefined' && createPortal(
        <div 
          className="animate-fade-in"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            background: "rgba(15,23,42,0.4)",
            backdropFilter: "blur(16px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20
          }}
        >
          <div 
            className="animate-modal-pop"
            style={{
              background: "#fff",
              borderRadius: 20,
              width: "100%",
              maxWidth: 400,
              padding: 32,
              boxShadow: "0 20px 50px rgba(0,0,0,0.2)"
            }}
          >
            <h3 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#0f172a" }}>Register New Device</h3>
            <p style={{ margin: "6px 0 0", fontSize: 13, color: "#64748b" }}>Enter the device serial number and its 6-digit PIN code.</p>
            <form onSubmit={handleAddDevice} style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#475569", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>Serial Number</label>
                <input
                  type="text"
                  value={serialNumber}
                  onChange={(e) => setSerialNumber(e.target.value)}
                  placeholder="e.g. DARAS-PI-12345"
                  autoFocus
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    padding: "12px 16px",
                    borderRadius: 10,
                    border: "1.5px solid #e2e8f0",
                    outline: "none",
                    fontSize: 14,
                    color: "#0f172a",
                    background: "#f8fafc",
                    transition: "border-color 0.15s",
                    fontFamily: "monospace"
                  }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = "#3b82f6")}
                  onBlur={(e) => (e.currentTarget.style.borderColor = "#e2e8f0")}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#475569", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>PIN Code <span style={{ color: "#94a3b8", textTransform: "none", fontWeight: 500 }}>(6 digits)</span></label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  value={pinCode}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, "").slice(0, 6);
                    setPinCode(val);
                  }}
                  placeholder="••••••"
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    padding: "12px 16px",
                    borderRadius: 10,
                    border: `1.5px solid ${pinCode.length > 0 && pinCode.length < 6 ? "#f59e0b" : "#e2e8f0"}`,
                    outline: "none",
                    fontSize: 18,
                    letterSpacing: "0.3em",
                    color: "#0f172a",
                    background: "#f8fafc",
                    transition: "border-color 0.15s"
                  }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = "#3b82f6")}
                  onBlur={(e) => (e.currentTarget.style.borderColor =
                    pinCode.length > 0 && pinCode.length < 6 ? "#f59e0b" : "#e2e8f0"
                  )}
                />
                <p style={{ margin: "5px 0 0", fontSize: 11, color: pinCode.length === 6 ? "#22c55e" : "#94a3b8", fontWeight: 600 }}>
                  {pinCode.length}/6 digits {pinCode.length === 6 ? "✓" : ""}
                </p>
              </div>
              {error && <p style={{ margin: 0, fontSize: 12, color: "#ef4444", fontWeight: 600 }}>⚠ {error}</p>}
              <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  style={{ flex: 1, padding: "12px", borderRadius: 10, border: "1px solid #e2e8f0", background: "#fff", fontWeight: 600, cursor: "pointer" }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  style={{
                    flex: 1,
                    padding: "12px",
                    borderRadius: 10,
                    border: "none",
                    background: "#2563eb",
                    color: "#fff",
                    fontWeight: 600,
                    cursor: "pointer",
                    opacity: isSubmitting ? 0.7 : 1
                  }}
                >
                  {isSubmitting ? "Registering..." : "Register"}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
