import React, { useState, useEffect } from 'react';
import { trackKeys } from '../utils/trackKeys.js';
import { Search, Flame, Sparkles, Plus, ChevronUp, Music, PartyPopper } from 'lucide-react';

const AVATARS = ['🎧', '💃', '⚡', '🥑', '🚀', '🍾', '🔥', '👑', '🦄', '🕺'];
const REACTIONS = [
  { emoji: '🔥', label: 'Fire' },
  { emoji: '❤️', label: 'Love' },
  { emoji: '💃', label: 'Dance' },
  { emoji: '⚡', label: 'Hype' },
  { emoji: '🍾', label: 'Cheers' },
  { emoji: '🚀', label: 'Drop' },
  { emoji: '🥑', label: 'Vibe' },
  { emoji: '💩', label: 'Skip' }
];

export default function MobileRemoteView({ socket }) {
  const [guestName, setGuestName] = useState(() => localStorage.getItem('guest_name') || 'Guest ' + Math.floor(Math.random() * 900 + 100));
  const [avatar, setAvatar] = useState(() => localStorage.getItem('guest_avatar') || AVATARS[Math.floor(Math.random() * AVATARS.length)]);
  const [guestId] = useState(() => localStorage.getItem('guest_id') || `guest_${Date.now()}_${Math.random().toString(36).substring(7)}`);

  const [activeTab, setActiveTab] = useState('react'); // 'react' | 'queue' | 'search'
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [queue, setQueue] = useState([]);
  // /api/queue currently answers with an object, so don't assume an array before the queue tab renders.
  const queueKeys = Array.isArray(queue) ? trackKeys(queue) : [];
  const [toast, setToast] = useState(null);

  useEffect(() => {
    localStorage.setItem('guest_name', guestName);
    localStorage.setItem('guest_avatar', avatar);
    localStorage.setItem('guest_id', guestId);
  }, [guestName, avatar, guestId]);

  // Initial fetch
  useEffect(() => {
    const controller = new AbortController();
    const ignoreAbort = (error) => { if (error.name !== 'AbortError') console.error(error); };
    fetch('/api/queue', { signal: controller.signal }).then(r => r.json()).then(setQueue).catch(ignoreAbort);
    return () => controller.abort();
  }, []);

  // Socket sync
  useEffect(() => {
    if (!socket) return;

    socket.on('queue:updated', newQueue => {
      setQueue(newQueue);
    });

    return () => {
      socket.off('queue:updated');
    };
  }, [socket]);

  const triggerHaptic = () => {
    if (typeof window !== 'undefined' && window.navigator && window.navigator.vibrate) {
      window.navigator.vibrate(35);
    }
  };

  const handleSendReaction = (emoji) => {
    triggerHaptic();
    if (socket) {
      socket.emit('guest:reaction', {
        emoji,
        guestName,
        guestId
      });
    }
  };

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(`/api/spotify/search?q=${encodeURIComponent(searchQuery)}`);
      const data = await res.json();
      setSearchResults(data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setSearching(false);
    }
  };

  const handleAddTrack = async (track) => {
    triggerHaptic();
    try {
      await fetch('/api/queue/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          track,
          guest: { id: guestId, name: guestName, avatar }
        })
      });
      showToast(`Added "${track.title}" to queue!`);
      setActiveTab('queue');
      setSearchQuery('');
      setSearchResults([]);
    } catch (err) {
      console.error(err);
    }
  };

  const handleUpvote = async (trackId) => {
    triggerHaptic();
    try {
      await fetch('/api/queue/upvote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackId, guestId })
      });
    } catch (err) {
      console.error(err);
    }
  };

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-white flex flex-col justify-between max-w-md mx-auto relative select-none">
      
      {/* Top Bar with Guest Profile */}
      <header className="p-4 bg-neutral-900/80 backdrop-blur-md border-b border-white/10 sticky top-0 z-30">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <span className="text-2xl">{avatar}</span>
            <input
              type="text"
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              className="bg-transparent font-bold text-sm text-white focus:outline-hidden border-b border-transparent focus:border-emerald-400 max-w-[140px]"
              placeholder="Your Name"
            />
          </div>

          <div className="flex space-x-1">
            {AVATARS.slice(0, 5).map((a) => (
              <button
                key={a}
                onClick={() => {
                  triggerHaptic();
                  setAvatar(a);
                }}
                className={`w-7 h-7 rounded-full text-xs flex items-center justify-center transition-all ${
                  avatar === a ? 'bg-emerald-500/30 scale-110 border border-emerald-400' : 'opacity-60'
                }`}
              >
                {a}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Main Body */}
      <main className="flex-1 p-4 pb-24 overflow-y-auto">
        {/* Tab 1: Live Reaction Soundboard */}
        {activeTab === 'react' && (
          <div className="space-y-4">
            <div className="text-center py-2">
              <h2 className="text-xl font-black text-white flex items-center justify-center gap-2">
                <Sparkles className="w-5 h-5 text-emerald-400" />
                Live Reaction Pad
              </h2>
              <p className="text-xs text-neutral-400 mt-0.5">
                Tap to burst emoji animations directly on the tablet screen!
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3.5">
              {REACTIONS.map((r) => (
                <button
                  key={r.label}
                  onClick={() => handleSendReaction(r.emoji)}
                  className="h-28 rounded-3xl bg-linear-to-b from-neutral-800/80 to-neutral-900 border border-white/10 active:scale-95 active:border-emerald-400 transition-all flex flex-col items-center justify-center shadow-lg relative overflow-hidden group"
                >
                  <span className="text-4xl group-active:scale-125 transition-transform">
                    {r.emoji}
                  </span>
                  <span className="text-xs font-bold text-neutral-300 mt-2 uppercase tracking-wider">
                    {r.label}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Tab 2: Shared Jam Queue */}
        {activeTab === 'queue' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <PartyPopper className="w-5 h-5 text-emerald-400" />
                Party Queue ({queue.length})
              </h2>
              <button
                onClick={() => setActiveTab('search')}
                className="px-3 py-1.5 bg-emerald-500 text-black font-bold text-xs rounded-xl flex items-center gap-1 active:scale-95 shadow-md"
              >
                <Plus className="w-4 h-4" /> Add Song
              </button>
            </div>

            {queue.length === 0 ? (
              <div className="text-center py-12 text-neutral-500">
                <Music className="w-10 h-10 mx-auto mb-2 opacity-50" />
                <p className="text-sm font-semibold">Queue is empty!</p>
                <p className="text-xs mt-1">Be the first to add a track.</p>
              </div>
            ) : (
              queue.map((track, idx) => (
                <div
                  key={queueKeys[idx]}
                  className="flex items-center justify-between p-3 rounded-2xl bg-neutral-900/70 border border-white/10"
                >
                  <div className="flex items-center space-x-3">
                    <button
                      onClick={() => handleUpvote(track.id)}
                      className="flex flex-col items-center justify-center w-10 h-10 rounded-xl bg-white/5 active:bg-emerald-500/20 active:scale-90 border border-white/10 text-emerald-400 font-bold"
                    >
                      <ChevronUp className="w-4 h-4 -mb-1" />
                      <span className="text-xs">{track.votes}</span>
                    </button>
                    <img
                      src={track.albumArt}
                      alt={track.title}
                      className="w-12 h-12 rounded-xl object-cover"
                    />
                    <div className="max-w-[150px]">
                      <p className="text-sm font-bold text-white truncate">
                        {track.title}
                      </p>
                      <p className="text-xs text-neutral-400 truncate">
                        {track.artist}
                      </p>
                    </div>
                  </div>

                  <div className="text-right">
                    <span className="text-xs bg-white/5 px-2 py-1 rounded-lg border border-white/5 text-neutral-300">
                      {track.addedBy?.avatar || '🎉'} {track.addedBy?.name || 'Guest'}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Tab 3: Search & Add Songs */}
        {activeTab === 'search' && (
          <div className="space-y-3">
            <form onSubmit={handleSearch} className="flex gap-2">
              <input
                type="text"
                placeholder="Search tracks or artists..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1 bg-neutral-900 border border-white/20 rounded-2xl px-4 py-3 text-sm text-white placeholder-neutral-500 focus:outline-hidden focus:border-emerald-400"
                autoFocus
              />
              <button
                type="submit"
                disabled={searching}
                className="px-5 bg-emerald-500 text-black font-extrabold text-xs rounded-2xl active:scale-95 disabled:opacity-50"
              >
                {searching ? '...' : 'Search'}
              </button>
            </form>

            <div className="space-y-2 pt-2">
              {searchResults.map((track) => (
                <div
                  key={track.id}
                  className="flex items-center justify-between p-2.5 rounded-2xl bg-neutral-900 border border-white/10"
                >
                  <div className="flex items-center space-x-3">
                    <img
                      src={track.albumArt}
                      alt={track.title}
                      className="w-11 h-11 rounded-xl object-cover"
                    />
                    <div className="max-w-[170px]">
                      <p className="text-xs font-bold text-white truncate">
                        {track.title}
                      </p>
                      <p className="text-[11px] text-neutral-400 truncate">
                        {track.artist}
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={() => handleAddTrack(track)}
                    className="px-3.5 py-1.5 bg-emerald-500 text-black font-extrabold text-xs rounded-xl active:scale-90 shadow-md"
                  >
                    + Queue
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Floating Toast Notification */}
      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 bg-emerald-500 text-black px-4 py-2 rounded-2xl font-bold text-xs shadow-2xl animate-fade-in">
          {toast}
        </div>
      )}

      {/* Bottom Sticky Tab Navigation Bar */}
      <nav className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-neutral-900/95 backdrop-blur-xl border-t border-white/10 p-2 flex justify-around z-30">
        <button
          onClick={() => {
            triggerHaptic();
            setActiveTab('react');
          }}
          className={`flex-1 py-2 rounded-xl flex flex-col items-center gap-1 transition-all ${
            activeTab === 'react' ? 'text-emerald-400 font-bold bg-white/5' : 'text-neutral-400'
          }`}
        >
          <Flame className="w-5 h-5" />
          <span className="text-[10px]">Reactions</span>
        </button>

        <button
          onClick={() => {
            triggerHaptic();
            setActiveTab('queue');
          }}
          className={`flex-1 py-2 rounded-xl flex flex-col items-center gap-1 transition-all ${
            activeTab === 'queue' ? 'text-emerald-400 font-bold bg-white/5' : 'text-neutral-400'
          }`}
        >
          <Music className="w-5 h-5" />
          <span className="text-[10px]">Queue</span>
        </button>

        <button
          onClick={() => {
            triggerHaptic();
            setActiveTab('search');
          }}
          className={`flex-1 py-2 rounded-xl flex flex-col items-center gap-1 transition-all ${
            activeTab === 'search' ? 'text-emerald-400 font-bold bg-white/5' : 'text-neutral-400'
          }`}
        >
          <Search className="w-5 h-5" />
          <span className="text-[10px]">Search</span>
        </button>
      </nav>
    </div>
  );
}
