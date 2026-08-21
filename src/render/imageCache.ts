const imageCache = new Map<string, HTMLImageElement>();
let imageInvalidator: (() => void) | null = null;

export function setImageInvalidator(cb: (() => void) | null): void {
  imageInvalidator = cb;
}

export function getCachedImage(url: string): HTMLImageElement | null {
  if (typeof Image === "undefined" || !url) return null;
  let img = imageCache.get(url);
  if (!img) {
    img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (imageInvalidator) imageInvalidator();
    };
    img.src = url;
    imageCache.set(url, img);
  }
  return img.complete && img.naturalWidth > 0 && img.naturalHeight > 0 ? img : null;
}

export function preloadCachedImage(url: string, timeoutMs: number): Promise<void> {
  if (typeof Image === "undefined" || !url) return Promise.resolve();
  getCachedImage(url);
  const img = imageCache.get(url);
  if (!img) return Promise.resolve();
  if (img.complete && img.naturalWidth > 0 && img.naturalHeight > 0) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => resolve();
    const timer = setTimeout(finish, timeoutMs);
    const done = () => {
      clearTimeout(timer);
      finish();
    };
    img.addEventListener("load", done, { once: true });
    img.addEventListener("error", done, { once: true });
  });
}
