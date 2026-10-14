import nodemailer from "nodemailer";

/**
 * Envío de correo. Si SMTP_URL no está configurado, el mensaje se escribe en el log del
 * servidor y se indica claramente que NO se ha enviado (solo para desarrollo).
 */
export async function sendMail(msg: { to: string; subject: string; text: string }): Promise<{ delivered: boolean }> {
  const url = process.env.SMTP_URL;
  if (!url) {
    if (process.env.NODE_ENV !== "test") {
      console.warn(`[mail] SMTP_URL no configurado: el correo NO se ha enviado. Contenido para ${msg.to}:\n${msg.text}`);
    }
    return { delivered: false };
  }
  const transport = nodemailer.createTransport(url);
  await transport.sendMail({ from: process.env.MAIL_FROM ?? "VANCE <no-reply@example.com>", ...msg });
  return { delivered: true };
}
