"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronDown, Mail, CheckCircle } from "lucide-react";
import { FloatingNav } from "../components/floating-nav";
import { NeuralNetCanvas } from "../components/neural-net-canvas";

const Q_AND_A = [
  {
    q: "How does DARAS detect distractions?",
    a: "We use high-frequency computer vision algorithms running on a dedicated Raspberry Pi module. Our AI identifies landmark features on the driver's face to detect eye closure (fatigue), head orientation (looking away), and the presence of objects like mobile phones in real-time."
  },
  {
    q: "Is my privacy protected?",
    a: "Absolutely. DARAS is designed with a 'Privacy-First' architecture. Our AI processing happens locally on the device (Edge AI). We do not record or stream continuous video to the cloud; we only log the specific metadata and risk events (e.g., 'Distraction Detected at 14:00') that are essential for safety reporting."
  },
  {
    q: "How is the Safety Score calculated?",
    a: "The score is a weighted average of your driving performance. It starts at 100 for every trip. Points are deducted based on the severity and frequency of detected distractions, fatigue events, and dangerous behaviors. Smooth, focused trips restore your standing over time."
  },
  {
    q: "Can DARAS be used for personal cars?",
    a: "Yes! While many enterprises use us for fleet management, our 'Individual' portal is specifically designed for personal use, allowing families to monitor the safety of teen drivers or senior family members to ensure everyone gets home safely."
  }
];

export default function FAQPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [question, setQuestion] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isSent, setIsSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSending(true);
    try {
      const res = await fetch("/api/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, issue: question, type: "FAQ Inquiry" }),
      });
      if (res.ok) {
        setIsSent(true);
        setName("");
        setEmail("");
        setQuestion("");
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-white">
      
      <NeuralNetCanvas />
      
      <FloatingNav />

      <main className="relative z-10 flex flex-1 flex-col items-center px-6 pt-48 pb-20">
        <div className="w-full max-w-4xl animate-fade-in">
          <div className="text-center mb-16">
            <h1 className="font-display text-5xl font-extrabold tracking-tight text-blue-950">Frequently Asked Questions</h1>
            <p className="mt-4 text-lg text-slate-500">Everything you need to know about DARAS technology and safety.</p>
          </div>

          <div className="grid gap-6">
            {Q_AND_A.map((qa, index) => (
              <details 
                key={index} 
                className="group rounded-3xl border border-blue-100 bg-white/60 p-8 backdrop-blur-md shadow-sm transition-all hover:bg-white/80"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between font-display text-xl font-bold text-blue-950">
                  {qa.q}
                  <ChevronDown className="text-blue-600 transition-transform duration-300 group-open:rotate-180" size={20} />
                </summary>
                <div className="mt-6 text-lg leading-relaxed text-slate-600">
                  {qa.a}
                </div>
              </details>
            ))}
          </div>

          <div className="mt-20 rounded-[3rem] bg-blue-600 p-12 text-white shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 right-0 p-8 opacity-10">
              <Mail size={120} className="text-white" />
            </div>
            
            <div className="relative z-10 grid md:grid-cols-2 gap-12 items-center">
              <div className="text-left">
                <h2 className="text-4xl font-black tracking-tight">Further Questions?</h2>
                <p className="mt-4 text-lg text-blue-100 font-medium">
                  If you didn&apos;t find what you were looking for, send us a direct message. Our engineers usually respond within 24 hours.
                </p>
                <div className="mt-8 flex items-center gap-4">
                  <div className="h-12 w-12 rounded-full bg-blue-500/30 flex items-center justify-center border border-blue-400/30 text-white">
                    <Mail size={20} />
                  </div>
                  <span className="font-bold text-blue-50">darascomp@gmail.com</span>
                </div>
              </div>

              <form onSubmit={handleSubmit} className="bg-white/10 backdrop-blur-md rounded-[2.5rem] p-8 border border-white/20">
                {isSent ? (
                  <div className="py-12 text-center animate-in fade-in zoom-in">
                    <div className="flex justify-center mb-4">
                      <CheckCircle size={48} className="text-white" />
                    </div>
                    <h3 className="text-2xl font-bold">Question Received!</h3>
                    <p className="mt-2 text-blue-100">Check your inbox soon.</p>
                    <button 
                      onClick={() => setIsSent(false)}
                      className="mt-6 text-sm font-bold underline opacity-80"
                    >
                      Send another
                    </button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <input 
                      required
                      type="text" 
                      placeholder="Your Name" 
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full bg-white/10 border border-white/20 rounded-2xl px-6 py-4 placeholder:text-blue-100 text-white focus:outline-none focus:ring-2 focus:ring-white/30 transition"
                    />
                    <input 
                      required
                      type="email" 
                      placeholder="Your Email" 
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full bg-white/10 border border-white/20 rounded-2xl px-6 py-4 placeholder:text-blue-100 text-white focus:outline-none focus:ring-2 focus:ring-white/30 transition"
                    />
                    <textarea 
                      required
                      rows={3}
                      placeholder="Your Question..." 
                      value={question}
                      onChange={(e) => setQuestion(e.target.value)}
                      className="w-full bg-white/10 border border-white/20 rounded-2xl px-6 py-4 placeholder:text-blue-100 text-white focus:outline-none focus:ring-2 focus:ring-white/30 transition resize-none"
                    />
                    <button 
                      type="submit"
                      disabled={isSending}
                      className="w-full bg-white text-blue-600 font-black uppercase tracking-widest py-4 rounded-2xl shadow-xl hover:-translate-y-1 transition-all active:translate-y-0 disabled:opacity-50"
                    >
                      {isSending ? "Sending..." : "Send Inquiry"}
                    </button>
                  </div>
                )}
              </form>
            </div>
          </div>
        </div>
      </main>

      <footer className="relative z-10 py-10 text-center text-sm text-slate-400">
        © 2026 DARAS · Helping you stay focused.
      </footer>
    </div>
  );
}
