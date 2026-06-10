"use client";

import React from "react";
import Link from "next/link";
import { ShieldAlert, MapPin, Activity, Shield, Zap, BarChart3, Car, Building2, ArrowRight } from "lucide-react";
import { FloatingNav } from "./components/floating-nav";
import { NeuralNetCanvas } from "./components/neural-net-canvas";

function Feature({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div
      style={{
        background: "rgba(255,255,255,0.72)", border: "1px solid rgba(147,197,253,0.35)",
        borderRadius: 18, padding: "22px 20px", backdropFilter: "blur(12px)",
        display: "flex", flexDirection: "column", gap: 12,
        transition: "transform 0.2s, box-shadow 0.2s", cursor: "default"
      }}
      onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-4px)"; e.currentTarget.style.boxShadow = "0 16px 40px -8px rgba(37,99,235,0.14)"; }}
      onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "none"; }}
    >
      <div style={{ color: "#2563eb", marginBottom: 4 }}>{icon}</div>
      <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#0f172a" }}>{title}</p>
      <p style={{ margin: 0, fontSize: 12.5, color: "#475569", lineHeight: 1.55 }}>{desc}</p>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div style={{ textAlign: "center", padding: "0 20px" }}>
      <p style={{ margin: 0, fontSize: 28, fontWeight: 800, color: "#1d4ed8", lineHeight: 1 }}>{value}</p>
      <p style={{ margin: "4px 0 0", fontSize: 11.5, color: "#64748b", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.07em" }}>{label}</p>
    </div>
  );
}

const FEATURES = [
  { icon: <ShieldAlert size={24} />, title: "Real-Time Risk Detection", desc: "AI-powered analysis flags distraction, fatigue, and dangerous driving the moment it happens." },
  { icon: <MapPin size={24} />, title: "Location Intelligence", desc: "Every stop and route is logged with timestamps and GPS coordinates for full traceability." },
  { icon: <Activity size={24} />, title: "Safety Score Engine", desc: "Each driver gets a live safety score updated trip by trip — from 0 to 100." },
  { icon: <Shield size={24} />, title: "Fleet-Wide Protection", desc: "Employers get aggregated risk insights, rankings, and exportable reports in one place." },
  { icon: <Zap size={24} />, title: "Raspberry Pi Powered", desc: "A lightweight on-device module captures road data with no cloud dependency required." },
  { icon: <BarChart3 size={24} />, title: "Trend Analysis", desc: "Weekly score sparklines and behaviour breakdowns reveal patterns over time." },
];

export default function Home() {
  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-white">
      <NeuralNetCanvas />

      <FloatingNav />

      <section className="relative z-10 flex flex-1 flex-col items-center justify-center px-4 pt-48 pb-20 text-center">
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-1000">
          <p className="mb-6 text-sm font-bold uppercase tracking-[0.45em] text-blue-600/70 text-center">
            Driver Attention &amp; Risk Assessment System
          </p>
          <h1 className="font-display text-5xl font-extrabold tracking-tighter text-blue-950 sm:text-9xl text-center">
            DARAS
          </h1>
          <p className="mx-auto mt-6 max-w-lg text-lg font-medium text-blue-700/70">
            See every moment. Miss nothing critical.
            <br />
            <span className="mt-3 block text-xs font-black uppercase tracking-[0.2em] text-blue-600/40">
              Select your portal to continue
            </span>
          </p>

          <div className="mt-16 flex flex-wrap justify-center gap-8">
            <Link href="/driver"
              style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "flex-start", textAlign: "left", background: "rgba(255,255,255,0.88)", border: "1.5px solid rgba(96,165,250,0.3)", borderRadius: 22, padding: "28px 28px 22px", width: "100%", maxWidth: 280, boxShadow: "0 8px 32px -8px rgba(37,99,235,0.12)", backdropFilter: "blur(14px)", textDecoration: "none", transition: "transform 0.22s cubic-bezier(.34,1.56,.64,1),box-shadow 0.22s,border-color 0.22s", overflow: "hidden" }}
              onMouseEnter={e => { const el = e.currentTarget; el.style.transform = "translateY(-6px) scale(1.01)"; el.style.boxShadow = "0 24px 56px -8px rgba(37,99,235,0.22)"; el.style.borderColor = "rgba(59,130,246,0.7)"; }}
              onMouseLeave={e => { const el = e.currentTarget; el.style.transform = "translateY(0) scale(1)"; el.style.boxShadow = "0 8px 32px -8px rgba(37,99,235,0.12)"; el.style.borderColor = "rgba(96,165,250,0.3)"; }}
            >
              <div style={{ position: "absolute", top: -30, right: -30, width: 100, height: 100, borderRadius: "50%", background: "radial-gradient(circle,rgba(96,165,250,0.2),transparent 70%)", pointerEvents: "none" }} />
              <div style={{ color: "#2563eb", marginBottom: 14 }}><Car size={32} strokeWidth={2.5} /></div>
              <span style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", fontFamily: "var(--font-display,inherit)", letterSpacing: "-0.02em" }}>Driver</span>
              <span style={{ marginTop: 8, fontSize: 13, color: "#475569", lineHeight: 1.5 }}>View your scores, trip history, and personal analytics.</span>
              <span style={{ marginTop: 18, fontSize: 13, fontWeight: 700, color: "#2563eb", display: "flex", alignItems: "center", gap: 6 }}>Continue <ArrowRight size={14} strokeWidth={3} /></span>
            </Link>

            <Link href="/employer"
              style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "flex-start", textAlign: "left", background: "linear-gradient(145deg,rgba(30,58,138,0.92),rgba(37,99,235,0.88))", border: "1.5px solid rgba(96,165,250,0.4)", borderRadius: 22, padding: "28px 28px 22px", width: "100%", maxWidth: 280, boxShadow: "0 8px 32px -8px rgba(29,78,216,0.35)", backdropFilter: "blur(14px)", textDecoration: "none", transition: "transform 0.22s cubic-bezier(.34,1.56,.64,1),box-shadow 0.22s", overflow: "hidden" }}
              onMouseEnter={e => { const el = e.currentTarget; el.style.transform = "translateY(-6px) scale(1.01)"; el.style.boxShadow = "0 24px 56px -8px rgba(29,78,216,0.45)"; }}
              onMouseLeave={e => { const el = e.currentTarget; el.style.transform = "translateY(0) scale(1)"; el.style.boxShadow = "0 8px 32px -8px rgba(29,78,216,0.35)"; }}
            >
              <div style={{ position: "absolute", bottom: -20, left: -20, width: 120, height: 120, borderRadius: "50%", background: "radial-gradient(circle,rgba(255,255,255,0.08),transparent 70%)", pointerEvents: "none" }} />
              <div style={{ color: "#fff", marginBottom: 14 }}><Building2 size={32} strokeWidth={2.5} /></div>
              <span style={{ fontSize: 22, fontWeight: 800, color: "#fff", fontFamily: "var(--font-display,inherit)", letterSpacing: "-0.02em" }}>Employer</span>
              <span style={{ marginTop: 8, fontSize: 13, color: "rgba(219,234,254,0.85)", lineHeight: 1.5 }}>Fleet overview, risk rankings, and exportable reports.</span>
              <span style={{ marginTop: 18, fontSize: 13, fontWeight: 700, color: "#93c5fd", display: "flex", alignItems: "center", gap: 6 }}>Continue <ArrowRight size={14} strokeWidth={3} /></span>
            </Link>
          </div>
        </div>
      </section>

      <section style={{ position: "relative", zIndex: 5, padding: "52px 28px 28px", maxWidth: 980, margin: "0 auto", width: "100%", animation: "hero-in 0.7s ease 0.6s both" }}>
        <p style={{ textAlign: "center", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.14em", color: "#3b82f6", marginBottom: 12 }}>Platform Capabilities</p>
        <h2 style={{ textAlign: "center", margin: "0 0 36px", fontSize: "clamp(22px,4vw,32px)", fontWeight: 800, color: "#0f172a", fontFamily: "var(--font-display,inherit)", letterSpacing: "-0.025em" }}>Built for every journey</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 16 }}>
          {FEATURES.map(f => <Feature key={f.title} {...f} />)}
        </div>
      </section>

      <footer className="relative z-10 py-12 text-center border-t border-blue-50 mt-auto">
        <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-slate-300">
          © 2026 DARAS · Safe Journeys Secured · AI Powered
        </p>
      </footer>

      <style>{`
        @keyframes badge-in { from{opacity:0;transform:scale(0.9) translateY(-6px)} to{opacity:1;transform:scale(1) translateY(0)} }
        @keyframes hero-in  { from{opacity:0;transform:translateY(18px)} to{opacity:1;transform:translateY(0)} }
      `}</style>
    </div>
  );
}
