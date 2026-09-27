import { z } from "zod";

/**
 * `quality.json_schema` → a body validator. The schema is compiled once per
 * distinct schema text (policies are re-evaluated on every call, so this
 * must not re-parse on the hot path) with Zod's own JSON Schema importer —
 * no extra dependency in the SDK.
 */

const cache = new Map<string, (body: string) => boolean>();

/** Throws if `schemaText` isn't valid JSON or isn't a usable JSON Schema —
 *  surfaced at policy-save / guard-construction time, never mid-payment. */
export function compileBodySchema(schemaText: string): (body: string) => boolean {
  const hit = cache.get(schemaText);
  if (hit) return hit;

  let parsed: unknown;
  try {
    parsed = JSON.parse(schemaText);
  } catch (err) {
    throw new Error(
      `quality.json_schema is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (typeof parsed !== "object" && typeof parsed !== "boolean") {
    throw new Error("quality.json_schema must be a JSON Schema object");
  }
  const schema = z.fromJSONSchema(parsed as Parameters<typeof z.fromJSONSchema>[0]);

  const validate = (body: string): boolean => {
    let json: unknown;
    try {
      json = JSON.parse(body);
    } catch {
      // A body the schema can't even parse is, by definition, not what the
      // schema describes — that's exactly a schema mismatch.
      return false;
    }
    return schema.safeParse(json).success;
  };
  cache.set(schemaText, validate);
  return validate;
}

/** `null` when no schema is configured. */
export function bodyValidatorFor(
  schemaText: string | null | undefined,
): ((body: string) => boolean) | undefined {
  return schemaText ? compileBodySchema(schemaText) : undefined;
}
