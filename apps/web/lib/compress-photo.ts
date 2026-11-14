export async function compressPhoto(file: File): Promise<Blob> {
  if (file.size > 10_000_000) throw new Error('Choose a photo smaller than 10 MB.');
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Photo preparation is unavailable on this browser.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.7, 0.55, 0.4]) {
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (image) =>
            image ? resolve(image) : reject(new Error('The photo could not be prepared.')),
          'image/jpeg',
          quality,
        ),
      );
      if (blob.size <= 300_000 || quality === 0.4) return blob;
    }
    throw new Error('The photo could not be prepared.');
  } finally {
    bitmap.close();
  }
}
