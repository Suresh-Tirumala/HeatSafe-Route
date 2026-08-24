import { describe, it, expect, beforeEach } from "vitest";
import { signUp, signIn, findUser, getUsers } from "../utils/auth";

describe("auth store (localStorage-backed)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("signUp creates a retrievable account", () => {
    const result = signUp("Suresh Kumar", "suresh@example.com", "strongpass123");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.user.email).toBe("suresh@example.com");
      expect(result.user.name).toBe("Suresh Kumar");
    }
    expect(findUser("suresh@example.com")).toBeDefined();
    expect(getUsers()).toHaveLength(1);
  });

  it("signUp normalizes email case", () => {
    signUp("A B", "Mixed.Case@Example.COM", "password123");
    expect(findUser("mixed.case@example.com")).toBeDefined();
  });

  it("signUp rejects duplicate emails", () => {
    signUp("First", "dup@example.com", "password123");
    const second = signUp("Second", "dup@example.com", "otherpass123");
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe("email-exists");
  });

  it("signUp rejects short passwords and bad emails", () => {
    const short = signUp("A", "a@example.com", "short");
    const badEmail = signUp("A", "not-an-email", "longenough1");
    expect(short.ok).toBe(false);
    expect(badEmail.ok).toBe(false);
    expect(getUsers()).toHaveLength(0);
  });

  it("signIn fails with no-account for unknown email", () => {
    const result = signIn("ghost@example.com", "whatever123");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("no-account");
  });

  it("signIn fails with wrong-password for known account", () => {
    signUp("Real User", "real@example.com", "correct-horse");
    const result = signIn("real@example.com", "wrong-pass");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("wrong-password");
  });

  it("signIn succeeds with correct credentials", () => {
    signUp("Real User", "real@example.com", "correct-horse");
    const result = signIn("real@example.com", "correct-horse");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.user.name).toBe("Real User");
  });
});
