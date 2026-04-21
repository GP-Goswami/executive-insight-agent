import { Resend } from "resend";

let resendClient: Resend | null = null;

function getResendClient(): Resend | null {
  if (!process.env.RESEND_API_KEY) {
    console.warn("RESEND_API_KEY not configured - email sending disabled");
    return null;
  }
  
  if (!resendClient) {
    resendClient = new Resend(process.env.RESEND_API_KEY);
  }
  
  return resendClient;
}

export interface SendEmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export async function sendPasswordResetEmail(
  to: string,
  resetToken: string,
  baseUrl: string
): Promise<SendEmailResult> {
  const client = getResendClient();
  
  if (!client) {
    console.error("Email service not configured - RESEND_API_KEY missing");
    return {
      success: false,
      error: "Email service not configured",
    };
  }

  const resetLink = `${baseUrl}/reset-password?token=${resetToken}`;
  const expiryHours = 1;

  try {
    const { data, error } = await client.emails.send({
      from: process.env.EMAIL_FROM || "Reporting Dashboard <noreply@resend.dev>",
      to: [to],
      subject: "Reset Your Password",
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #0a0a0f; color: #e5e5e5; padding: 40px 20px; margin: 0;">
          <div style="max-width: 500px; margin: 0 auto; background-color: #1a1a2e; border-radius: 12px; padding: 40px; border: 1px solid rgba(255,255,255,0.1);">
            <h1 style="color: #ffffff; font-size: 24px; margin: 0 0 24px 0; text-align: center;">
              Reset Your Password
            </h1>
            
            <p style="color: #a0a0a0; font-size: 16px; line-height: 1.6; margin: 0 0 24px 0;">
              We received a request to reset your password. Click the button below to create a new password.
            </p>
            
            <div style="text-align: center; margin: 32px 0;">
              <a href="${resetLink}" style="display: inline-block; background: linear-gradient(135deg, #06b6d4, #8b5cf6); color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">
                Reset Password
              </a>
            </div>
            
            <p style="color: #a0a0a0; font-size: 14px; line-height: 1.6; margin: 24px 0 0 0;">
              This link will expire in ${expiryHours} hour. If you didn't request a password reset, you can safely ignore this email.
            </p>
            
            <hr style="border: none; border-top: 1px solid rgba(255,255,255,0.1); margin: 32px 0;">
            
            <p style="color: #666666; font-size: 12px; line-height: 1.5; margin: 0; text-align: center;">
              If the button doesn't work, copy and paste this link into your browser:<br>
              <a href="${resetLink}" style="color: #06b6d4; word-break: break-all;">${resetLink}</a>
            </p>
          </div>
        </body>
        </html>
      `,
      text: `
Reset Your Password

We received a request to reset your password. Click the link below to create a new password:

${resetLink}

This link will expire in ${expiryHours} hour.

If you didn't request a password reset, you can safely ignore this email.
      `.trim(),
    });

    if (error) {
      console.error("Resend API error:", error);
      return {
        success: false,
        error: error.message || "Failed to send email",
      };
    }

    console.log(`Password reset email sent to ${to}, messageId: ${data?.id}`);
    return {
      success: true,
      messageId: data?.id,
    };
  } catch (error) {
    console.error("Email sending error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error sending email",
    };
  }
}

export function isEmailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}
