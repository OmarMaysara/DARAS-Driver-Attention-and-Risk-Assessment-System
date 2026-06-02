"use client";

import { FloatingNav } from "../components/floating-nav";
import { NeuralNetCanvas } from "../components/neural-net-canvas";
import { useState } from "react";
import { useToast } from "../components/toast-context";
import { Mail, Globe, ArrowRight } from "lucide-react";

const INQUIRY_TYPES = [
  "Enterprise Licensing",
  "Fleet Integration & Deployment",
  "Partnership & Reseller Program",
  "API & Technical Integration",
  "Custom Hardware Solutions",
  "Pilot Program Request",
  "Investor Relations",
  "Other Business Inquiry",
];

const CONTACT_CARDS = [
  {
    icon: <Mail size={24} />,
    label: "Business Email",
    value: "darascomp@gmail.com",
    sub: "We respond within 24 hours",
  },
  {
    icon: <Globe size={24} />,
    label: "Headquarters",
    value: "Alexandria, Egypt",
    sub: "DARAS Intelligence Labs",
  },
];

export default function ContactPage() {
  const { showToast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const formData = new FormData(form);
    
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.get("name"),
          email: formData.get("email"),
          company: formData.get("company"),
          issue: formData.get("message"),
          type: "Enterprise Inquiry",
        }),
      });
      
      if (res.ok) {
        showToast("Your inquiry has been received. Our team will contact you shortly.", "success");
        form.reset();
      } else {
        showToast("Something went wrong. Please try again or email us directly.", "error");
      }
    } catch (err) {
      console.error(err);
      showToast("Network error. Please check your connection.", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-white">
      <NeuralNetCanvas />
      <FloatingNav />

      {/* Hero */}
      <section className="relative z-10 pt-44 pb-16 px-6 text-center">
        <p className="text-[11px] font-black uppercase tracking-[0.4em] text-blue-500 mb-4">
          Business Inquiries
        </p>
        <h1 className="font-display text-5xl md:text-6xl font-extrabold tracking-tight text-blue-950 mb-5">
          Let&apos;s Build Something<br />
          <span className="text-blue-600">Together</span>
        </h1>
        <p className="mx-auto max-w-xl text-base text-slate-500 leading-relaxed">
          Whether you&apos;re looking to protect your fleet, integrate DARAS into your platform,
          or explore a partnership — our enterprise team is ready to help.
        </p>
      </section>

      {/* Contact Info Cards */}
      <section className="relative z-10 px-6 pb-10 max-w-4xl mx-auto w-full">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {CONTACT_CARDS.map((card) => (
            <div
              key={card.label}
              className="bg-white/70 border border-blue-100 rounded-3xl p-7 shadow-sm flex items-start gap-5 hover:shadow-md hover:-translate-y-1 transition-all duration-200 backdrop-blur-md"
            >
              <span className="text-blue-600 mt-0.5">{card.icon}</span>
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400 mb-1">
                  {card.label}
                </p>
                <p className="text-sm font-black text-blue-950">{card.value}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">{card.sub}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Form */}
      <main className="relative z-10 flex flex-1 flex-col items-center px-6 pb-24">
        <div className="w-full max-w-3xl">
          <div className="rounded-[2.5rem] border border-blue-100 bg-white/70 backdrop-blur-xl shadow-xl p-10 md:p-14">
            <h2 className="text-2xl font-black text-blue-950 mb-1 tracking-tight">
              Send an Inquiry
            </h2>
            <p className="text-sm text-slate-400 mb-10">
              Fill in the form below and a DARAS enterprise specialist will reach out within one business day.
            </p>

            <form onSubmit={handleSubmit} className="space-y-7">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <input
                    required
                    name="name"
                    className="w-full rounded-2xl border border-blue-100 bg-blue-50/30 px-5 py-4 text-sm text-blue-950 placeholder:text-slate-300 focus:border-blue-600 focus:bg-white outline-none transition-all"
                    placeholder="Jane Smith"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[11px] font-black uppercase tracking-[0.2em] text-blue-950 block">
                    Business Email
                  </label>
                  <input
                    required
                    name="email"
                    type="email"
                    className="w-full rounded-2xl border border-blue-100 bg-blue-50/30 px-5 py-4 text-sm text-blue-950 placeholder:text-slate-300 focus:border-blue-600 focus:bg-white outline-none transition-all"
                    placeholder="jane@company.com"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-[11px] font-black uppercase tracking-[0.2em] text-blue-950 block">
                    Company / Organization
                  </label>
                  <input
                    required
                    name="company"
                    className="w-full rounded-2xl border border-blue-100 bg-blue-50/30 px-5 py-4 text-sm text-blue-950 placeholder:text-slate-300 focus:border-blue-600 focus:bg-white outline-none transition-all"
                    placeholder="Acme Logistics Ltd."
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[11px] font-black uppercase tracking-[0.2em] text-blue-950 block">
                    Fleet Size (approx.)
                  </label>
                  <select className="w-full rounded-2xl border border-blue-100 bg-blue-50/30 px-5 py-4 text-sm text-blue-950 focus:border-blue-600 focus:bg-white outline-none transition-all appearance-none cursor-pointer">
                    <option value="">Select range</option>
                    <option>1 – 10 vehicles</option>
                    <option>11 – 50 vehicles</option>
                    <option>51 – 200 vehicles</option>
                    <option>200+ vehicles</option>
                    <option>Not applicable</option>
                  </select>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[11px] font-black uppercase tracking-[0.2em] text-blue-950 block">
                  Inquiry Type
                </label>
                <select className="w-full rounded-2xl border border-blue-100 bg-blue-50/30 px-5 py-4 text-sm text-blue-950 focus:border-blue-600 focus:bg-white outline-none transition-all appearance-none cursor-pointer">
                  {INQUIRY_TYPES.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-[11px] font-black uppercase tracking-[0.2em] text-blue-950 block">
                  Message
                </label>
                <textarea
                  required
                  name="message"
                  rows={5}
                  className="w-full rounded-2xl border border-blue-100 bg-blue-50/30 px-5 py-4 text-sm text-blue-950 placeholder:text-slate-300 focus:border-blue-600 focus:bg-white outline-none transition-all resize-none"
                  placeholder="Tell us about your use case, team size, or goals..."
                />
              </div>

              <button
                disabled={isSubmitting}
                className="w-full rounded-2xl bg-blue-600 py-4 font-black text-white text-sm uppercase tracking-[0.2em] shadow-xl shadow-blue-200 transition hover:-translate-y-1 hover:bg-blue-700 active:translate-y-0 disabled:bg-blue-300 disabled:transform-none disabled:shadow-none"
              >
                {isSubmitting ? "Sending Inquiry..." : "Submit Business Inquiry"}
                <ArrowRight size={16} className="ml-2 inline-block" />
              </button>

              <p className="text-center text-[11px] text-slate-400">
                By submitting, you agree to our{" "}
                <a href="/privacy" className="text-blue-500 hover:underline font-bold">Privacy Policy</a>.
                We never share your data with third parties.
              </p>
            </form>
          </div>
        </div>
      </main>

      <footer className="relative z-10 py-10 text-center text-sm text-slate-400 border-t border-blue-50">
        © 2026 DARAS · Safe Journeys Secured.
      </footer>
    </div>
  );
}
