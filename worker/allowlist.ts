// Who may sign in. ALLOWED_EMAILS unset or empty leaves sign-in open to any Google account,
// as dev and the tests have it; set, only the emails on it (and the owners) get an account.
// Both lists are comma-separated Google emails, compared trimmed and lower-cased. Taking
// someone off the list stops their next sign-in, not a session they already hold (30 days,
// worker/auth.ts); deleting the user from the terminal is the hard stop. See DECISIONS.md.

// A comma-separated secret as a list of lower-cased emails, blanks dropped.
export const emailList = (csv: string | undefined): string[] =>
  (csv ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

export function isAllowed(email: string, env: Pick<Env, "ALLOWED_EMAILS" | "OWNER_EMAILS">): boolean {
  const allowed = emailList(env.ALLOWED_EMAILS);
  if (allowed.length === 0) return true;
  return [...allowed, ...emailList(env.OWNER_EMAILS)].includes(email.toLowerCase());
}
