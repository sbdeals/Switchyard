declare module "js-yaml" {
  export const DEFAULT_SCHEMA: unknown;
  export function load(input: string, options?: { schema: unknown }): unknown;
}
