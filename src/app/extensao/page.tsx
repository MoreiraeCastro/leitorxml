import { redirect } from "next/navigation";

/** A página virou a aba "Extensão do Chrome" em Conexões. Mantida porque versões antigas da extensão abrem este endereço. */
export default function ExtensaoRedirect() {
  redirect("/conexoes?aba=extensao");
}
