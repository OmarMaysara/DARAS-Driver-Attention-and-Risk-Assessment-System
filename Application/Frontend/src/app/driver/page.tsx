"use client";

import { useState } from "react";
import { FloatingNav } from "../components/floating-nav";
import { DriverLoginForm } from "./driver-login-form";
import { DriverRegisterForm } from "./driver-register-form";

type AuthMode = "register" | "signin";

export default function DriverLoginPage() {
  const [authMode, setAuthMode] = useState<AuthMode>("signin");
  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-[#f8fbff]">
      {/* Decorative Background Accents */}
      <div className="absolute top-0 right-0 h-[500px] w-[500px] rounded-full bg-blue-100/30 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 left-0 h-[400px] w-[400px] rounded-full bg-blue-50/50 blur-[100px] pointer-events-none" />

      <FloatingNav />
      
      <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-4 pt-48 pb-20">
        <div className="mx-auto w-full max-w-xl text-center">
          
          {/* Header Section */}
          <div className="animate-in slide-in-from-bottom-4 duration-700">
            <h1 className="font-display text-4xl font-extrabold tracking-tight text-blue-950 sm:text-5xl">
              Driver Gateway
            </h1>
            <p className="mt-4 text-[10px] font-bold uppercase tracking-[0.35em] text-blue-600/70">
              {authMode === "register" ? "Join the Fleet Network" : "Welcome Back Driver"}
            </p>
          </div>
          
          <div className="mt-12 w-full mx-auto max-w-md">
            
            {/* Auth Mode Tabs */}
            <nav className="mb-10 flex items-center justify-center gap-10">
              <button 
                onClick={() => setAuthMode("register")}
                className={`pb-3 text-[11px] font-bold uppercase tracking-widest transition-all ${
                  authMode === "register" ? "border-b-2 border-blue-600 text-blue-950" : "text-slate-400 hover:text-slate-600"
                }`}
              >
                Register
              </button>
              <button 
                onClick={() => setAuthMode("signin")}
                className={`pb-3 text-[11px] font-bold uppercase tracking-widest transition-all ${
                  authMode === "signin" ? "border-b-2 border-blue-600 text-blue-950" : "text-slate-400 hover:text-slate-600"
                }`}
              >
                Sign In
              </button>
            </nav>

            <div className="animate-in fade-in slide-in-from-bottom-8 duration-700">
              <div className="relative">
                {/* Subtle glow behind form */}
                <div className="absolute -inset-4 z-0 rounded-[2.5rem] bg-blue-400/5 blur-2xl" />
                <div className="relative z-10 rounded-[2.5rem] border border-blue-100/50 bg-white/70 p-6 sm:p-10 shadow-2xl backdrop-blur-3xl ring-1 ring-blue-950/5 text-left">
                  {authMode === "register" ? (
                    <DriverRegisterForm onSwitchToSignIn={() => setAuthMode("signin")} />
                  ) : (
                    <DriverLoginForm />
                  )}
                </div>
              </div>
            </div>

          <p className="mt-12 text-center text-[10px] font-bold uppercase tracking-[0.3em] text-blue-200">
            © 2026 DARAS INTELLIGENCE · SECURE GATEWAY
          </p>
        </div>
      </div>
    </main>
  </div>
  );
}
