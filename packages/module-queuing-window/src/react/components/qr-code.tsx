'use client';

import { create as createQr } from 'qrcode';
import { useMemo } from 'react';

/**
 * A QR code for the display link, drawn in the browser.
 *
 * ⚠ NEVER A QR WEB SERVICE. A hosted QR API receives the URL it draws, and this
 * URL carries a live display code.
 *
 * ⚠ Built from the MATRIX `qrcode` computes, as one SVG path — not from its
 * SVG-string output injected as markup. Nothing here is HTML from a string.
 *
 * Always dark on white, whatever the theme: scanners read contrast, and an
 * inverted code on a dark console fails on half the phones that try.
 */
export function QrCode({ value, size = 176, label }: { value: string; size?: number; label: string }) {
  const { count, path } = useMemo(() => {
    const qr = createQr(value, { errorCorrectionLevel: 'M' });
    const modules = qr.modules;
    let d = '';
    for (let row = 0; row < modules.size; row += 1) {
      for (let column = 0; column < modules.size; column += 1) {
        if (modules.get(row, column)) d += `M${column},${row}h1v1h-1z`;
      }
    }
    return { count: modules.size, path: d };
  }, [value]);

  // A quiet zone of four modules, which the standard asks for.
  const quiet = 4;
  return (
    <svg
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox={`${-quiet} ${-quiet} ${count + quiet * 2} ${count + quiet * 2}`}
      shapeRendering="crispEdges"
      className="rounded-md"
    >
      <rect x={-quiet} y={-quiet} width={count + quiet * 2} height={count + quiet * 2} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}
