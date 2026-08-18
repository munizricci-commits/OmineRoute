/**
 * P6.01 — model-parser: qualified route parsing for `<organization>/<route>`
 * with legacy compatibility (Organizations feature).
 *
 * TDD: parser is pure; cover org-qualified, auto-qualified, personal model,
 * provider-prefixed personal (openai/gpt-4 MUST stay personal), and malformed.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { parseQualifiedModel } from "../../src/lib/org/qualifiedRoute.ts";

test("org-qualified combo route splits into slug + route", () => {
  const r = parseQualifiedModel("team1/combo:dev");
  assert.equal(r.organizationSlug, "team1");
  assert.equal(r.route, "combo:dev");
});

test("org-qualified auto route splits into slug + route", () => {
  const r = parseQualifiedModel("team1/auto:coding");
  assert.equal(r.organizationSlug, "team1");
  assert.equal(r.route, "auto:coding");
});

test("bare model id is personal (no org)", () => {
  const r = parseQualifiedModel("gpt-4");
  assert.equal(r.organizationSlug, undefined);
  assert.equal(r.route, "gpt-4");
});

test("provider-prefixed model id stays PERSONAL, not org", () => {
  const r = parseQualifiedModel("openai/gpt-4");
  assert.equal(r.organizationSlug, undefined, "openai is a provider namespace, not an org");
  assert.equal(r.route, "openai/gpt-4");
});

test("anthropic-prefixed model id stays personal", () => {
  const r = parseQualifiedModel("anthropic/claude-3-opus");
  assert.equal(r.organizationSlug, undefined);
  assert.equal(r.route, "anthropic/claude-3-opus");
});

test("nested provider id with two slashes stays personal", () => {
  const r = parseQualifiedModel("team1/openai/gpt-4");
  // two slashes → treated as a personal provider id, never org-qualified
  assert.equal(r.organizationSlug, undefined);
  assert.equal(r.route, "team1/openai/gpt-4");
});

test("malformed //x normalizes to personal", () => {
  const r = parseQualifiedModel("//x");
  assert.equal(r.organizationSlug, undefined);
  assert.equal(r.route, "//x");
});

test("empty leading/trailing segment normalizes to personal", () => {
  assert.equal(parseQualifiedModel("team1/").route, "team1/");
  assert.equal(parseQualifiedModel("/combo:dev").organizationSlug, undefined);
});

test("empty / non-string input yields empty personal route", () => {
  assert.deepEqual(parseQualifiedModel(""), { route: "" });
  assert.deepEqual(parseQualifiedModel(undefined as unknown as string), { route: "" });
});

test("org slug with uppercase is NOT treated as org (slug is lowercase-only)", () => {
  // ORG_SLUG_RE requires lowercase; a mixed-case leading segment → personal.
  const r = parseQualifiedModel("Team1/combo:dev");
  assert.equal(r.organizationSlug, undefined);
  assert.equal(r.route, "Team1/combo:dev");
});
