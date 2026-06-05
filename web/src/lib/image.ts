// 背景图前端压缩：把用户选的图缩放并重编码为体积可控的 data URL，
// 直接随显示设置以 base64 存库（避免引入文件上传/静态服务）。

const MAX_WIDTH = 1920; // 超宽图等比缩到此宽度
const QUALITY = 0.82; // JPEG 质量

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("图片解码失败"));
    img.src = src;
  });
}

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("文件读取失败"));
    reader.readAsDataURL(file);
  });
}

/**
 * 读取图片文件，等比缩放到 ≤MAX_WIDTH，重编码为 JPEG data URL。
 * 失败（如浏览器不支持 canvas 导出）时回退为原始 data URL。
 */
export async function fileToBackgroundDataUrl(file: File): Promise<string> {
  const raw = await readAsDataURL(file);
  try {
    const img = await loadImage(raw);
    const scale = Math.min(1, MAX_WIDTH / img.naturalWidth);
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return raw;
    ctx.drawImage(img, 0, 0, w, h);
    const out = canvas.toDataURL("image/jpeg", QUALITY);
    // 极少数情况下重编码后反而更大，则保留原图
    return out.length < raw.length ? out : raw;
  } catch {
    return raw;
  }
}
