"use client";

import { FloatingNav } from "../components/floating-nav";
import { NeuralNetCanvas } from "../components/neural-net-canvas";
import { Rocket, ShieldCheck, Handshake } from "lucide-react";

export default function AboutPage() {
  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-white">

      <NeuralNetCanvas />

      <FloatingNav />

      <main className="relative z-10 flex flex-1 flex-col items-center px-6 pt-48 pb-20">
        <div className="w-full max-w-3xl animate-in fade-in slide-in-from-bottom-4 duration-1000">
          <div className="text-center">
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-blue-600">Our Story</p>
            <h1 className="mt-4 font-display text-5xl font-extrabold tracking-tight text-blue-950 sm:text-7xl">
              Making Every Road a Safer Place
            </h1>
          </div>

          <div className="mt-16 space-y-12 text-lg leading-relaxed text-slate-700">
            <section className="rounded-3xl border border-blue-100 bg-white/60 p-8 backdrop-blur-md shadow-sm">
              <h2 className="font-display text-2xl font-bold text-blue-950">The Vision</h2>
              <p className="mt-4">
                DARAS was founded on a simple but powerful idea: <strong>Safety should never be left to chance.</strong> 
                Every year, millions of collisions occur due to preventable distractions. Our goal is to eliminate 
                these risks using the world&apos;s most advanced real-time AI behavior monitoring.
              </p>
            </section>

            <section className="rounded-3xl border border-blue-100 bg-white/60 p-8 backdrop-blur-md shadow-sm">
              <h2 className="font-display text-2xl font-bold text-blue-1000">The Technology</h2>
              <p className="mt-4">
                We combine high-performance computer vision with lightweight edge computing (Raspberry Pi) to 
                protect drivers without invading their privacy. Our AI doesn&apos;t just record; it understands. 
                It identifies fatigue, phone usage, and distraction in milliseconds, providing an immediate 
                safety net for every journey.
              </p>
            </section>

            <section className="rounded-3xl border border-blue-100 bg-white/60 p-8 backdrop-blur-md shadow-sm">
              <h2 className="font-display text-2xl font-bold text-blue-950">Scaleable Protection</h2>
              <p className="mt-4">
                Whether you&apos;re an enterprise managing a thousand trucks or an individual caring for a 
                family member, DARAS is your vigilant co-pilot. We provide role-specific dashboards that 
                translate complex data into actionable safety scores and risk patterns.
              </p>
            </section>
          </div>

          <div className="mt-20 grid grid-cols-1 gap-8 sm:grid-cols-3 text-center">
            <div className="rounded-2xl bg-blue-50/50 p-6 backdrop-blur-sm flex flex-col items-center">
              <Rocket size={40} className="text-blue-600" />
              <h3 className="mt-4 font-bold text-blue-950">Innovation</h3>
              <p className="mt-2 text-sm text-slate-600">Pushing the boundaries of Edge AI.</p>
            </div>
            <div className="rounded-2xl bg-blue-50/50 p-6 backdrop-blur-sm flex flex-col items-center">
              <ShieldCheck size={40} className="text-blue-600" />
              <h3 className="mt-4 font-bold text-blue-950">Protection</h3>
              <p className="mt-2 text-sm text-slate-600">Zero-latency safety alerts.</p>
            </div>
            <div className="rounded-2xl bg-blue-50/50 p-6 backdrop-blur-sm flex flex-col items-center">
              <Handshake size={40} className="text-blue-600" />
              <h3 className="mt-4 font-bold text-blue-950">Integrity</h3>
              <p className="mt-2 text-sm text-slate-600">Privacy-first monitoring logic.</p>
            </div>
          </div>
        </div>
      </main>

      <footer className="relative z-10 border-t border-blue-50 py-10 text-center text-sm text-slate-400">
        © 2026 DARAS · Advanced Safety Intelligence
      </footer>
    </div>
  );
}
