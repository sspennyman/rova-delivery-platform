// A provider acceptance is not proof that an email reached the recipient.
export async function sendDriverInvite(env, driver, inviteUrl, send = fetch) {
  const apiKey = String(env.RESEND_API_KEY || "").trim();
  const from = String(env.INVITE_FROM_EMAIL || "").trim();
  if (!apiKey || !from) return { sent: false, reason: "Automatic email is not connected. Share the invitation link instead." };
  try {
    const response = await send("https://api.resend.com/emails", {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(10000),
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        // Retrying the same invitation must not produce duplicate email.
        "idempotency-key": `driver-invite/${driver.inviteTokenHash}`
      },
      body: JSON.stringify({
        from,
        to: [driver.email],
        subject: "You’re invited to Rivo",
        text: `Hi ${driver.name},\n\nYou’ve been invited to join Rivo as a driver. Create your password and sign in here:\n${inviteUrl}\n\nThis link expires in 7 days. After setup, use your email and the password you choose. If you weren’t expecting this invitation, ignore it.`
      })
    });
    if (!response.ok) return { sent: false, reason: response.status === 429
      ? "Email provider is busy. Share the invitation link or try again later."
      : `Email provider rejected the invitation (${response.status}). Share the invitation link and check the sender setup.` };
    const payload = await response.json().catch(() => ({}));
    if (typeof payload.id !== "string" || !payload.id.trim()) return { sent: false, reason: "Email provider did not confirm acceptance. Share the invitation link instead." };
    return { sent: true, providerMessageId: payload.id };
  } catch {
    return { sent: false, reason: "Email acceptance could not be confirmed. Share the invitation link instead." };
  }
}
