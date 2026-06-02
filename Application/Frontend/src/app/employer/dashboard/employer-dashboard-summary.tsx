"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { EMPLOYER_REGISTRATION_KEY, type EmployerRegistration } from "../employer-session";

function parseRegistration(): EmployerRegistration | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(EMPLOYER_REGISTRATION_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as unknown;
    if (!data || typeof data !== "object" || !("kind" in data)) return null;
    if ((data as { kind: string }).kind === "enterprise") {
      const d = data as unknown as {
        id: number;
        companyName?: string;
        country?: string;
        companyEmail?: string;
        phoneNumber?: string;
      };
      if (d.id && d.companyName && d.country && d.phoneNumber)
        return {
          id: d.id,
          kind: "enterprise",
          companyName: d.companyName,
          country: d.country,
          companyEmail: d.companyEmail ?? "",
          phoneNumber: d.phoneNumber,
        };
    }
    if ((data as { kind: string }).kind === "individual") {
      const d = data as unknown as { id: number; employerName?: string; email?: string; phoneNumber?: string };
      if (d.id && d.employerName && d.phoneNumber)
        return {
          id: d.id,
          kind: "individual",
          employerName: d.employerName,
          email: d.email ?? "",
          phoneNumber: d.phoneNumber,
        };
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function EmployerDashboardSummary() {
  const [data, setData] = useState<EmployerRegistration | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setData(parseRegistration());
  }, []);

  if (!data) return null;

  if (data.kind === "enterprise") {
    return (
      <p className="mt-3 text-sm text-blue-700">
        Overview for{" "}
        <span className="text-blue-950">{data.companyName}</span>
        {" · "}
        {data.country}
      </p>
    );
  }

  return (
    <p className="mt-3 text-sm text-blue-700">
      Signed in as{" "}
      <span className="text-blue-950">{data.employerName}</span>
    </p>
  );
}

export function EmployerDashboardLinks() {
  return (
    <p className="mt-6 flex flex-wrap gap-4">
      <Link href="/" className="text-sm text-blue-600 transition hover:text-blue-800">
        Change role (home)
      </Link>
    </p>
  );
}
