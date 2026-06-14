"use client";

import Link from "next/link";

export default function Error() {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-rose-50 px-6">
      
      <div className="relative z-10 text-center animate-fade-in">
        <h1 className="font-display text-9xl font-extrabold text-rose-950/10">500</h1>
        <div className="-mt-12">
          <h2 className="font-display text-4xl font-bold text-rose-950">Engine Trouble...</h2>
          <p className="mt-4 text-lg text-slate-500">
            Our safety system encountered an unexpected error. 
            We&apos;re recalibrating and will be back shortly.
          </p>
          <div className="mt-10">
            <Link 
              href="/" 
              className="inline-flex items-center gap-2 rounded-2xl bg-rose-600 px-8 py-4 font-bold text-white shadow-xl transition hover:-translate-y-1 hover:bg-rose-700"
            >
              ← Back to High-Way
            </Link>
          </div>
        </div>
      </div>
      
      <footer className="absolute bottom-8 text-center text-xs font-bold uppercase tracking-widest text-rose-400">
        © 2026 DARAS · Safe Journeys Secured
      </footer>
    </div>
  );
}
