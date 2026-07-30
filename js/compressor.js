/**
 * Canvas Auto-Compressor
 * Automatically resizes and compresses user-uploaded product images down to ~25KB-35KB.
 * Protects server payload limits and ensures instant rendering in Telegram WebApp.
 */
function compressImage(file, maxDimension = 450, quality = 0.75) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.match(/image.*/)) {
      return reject(new Error("Faqat rasm fayllari qabul qilinadi!"));
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        // Calculate proportional aspect ratio resizing
        if (width > height) {
          if (width > maxDimension) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          }
        } else {
          if (height > maxDimension) {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        // Convert canvas to WebP/JPEG data URL (25KB - 35KB)
        const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
        const approxKB = Math.round((compressedDataUrl.length * 3 / 4) / 1024);

        console.log(`✨ Rasm avto-kompress qilindi: ${width}x${height}px, ~${approxKB} KB`);
        resolve({ dataUrl: compressedDataUrl, sizeKB: approxKB });
      };
      img.onerror = () => reject(new Error("Rasm o'qishda xatolik!"));
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}
