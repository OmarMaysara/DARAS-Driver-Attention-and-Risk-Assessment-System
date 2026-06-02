"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function NotFound() {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-white px-6">
      
      <div className="relative z-10 text-center animate-fade-in">
        <h1 className="font-display text-9xl font-extrabold text-blue-950/10">404</h1>
        <div className="-mt-12">
          <h2 className="font-display text-4xl font-bold text-blue-950">Lost on the road?</h2>
          <p className="mt-4 text-lg text-slate-500">
            The page you are looking for doesn&apos;t exist or has been relocated.
          </p>
          <div className="mt-10">
            <Link 
              href="/" 
              className="inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-8 py-4 font-bold text-white shadow-xl transition hover:-translate-y-1 hover:bg-blue-700"
            >
              <ArrowLeft size={20} /> Back to High-Way
            </Link>
          </div>
        </div>
      </div>
      
      <footer className="absolute bottom-8 text-center text-xs font-bold uppercase tracking-widest text-blue-300">
        © 2026 DARAS · Safe Journeys Secured
      </footer>
    </div>
  );
}
