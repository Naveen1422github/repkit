// images — shrink a picked photo to a small JPEG Blob before storing it.
export function fitSize(w, h, max = 800) {
  const scale = Math.min(1, max / Math.max(w, h));
  return { w: Math.round(w * scale), h: Math.round(h * scale) };
}

// rejects if the browser can't decode the file (e.g. HEIC on some phones)
export async function compressImage(file) {
  const bmp = await createImageBitmap(file);
  const { w, h } = fitSize(bmp.width, bmp.height);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('could not read that photo'))), 'image/jpeg', 0.7);
  });
}
