/**
 * Helpers re-exported for the node:test suite
 * (tests import from dist/lib.js so they run against the built artifact).
 */
export { connectDeployClient, createDeployCommand, deployDirectory } from "./commands/deploy.js";
export { DEFAULT_DEPLOY_MAX_BYTES, packDirectory } from "./core/deploy-pack.js";
export { uploadApplication } from "./core/dokploy-api.js";
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
export {
  darwinEngineCandidates,
  dockerHostUrl,
  engineFallbackHint,
  parseJsonLines,
  type EngineCandidate,
} from "./core/docker.js";
export {
  CONTROL_PLANE_RESET_NOTICE,
  CONTROL_PLANE_STOP_NOTICE,
  downControlPlane,
  planControlPlaneDown,
  type ControlPlaneResource,
} from "./core/control-plane.js";
export { UserError } from "./core/errors.js";
export { LOCAL_INGRESS_CONTAINER, renderLocalIngress } from "./core/local-ingress.js";
export { nextFreePort, portFree } from "./core/ports.js";
export {
  collectComposeIds,
  needsRepair,
  parseContainerRows,
  type ContainerRow,
  type RepairResult,
} from "./core/repair.js";
export { ensureSwitchyard, renderContainer } from "./core/switchyard-container.js";
export { generatePassword, isValidEmail, parsePort, randomSecret, sha256 } from "./core/util.js";
export { dockerDesktopPlatform } from "./platform/docker-desktop.js";
export { linuxPlatform, runScript } from "./platform/linux.js";
export { CLI_VERSION } from "./version.js";
