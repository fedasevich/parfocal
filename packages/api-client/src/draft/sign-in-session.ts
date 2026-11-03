import { z } from "zod";

export const signInSessionSchema = z.object({ return_to: z.string() });

export type SignInSession = z.infer<typeof signInSessionSchema>;

export const signInLinkSentSchema = z.object({
  email: z.string(),
  expires_minutes: z.number().int().positive(),
  resend_seconds: z.number().int().nonnegative(),
});

export type SignInLinkSent = z.infer<typeof signInLinkSentSchema>;

export const passwordResetSentSchema = z.object({ email: z.string() });

export type PasswordResetSent = z.infer<typeof passwordResetSentSchema>;
