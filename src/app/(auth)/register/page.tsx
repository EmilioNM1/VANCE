import { Suspense } from "react";
import { RegisterForm } from "@/components/auth-forms";

export default function Page() {
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  );
}
