import { redirect } from "next/navigation";
import { requireOfficeSessionOrRedirect } from "@/lib/auth/session";

export default async function HomePage() {
  await requireOfficeSessionOrRedirect();
  redirect("/painel");
}
