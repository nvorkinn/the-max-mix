/**
 * Known female artists / singers catalog for the Jam Settings Lockout Rule
 */

const FEMALE_ARTISTS_CATALOG = [
  'ariana grande',
  'britney spears',
  'christina aguilera',
  'cher',
  'céline dion',
  'celine dion',
  'beyoncé',
  'beyonce',
  'dua lipa',
  'taylor swift',
  'whitney houston',
  'madonna',
  'mariah carey',
  'lady gaga',
  'rihanna',
  'katy perry',
  'adele',
  'billie eilish',
  'olivia rodrigo',
  'sabrina carpenter',
  'sza',
  'chappell roan',
  'charli xcx',
  'lana del rey',
  'miley cyrus',
  'shakira',
  'selena gomez',
  'camila cabello',
  'doja cat',
  'nicki minaj',
  'megan thee stallion',
  'cardi b',
  'lorde',
  'kesha',
  'carly rae jepsen',
  'kylie minogue',
  'janet jackson',
  'tina turner',
  'diana ross',
  'donna summer',
  'stevie nicks',
  'amy winehouse',
  'alanis morissette',
  'norah jones',
  'sia',
  'gwen stefani',
  'avril lavigne',
  'kelly clarkson',
  'paramore',
  'hayley williams',
  'bebe rexha',
  'alessia cara',
  'florence + the machine',
  'florence welch',
  'tate mcrae',
  'rosalía',
  'rosalia',
  'anitta',
  'karol g',
  'ellie goulding',
  'jessie j',
  'rita ora',
  'björk',
  'bjork',
  'shania twain',
  'marina',
  'marina and the diamonds',
  'lizzo',
  'grimes',
  'st. vincent',
  'phoebe bridgers',
  'clairo',
  'kali uchis',
  'faye webster',
  'ashnikko',
  'remi wolf',
  'rebecca black',
  'fletcher',
  'alicia keys',
  'dolly parton'
];

/** @param {string} text */
const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A catalog name only counts as a whole name, so "Asia" does not match "sia" and "Cherry" does not match "cher".
const CATALOG_MATCHERS = FEMALE_ARTISTS_CATALOG.map(
  name => new RegExp(String.raw`(?<![\p{L}\p{N}])${escapeRegExp(name)}(?![\p{L}\p{N}])`, 'u')
);

/**
 * Checks if a track features any known female artists
 * @param {import('../types').Track | null | undefined} track
 */
export function isTrackByFemaleSinger(track) {
  if (!track) return { isFemale: false, artist: null };

  /** @type {string[]} */
  const artistsToCheck = [];

  if (Array.isArray(track.artists)) {
    artistsToCheck.push(...track.artists.map(a => (typeof a === 'string' ? a : a.name || '')));
  } else if (typeof track.artist === 'string') {
    artistsToCheck.push(...track.artist.split(',').map(s => s.trim()));
  }

  const artistsLower = artistsToCheck.map(a => a.toLowerCase().trim());

  for (const artist of artistsLower) {
    for (const matcher of CATALOG_MATCHERS) {
      if (matcher.test(artist)) {
        return { isFemale: true, artist };
      }
    }
  }

  return { isFemale: false, artist: null };
}

/**
 * Checks if any track in the queue features a female singer
 * @param {import('../types').Track[]} [queue]
 */
export function findFemaleSingersInQueue(queue = []) {
  const found = [];

  for (const track of queue) {
    const check = isTrackByFemaleSinger(track);
    if (check.isFemale) {
      found.push({
        trackTitle: track.name || track.title || 'Unknown Title',
        artist: check.artist
      });
    }
  }

  return found;
}
