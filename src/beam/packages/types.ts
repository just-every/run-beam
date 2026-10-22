export type PackageStandard = '1.2' | '2004-2' | '2004-3' | '2004-4'

export interface PackageSco {
  /** Organization item identifier, not the resource identifier. */
  id: string
  title: string
  /** Decoded package-relative path, followed by the original query/fragment. */
  launch: string
  prerequisites: string[]
  masteryScore: number | null
  objectives: string[]
  successThreshold?: number | null
  completionThreshold?: number | null
  objectiveIds?: string[]
  primaryObjectiveId?: string
  dataFromLMS?: string
  required?: boolean
}

export interface PackageManifest {
  standard: PackageStandard
  title: string
  objectives: string[]
  scos: PackageSco[]
  sequencing?: { choice: boolean; flow: boolean; forwardOnly: boolean }
}

export interface PackageFile { path: string; bytes: Uint8Array }
