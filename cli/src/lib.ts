/**
 * Pure, side-effect-light helpers re-exported for the node:test suite
 * (tests import from dist/lib.js so they run against the built artifact).
 */
export {
  CONFIG_KEY_TYPES,
  coerceConfigValue,
  configPath,
  defaultConfig,
  detectPlatform,
  loadConfig,
  metricsStoreUrl,
  saveConfig,
  STORE_SERVICE,
  type ConfigKey,
  type SwitchyardConfig,
} from "./core/config.js";
export { parseJsonLines } from "./core/docker.js";
export { UserError } from "./core/errors.js";
export { LOCAL_INGRESS_CONTAINER, renderLocalIngress } from "./core/local-ingress.js";
export { nextFreePort, portFree } from "./core/ports.js";
export { renderContainer } from "./core/switchyard-container.js";
export { generatePassword, isValidEmail, parsePort, randomSecret, sha256 } from "./core/util.js";
export { CLI_VERSION } from "./version.js";
