"use client";

import { COUNTRIES } from "@/lib/countries";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { API_ENDPOINTS, COMMON_HEADERS } from "@/lib/api-config";

const inputClass =
  "w-full rounded-xl border border-blue-200/90 bg-white px-4 py-3 text-blue-950 outline-none transition placeholder:text-blue-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20";

const selectClass =
  "w-full rounded-xl border border-blue-200/90 bg-white px-4 py-3 text-blue-950 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20";

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function EnterpriseRegisterForm({ onSwitchToSignIn }: { onSwitchToSignIn?: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [country, setCountry] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const n = name.trim();
    const em = email.trim();
    const ph = phoneNumber.trim();
    const loc = country.trim();

    if (!n || !em || !ph || !loc || !password) {
      setError("Please fill in every field.");
      return;
    }
    if (!isValidEmail(em)) {
      setError("Enter a valid company email address.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    const registrationData = {
      id: parseInt(Date.now().toString().slice(-6)),
      kind: "enterprise" as const,
      name: n,
      email: em,
      phoneNumber: ph,
      country: loc,
    };

    try {
      // Synchronize with backend
      const url = API_ENDPOINTS.EMPLOYERS;
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...COMMON_HEADERS,
        },
        body: JSON.stringify({
          employer_name: registrationData.name,
          phone_number: registrationData.phoneNumber,
          email: registrationData.email,
          country: registrationData.country,
          password: password
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error("Employer Registration Rejected:", errorData);
        const msg = errorData.detail || `Registration failed (Status ${response.status})`;
        throw new Error(msg);
      }

      // Clear old data from previous sessions so new employers get a clean dashboard
      localStorage.removeItem("daras_employer_employees");
      localStorage.removeItem("current_employer_id");
      localStorage.removeItem("daras_auth_token");
      sessionStorage.removeItem("daras_employer_employees");

      sessionStorage.setItem("daras_employer_registration", JSON.stringify(registrationData));
      
      // Redirect to Sign In page after successful registration
      if (onSwitchToSignIn) {
        onSwitchToSignIn();
      } else {
        router.push("/employer/dashboard");
      }
    } catch (err) {
      console.error("Employer Sync Error:", err);
      setError(err instanceof Error ? err.message : "Failed to connect to the registration server. Please try again.");
    }
  }

  const isDuplicateError = error?.toLowerCase().includes("already registered");

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-8 w-full max-w-md space-y-5 rounded-2xl border border-blue-200/90 bg-white p-6 shadow-[var(--shadow-soft)] sm:p-8"
      noValidate
    >
      <div className="space-y-2">
        <label htmlFor="name" className="block text-sm font-medium text-blue-900">
          Company name
        </label>
        <input
          id="name"
          name="name"
          type="text"
          autoComplete="organization"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your company or fleet name"
          className={inputClass}
          suppressHydrationWarning
        />
      </div>
      <div className="space-y-2">
        <label htmlFor="email" className="block text-sm font-medium text-blue-900">
          Email address
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="fleet@company.com"
          className={inputClass}
          suppressHydrationWarning
        />
      </div>
      <div className="space-y-2">
        <label htmlFor="phone" className="block text-sm font-medium text-blue-900">
          Phone number
        </label>
        <input
          id="phone"
          name="phoneNumber"
          type="tel"
          autoComplete="tel"
          value={phoneNumber}
          onChange={(e) => setPhoneNumber(e.target.value)}
          placeholder="+20 XXXXXXXXXX"
          className={inputClass}
          suppressHydrationWarning
        />
      </div>
      <div className="space-y-2">
        <label htmlFor="country" className="block text-sm font-medium text-blue-900">
          Country
        </label>
        <select
          id="country"
          name="country"
          value={country}
          onChange={(e) => setCountry(e.target.value)}
          className={selectClass}
          required
          suppressHydrationWarning
        >
          <option value="">Select country</option>
          {COUNTRIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-2">
        <label htmlFor="password" className="block text-sm font-medium text-blue-900">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="At least 8 characters"
          className={inputClass}
          suppressHydrationWarning
        />
      </div>
      {error ? (
        <div 
          className={`rounded-xl px-4 py-3 text-sm animate-in fade-in slide-in-from-top-2 duration-300 ${
            isDuplicateError 
              ? "bg-amber-50 border border-amber-200 text-amber-800" 
              : "bg-red-50 border border-red-200 text-red-600"
          }`} 
          role="alert"
        >
          <div className="flex items-center gap-3">
             <span className="text-lg">{isDuplicateError ? "⚠️" : "❌"}</span>
             <div className="flex-1">
               <p className="font-bold uppercase tracking-tight text-[10px] mb-0.5">
                 {isDuplicateError ? "Account Found" : "System Alert"}
               </p>
               <p className="font-medium leading-relaxed">{error}</p>
               {isDuplicateError && onSwitchToSignIn && (
                 <button
                   type="button"
                   onClick={onSwitchToSignIn}
                   className="mt-2 text-[11px] font-black uppercase tracking-widest text-blue-600 hover:text-blue-800 underline underline-offset-4 decoration-2"
                 >
                   Sign in to your account instead
                 </button>
               )}
             </div>
          </div>
        </div>
      ) : null}
      <button
        type="submit"
        className="w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
      >
        Create account
      </button>
    </form>
  );
}
