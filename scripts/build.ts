#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";

type BuildTargetKey = "linux" | "windows";

interface TargetSpec {
  key: BuildTargetKey;
  bunTarget: "bun-linux-x64" | "bun-windows-x64";
  outfile: string;
  requiredNativePkg: string;
  libcDefine: string;
}

const TARGETS: Record<BuildTargetKey, TargetSpec> = {
  linux: {
    key: "linux",
    bunTarget: "bun-linux-x64",
    outfile: "./dist/tacl-linux-x64",
    requiredNativePkg: "@opentui/core-linux-x64",
    libcDefine: "glibc",
  },
  windows: {
    key: "windows",
    bunTarget: "bun-windows-x64",
    outfile: "./dist/tacl-windows-x64.exe",
    requiredNativePkg: "@opentui/core-win32-x64",
    libcDefine: "",
  },
};

function formatMB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function buildOne(spec: TargetSpec): Promise<void> {
  const pkgPath = join("node_modules", ...spec.requiredNativePkg.split("/"));
  if (!existsSync(pkgPath)) {
    throw new Error(
      `Falta el paquete nativo ${spec.requiredNativePkg}. Ejecuta primero: bun install --os="*" --cpu="*"`
    );
  }

  console.log(`\nCompilando ${spec.key} (${spec.bunTarget}) -> ${spec.outfile} ...`);
  const result = await Bun.build({
    entrypoints: ["./src/index.tsx"],
    compile: {
      target: spec.bunTarget,
      outfile: spec.outfile,
    },
    minify: true,
    define: {
      "process.env.OPENTUI_LIBC": JSON.stringify(spec.libcDefine),
      "process.env.NODE_ENV": JSON.stringify("production"),
    },
  });

  if (!result.success) {
    for (const log of result.logs) {
      console.error(log);
    }
    throw new Error(`Fallo la compilación para ${spec.key}`);
  }

  const info = await stat(spec.outfile);
  console.log(`✓ Generado ${spec.outfile} (${formatMB(info.size)})`);
}

async function main() {
  const arg = process.argv[2]?.toLowerCase();
  let selected: TargetSpec[];

  if (!arg || arg === "all") {
    selected = [TARGETS.linux, TARGETS.windows];
  } else if (arg === "linux") {
    selected = [TARGETS.linux];
  } else if (arg === "windows" || arg === "win") {
    selected = [TARGETS.windows];
  } else {
    console.error("Uso: bun run scripts/build.ts [all|linux|windows]");
    process.exit(1);
  }

  await mkdir("./dist", { recursive: true });

  for (const spec of selected) {
    await buildOne(spec);
  }

  console.log("\n¡Compilación completada!");
}

main().catch((err) => {
  console.error(`\nError de compilación: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
