import { ClipboardList } from "lucide-react";
import type { ApplicationRecord } from "../models/domain";
import { EmptyState } from "../components/EmptyState";

interface ApplicationTrackerPageProps {
  applications: ApplicationRecord[];
}

export function ApplicationTrackerPage({
  applications
}: ApplicationTrackerPageProps) {
  return (
    <div className="space-y-6">
      <header className="max-w-3xl">
        <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">
          Tracker
        </p>
        <h2 className="mt-2 text-3xl font-semibold text-slate-950">
          Application tracker
        </h2>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Approved, submitted, interviewing, offer, and archived records will be tracked here.
        </p>
      </header>

      {applications.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No applications tracked"
          message="Application records will appear here only after a user-approved workflow creates them."
        />
      ) : (
        <section className="overflow-hidden rounded-lg border border-line bg-white shadow-soft">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="bg-panel text-slate-600">
              <tr>
                <th className="px-4 py-3 font-semibold">Job</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Updated</th>
                <th className="px-4 py-3 font-semibold">Notes</th>
              </tr>
            </thead>
            <tbody>
              {applications.map((application) => (
                <tr key={application.id} className="border-t border-slate-200">
                  <td className="px-4 py-3">{application.jobId}</td>
                  <td className="px-4 py-3">{application.status}</td>
                  <td className="px-4 py-3">
                    {new Date(application.updatedAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">{application.notes || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
