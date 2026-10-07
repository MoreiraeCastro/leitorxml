import { redirect } from "next/navigation";

/** O guia virou a página Ajuda (mais curta). */
export default function GuiaRedirect() {
  redirect("/ajuda");
}
