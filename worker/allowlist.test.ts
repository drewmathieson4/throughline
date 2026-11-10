import { expect, test } from "vitest";
import { emailList, isAllowed } from "./allowlist";

test("the allowlist is open until ALLOWED_EMAILS names someone, then admits those and the owners, any case", () => {
  expect(isAllowed("anyone@example.test", {})).toBe(true);
  expect(isAllowed("anyone@example.test", { ALLOWED_EMAILS: "" })).toBe(true);
  expect(isAllowed("anyone@example.test", { ALLOWED_EMAILS: " , " })).toBe(true);
  const env = { ALLOWED_EMAILS: " Colleague@Example.test ,second@example.test", OWNER_EMAILS: "drew@example.test" };
  expect(isAllowed("colleague@example.test", env)).toBe(true);
  expect(isAllowed("SECOND@example.test", env)).toBe(true);
  expect(isAllowed("Drew@example.test", env)).toBe(true);
  expect(isAllowed("anyone@example.test", env)).toBe(false);
  expect(isAllowed("anyone@example.test", { ALLOWED_EMAILS: "colleague@example.test" })).toBe(false);
  expect(emailList(undefined)).toEqual([]);
  expect(emailList(" A@b.test,, c@d.test ")).toEqual(["a@b.test", "c@d.test"]);
});
