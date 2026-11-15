/** Mean plate luminance (linear 0..1) and mean colour (#rrggbb) from a packed RGB24 downscale of a still (media/ffmpeg.ts `sampleStillGrid`). Pure. */
export function plateFromRgb(rgb: Uint8Array): {luminance: number; color: string} | null {
  const n = Math.floor(rgb.length / 3);
  if (n === 0) return null;
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < n; i += 1) { r += rgb[i * 3]!; g += rgb[i * 3 + 1]!; b += rgb[i * 3 + 2]!; }
  r /= n; g /= n; b /= n;
  const lin = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const hex = (v: number) => Math.round(v).toString(16).padStart(2, '0');
  return {luminance: +(0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)).toFixed(4), color: `#${hex(r)}${hex(g)}${hex(b)}`};
}
