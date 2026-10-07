import { redirect } from "next/navigation";

/** A página virou a aba "SharePoint" em Conexões. */
export default function SharePointRedirect() {
  redirect("/conexoes?aba=sharepoint");
}
