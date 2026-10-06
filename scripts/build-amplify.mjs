#!/usr/bin/env node
/**
 * Construye el bundle de despliegue de AWS Amplify Hosting según la especificación oficial
 * (`ssr-deployment-specification.html`).
 *
 * Estructura generada:
 *
 *   .amplify-hosting/
 *   ├── deploy-manifest.json        ← rutas: estáticos primero, compute como catch-all
 *   ├── static/                     ← copia de dist/client (index.html, _astro/*)
 *   └── compute/default/
 *       ├── server.mjs              ← entrypoint en la RAÍZ (requisito de Amplify)
 *       ├── dist/                   ← output completo de astro build
 *       └── node_modules/           ← las deps bare que el bundle de Astro no empaqueta
 *
 * Motivos:
 *
 * 1. `compute/default` necesita un entrypoint en su raíz. Amplify lo ejecuta con
 *    `node <entrypoint>` dentro del subdirectorio y no acepta rutas anidadas.
 * 2. Astro en modo standalone escucha en 4321/localhost por defecto. Amplify llama al
 *    puerto 3000, así que `server.mjs` fija PORT=3000 y HOST=0.0.0.0 antes de importar
 *    el entrypoint real.
 * 3. `dist/server` deja imports bare (piccolore, devalue, cookie, zod, unstorage, ...).
 *    Sin `node_modules` adentro, Node muere con ERR_MODULE_NOT_FOUND en runtime.
 * 4. Los estáticos van aparte para que Amplify los sirva sin despertar compute.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const host = join(root, ".amplify-hosting");
const staticDir = join(host, "static");
const computeDir = join(host, "compute", "default");

for (const dir of [staticDir, computeDir]) {
  mkdirSync(dir, { recursive: true });
}

// dist/client: assets prerendered y assets de Astro.
const clientDir = join(root, "dist", "client");
if (!existsSync(join(clientDir, "index.html"))) {
  throw new Error(
    "Falta dist/client/index.html. Ejecutá `npm run build` antes de este script."
  );
}

// Los estáticos no se limpian con rmSync de compute: sólo se pisan.
cpSync(clientDir, staticDir, { recursive: true });

// El compute necesita el output COMPLETO: dist/server para el SSR y dist/client por si el
// server sirve assets por su cuenta (lo hace cuando la ruta no matchea el manifest).
cpSync(join(root, "dist"), join(computeDir, "dist"), { recursive: true });

// Amplify limita el tamaño del bundle; node_modules es ~150 MB de los ~220 permitidos.
cpSync(join(root, "node_modules"), join(computeDir, "node_modules"), {
  recursive: true,
});

// Entry en la raíz del subdirectorio de compute.
writeFileSync(
  join(computeDir, "server.mjs"),
  [
    "// Entrypoint de Amplify Hosting. Amplify ejecuta `node server.mjs` con cwd en este",
    "// directorio y espera un servidor HTTP en el puerto 3000. Astro standalone arranca en",
    "// 4321 y sólo en localhost, así que hay que fijar ambas cosas ANTES de importarlo:",
    "// el entrypoint real lee PORT/HOST al cargarse.",
    "process.env.PORT ||= '3000';",
    "process.env.HOST ||= '0.0.0.0';",
    "await import('./dist/server/entry.mjs');",
    "",
  ].join("\n"),
);

// https://docs.aws.amazon.com/amplify/latest/userguide/ssr-deployment-specification.html
const manifest = {
  version: 1,
  routes: [
    // Archivos con extensión: los sirve el primitive estático. Si no existen, caen al
    // compute en vez de devolver 404.
    {
      path: "/*.*",
      target: {
        kind: "Static",
        cacheControl: "public, max-age=31536000, immutable",
      },
      fallback: { kind: "Compute", src: "default" },
    },
    // Catch-all obligatorio: páginas SSR y /api/chat.
    {
      path: "/*",
      target: { kind: "Compute", src: "default" },
    },
  ],
  computeResources: [
    {
      name: "default",
      entrypoint: "server.mjs",
      runtime: "nodejs20.x",
    },
  ],
  framework: { name: "astro", version: "5.17.3" },
};

writeFileSync(
  join(host, "deploy-manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);

const sizeMb = (dir) => {
  let total = 0;
  const walk = (d) => {
    // readdirSync con withFileTypes NO trae `size`: hay que pedirlo por separado.
    for (const entry of readdirSyncSafe(d)) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        try {
          total += statSync(full).size;
        } catch {
          /* archivo borrado entre readdir y stat: se ignora */
        }
      }
    }
  };
  walk(dir);
  return (total / (1024 * 1024)).toFixed(1);
};

function readdirSyncSafe(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

console.log(`[amplify] static/     ${sizeMb(staticDir)} MB`);
console.log(`[amplify] compute/    ${sizeMb(computeDir)} MB`);
console.log(`[amplify] deploy-manifest.json ok`);
console.log(`[amplify] entrypoint  compute/default/server.mjs ok`);