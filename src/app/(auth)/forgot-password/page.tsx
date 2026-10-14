import { Suspense } from "react";
import { ForgotForm } from "@/components/auth-forms";

export default function Page() {
  return (
    <Suspense>
      <ForgotForm />
    </Suspense>
  );
}
