// Spotify sign-in on a phone, through countdown-server (countdown-api's createSpotifySignIn and getSpotifySignIn). The
// kiosk makes a PKCE verifier and keeps it; the server is told only its challenge, and the kiosk shows the settings
// site's page for the sign-in (spotifySignInPage) as a QR code. The phone signs in at Spotify and comes back to the
// settings site, which hands Spotify's code to the kiosk; the kiosk exchanges it itself (spotify/auth.ts).

import {
  createSpotifySignIn,
  getSpotifySignIn,
  spotifySignInPageUrl
} from '../../../vendor/countdown-api/src/countdown_api/client';
import type { Client } from '../../../vendor/countdown-api/src/countdown_api/client';
import { newVerifier, SCOPES } from '../spotify/auth';
import type { PhoneReply } from '../spotify/auth';
import { getClientId } from '../spotify/settings';

/** A sign-in the kiosk has started: the page its QR code opens, and what finishing it takes. */
export interface PhoneSignIn {
  readonly id: string;
  readonly pageUrl: string;
  readonly redirectUri: string;
  readonly verifier: string;
  /** When it lapses, as Date.now() counts. */
  readonly expiresAt: number;
}

/** A new sign-in for a phone to scan, as the settings site's page on `site`; null when the server can't make one. */
export async function startPhoneSignIn(client: Client, site: string, signal: AbortSignal): Promise<PhoneSignIn | null> {
  try {
    const { verifier, challenge } = await newVerifier();
    const { data } = await createSpotifySignIn(
      client,
      { client_id: getClientId(), code_challenge: challenge, scope: SCOPES },
      { signal }
    );
    if (!data) return null;
    return {
      id: data.id,
      pageUrl: spotifySignInPageUrl(site, { id: data.id }).href,
      redirectUri: data.redirect_uri,
      verifier,
      expiresAt: Date.now() + data.expires_in * 1000
    };
  } catch {
    return null;
  }
}

/**
 * Whether the phone is back: `waiting`, Spotify's reply (once), `gone` when the server no longer has the sign-in (it
 * lapsed, or was answered), or null when the server can't be asked now.
 */
export async function phoneSignInReply(
  client: Client,
  signIn: PhoneSignIn,
  signal: AbortSignal
): Promise<'waiting' | 'gone' | PhoneReply | null> {
  try {
    const { data, response } = await getSpotifySignIn(client, { id: signIn.id }, { signal });
    if (response.status === 404) return 'gone';
    if (!data) return null;
    if (data.status === 'waiting') return 'waiting';
    const error = data.status === 'failed' ? (data.error ?? 'failed') : undefined;
    return { code: data.code, error, redirectUri: signIn.redirectUri };
  } catch {
    return null;
  }
}
