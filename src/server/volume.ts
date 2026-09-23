import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Diz se a pasta é um ponto de montagem (volume do Docker/Easypanel).
 * Sem volume, o leads.jsonl fica na camada do container e some a cada deploy.
 * Retorna null quando não dá para saber (fora do Linux).
 */
export function isMountPoint(dir: string, mountinfoFile = "/proc/self/mountinfo"): boolean | null {
  let mountinfo: string;
  try {
    mountinfo = readFileSync(mountinfoFile, "utf8");
  } catch {
    return null;
  }
  const target = path.resolve(dir);
  // 5º campo de cada linha é o ponto de montagem.
  return mountinfo.split("\n").some((line) => line.split(" ")[4] === target);
}
