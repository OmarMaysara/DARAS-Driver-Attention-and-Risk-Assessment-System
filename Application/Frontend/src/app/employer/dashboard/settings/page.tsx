"use client";

import { useEffect, useState } from "react";
import { EMPLOYER_REGISTRATION_KEY, type EmployerRegistration } from "../../employer-session";
import { useToast } from "../../../components/toast-context";

export default function EmployerSettingsPage() {
  const { showToast } = useToast();
  const [profile, setProfile] = useState<EmployerRegistration | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(EMPLOYER_REGISTRATION_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw) setProfile(JSON.parse(raw));
    } catch { /* ignore */ }
    setTimeout(() => setIsLoading(false), 800);
  }, []);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (profile) {
      sessionStorage.setItem(EMPLOYER_REGISTRATION_KEY, JSON.stringify(profile));
      showToast("Profile settings updated successfully!", "success");
    }
  };

  if (isLoading) return (
    <div className="p-12 space-y-8 animate-fade-in">
      <div className="h-10 w-48 rounded-2xl skeleton" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="h-64 rounded-3xl skeleton" />
        <div className="h-64 rounded-3xl skeleton" />
      </div>
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto p-12 animate-fade-in">
      <h1 className="font-display text-4xl font-extrabold tracking-tight text-blue-950 mb-12 flex items-center gap-4">
        <span className="text-3xl">⚙️</span> Settings & Profile
      </h1>

      <div className="grid gap-12">
        <form onSubmit={handleSave} className="rounded-[2.5rem] bg-white border border-blue-100 p-12 shadow-sm space-y-8 backdrop-blur-xl">
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-blue-950">Organization Information</h2>
            <p className="text-sm text-slate-500">Manage your registration details and contact point.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
            <div className="space-y-2">
              <label className="text-xs font-bold text-blue-950 uppercase tracking-widest block">
                {profile?.kind === "enterprise" ? "Company name" : "Employer Name"}
              </label>
              <input 
                value={profile?.kind === "enterprise" ? profile.companyName : (profile?.employerName || "")} 
                onChange={e => setProfile(p => {
                  if (!p) return null;
                  if (p.kind === "enterprise") return { ...p, companyName: e.target.value };
                  return { ...p, employerName: e.target.value };
                })}
                className="w-full rounded-2xl border border-blue-100 bg-blue-50/30 p-4 text-sm focus:border-blue-600 outline-none transition-all"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-blue-950 uppercase tracking-widest block">Email Address</label>
              <input 
                value={profile?.kind === "enterprise" ? profile.companyEmail : (profile?.email || "")} 
                onChange={e => setProfile(p => {
                  if (!p) return null;
                  if (p.kind === "enterprise") return { ...p, companyEmail: e.target.value };
                  return { ...p, email: e.target.value };
                })}
                className="w-full rounded-2xl border border-blue-100 bg-blue-50/30 p-4 text-sm focus:border-blue-600 outline-none transition-all"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-blue-950 uppercase tracking-widest block">Phone Number</label>
              <input 
                defaultValue={profile?.phoneNumber} 
                onChange={e => setProfile(p => p ? { ...p, phoneNumber: e.target.value } : null)}
                className="w-full rounded-2xl border border-blue-100 bg-blue-50/30 p-4 text-sm focus:border-blue-600 outline-none transition-all"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-blue-950 uppercase tracking-widest block">Account ID</label>
              <input 
                disabled 
                defaultValue={profile?.id} 
                className="w-full rounded-2xl border border-blue-100 bg-slate-100 p-4 text-sm text-slate-400 font-mono cursor-not-allowed"
              />
            </div>
          </div>

          <div className="pt-4 flex justify-end">
            <button 
              type="submit"
              className="rounded-2xl bg-blue-600 px-10 py-4 font-bold text-white shadow-xl transition hover:-translate-y-1 hover:bg-blue-700"
            >
              Update Profile 💾
            </button>
          </div>
        </form>

        <section className="rounded-[2.5rem] bg-rose-50 border border-rose-100 p-12 space-y-4">
          <h2 className="text-xl font-bold text-rose-950">Security & Privacy</h2>
          <p className="text-sm text-slate-600 max-w-lg">
            Ensure your fleet account is secure. We recommend rotating your synchronization keys 
            every 90 days if using Raspberry Pi hardware integration.
          </p>
          <div className="pt-4 flex gap-4">
            <button className="rounded-2xl border border-rose-200 bg-white/70 px-6 py-3 text-sm font-bold text-rose-600 hover:bg-white transition shadow-sm">
              Change Secret Key
            </button>
            <button className="rounded-2xl border border-rose-200 bg-white/70 px-6 py-3 text-sm font-bold text-rose-600 hover:bg-white transition shadow-sm">
              Manage API Access Tokens
            </button>
          </div>
        </section>
      </div>

      <footer className="py-12 text-center text-[10px] font-bold uppercase tracking-[0.3em] text-blue-200">
        © 2026 DARAS INTELLIGENCE · ENTERPRISE SETTINGS
      </footer>
    </div>
  );
}
