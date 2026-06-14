"use client";

import { EmployeeRankingTable } from "./employee-ranking";
import { DeviceManagementTable } from "./device-management";
import { EmployerDashboardShell } from "./employer-dashboard-shell";

export default function EmployerDashboardPage() {
  return (
    <EmployerDashboardShell>
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col px-6 py-12 animate-fade-in">
        <div className="space-y-12">
          {/* Main Workspace: Fleet Roster */}
          <section>
            <div className="mb-6 flex items-center justify-between px-2">
              <div>
                <h2 className="text-sm font-black uppercase tracking-widest text-blue-950">Fleet Directory</h2>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">Manage driver performance and credentials</p>
              </div>
            </div>
            <EmployeeRankingTable />
          </section>

          {/* Secondary Workspace: Hardware & Operations */}
          <section>
            <div className="mb-6 px-2">
              <h2 className="text-sm font-black uppercase tracking-widest text-blue-950">Hardware Inventory</h2>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">Device health and serial monitoring</p>
            </div>
            <DeviceManagementTable />
          </section>
        </div>
      </main>
    </EmployerDashboardShell>
  );
}
