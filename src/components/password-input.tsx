"use client";

import { useState, type InputHTMLAttributes } from "react";

/** Campo de senha com o olhinho: clicar mostra o que foi digitado, clicar de novo esconde. */
export function PasswordInput({ style, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [visible, setVisible] = useState(false);
  const label = visible ? "Esconder senha" : "Mostrar senha";
  return <div style={{ position: "relative", display: "block", width: "100%" }}>
    <input {...props} type={visible ? "text" : "password"} style={{ ...style, width: "100%", boxSizing: "border-box", paddingRight: 40 }} />
    <button type="button" onClick={() => setVisible((v) => !v)} aria-label={label} title={label} aria-pressed={visible}
      style={{
        position: "absolute", top: "50%", right: 4, transform: "translateY(-50%)", width: 32, height: 32, minWidth: 0, margin: 0, padding: 0,
        display: "grid", placeItems: "center", border: 0, borderRadius: 6, background: "transparent", boxShadow: "none",
        color: "inherit", opacity: 0.55, cursor: "pointer",
      }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {visible
          ? <><path d="M10.7 5.1A10.4 10.4 0 0 1 12 5c6 0 9.5 7 9.5 7a17 17 0 0 1-2.2 3.1" /><path d="M6.6 6.6C3.9 8.4 2.5 12 2.5 12S6 19 12 19a9.7 9.7 0 0 0 5.4-1.6" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /><path d="m2 2 20 20" /></>
          : <><path d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z" /><circle cx="12" cy="12" r="3" /></>}
      </svg>
    </button>
  </div>;
}
