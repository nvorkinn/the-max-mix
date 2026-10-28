import React from 'react';
import { X, Users } from 'lucide-react';

export default function JamSettingsModal({ isOpen, onClose }) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="jam-help-title" className="app-modal-panel border rounded-3xl p-6 max-w-md w-full relative shadow-2xl max-h-[92dvh] overflow-y-auto">
        <button onClick={onClose} aria-label="Close Jam instructions" className="absolute right-4 top-4 p-2 rounded-full bg-white/10 text-white"><X size={18} /></button>
        <Users className="text-[#d5f580] mb-3" size={24} />
        <h2 id="jam-help-title" className="text-xl font-semibold pr-8">Start a Jam in Spotify</h2>
        <p className="text-sm text-neutral-300 mt-3">Use the Spotify app on your phone to host a native Jam.</p>
        <ol className="list-decimal pl-5 space-y-3 text-sm text-neutral-300 my-5">
          <li>Play a song in Spotify and select your speaker or THE MAX MIX from the device picker.</li>
          <li>Choose <strong>Start a Jam</strong> in Spotify and share its invite link or QR code with friends.</li>
          <li>Manage guest permissions, reorder songs, and end the Jam in Spotify.</li>
        </ol>
        <p className="text-xs leading-relaxed text-neutral-400 border-t border-white/10 pt-4">
          This display reads Spotify&apos;s playback queue and controls the active device. Spotify&apos;s public API does not expose Jam creation, membership, guest permissions, or queue reordering. It does not tell us who added each song or whether a Jam is active.
        </p>
      </div>
    </div>
  );
}
