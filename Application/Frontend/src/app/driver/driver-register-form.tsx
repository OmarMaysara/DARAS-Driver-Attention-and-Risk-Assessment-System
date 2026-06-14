"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "../components/toast-context";
import { API_ENDPOINTS, COMMON_HEADERS } from "@/lib/api-config";

const inputClass =
  "w-full rounded-xl border border-blue-200/90 bg-white px-4 py-3 text-blue-950 outline-none transition placeholder:text-blue-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20";

interface DriverRegisterFormProps {
  onSwitchToSignIn: () => void;
}

export function DriverRegisterForm({ onSwitchToSignIn }: DriverRegisterFormProps) {
  const { showToast } = useToast();
  const [formData, setFormData] = useState({
    driverName: "",
    phoneNumber: "",
    nationalId: "",
    licenseExpirationDate: "",
    email: "",
    password: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const { driverName, phoneNumber, nationalId, licenseExpirationDate, email, password } = formData;

    // Basic empty field validation
    if (!driverName || !phoneNumber || !nationalId || !licenseExpirationDate || !email || !password) {
      showToast("Please fill in all fields.", "warning");
      return;
    }

    // NEW: Password length validation
    if (password.length < 8) {
      showToast("Password must be at least 8 characters long.", "warning");
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch(API_ENDPOINTS.DRIVER_REGISTER, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...COMMON_HEADERS,
        },
        body: JSON.stringify({
          // FIXED: Strictly matching the expected JSON payload
          driver_name: driverName, 
          phone_number: phoneNumber,
          national_id: nationalId,
          license_expiration_date: licenseExpirationDate,
          email: email,
          password: password,
        }),
      });

      if (!response.ok) {
        let errorMsg = `Registration failed (${response.status})`;
        try {
          const errorData = await response.json();
          errorMsg = errorData.detail || errorData.message || errorMsg;
        } catch { /* ignore */ }
        throw new Error(errorMsg);
      }
      
      showToast("Registration Successful! Please sign in.", "success");
      // Persist profile info for the dashboard profile panel
      localStorage.setItem("daras_driver_profile", JSON.stringify({
        name: driverName,
        email: email,
        national_id: nationalId,
        license_expiration_date: licenseExpirationDate,
        phone_number: phoneNumber,
      }));
      onSwitchToSignIn();
    } catch (err: any) {
      showToast(err.message || "Registration failed.", "error");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-blue-950">
          Driver Registration
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          Enter your personal and license details to register for the DARAS network.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div className="space-y-2">
          <label className="block text-xs font-bold uppercase tracking-wider text-blue-900/60 ml-1">
            Driver Name
          </label>
          <input
            type="text"
            value={formData.driverName}
            onChange={(e) => setFormData({ ...formData, driverName: e.target.value })}
            placeholder="John Doe"
            className={inputClass}
          />
        </div>

        <div className="space-y-2">
          <label className="block text-xs font-bold uppercase tracking-wider text-blue-900/60 ml-1">
            Phone Number
          </label>
          <input
            type="tel"
            value={formData.phoneNumber}
            onChange={(e) => setFormData({ ...formData, phoneNumber: e.target.value })}
            placeholder="+1 (555) 000-0000"
            className={inputClass}
          />
        </div>

        <div className="space-y-2">
          <label className="block text-xs font-bold uppercase tracking-wider text-blue-900/60 ml-1">
            National ID
          </label>
          <input
            type="text"
            value={formData.nationalId}
            onChange={(e) => setFormData({ ...formData, nationalId: e.target.value })}
            placeholder="Enter your national ID"
            className={inputClass}
          />
        </div>

        <div className="space-y-2">
          <label className="block text-xs font-bold uppercase tracking-wider text-blue-900/60 ml-1">
            License Expiration Date
          </label>
          <input
            type="date"
            value={formData.licenseExpirationDate}
            onChange={(e) => setFormData({ ...formData, licenseExpirationDate: e.target.value })}
            className={inputClass}
          />
        </div>

        <div className="space-y-2">
          <label className="block text-xs font-bold uppercase tracking-wider text-blue-900/60 ml-1">
            Email Address
          </label>
          <input
            type="email"
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            placeholder="driver@example.com"
            className={inputClass}
          />
        </div>

        <div className="space-y-2">
          <label className="block text-xs font-bold uppercase tracking-wider text-blue-900/60 ml-1">
            Password
          </label>
          <input
            type="password"
            value={formData.password}
            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
            placeholder="••••••••"
            className={inputClass}
          />
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="group relative w-full overflow-hidden rounded-xl bg-blue-600 px-4 py-3.5 text-sm font-bold text-white transition-all hover:bg-blue-700 active:scale-[0.98] disabled:bg-blue-300 disabled:cursor-not-allowed mt-2"
        >
          <span className="relative z-10 flex items-center justify-center gap-2">
            {isSubmitting ? (
              <>
                <svg className="h-4 w-4 animate-spin text-white" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Registering...
              </>
            ) : (
              <>
                Complete Registration
                <svg className="h-4 w-4 transition-transform group-hover:translate-x-1" viewBox="0 0 24 24" fill="none">
                  <path d="M5 12h14M12 5l7 7-7 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </>
            )}
          </span>
          <div className="absolute inset-0 z-0 bg-gradient-to-r from-transparent via-white/10 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000" />
        </button>
      </form>
      
      <div className="mt-8 border-t border-slate-100 pt-6">
        <p className="text-center text-[10px] font-bold uppercase tracking-widest text-slate-400">
          Encryption Secured by DARAS AI
        </p>
      </div>
    </div>
  );
}
