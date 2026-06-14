"use client";

import { API_ENDPOINTS, COMMON_HEADERS } from "@/lib/api-config";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useToast } from "../components/toast-context";
import { EMPLOYER_REGISTRATION_KEY } from "./employer-session";

const inputClass =
  "w-full rounded-xl border border-blue-200/90 bg-white px-4 py-3 text-blue-950 outline-none transition placeholder:text-blue-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20";

interface EmployerLoginFormProps {
  role: "enterprise" | "individual";
}

export function EmployerLoginForm({ role }: EmployerLoginFormProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);


  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const idValue = identifier.trim();
    const passValue = password.trim();

    if (!idValue || !passValue) {
      showToast("Please fill in all fields.", "warning");
      return;
    }

    setIsSubmitting(true);

    try {
      const body = new URLSearchParams();
      body.append("username", idValue);
      body.append("password", passValue);

      const response = await fetch(API_ENDPOINTS.LOGIN, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          ...COMMON_HEADERS,
        },
        body: body,
      });

      console.log("Login Response Status:", response.status);

      if (!response.ok) {
        let errorMsg = `Server returned ${response.status}`;
        try {
          const rawText = await response.text();
          console.log("Raw Error Response:", rawText);
          try {
            const errorData = JSON.parse(rawText);
            console.error("Login Error Data:", errorData);
            if (errorData.detail) {
              errorMsg = typeof errorData.detail === "string" 
                ? errorData.detail 
                : JSON.stringify(errorData.detail);
            } else {
              errorMsg = errorData.message || errorData.error || errorMsg;
            }
          } catch {
            if (rawText && rawText.length < 150) errorMsg = rawText;
          }
        } catch {
          // Fallback to default errorMsg
        }
        throw new Error(errorMsg);
      }

      const data = await response.json();
      console.log("Login Success Data:", data);

      const myToken = data.access_token;
      const myEmployerId = data.employer_id;

      // SAVE IT FOR LATER as requested
      localStorage.setItem("daras_employer_token", myToken);
      localStorage.setItem("current_employer_id", myEmployerId);
      
      // Map API response to the app's session format for UI display
      const employerProfile = {
        id: myEmployerId || data.id || parseInt(Date.now().toString().slice(-6)),
        kind: role,
        ...(role === "enterprise" ? {
          companyName: data.company_name || data.name || (idValue.split('@')[0].toUpperCase() + " FLEET"),
          companyEmail: data.email || idValue,
          country: data.country || "Egypt",
          phoneNumber: data.phone_number || data.phone || "+20 100 200 3000",
        } : {
          employerName: data.name || data.employer_name || idValue.split('@')[0] || "Registered User",
          email: data.email || idValue,
          phoneNumber: data.phone_number || data.phone || "+20 100 200 3000",
        })
      };

      sessionStorage.setItem(EMPLOYER_REGISTRATION_KEY, JSON.stringify(employerProfile));
      
      // Store token in session too for generic auth logic consistency
      sessionStorage.setItem("daras_auth_token", myToken);

      showToast("Login Successful! Welcome back.", "success");
      router.push("/employer/dashboard");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      console.error("Login failure:", err);
      let userMsg = err.message || "Authentication failed.";
      
      if (err.message === "Failed to fetch") {
        userMsg = "Cannot connect to the security server. The backend service might be offline or the tunnel has expired.";
      }
      
      showToast(userMsg, "error");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-blue-950">
          {role === "enterprise" ? "Enterprise Sign In" : "Individual Access"}
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          Enter your registered {role === "enterprise" ? "company email" : "personal account"} details to access your dashboard.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div className="space-y-2">
          <label htmlFor="identifier" className="block text-xs font-bold uppercase tracking-wider text-blue-900/60 ml-1">
            {role === "enterprise" ? "Work Email Address" : "Email or Phone"}
          </label>
          <input
            id="identifier"
            type="text"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            placeholder={role === "enterprise" ? "name@company.com" : "you@example.com"}
            className={inputClass}
            autoComplete="username"
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between ml-1">
            <label htmlFor="password" className="block text-xs font-bold uppercase tracking-wider text-blue-900/60">
              Password
            </label>
          </div>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className={inputClass}
            autoComplete="current-password"
          />
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="group relative w-full overflow-hidden rounded-xl bg-blue-600 px-4 py-3.5 text-sm font-bold text-white transition-all hover:bg-blue-700 active:scale-[0.98] disabled:bg-blue-300 disabled:cursor-not-allowed"
        >
          <span className="relative z-10 flex items-center justify-center gap-2">
            {isSubmitting ? (
              <>
                <svg className="h-4 w-4 animate-spin text-white" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Authenticating...
              </>
            ) : (
              <>
                Access Unified Dashboard
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
