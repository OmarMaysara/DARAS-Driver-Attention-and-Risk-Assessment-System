"use client";

import { useState } from "react";

import { FloatingNav } from "../components/floating-nav";
import { EnterpriseRegisterForm } from "./enterprise/enterprise-register-form";
import { IndividualRegisterForm } from "./individual/individual-register-form";
import { EmployerLoginForm } from "./employer-login-form";

type AuthMode = "register" | "signin";
type RoleType = "enterprise" | "individual";

export default function EmployerMasterEntry() {
  const [authMode, setAuthMode] = useState<AuthMode>("register");
  const [role, setRole] = useState<RoleType>("enterprise");

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-[#f8fbff] text-blue-950 antialiased font-sans">
      {/* Decorative Background Accents */}
      <div className="absolute top-0 right-0 h-[500px] w-[500px] rounded-full bg-blue-100/30 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 left-0 h-[400px] w-[400px] rounded-full bg-blue-50/50 blur-[100px] pointer-events-none" />

      <FloatingNav />
      
      <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-4 pt-48 pb-20">
        <div className="mx-auto w-full max-w-2xl text-center">
          
          {/* Header Section */}
          <div className="animate-in slide-in-from-bottom-4 duration-700">
            <h1 className="font-display text-4xl font-extrabold tracking-tight text-blue-950 sm:text-5xl">
              Employer Gateway
            </h1>
            <p className="mt-4 text-[10px] font-bold uppercase tracking-[0.35em] text-blue-600/70">
              {authMode === "register" ? "Secure Fleet Registration" : "Welcome Back Commander"}
            </p>
          </div>

          {/* Dynamic Intelligence Hub */}
          <div className="mt-12 w-full mx-auto max-w-xl">
            
            {/* Auth Mode Tabs */}
            <nav className="mb-10 flex items-center justify-center gap-10">
              <button 
                onClick={() => setAuthMode("register")}
                className={`pb-3 text-[11px] font-bold uppercase tracking-widest transition-all ${
                  authMode === "register" ? "border-b-2 border-blue-600 text-blue-950" : "text-slate-400 hover:text-slate-600"
                }`}
              >
                Register Account
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
              
              {/* Horizontal Role Selector Boxes */}
              <div className="mb-10 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <button 
                  onClick={() => setRole("enterprise")}
                  className={`flex flex-col items-center gap-4 rounded-[2rem] border p-6 text-center transition-all ${
                    role === "enterprise" ? "border-blue-200 bg-white shadow-xl ring-1 ring-blue-100" : "border-slate-100 bg-white/40 backdrop-blur-xl hover:border-slate-200"
                  }`}
                >
                  <div className="h-12 w-12 rounded-2xl bg-blue-50 flex items-center justify-center text-2xl">🏢</div>
                  <div>
                    <p className="text-sm font-extrabold text-blue-950">Enterprise</p>
                    <p className="text-[10px] font-medium text-slate-400 mt-1 uppercase tracking-wider">Fleet Management</p>
                  </div>
                </button>

                <button 
                  onClick={() => setRole("individual")}
                  className={`flex flex-col items-center gap-4 rounded-[2rem] border p-6 text-center transition-all ${
                    role === "individual" ? "border-blue-200 bg-white shadow-xl ring-1 ring-blue-100" : "border-slate-100 bg-white/40 backdrop-blur-xl hover:border-slate-200"
                  }`}
                >
                  <div className="h-12 w-12 rounded-2xl bg-emerald-50 flex items-center justify-center text-2xl">👤</div>
                  <div>
                    <p className="text-sm font-extrabold text-blue-950">Individual</p>
                    <p className="text-[10px] font-medium text-slate-400 mt-1 uppercase tracking-wider">Personal Tracker</p>
                  </div>
                </button>
              </div>

              {/* Dynamic Form Area */}
              <div className="relative">
                {/* Subtle glow behind form */}
                <div className="absolute -inset-4 z-0 rounded-[2.5rem] bg-blue-400/5 blur-2xl" />
                <div className="relative z-10 rounded-[2.5rem] border border-blue-100/50 bg-white/70 p-6 sm:p-10 shadow-2xl backdrop-blur-3xl ring-1 ring-blue-950/5 text-left">
                  {authMode === "register" ? (
                    role === "enterprise" ? 
                      <EnterpriseRegisterForm onSwitchToSignIn={() => setAuthMode("signin")} /> : 
                      <IndividualRegisterForm onSwitchToSignIn={() => setAuthMode("signin")} />
                  ) : (
                    <EmployerLoginForm role={role} />
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      <footer className="relative z-10 py-12 text-center text-[10px] font-bold uppercase tracking-[0.45em] text-blue-200">
        © 2026 DARAS INTELLIGENCE · UNIFIED GATEWAY Access
      </footer>
    </div>
  );
}
