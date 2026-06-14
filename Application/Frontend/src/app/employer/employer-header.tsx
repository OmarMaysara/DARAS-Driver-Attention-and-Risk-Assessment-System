import Link from "next/link";

type Props = {
  backHref: string;
  backLabel: string;
};

export function EmployerHeader({ backHref, backLabel }: Props) {
  return (
    <header className="flex items-center justify-between gap-4 border-b border-blue-200/80 bg-white/80 px-4 py-3 backdrop-blur-md sm:px-6">
      <Link
        href={backHref}
        className="shrink-0 text-sm text-blue-600 transition hover:text-blue-800"
      >
        {backLabel}
      </Link>
      <Link href="/" className="font-display text-lg tracking-tight text-blue-950 transition hover:text-blue-700">DARAS</Link>
      <span className="shrink-0 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-800">
        Employer
      </span>
    </header>
  );
}
