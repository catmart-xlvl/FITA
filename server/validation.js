import sharp from "sharp";
import { fail } from "./storage.js";
export async function imageBuffer(buffer) {
  if (!buffer || buffer.length > 20 * 1024 * 1024)
    fail("La imagen debe pesar como máximo 20 MB.");
  let meta;
  try {
    meta = await sharp(buffer, { limitInputPixels: 40000000 }).metadata();
  } catch {
    fail("Archivo de imagen inválido. Usa PNG, JPG o WebP.");
  }
  if (!["png", "jpeg", "webp"].includes(meta.format) || meta.pages > 1)
    fail("Usa PNG, JPG o WebP sin animación.");
  if (meta.width < 64 || meta.height < 64)
    fail("La imagen debe medir al menos 64 × 64 px.");
  const out = await sharp(buffer)
    .rotate()
    .resize({
      width: 2048,
      height: 2048,
      fit: "inside",
      withoutEnlargement: true,
    })
    .png()
    .toBuffer();
  return out;
}
export async function inspectReference(buffer) {
  await imageBuffer(buffer); // Decode actual pixels, enforce limits and format.
  const metadata = await sharp(buffer, {
    limitInputPixels: 40000000,
  }).metadata();
  return {
    format: metadata.format,
    width: metadata.width,
    height: metadata.height,
    bytes: buffer.length,
    decoded: true,
    checkedAt: new Date().toISOString(),
    scope:
      "Formato, decodificación, dimensiones y tamaño. No se ha evaluado el diseño con IA.",
  };
}
export function glbBuffer(b) {
  if (
    !b ||
    b.length < 20 ||
    b.length > 150 * 1024 * 1024 ||
    b.toString("ascii", 0, 4) !== "glTF" ||
    b.readUInt32LE(4) !== 2 ||
    b.readUInt32LE(8) !== b.length
  )
    fail("GLB 2.0 inválido o superior a 150 MB.");
  const len = b.readUInt32LE(12);
  if (b.readUInt32LE(16) !== 0x4e4f534a || len + 20 > b.length)
    fail("GLB sin bloque JSON válido.");
  let d;
  try {
    d = JSON.parse(b.toString("utf8", 20, 20 + len));
  } catch {
    fail("GLB con JSON inválido.");
  }
  if (d.asset?.version !== "2.0" || !d.meshes?.length)
    fail("El GLB debe contener geometría.");
  for (const x of [...(d.buffers || []), ...(d.images || [])])
    if (x.uri && !x.uri.startsWith("data:"))
      fail(
        "Importa un GLB autocontenido, con texturas y geometría incorporadas.",
      );
  if (
    d.extensionsRequired?.some(
      (x) =>
        ![
          "KHR_materials_unlit",
          "KHR_materials_clearcoat",
          "KHR_materials_transmission",
          "KHR_materials_ior",
          "KHR_materials_specular",
          "KHR_materials_emissive_strength",
          "KHR_texture_transform",
          "KHR_mesh_quantization",
        ].includes(x),
    )
  )
    fail(
      "Este GLB necesita una extensión no disponible en el visor. Exporta un GLB sin compresión Draco/KTX2.",
    );
  return b;
}
