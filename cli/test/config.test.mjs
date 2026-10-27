import assert from "node:assert/strict";
import fs, {
  chmodSync,
  existsSync,
  fstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { mock } from "node:test";

import { coerceConfigValue, configPath, defaultConfig, loadConfig, saveConfig, UserError } from "../dist/lib.js";

const PORT_KEYS = ["dokployPort", "dashboardPort", "localIngressHttpPort", "localIngressHttpsPort"];

function withTempConfig(fn) {
  const dir = mkdtempSync(join(tmpdir(), "switchyard-test-"));
  const file = join(dir, "config.json");
  const prev = process.env.SWITCHYARD_CONFIG;
  process.env.SWITCHYARD_CONFIG = file;
  try {
    return fn(file);
  } finally {
    if (prev === undefined) delete process.env.SWITCHYARD_CONFIG;
    else process.env.SWITCHYARD_CONFIG = prev;
    rmSync(dir, { recursive: true, force: true });
  }
}

function withFsMock(method, implementation, fn) {
  const mocked = mock.method(fs, method, implementation);
  syncBuiltinESMExports();
  try {
    return fn();
  } finally {
    mocked.mock.restore();
    syncBuiltinESMExports();
  }
}

test("SWITCHYARD_CONFIG override + save/load roundtrip", () => {
  withTempConfig((file) => {
    assert.equal(configPath(), file);
    const first = loadConfig();
    assert.equal(first.existed, false);
    assert.equal(first.config.dashboardPort, 3001);

    const config = { ...first.config, dashboardPort: 3101, adminEmail: "x@y.zz" };
    saveConfig(config, file);
    const second = loadConfig();
    assert.equal(second.existed, true);
    assert.deepEqual(second.config, config);
    const contents = readFileSync(file, "utf8");
    saveConfig(second.config, file);
    assert.equal(readFileSync(file, "utf8"), contents);
    assert.deepEqual(loadConfig().config, config);
    assert.deepEqual(readdirSync(dirname(file)), ["config.json"]);
  });
});

test("configs written by older CLIs gain new defaults", () => {
  withTempConfig((file) => {
    writeFileSync(file, JSON.stringify({ dashboardPort: 4000 }), "utf8");
    const { config } = loadConfig();
    assert.equal(config.dashboardPort, 4000);
    assert.equal(config.dokployPort, 3000); // default filled in
    assert.equal(config.image, "ghcr.io/sbdeals/switchyard");
  });
});

test("invalid JSON is a user error, not a crash", () => {
  withTempConfig((file) => {
    writeFileSync(file, "{ not json", "utf8");
    assert.throws(() => loadConfig(), /not valid JSON/);
  });
});

test("coerceConfigValue types and errors", () => {
  assert.equal(coerceConfigValue("dashboardPort", "3101"), 3101);
  assert.equal(coerceConfigValue("expose", "true"), true);
  assert.equal(coerceConfigValue("expose", "0"), false);
  assert.equal(coerceConfigValue("adminEmail", "a@b.co"), "a@b.co");
  assert.throws(() => coerceConfigValue("dashboardPort", "abc"), /integer/);
  assert.throws(() => coerceConfigValue("expose", "maybe"), /true or false/);
});

for (const key of PORT_KEYS) {
  test(`${key} accepts only ports in 1–65535`, () => {
    for (const value of ["1", "3001", "65535"]) {
      assert.equal(coerceConfigValue(key, value), Number(value));
    }
    for (const value of ["0", "-1", "65536", "abc", "1.5", ""]) {
      assert.throws(() => coerceConfigValue(key, value), (err) => {
        assert.ok(err instanceof UserError);
        assert.ok(err.message.includes(key));
        assert.match(err.message, /integer between 1 and 65535/);
        return true;
      });
    }
  });

  test(`loadConfig rejects invalid ${key} with the key and file path`, () => {
    withTempConfig((file) => {
      for (const value of [0, -1, 65536, "abc", 1.5, "3001", null, true, [], {}]) {
        writeFileSync(file, JSON.stringify({ [key]: value }), "utf8");
        assert.throws(() => loadConfig(), (err) => {
          assert.ok(err instanceof UserError);
          assert.ok(err.message.includes(key));
          assert.ok(err.message.includes(file));
          return true;
        });
      }
      for (const value of [1, 65535]) {
        writeFileSync(file, JSON.stringify({ [key]: value }), "utf8");
        assert.equal(loadConfig().config[key], value);
      }
    });
  });
}

test("loadConfig rejects non-object JSON instead of silently using defaults", () => {
  withTempConfig((file) => {
    for (const value of [null, [], true, 42, "config"]) {
      writeFileSync(file, JSON.stringify(value), "utf8");
      assert.throws(() => loadConfig(), (err) => {
        assert.ok(err instanceof UserError);
        assert.ok(err.message.includes(file));
        assert.match(err.message, /JSON object/);
        return true;
      });
    }
  });
});

test("config is private from creation under umask 000 and existing directory modes are preserved", {
  skip: process.platform === "win32",
}, () => {
  withTempConfig((file) => {
    const previousUmask = process.umask(0);
    const originalOpen = fs.openSync;
    try {
      const dir = join(dirname(file), "new", "nested");
      const target = join(dir, "config.json");
      let opened = false;
      withFsMock("openSync", (path, flags, mode) => {
        const fd = originalOpen(path, flags, mode);
        if (flags === "wx") {
          opened = true;
          assert.equal(dirname(path), dir);
          assert.equal(mode, 0o600);
          assert.equal(fstatSync(fd).mode & 0o777, 0o600);
          assert.equal(fstatSync(fd).size, 0);
        }
        return fd;
      }, () => saveConfig(defaultConfig(), target));
      assert.equal(opened, true);
      assert.equal(statSync(target).mode & 0o777, 0o600);
      assert.equal(statSync(dir).mode & 0o777, 0o700);
      assert.equal(statSync(dirname(dir)).mode & 0o777, 0o700);
      assert.deepEqual(readdirSync(dir), ["config.json"]);

      chmodSync(dir, 0o755);
      chmodSync(target, 0o644);
      saveConfig(defaultConfig(), target);
      assert.equal(statSync(dir).mode & 0o777, 0o755);
      assert.equal(statSync(target).mode & 0o777, 0o600);
    } finally {
      process.umask(previousUmask);
    }
  });
});

test("the old config remains intact until the complete, fsynced replacement is renamed", () => {
  withTempConfig((file) => {
    const config = defaultConfig();
    saveConfig(config, file);
    const original = readFileSync(file, "utf8");
    const next = { ...config, dashboardPort: 3101 };
    const originalFsync = fs.fsyncSync;
    const originalRename = fs.renameSync;
    let synced = false;
    let renamed = false;
    withFsMock("fsyncSync", (fd) => {
      originalFsync(fd);
      synced = true;
    }, () => {
      withFsMock("renameSync", (source, target) => {
        assert.equal(synced, true);
        assert.equal(target, file);
        assert.equal(dirname(source), dirname(file));
        assert.equal(readFileSync(file, "utf8"), original);
        assert.deepEqual(JSON.parse(readFileSync(source, "utf8")), next);
        originalRename(source, target);
        renamed = true;
      }, () => saveConfig(next, file));
    });
    assert.equal(renamed, true);
    assert.deepEqual(loadConfig().config, next);
  });
});

for (const operation of ["fchmodSync", "writeFileSync", "fsyncSync", "renameSync"]) {
  test(`failed ${operation} preserves the config and removes the temporary file`, {
    skip: operation === "fchmodSync" && process.platform === "win32",
  }, () => {
    withTempConfig((file) => {
      for (const existed of [false, true]) {
        if (existed) saveConfig(defaultConfig(), file);
        const original = existed ? readFileSync(file, "utf8") : undefined;
        withFsMock(operation, () => {
          throw Object.assign(new Error("injected failure"), { code: "EACCES" });
        }, () => {
          assert.throws(() => saveConfig({ ...defaultConfig(), dashboardPort: 3101 }, file), (err) => {
            assert.ok(err instanceof UserError);
            assert.ok(err.message.includes(file));
            assert.match(err.message, /EACCES/);
            return true;
          });
        });
        assert.equal(existsSync(file), existed);
        if (existed) assert.equal(readFileSync(file, "utf8"), original);
        assert.deepEqual(readdirSync(dirname(file)), existed ? ["config.json"] : []);
      }
    });
  });
}

test("failed exclusive creation does not remove an existing temporary path", () => {
  withTempConfig((file) => {
    let collision;
    withFsMock("openSync", (path, flags, mode) => {
      assert.equal(flags, "wx");
      assert.equal(mode, 0o600);
      collision = path;
      mkdirSync(path);
      throw Object.assign(new Error("injected collision"), { code: "EEXIST" });
    }, () => assert.throws(() => saveConfig(defaultConfig(), file), /EEXIST/));
    assert.equal(existsSync(file), false);
    assert.equal(statSync(collision).isDirectory(), true);
  });
});
