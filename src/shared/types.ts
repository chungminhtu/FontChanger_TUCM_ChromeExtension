export type FeatureKey =
  | 'typography'
  | 'expandComments'
  | 'expandCollapsedComments'
  | 'removeExpandedComments'
  | 'styleThreadline'
  | 'blockAds'
  | 'removeMinHXL'
  | 'removeStaticRows'

export type FeatureToggles = Record<FeatureKey, boolean>

export interface FontSettings {
  fontFamily: string
  fontSize: number
  fontWeight: number
  lineHeight: number
  letterSpacing: number
  features: FeatureToggles
  allowedDomains: string[]
}

