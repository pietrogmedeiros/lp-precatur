import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { isMountPoint } from "../src/server/volume.js";

describe("isMountPoint", () => {
  let dir: string;
  after(() => rm(dir, { recursive: true, force: true }));

  it("reconhece o volume pelo mountinfo", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "lp-volume-"));
    const file = path.join(dir, "mountinfo");
    await writeFile(
      file,
      [
        "22 1 0:21 / / rw,relatime - overlay overlay rw",
        "35 22 8:1 /volumes/lp /app/data rw,relatime - ext4 /dev/sda1 rw",
      ].join("\n"),
    );
    assert.equal(isMountPoint("/app/data", file), true);
    assert.equal(isMountPoint("/app/data/", file), true);
    assert.equal(isMountPoint("/app/outra", file), false);
  });

  it("não sabe dizer fora do Linux", () => {
    assert.equal(isMountPoint("/app/data", "/nao/existe/mountinfo"), null);
  });
});
