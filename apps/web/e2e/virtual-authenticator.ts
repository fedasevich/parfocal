import { generateKeyPairSync } from "node:crypto";
import type { CDPSession, Page } from "@playwright/test";

export type VirtualAuthenticator = {
  cdp: CDPSession;
  id: string;
  credentials(): Promise<{ credentialId: string; signCount: number; rpId?: string }[]>;
  saveCredential(rpId?: string): Promise<void>;
  refuseUserVerification(): Promise<void>;
};

export async function addVirtualAuthenticator(page: Page): Promise<VirtualAuthenticator> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId: id } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return {
    cdp,
    id,
    credentials: async () =>
      (await cdp.send("WebAuthn.getCredentials", { authenticatorId: id })).credentials,
    saveCredential: async (rpId = "localhost") => {
      const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
      await cdp.send("WebAuthn.addCredential", {
        authenticatorId: id,
        credential: {
          credentialId: Buffer.from("e2e-passkey").toString("base64"),
          isResidentCredential: true,
          rpId,
          privateKey: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
          userHandle: Buffer.from("fake-user").toString("base64"),
          signCount: 0,
        },
      });
    },
    refuseUserVerification: async () => {
      await cdp.send("WebAuthn.setUserVerified", { authenticatorId: id, isUserVerified: false });
    },
  };
}
