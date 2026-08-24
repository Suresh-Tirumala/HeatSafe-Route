export interface StoredUser {
  name: string;
  email: string;
  password: string;
  createdAt: string;
}

const USERS_KEY = "heatsafe-users";

export type AuthResult =
  | { ok: true; user: StoredUser }
  | { ok: false; error: string; code: "email-exists" | "no-account" | "wrong-password" | "invalid" };

export function getUsers(): StoredUser[] {
  try {
    const raw = window.localStorage.getItem(USERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveUsers(users: StoredUser[]): void {
  window.localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

export function findUser(email: string): StoredUser | undefined {
  const normalized = email.trim().toLowerCase();
  return getUsers().find((u) => u.email === normalized);
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export function signUp(name: string, email: string, password: string): AuthResult {
  const trimmedName = name.trim();
  const normalizedEmail = email.trim().toLowerCase();

  if (!trimmedName) {
    return { ok: false, error: "Please enter your full name.", code: "invalid" };
  }
  if (!isValidEmail(normalizedEmail)) {
    return { ok: false, error: "Please enter a valid email address.", code: "invalid" };
  }
  if (password.length < 8) {
    return { ok: false, error: "Password must be at least 8 characters.", code: "invalid" };
  }
  if (findUser(normalizedEmail)) {
    return {
      ok: false,
      error: "An account with this email already exists. Sign in instead.",
      code: "email-exists",
    };
  }

  const user: StoredUser = {
    name: trimmedName,
    email: normalizedEmail,
    password,
    createdAt: new Date().toISOString(),
  };
  saveUsers([...getUsers(), user]);
  return { ok: true, user };
}

export function signIn(email: string, password: string): AuthResult {
  const normalizedEmail = email.trim().toLowerCase();
  if (!isValidEmail(normalizedEmail)) {
    return { ok: false, error: "Please enter a valid email address.", code: "invalid" };
  }

  const user = findUser(normalizedEmail);
  if (!user) {
    return {
      ok: false,
      error: "No account found for this email. Create one below.",
      code: "no-account",
    };
  }
  if (user.password !== password) {
    return { ok: false, error: "Incorrect password. Try again.", code: "wrong-password" };
  }
  return { ok: true, user };
}
