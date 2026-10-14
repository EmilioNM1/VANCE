import Link from "next/link";
import { Logo } from "@/components/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-paper px-4 py-10">
      <Link href="/" className="mb-8 text-text">
        <Logo />
      </Link>
      <div className="w-full max-w-sm rounded-xl border border-line bg-surface p-6 sm:p-7">{children}</div>
    </div>
  );
}
