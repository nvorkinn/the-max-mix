/**
 * Avatar & Theming Engine
 * Supports Neon (Global Divas) and Minimalist Studio themes.
 */

// 1. NEON SKIN: Iconic Global Divas
export const GLOBAL_DIVAS = [
  { name: 'Britney Spears', image: '/divas/britney.jpg', title: 'Pop Princess' },
  { name: 'Ariana Grande', image: '/divas/ariana.jpg', title: 'Vocal Diva' },
  { name: 'Christina Aguilera', image: '/divas/christina.jpg', title: 'Voice of a Generation' },
  { name: 'Cher', image: '/divas/cher.jpg', title: 'Goddess of Pop' },
  { name: 'Céline Dion', image: '/divas/celine.jpg', title: 'Queen of Power Ballads' },
  { name: 'Beyoncé', image: '/divas/beyonce.jpg', title: 'Queen Bey' },
  { name: 'Whitney Houston', image: '/divas/whitney.jpg', title: 'The Voice' },
  { name: 'Madonna', image: '/divas/madonna.jpg', title: 'Queen of Pop' },
  { name: 'Mariah Carey', image: '/divas/mariah.png', title: 'Songbird Supreme' }
];

// 2. MINIMALIST SKIN: Clean monochrome studio portraits
/** @type {{ name: string, image: string, title?: string }[]} */
export const MINIMALIST_AVATARS = [
  {
    name: 'Studio A',
    image: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80'
  },
  {
    name: 'Studio B',
    image: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80'
  },
  {
    name: 'Studio C',
    image: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=150&auto=format&fit=crop&q=80'
  },
  {
    name: 'Studio D',
    image: 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=150&auto=format&fit=crop&q=80'
  },
  {
    name: 'Studio E',
    image: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=150&auto=format&fit=crop&q=80'
  }
];

/** @typedef {{ name: string, image: string, title?: string }} Avatar */

/**
 * The roster entry at `index` (wrapping around); the rosters are never empty.
 * @param {Avatar[]} roster
 * @param {number} index
 * @returns {Avatar}
 */
function pick(roster, index) {
  return /** @type {Avatar} */ (roster[index % roster.length]);
}

/**
 * Returns the appropriate avatar based on the selected theme
 * @returns {Avatar}
 * @param {string | null | undefined} userNameOrId
 * @param {number} [fallbackIndex]
 * @param {string} [theme]
 */
export function getDivaForUser(userNameOrId, fallbackIndex = 0, theme = 'neon') {
  /** @type {Avatar[]} */
  let roster = GLOBAL_DIVAS;

  if (theme === 'minimal') {
    roster = MINIMALIST_AVATARS;
  }

  if (!userNameOrId) {
    return pick(roster, fallbackIndex);
  }

  let hash = 0;
  const str = String(userNameOrId);
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }

  const index = Math.abs(hash) % roster.length;
  return pick(roster, index);
}
