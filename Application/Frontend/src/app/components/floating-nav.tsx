"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function FloatingNav({ showLogo = true }: { showLogo?: boolean }) {
  const pathname = usePathname();

  const links = [
    { name: "About", href: "/about" },
    { name: "FAQ", href: "/faq" },
    { name: "Privacy", href: "/privacy" },
    { name: "Contact Us", href: "/support" }
  ];

  return (
    <div className="fixed top-6 left-0 right-0 z-50 flex justify-center px-6 pointer-events-none">
      <header className="pointer-events-auto flex w-full max-w-6xl items-center justify-between rounded-full border border-white/20 bg-white/40 px-5 md:px-10 py-3 md:py-5 shadow-2xl backdrop-blur-3xl animate-in slide-in-from-top-4 duration-700 ring-1 ring-blue-950/5 mx-4">
        <div className="flex items-center gap-12">
          {showLogo && (
            <Link href="/" className="font-display text-2xl font-bold tracking-tighter text-blue-950 transition hover:opacity-70">
              DARAS
            </Link>
          )}
          
          <nav className="hidden md:flex items-center gap-8">
            {links.map((link) => (
              <Link 
                key={link.href} 
                href={link.href}
                className={`text-[11px] font-bold uppercase tracking-[0.2em] transition-all hover:text-blue-600 ${
                  pathname === link.href ? "text-blue-600" : "text-blue-950/60"
                }`}
              >
                {link.name}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-6">
          <Link 
            href="/"
            className="rounded-full bg-blue-600 px-6 py-2.5 text-[10px] font-bold text-white shadow-xl transition hover:-translate-y-0.5 hover:bg-blue-700 active:translate-y-0 uppercase tracking-widest"
          >
            Portals
          </Link>
        </div>
      </header>
    </div>
  );
}
