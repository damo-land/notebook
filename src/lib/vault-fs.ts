// VaultFs implementation for the Tauri frontend: each method is a thin
// wrapper over the vault_* commands in src-tauri/src/lib.rs (plain std::fs).

import { invoke } from "@tauri-apps/api/core";
import type { VaultFs } from "./vault";

export const tauriVaultFs: VaultFs = {
  readFile: (path) => invoke<string>("vault_read_file", { path }),
  writeFile: (path, data) => invoke<void>("vault_write_file", { path, data }),
  readdir: (path) => invoke<string[]>("vault_readdir", { path }),
  mkdir: (path) => invoke<void>("vault_mkdir", { path }),
};

export function homeDir(): Promise<string> {
  return invoke<string>("home_dir");
}
