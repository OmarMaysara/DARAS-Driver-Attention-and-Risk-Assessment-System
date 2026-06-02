"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useToast } from "../components/toast-context";
import { API_ENDPOINTS, COMMON_HEADERS } from "@/lib/api-config";

export function DriverLoginForm() {
  const router = useRouter();
  const { showToast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const emailVal = email.trim();
    const passVal = password.trim();
    
    if (!emailVal || !passVal) {
      showToast("Please enter both email and password.", "warning");
      return;
    }

    setIsSubmitting(true);

    try {
      const url = API_ENDPOINTS.DRIVER_LOGIN;
      console.log("Attempting driver login at:", url);
      
      const body = new URLSearchParams();
      body.append("username", emailVal);
      body.append("password", passVal);

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          ...COMMON_HEADERS,
        },
        body: body
      });

      console.log("Driver login response status:", response.status);

      if (!response.ok) {
        let errorMsg = "Invalid credentials or device not found.";
        try {
          const errorData = await response.json();
          errorMsg = errorData.detail || errorMsg;
        } catch { /* ignore */ }
        console.error("Driver login failed:", errorMsg);
        throw new Error(errorMsg);
      }

      // If there's an auth token, store it
      try {
        const data = await response.json();
        if (data.access_token) {
          localStorage.setItem("daras_driver_token", data.access_token);
        }
        // Store email for profile panel
        localStorage.setItem("daras_driver_email", emailVal);
      } catch { /* ignore */ }

      showToast("Access Granted. Redirecting...", "success");
      const params = new URLSearchParams({ 
        driverId: emailVal.split('@')[0].toUpperCase(), 
        deviceSerial: "DARAS-SV-99" 
      });
      router.push(`/driver/dashboard?${params.toString()}`);
    } catch (err) {
      console.error("Login Network Error:", err);
      const isFetchError = err instanceof TypeError && err.message === 'Failed to fetch';
      
      showToast(
        isFetchError 
          ? "Backend Server Offline: Check your ngrok tunnel connection." 
          : "Sign-in Failed: Please check your credentials.", 
        "error"
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-blue-950">
          Driver Sign In
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          Sign in with your registered email and password to access your personal safety metrics.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div className="space-y-2">
          <label htmlFor="email" className="block text-xs font-bold uppercase tracking-wider text-blue-900/60 ml-1">
            Email Address
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="driver@example.com"
            className="w-full rounded-xl border border-blue-200/90 bg-white px-4 py-3 text-blue-950 outline-none transition placeholder:text-blue-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
          />
        </div>
        <div className="space-y-2">
          <label
            htmlFor="password"
            className="block text-xs font-bold uppercase tracking-wider text-blue-900/60 ml-1"
          >
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="w-full rounded-xl border border-blue-200/90 bg-white px-4 py-3 text-blue-950 outline-none transition placeholder:text-blue-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
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
                Synchronizing...
              </>
            ) : (
              <>
                Access Dashboard
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
