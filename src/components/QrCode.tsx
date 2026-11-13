import { useMemo } from 'react';
import qrcode from 'qrcode-generator';

/** `text` as a QR code a phone's camera opens, drawn dark on light whatever the theme so every camera reads it. */
export default function QrCode({ text, className }: Readonly<{ text: string; className: string }>) {
  const { size, path } = useMemo(() => {
    const code = qrcode(0, 'M');
    code.addData(text);
    code.make();
    const count = code.getModuleCount();
    let modules = '';
    for (let row = 0; row < count; row++) {
      for (let column = 0; column < count; column++) {
        if (code.isDark(row, column)) modules += `M${column + 4} ${row + 4}h1v1h-1z`;
      }
    }
    // Four modules of quiet zone round the code, as the standard asks.
    return { size: count + 8, path: modules };
  }, [text]);
  return (
    <svg className={className} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={text} shapeRendering="crispEdges">
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
