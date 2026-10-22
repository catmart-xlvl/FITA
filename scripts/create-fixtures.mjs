// Neutral, procedural QA assets. No AI provider or private source art is used.
import * as THREE from "three";
import sharp from "sharp";
import fs from "node:fs/promises";
import path from "node:path";
const out = path.resolve("fixtures");
await fs.mkdir(out, { recursive: true });
const parts = [];
function part(name, geo, color, pos = [0, 0, 0], rot = [0, 0, 0]) {
  geo.applyMatrix4(
    new THREE.Matrix4().compose(
      new THREE.Vector3(...pos),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)),
      new THREE.Vector3(1, 1, 1),
    ),
  );
  parts.push({ name, geo, color });
}
part(
  "Cabeza",
  new THREE.SphereGeometry(0.34, 12, 10),
  [0.86, 0.83, 0.73, 1],
  [0, 2.25, 0],
);
part(
  "Cabello esquematico",
  new THREE.SphereGeometry(0.355, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.53),
  [0.2, 0.29, 0.29, 1],
  [0, 2.28, -0.025],
);
part(
  "Cuello",
  new THREE.CylinderGeometry(0.11, 0.12, 0.18, 10),
  [0.86, 0.83, 0.73, 1],
  [0, 1.92, 0],
);
part(
  "Torso",
  new THREE.CylinderGeometry(0.29, 0.23, 0.68, 6),
  [0.4, 0.62, 0.54, 1],
  [0, 1.54, 0],
);
part(
  "Cadera",
  new THREE.SphereGeometry(0.265, 10, 8),
  [0.23, 0.34, 0.34, 1],
  [0, 1.16, 0],
);
for (const s of [-1, 1]) {
  part(
    "Brazo",
    new THREE.CylinderGeometry(0.095, 0.07, 0.65, 8),
    [0.4, 0.62, 0.54, 1],
    [s * 0.43, 1.5, 0],
    [0, 0, s * 0.4],
  );
  part(
    "Mano",
    new THREE.SphereGeometry(0.095, 8, 6),
    [0.86, 0.83, 0.73, 1],
    [s * 0.57, 1.17, 0],
  );
  part(
    "Pierna",
    new THREE.CylinderGeometry(0.115, 0.09, 0.86, 8),
    [0.26, 0.36, 0.37, 1],
    [s * 0.145, 0.67, 0],
  );
  part(
    "Bota",
    new THREE.BoxGeometry(0.22, 0.22, 0.37),
    [0.15, 0.23, 0.25, 1],
    [s * 0.145, 0.16, 0.08],
  );
  part(
    "Ojo",
    new THREE.SphereGeometry(0.035, 8, 6),
    [0.12, 0.23, 0.23, 1],
    [s * 0.12, 2.27, 0.31],
  );
}
const document = {
  asset: {
    version: "2.0",
    generator: "Local procedural demonstration - no AI",
  },
  scene: 0,
  scenes: [{ nodes: [] }],
  nodes: [],
  meshes: [],
  materials: [],
  accessors: [],
  bufferViews: [],
  buffers: [{ byteLength: 0 }],
};
const buffers = [];
let offset = 0;
function attribute(array, type, componentType, min, max, target) {
  const b = Buffer.from(array.buffer, array.byteOffset, array.byteLength);
  const pad = (4 - (b.length % 4)) % 4;
  const vi = document.bufferViews.length;
  document.bufferViews.push({
    buffer: 0,
    byteOffset: offset,
    byteLength: b.length,
    target,
  });
  buffers.push(b, Buffer.alloc(pad));
  offset += b.length + pad;
  const ai = document.accessors.length;
  document.accessors.push({
    bufferView: vi,
    componentType,
    count: array.length / (type === "VEC3" ? 3 : 1),
    type,
    ...(min ? { min, max } : {}),
  });
  return ai;
}
for (const p of parts) {
  const pos = p.geo.attributes.position.array,
    norm = p.geo.attributes.normal.array;
  const box = new THREE.Box3().setFromBufferAttribute(
    p.geo.attributes.position,
  );
  const ai = attribute(
      pos,
      "VEC3",
      5126,
      box.min.toArray(),
      box.max.toArray(),
      34962,
    ),
    ni = attribute(norm, "VEC3", 5126, null, null, 34962),
    ix = attribute(
      new Uint32Array(p.geo.index.array),
      "SCALAR",
      5125,
      null,
      null,
      34963,
    );
  const mi = document.materials.length;
  document.materials.push({
    pbrMetallicRoughness: {
      baseColorFactor: p.color,
      metallicFactor: 0,
      roughnessFactor: 0.85,
    },
    doubleSided: false,
  });
  const mesh = document.meshes.length;
  document.meshes.push({
    primitives: [
      { attributes: { POSITION: ai, NORMAL: ni }, indices: ix, material: mi },
    ],
  });
  document.scenes[0].nodes.push(document.nodes.length);
  document.nodes.push({ name: p.name, mesh });
}
document.buffers[0].byteLength = offset;
const json = Buffer.from(JSON.stringify(document)),
  jsonPadded = Buffer.concat([
    json,
    Buffer.alloc((4 - (json.length % 4)) % 4, 32),
  ]),
  bin = Buffer.concat(buffers);
const header = Buffer.alloc(12),
  jh = Buffer.alloc(8),
  bh = Buffer.alloc(8);
header.write("glTF");
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonPadded.length + 8 + bin.length, 8);
jh.writeUInt32LE(jsonPadded.length);
jh.writeUInt32LE(0x4e4f534a, 4);
bh.writeUInt32LE(bin.length);
bh.writeUInt32LE(0x004e4942, 4);
await fs.writeFile(
  path.join(out, "mannequin.glb"),
  Buffer.concat([header, jh, jsonPadded, bh, bin]),
);
for (const group of ["head", "body"])
  for (const view of ["front", "right", "back"]) {
    const side = view === "right",
      back = view === "back";
    const figure = `<g stroke="#354b48" stroke-width="2" stroke-linejoin="round"><g fill="#718f81">${group === "body" ? `<path d="M206 250 L174 347 L190 357 L231 275 M294 250 L325 347 L310 357 L270 275"/><path d="M214 242 L286 242 L281 338 L218 338 Z"/><path fill="#425a58" d="M218 337 L281 337 L288 372 L212 372 Z"/><path fill="#526963" d="M216 369 L241 372 L239 503 L216 503 Z M258 372 L282 369 L284 503 L260 503 Z"/><path fill="#2e4746" d="M212 501 L240 501 L240 525 L204 525 Z M260 501 L287 501 L296 525 L260 525 Z"/>` : ""}</g><path fill="#d7d0ba" d="M235 218 L266 218 L266 247 L235 247Z"/><ellipse fill="#d7d0ba" cx="250" cy="179" rx="${side ? 37 : 49}" ry="57"/><path fill="#344f4b" d="M201 184 Q191 120 249 119 Q311 124 299 187 L287 155 L275 171 L252 152 L228 170 L220 159 Z"/>${back ? '<path fill="#344f4b" d="M204 159 Q248 138 296 159 L293 204 Q250 229 206 205Z"/>' : side ? '<path fill="#d7d0ba" d="M282 173 L295 188 L282 191Z"/><path d="M272 174 l8 0"/>' : '<path stroke-width="3" d="M224 177 l13 0 M265 177 l13 0"/><path fill="none" d="M244 204 Q250 208 257 204"/>'}${group === "body" ? '<ellipse fill="#d7d0ba" cx="180" cy="357" rx="10" ry="13"/><ellipse fill="#d7d0ba" cx="318" cy="357" rx="10" ry="13"/>' : ""}${back && group === "body" ? '<path stroke="#adc5b3" stroke-width="5" d="M250 267 L250 315"/>' : ""}</g>`;
    const transform =
      group === "head"
        ? "translate(-200,-220) scale(1.8)"
        : side
          ? "translate(115,0) scale(.55,1)"
          : "";
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="600"><rect width="500" height="600" fill="#dfe5dc"/><g stroke="#abbcad" opacity=".45"><path d="M50 540H450 M250 40V555" stroke-dasharray="5 7"/><path d="M50 120H450 M50 240H450 M50 370H450 M50 500H450"/></g><text x="28" y="35" font-family="Arial" font-size="12" letter-spacing="2" fill="#526b5b">DEMO PROCEDURAL / SIN IA</text><g transform="${transform}">${figure}</g><text x="250" y="578" text-anchor="middle" font-family="Arial" font-size="12" letter-spacing="2" fill="#526b5b">${group === "head" ? "CABEZA" : "CUERPO"} / ${view === "front" ? "FRENTE" : side ? "PERFIL DERECHO" : "ESPALDA"}</text></svg>`;
    await sharp(Buffer.from(svg))
      .png()
      .toFile(path.join(out, `${group}-${view}.png`));
  }
console.log(
  "Fixtures procedurales escritos en fixtures/. Sin llamadas externas.",
);
