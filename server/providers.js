const TRIPO = "https://openapi.tripo3d.ai/v3";
const OPENAI = "https://api.openai.com/v1";
export const IMAGE_MODEL = "gpt-image-2";
export const MESH_MODEL = "v3.1-20260211";
export const SIWC = {
  available: false,
  reason:
    "La vista previa de Sign in with ChatGPT no admite generación de imágenes. La elegibilidad de esta aplicación privada tampoco está validada. Usa importación local o el conector OpenAI API, con facturación independiente.",
  docs: "https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations",
};
export class ProviderError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}
export function cleanError(e) {
  if (e.name === "TimeoutError" || e.name === "AbortError")
    return "Se agotó el tiempo de espera. Revisa el proveedor antes de repetir una generación: el envío puede haberse aceptado.";
  return String(e.message || "Error de proveedor")
    .replace(/(?:sk-|tsk_)[A-Za-z0-9_-]+/g, "[clave oculta]")
    .slice(0, 400);
}
export function createProviders(fetcher = fetch) {
  async function request(url, key, options = {}) {
    let response;
    try {
      response = await fetcher(url, {
        ...options,
        headers: { Authorization: `Bearer ${key}`, ...options.headers },
        signal: AbortSignal.timeout(options.timeout || 45000),
      });
    } catch (e) {
      throw new ProviderError(cleanError(e));
    }
    let data;
    try {
      data = await response.json();
    } catch {
      throw new ProviderError(
        `El proveedor devolvió una respuesta no válida (HTTP ${response.status}).`,
      );
    }
    if (!response.ok || (data.code !== undefined && data.code !== 0)) {
      const code = data.error?.code || data.code || "sin código";
      throw new ProviderError(
        `Proveedor HTTP ${response.status} · ${code}. ${response.status === 401 ? "Clave inválida o revocada." : response.status === 429 ? "Límite de uso o saldo insuficiente." : "Comprueba permisos, saldo y disponibilidad en la consola del proveedor."}`,
        response.status === 401 ? 401 : 502,
      );
    }
    return data;
  }
  return {
    async verify(kind, key) {
      if (kind === "openai") {
        const data = await request(OPENAI + "/models", key);
        return {
          verifiedAt: new Date().toISOString(),
          imageModelListed: !!data.data?.some((x) => x.id === IMAGE_MODEL),
          message:
            "Clave verificada consultando modelos. Esto no garantiza permiso ni saldo para generar imágenes.",
        };
      }
      const d = (await request(TRIPO + "/account/balance", key)).data;
      return {
        verifiedAt: new Date().toISOString(),
        balance: d.balance,
        frozen: d.frozen,
        message: "Saldo de Tripo API consultado sin generación.",
      };
    },
    async image(key, images, prompt) {
      const d = await request(OPENAI + "/images/edits", key, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: IMAGE_MODEL,
          images: images.map((b) => ({
            image_url: "data:image/png;base64," + b.toString("base64"),
          })),
          prompt,
          n: 1,
          size: "1024x1024",
          quality: "medium",
          output_format: "png",
        }),
        timeout: 600000,
      });
      if (!d.data?.[0]?.b64_json)
        throw new ProviderError(
          "OpenAI no devolvió una imagen. No se reemplazó la vista anterior.",
        );
      return {
        buffer: Buffer.from(d.data[0].b64_json, "base64"),
        usage: d.usage || null,
      };
    },
    async upload(key, buffer) {
      const form = new FormData();
      form.set("file", new Blob([buffer], { type: "image/png" }), "view.png");
      const d = (
        await request(TRIPO + "/files", key, { method: "POST", body: form })
      ).data;
      if (!d?.file_token)
        throw new ProviderError("Tripo no devolvió un token de archivo.");
      return d.file_token;
    },
    async mesh(key, inputs, {faceLimit=20000}={}) {
      if(!Number.isInteger(faceLimit)||faceLimit<500||faceLimit>25000)throw new ProviderError('Invalid target polygon count.',400);
      const d = (
        await request(TRIPO + "/generation/multiview-to-model", key, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            inputs,
            model: MESH_MODEL,
            texture: true,
            pbr: true,
            face_limit: faceLimit,
          }),
        })
      ).data;
      if (!d?.task_id)
        throw new ProviderError(
          "Tripo no devolvió task_id. Comprueba tu consola antes de repetir.",
        );
      return d.task_id;
    },
    async task(key, id) {
      return (await request(TRIPO + "/tasks/" + encodeURIComponent(id), key))
        .data;
    },
    async download(url) {
      const u = new URL(url);
      if (
        u.protocol !== "https:" ||
        !/(^|\.)tripo3d\.(ai|com)$/.test(u.hostname)
      )
        throw new ProviderError(
          "El modelo usa un dominio de descarga no reconocido. Revisa el task_id en Tripo y descarga/importa manualmente el GLB.",
        );
      const r = await fetcher(url, {
        redirect: "error",
        signal: AbortSignal.timeout(120000),
      });
      if (!r.ok)
        throw new ProviderError(
          "No se pudo descargar el GLB. Reanuda la consulta para obtener una URL nueva.",
        );
      const chunks = [];
      let total = 0;
      for await (const chunk of r.body) {
        total += chunk.length;
        if (total > 150 * 1024 * 1024)
          throw new ProviderError("El modelo supera 150 MB.");
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    },
  };
}
