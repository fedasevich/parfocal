import { z } from "zod";

export const accountCodeSentSchema = z.object({
  email: z.string(),
  expires_minutes: z.number().int().positive(),
  resend_seconds: z.number().int().nonnegative(),
});

export type AccountCodeSent = z.infer<typeof accountCodeSentSchema>;
