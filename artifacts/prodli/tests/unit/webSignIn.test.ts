import { createHash } from "crypto";
import { describe, expect, it } from "vitest";
import { challengeFor, checkSignInMessage, knownWithoutChromeSignIn, webSignInUrl, WEB_SIGNIN_MESSAGE } from "../../src/lib/webSignIn";
import { parseExtensionHandoff } from "../../src/lib/desktopHandoff";

const ID = "gjgknflakhglanjaeenkmciohimnbkdp";
const STATE = "s".repeat(32);
const CODE = `plec_${"c".repeat(43)}`;
const ORIGIN = "https://app.prodli.com";
const pending = { state: STATE, verifier: "v".repeat(64), createdAt: 1_000_000 };

describe("extension sign-in through app.prodli.com", () => {
  it("the challenge is base64url(SHA-256(verifier)), like the server's", async () => {
    const v = "a1B2c3D4e5F6g7H8i9J0k-._~" + "x".repeat(30);
    expect(await challengeFor(v)).toBe(createHash("sha256").update(v).digest("base64url"));
    expect(await challengeFor(v)).toHaveLength(43);
  });

  it("opens the web app's hand-off page, which reads the same request back", async () => {
    const challenge = await challengeFor("v".repeat(64));
    const url = webSignInUrl(`${ORIGIN}/`, ID, STATE, challenge);
    expect(url.startsWith(`${ORIGIN}/?extension=signin&id=${ID}&`)).toBe(true);
    expect(parseExtensionHandoff(new URL(url).search)).toEqual({ extensionId: ID, state: STATE, challenge });
  });

  it("the hand-off page ignores malformed requests", () => {
    expect(parseExtensionHandoff("?extension=signin&id=NOTANID&state=" + STATE + "&challenge=" + "c".repeat(43))).toBeNull();
    expect(parseExtensionHandoff(`?extension=signin&id=${ID}&state=short&challenge=${"c".repeat(43)}`)).toBeNull();
    expect(parseExtensionHandoff(`?extension=signin&id=${ID}&state=${STATE}&challenge=short`)).toBeNull();
    expect(parseExtensionHandoff(`?desktop=signin&id=${ID}`)).toBeNull();
  });

  it("accepts only the code it asked for, from app.prodli.com, in time", () => {
    const msg = { type: WEB_SIGNIN_MESSAGE, code: CODE, state: STATE };
    expect(checkSignInMessage(msg, ORIGIN, ORIGIN, pending, pending.createdAt + 60_000)).toBeNull();
    expect(checkSignInMessage({ type: "other" }, ORIGIN, ORIGIN, pending)).toBe("not_signin");
    expect(checkSignInMessage(msg, "https://evil.example", ORIGIN, pending)).toBe("wrong_sender");
    expect(checkSignInMessage(msg, undefined, ORIGIN, pending)).toBe("wrong_sender");
    expect(checkSignInMessage({ ...msg, code: `pldc_${"c".repeat(43)}` }, ORIGIN, ORIGIN, pending)).toBe("bad_message");
    expect(checkSignInMessage({ ...msg, state: "t".repeat(32) }, ORIGIN, ORIGIN, pending)).toBe("not_started");
    expect(checkSignInMessage(msg, ORIGIN, ORIGIN, null)).toBe("not_started");
    expect(checkSignInMessage(msg, ORIGIN, ORIGIN, pending, pending.createdAt + 16 * 60_000)).toBe("expired");
  });

  it("goes straight to the web sign-in in browsers without Chrome's Google sign-in", () => {
    const brands = (...b: string[]) => ({ userAgentData: { brands: b.map((brand) => ({ brand })) } });
    expect(knownWithoutChromeSignIn(brands("Chromium", "Microsoft Edge"))).toBe(true);
    expect(knownWithoutChromeSignIn(brands("Opera", "Chromium"))).toBe(true);
    expect(knownWithoutChromeSignIn({ ...brands("Chromium"), brave: {} })).toBe(true);
    expect(knownWithoutChromeSignIn({ userAgent: "Mozilla/5.0 … Chrome/131.0 Safari/537.36 Edg/131.0" })).toBe(true);
    expect(knownWithoutChromeSignIn(brands("Google Chrome", "Chromium", "Not_A Brand"))).toBe(false);
    // Vivaldi, Arc and others look like Chrome: Chrome's sign-in is tried first, and the web sign-in follows if it fails.
    expect(knownWithoutChromeSignIn(brands("Chromium", "Not_A Brand"))).toBe(false);
  });
});
