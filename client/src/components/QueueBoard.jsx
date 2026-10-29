import { useState } from 'react';
import { trackKeys } from '../utils/trackKeys.js';
import { ChevronUp, Plus, Trash2, Music2, Sparkles, Search, X } from 'lucide-react';

/**
 * @param {{
 *   queue: import('../types.js').Track[],
 *   onUpvote: (trackId?: string) => unknown,
 *   onRemove: (trackId?: string) => unknown,
 *   onAddSong: (track: import('../types.js').Track, guest: import('../types.js').Guest) => unknown,
 *   onSearchSpotify: (query: string) => Promise<import('../types.js').Track[] | undefined>,
 *   onOpenQR: () => void
 * }} props
 */
export default function QueueBoard({ queue, onUpvote, onRemove, onAddSong, onSearchSpotify, onOpenQR }) {
  const keys = trackKeys(queue);
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(/** @type {import('../types.js').Track[]} */ ([]));
  const [searching, setSearching] = useState(false);

  /** @param {import('react').FormEvent} e */
  const handleSearch = async e => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const results = await onSearchSpotify(searchQuery);
      setSearchResults(results || []);
    } catch (err) {
      console.error(err);
    } finally {
      setSearching(false);
    }
  };

  /** @param {import('../types.js').Track} track */
  const handleSelectTrack = track => {
    onAddSong(track, { id: 'tablet-host', name: 'Tablet Touch', avatar: '📱' });
    setShowSearchModal(false);
    setSearchQuery('');
    setSearchResults([]);
  };

  return (
    <div className="flex flex-col h-full bg-black/40 backdrop-blur-xl border border-white/10 rounded-3xl p-4 shadow-2xl relative overflow-hidden">
      {/* Queue Header */}
      <div className="flex items-center justify-between pb-3 border-b border-white/10">
        <div className="flex items-center space-x-2">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-500/30">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              Shared Jam Queue
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                {queue.length}
              </span>
            </h3>
            <p className="text-xs text-neutral-400">Crowd-voted party playlist</p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {/* Quick Add Song Button */}
          <button
            onClick={() => setShowSearchModal(true)}
            className="flex items-center space-x-1.5 px-3 py-1.5 bg-emerald-500/20 hover:bg-emerald-500/30 active:scale-95 text-emerald-300 border border-emerald-500/40 rounded-xl text-xs font-bold transition-all shadow-md"
          >
            <Plus className="w-4 h-4" />
            <span>Add Track</span>
          </button>
        </div>
      </div>

      {/* Queue Items List */}
      <div className="flex-1 overflow-y-auto mt-2 space-y-2 pr-1 select-none">
        {queue.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-neutral-400 space-y-3">
            <div className="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-neutral-500">
              <Music2 className="w-8 h-8" />
            </div>
            <div>
              <p className="text-sm font-bold text-white">The Queue is Empty</p>
              <p className="text-xs text-neutral-400 mt-1 max-w-xs">
                Scan the QR code from your phone or tap &quot;Add Track&quot; above to queue up songs!
              </p>
            </div>
            <button
              onClick={onOpenQR}
              className="px-4 py-2 bg-linear-to-r from-emerald-500 to-teal-500 text-black font-extrabold text-xs rounded-xl shadow-lg active:scale-95"
            >
              Show QR Code
            </button>
          </div>
        ) : (
          queue.map((track, index) => {
            const isTop = index === 0;
            return (
              <div
                key={keys[index]}
                className={`flex items-center justify-between p-2.5 rounded-2xl transition-all duration-300 border ${
                  isTop
                    ? 'bg-linear-to-r from-emerald-950/40 to-teal-950/30 border-emerald-500/40 shadow-[0_0_15px_rgba(16,185,129,0.15)]'
                    : 'bg-white/5 hover:bg-white/10 border-white/5'
                }`}
              >
                {/* Left: Rank & Upvote Button */}
                <div className="flex items-center space-x-3">
                  <button
                    onClick={() => onUpvote(track.id)}
                    className={`flex flex-col items-center justify-center w-11 h-11 rounded-xl transition-all active:scale-90 border ${
                      (track.votes ?? 0) > 1
                        ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40 font-extrabold'
                        : 'bg-white/5 text-neutral-300 border-white/10 font-bold'
                    }`}
                  >
                    <ChevronUp className="w-4 h-4 -mb-1" />
                    <span className="text-xs">{track.votes}</span>
                  </button>

                  {/* Album Thumbnail */}
                  <img
                    src={track.albumArt}
                    alt={track.title}
                    className="w-11 h-11 rounded-xl object-cover shadow-md border border-white/10"
                  />

                  {/* Title & Artist */}
                  <div className="max-w-[210px]">
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-bold text-white truncate">{track.title}</p>
                      {isTop && (
                        <span className="text-[10px] font-black uppercase tracking-wider bg-emerald-500/30 text-emerald-300 px-1.5 py-0.2 rounded-sm border border-emerald-400/30">
                          Next Up
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-neutral-400 truncate">{track.artist}</p>
                  </div>
                </div>

                {/* Right: Guest Avatar Tag & Remove button */}
                <div className="flex items-center space-x-2">
                  <div className="flex items-center space-x-1 px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-xs text-neutral-300">
                    <span>{track.addedBy?.avatar || '🎉'}</span>
                    <span className="max-w-[70px] truncate text-[11px] font-medium">
                      {track.addedBy?.name || 'Guest'}
                    </span>
                  </div>

                  <button
                    onClick={() => onRemove(track.id)}
                    className="w-8 h-8 rounded-lg text-neutral-500 hover:text-rose-400 hover:bg-rose-500/10 active:scale-90 flex items-center justify-center transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* In-place Track Search Drawer */}
      {showSearchModal && (
        <div className="absolute inset-0 bg-neutral-950/95 backdrop-blur-2xl z-50 p-4 flex flex-col">
          <div className="flex items-center justify-between pb-3 border-b border-white/10">
            <h4 className="text-sm font-bold text-white flex items-center gap-2">
              <Search className="w-4 h-4 text-emerald-400" />
              Add Track to Party Queue
            </h4>
            <button
              onClick={() => setShowSearchModal(false)}
              className="w-8 h-8 rounded-full bg-white/10 text-white flex items-center justify-center active:scale-90"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <form onSubmit={handleSearch} className="flex gap-2 mt-3">
            <input
              type="text"
              placeholder="Search song or artist..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="flex-1 bg-white/10 border border-white/20 rounded-xl px-4 py-2.5 text-sm text-white placeholder-neutral-500 focus:outline-hidden focus:border-emerald-400"
              autoFocus
            />
            <button
              type="submit"
              disabled={searching}
              className="px-5 py-2.5 bg-emerald-500 text-black font-bold text-xs rounded-xl shadow-lg active:scale-95 disabled:opacity-50"
            >
              {searching ? '...' : 'Search'}
            </button>
          </form>

          <div className="flex-1 overflow-y-auto mt-3 space-y-2">
            {searchResults.length === 0 && !searching && (
              <p className="text-center text-xs text-neutral-500 mt-6">Type song title or artist and tap Search</p>
            )}
            {searchResults.map(track => (
              <div
                key={track.id}
                onClick={() => handleSelectTrack(track)}
                className="flex items-center justify-between p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 cursor-pointer active:scale-98 transition-all"
              >
                <div className="flex items-center space-x-3">
                  <img src={track.albumArt} alt={track.title} className="w-10 h-10 rounded-lg object-cover" />
                  <div>
                    <p className="text-xs font-bold text-white truncate max-w-[280px]">{track.title}</p>
                    <p className="text-[11px] text-neutral-400 truncate max-w-[280px]">{track.artist}</p>
                  </div>
                </div>
                <button className="px-3 py-1 bg-emerald-500/20 text-emerald-400 text-xs font-bold rounded-lg border border-emerald-500/40">
                  + Add
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
