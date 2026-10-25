const service = { id: "sy-shell-approval-demo", name: "Shell approval demo", appName: "sy-shell-approval-demo", kind: "application" };
module.exports = new Proxy({
  ENGINES: ["postgres", "mysql", "mariadb", "mongo", "redis"],
  loadWorkspace: async () => ({ services: [service], projects: [] }),
  getDokployRole: async (cookie) => { if (cookie !== "sess=local-smoke-fixture") throw new Error("Wrong fixture session"); return "admin"; },
  DokploySessionExpiredError: class extends Error {},
}, { get(target, prop) { return prop in target ? target[prop] : () => { throw new Error("Forbidden fixture operation: " + String(prop)); }; } });
