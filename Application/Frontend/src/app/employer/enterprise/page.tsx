"use client";

import { FloatingNav } from "../../components/floating-nav";
import { EnterpriseRegisterForm } from "./enterprise-register-form";

export default function EmployerEnterprisePage() {
  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-[#f8fbff]">
      {/* Decorative Background Accents */}
      <div className="absolute top-0 right-0 h-[500px] w-[500px] rounded-full bg-blue-100/30 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 left-0 h-[400px] w-[400px] rounded-full bg-blue-50/50 blur-[100px] pointer-events-none" />

      <FloatingNav />
      
      <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-4 pt-48 pb-20">
        <div className="w-full max-w-md animate-in fade-in slide-in-from-bottom-4 duration-1000">
          <div className="mb-10 text-center">
            <h1 className="font-display text-4xl font-extrabold tracking-tight text-blue-950 sm:text-5xl">
              Enterprise
            </h1>
            <p className="mt-4 text-balance font-bold uppercase tracking-widest text-xs text-blue-600/70">
              Fleet Risk Management Hub
            </p>
            <p className="mt-4 text-balance text-sm font-medium leading-relaxed text-blue-700/80">
              Register your organization to manage fleet risk and driver reports on DARAS.
            </p>
          </div>
          
          <div className="relative">
            {/* Subtle glow behind form */}
            <div className="absolute -inset-4 z-0 rounded-[2.5rem] bg-blue-400/5 blur-2xl" />
            <div className="relative z-10 rounded-[2.5rem] border border-blue-100/50 bg-white/70 p-10 shadow-2xl backdrop-blur-2xl ring-1 ring-blue-950/5">
              <EnterpriseRegisterForm />
            </div>
          </div>

          <p className="mt-12 text-center text-[10px] font-bold uppercase tracking-[0.3em] text-blue-200">
            © 2026 DARAS INTELLIGENCE · SECURE AUTH
          </p>
        </div>
      </main>
    </div>
  );
}
