import type { FeatureToggles, FontSettings } from './types'

export const DEFAULT_FEATURES: FeatureToggles = {
  typography: true,
  expandComments: true,
  expandCollapsedComments: true,
  removeExpandedComments: true,
  styleThreadline: true,
  blockAds: true,
  removeMinHXL: true,
  removeStaticRows: true,
}

export const DEFAULT_ALLOWED_DOMAINS: string[] = []
export const LEGACY_DEFAULT_ALLOWED_DOMAINS = ['www.reddit.com', 'old.reddit.com']

export const DEFAULT_SETTINGS: FontSettings = {
  fontFamily: 'Lexend Deca',
  fontSize: 16,
  fontWeight: 400,
  lineHeight: 1.5,
  letterSpacing: 0,
  features: { ...DEFAULT_FEATURES },
  allowedDomains: [...DEFAULT_ALLOWED_DOMAINS],
}

export const FONTS = [
  'Lexend Deca',
  'Poppins',
  'Outfit',
  'Urbanist',
  'Figtree',
  'Plus Jakarta Sans',
  'DM Sans',
  'Manrope',
  'Rubik',
]

