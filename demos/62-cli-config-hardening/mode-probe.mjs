// Preload: print the config file's mode at the moment before chmod (old code) or before rename (new code).
import fs from "node:fs"; import { syncBuiltinESMExports } from "node:module";
const st = (p) => { try { return (fs.statSync(p).mode & 0o777).toString(8); } catch { return "?"; } };
const oc = fs.chmodSync; fs.chmodSync = (p, m) => { console.error(`  [probe] before chmod: ${String(p).replace(/.*\//, "")} mode ${st(p)}`); return oc(p, m); };
const orn = fs.renameSync; fs.renameSync = (a, b) => { console.error(`  [probe] temp file before rename: mode ${st(a)}`); return orn(a, b); };
syncBuiltinESMExports();
