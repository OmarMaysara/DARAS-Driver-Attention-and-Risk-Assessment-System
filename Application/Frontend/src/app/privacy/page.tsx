"use client";

import { FloatingNav } from "../components/floating-nav";
import { NeuralNetCanvas } from "../components/neural-net-canvas";
import { Cpu, FileText, Lock, User } from "lucide-react";
import Link from "next/link";

export default function PrivacyPage() {
  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-white">
      
      <NeuralNetCanvas />
      
      <FloatingNav />

      <main className="relative z-10 flex flex-1 flex-col items-center px-6 pt-48 pb-20 animate-fade-in">
        <div className="w-full max-w-4xl space-y-12">
          <div className="text-center mb-16">
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-blue-600">Privacy & Data Governance</p>
            <h1 className="mt-4 font-display text-5xl font-extrabold tracking-tight text-blue-950">How We Protect You</h1>
            <p className="mt-4 text-lg text-slate-500">Your privacy is not just a policy; it&apos;s a core feature of our AI design.</p>
          </div>

          <div className="grid gap-8 sm:grid-cols-2">
            {[
              { 
                t: "Local Processing", 
                d: "All computer vision analysis is performed on the DARAS hardware (Raspberry Pi). No raw video data is ever sent to or stored on our cloud servers.",
                icon: <Cpu size={24} />
              },
              { 
                t: "Metadata-Only Logging", 
                d: "We only log anonymized risk event timestamps and behavioral classifications (e.g. 'Distraction') for safety scoring and reporting purposes.",
                icon: <FileText size={24} />
              },
              { 
                t: "End-to-End Encryption", 
                d: "Any data transmitted between the hardware device and your dashboard is secured using industry-standard TLS 1.3 encryption.",
                icon: <Lock size={24} />
              },
              { 
                t: "Driver Autonomy", 
                d: "Drivers have full visibility of their own logs and safety scores, ensuring transparency and trust within the fleet.",
                icon: <User size={24} />
              },
            ].map((p, i) => (
              <div key={i} className="rounded-3xl border border-blue-100 bg-white/60 p-8 backdrop-blur-md shadow-sm flex flex-col items-start gap-4">
                <div className="p-3 bg-blue-50 rounded-2xl text-blue-600">
                  {p.icon}
                </div>
                <div>
                  <h3 className="font-display text-xl font-bold text-blue-950 mb-2">{p.t}</h3>
                  <p className="text-slate-600 leading-relaxed">{p.d}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="prose prose-blue max-w-none rounded-3xl border border-blue-100 bg-white/70 p-12 backdrop-blur-xl shadow-2xl">
            <h2 className="font-display text-3xl font-bold text-blue-950">The DARAS Privacy Promise</h2>
            <p className="mt-8 text-xl leading-relaxed text-slate-700">
              We believe safety technology should be a shield, not a spotlight. DARAS does not use facial 
              recognition to identify individuals for monitoring purposes. Our AI focuses purely on 
              <strong>behavioral landmarks</strong> and <strong>physics-based risk factors</strong> to detect 
              distraction and fatigue.
            </p>
            <p className="mt-8 text-slate-600 leading-relaxed">
              Last updated: October 2026. For specific data requests or deletion inquiries, please reach out via our 
              <Link href="/support" className="text-blue-600 font-bold ml-2 underline underline-offset-4 hover:text-blue-800">Support Portal</Link>.
            </p>
          </div>
        </div>
      </main>

      <footer className="relative z-10 py-10 text-center text-sm text-slate-400">
        © 2026 DARAS · Safe Journeys Secured.
      </footer>
    </div>
  );
}
