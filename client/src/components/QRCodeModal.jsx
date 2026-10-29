import { QRCodeSVG } from 'qrcode.react';
import { X, Smartphone, ExternalLink, Sparkles } from 'lucide-react';

/** @param {{ isOpen: boolean, onClose: () => void, remoteUrl: string }} props */
export default function QRCodeModal({ isOpen, onClose, remoteUrl }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <div className="bg-linear-to-b from-neutral-900 to-neutral-950 border border-white/20 rounded-3xl p-6 max-w-sm w-full text-center relative shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 active:scale-90 text-white flex items-center justify-center transition-all"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="flex items-center justify-center space-x-2 text-emerald-400 mb-2">
          <Sparkles className="w-5 h-5 animate-pulse" />
          <h3 className="text-lg font-black text-white">Join the Jam Session!</h3>
        </div>
        <p className="text-xs text-neutral-400 mb-4">Scan to queue songs & send live emoji reactions</p>

        {/* QR Code Container */}
        <div className="p-4 bg-white rounded-2xl inline-block shadow-[0_0_30px_rgba(16,185,129,0.3)] border-4 border-emerald-500/30">
          <QRCodeSVG value={remoteUrl || 'http://localhost:5173/remote'} size={180} level="H" includeMargin={false} />
        </div>

        {/* URL Link */}
        <div className="mt-4 p-2.5 rounded-xl bg-white/5 border border-white/10 flex items-center justify-between text-xs text-neutral-300">
          <div className="flex items-center space-x-2 truncate">
            <Smartphone className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="font-mono truncate">{remoteUrl}</span>
          </div>
          <a
            href={remoteUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 ml-2 shrink-0"
            title="Open Mobile Remote in new tab"
          >
            <ExternalLink className="w-4 h-4" />
          </a>
        </div>

        {/* Bottom helper */}
        <div className="mt-4 flex justify-center gap-2">
          <span className="px-3 py-1 rounded-full bg-white/5 text-[11px] text-neutral-400 border border-white/5">
            📶 No App Needed
          </span>
          <span className="px-3 py-1 rounded-full bg-white/5 text-[11px] text-neutral-400 border border-white/5">
            ⚡ Real-time Sync
          </span>
        </div>
      </div>
    </div>
  );
}
