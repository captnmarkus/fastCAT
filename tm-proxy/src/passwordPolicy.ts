import crypto from "crypto";

export const PASSWORD_POLICY = {
  minLength: 12,
  requireLowercase: true,
  requireUppercase: true,
  requireNumber: true,
  requireSymbol: true,
  forbidWhitespace: true
} as const;

export const PASSWORD_POLICY_MESSAGE =
  "Password must be at least 12 characters and include uppercase, lowercase, number, and symbol.";

export function validatePasswordPolicy(password: string): {
  ok: boolean;
  message?: string;
} {
  const value = String(password ?? "");
  if (value.length < PASSWORD_POLICY.minLength) {
    return { ok: false, message: PASSWORD_POLICY_MESSAGE };
  }
  if (PASSWORD_POLICY.forbidWhitespace && /\s/.test(value)) {
    return { ok: false, message: PASSWORD_POLICY_MESSAGE };
  }
  if (PASSWORD_POLICY.requireLowercase && !/[a-z]/.test(value)) {
    return { ok: false, message: PASSWORD_POLICY_MESSAGE };
  }
  if (PASSWORD_POLICY.requireUppercase && !/[A-Z]/.test(value)) {
    return { ok: false, message: PASSWORD_POLICY_MESSAGE };
  }
  if (PASSWORD_POLICY.requireNumber && !/[0-9]/.test(value)) {
    return { ok: false, message: PASSWORD_POLICY_MESSAGE };
  }
  if (PASSWORD_POLICY.requireSymbol && !/[^A-Za-z0-9]/.test(value)) {
    return { ok: false, message: PASSWORD_POLICY_MESSAGE };
  }
  return { ok: true };
}

export function assertPasswordPolicy(password: string): void {
  const result = validatePasswordPolicy(password);
  if (result.ok) return;
  throw Object.assign(new Error(result.message || PASSWORD_POLICY_MESSAGE), {
    code: "WEAK_PASSWORD"
  });
}

function randomFromAlphabet(alphabet: string) {
  return alphabet[crypto.randomInt(0, alphabet.length)]!;
}

function shuffle(input: string[]) {
  for (let i = input.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(0, i + 1);
    [input[i], input[j]] = [input[j]!, input[i]!];
  }
  return input;
}

export function generateStrongPassword(length = 20): string {
  const safeLength = Math.max(length, PASSWORD_POLICY.minLength, 12);

  const lower = "abcdefghijklmnopqrstuvwxyz";
  const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const digits = "0123456789";
  const symbols = "!@#$%^&*()-_=+[]{};:,.?";
  const all = `${lower}${upper}${digits}${symbols}`;

  const chars = [
    randomFromAlphabet(lower),
    randomFromAlphabet(upper),
    randomFromAlphabet(digits),
    randomFromAlphabet(symbols)
  ];
  while (chars.length < safeLength) chars.push(randomFromAlphabet(all));
  const result = shuffle(chars).join("");

  const validation = validatePasswordPolicy(result);
  if (!validation.ok) {
    // Should never happen; fall back to a known-strong template.
    return "Aa1!" + crypto.randomBytes(32).toString("base64url");
  }
  return result;
}

