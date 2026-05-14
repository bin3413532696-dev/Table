export type WritingProjectStatus = 'active' | 'draft';
export type WritingAssetStatus = 'confirmed' | 'candidate' | 'draft';
export type WritingWorkflowType = 'bootstrap_bible' | 'consistency_check' | 'finalize_bible';
export type WritingWorkflowStatus = 'running' | 'waiting_review' | 'completed';
export type WritingStageStatus = 'done' | 'current' | 'todo';
export type WritingConflictSeverity = 'critical' | 'high' | 'medium' | 'low';
export type WritingConflictStatus = 'open' | 'ignored' | 'resolved';
export type WritingCanonSection = 'characters' | 'factions' | 'locations' | 'rules' | 'timeline';
export type WritingHistoryTone = 'neutral' | 'success' | 'warning';

export interface WritingAssetRecord {
  id: string;
  title: string;
  subtitle: string;
  summary: string;
  status: WritingAssetStatus;
  tags?: string[];
  sections: Array<{
    label: string;
    value: string | string[];
  }>;
}

export interface WritingConflictItem {
  id: string;
  title: string;
  category: string;
  severity: WritingConflictSeverity;
  status: WritingConflictStatus;
  summary: string;
  suggestion: string;
  involvedAssets: string[];
}

export interface WritingBibleVersion {
  id: string;
  version: string;
  status: 'published' | 'candidate';
  summary: string;
  pillars: string[];
  excerpt: string[];
}

export interface WritingWorkflowStage {
  id: string;
  label: string;
  detail: string;
  status: WritingStageStatus;
}

export interface WritingReviewPatch {
  id: string;
  title: string;
  target: string;
  summary: string;
}

export interface WritingWorkflowEvent {
  id: string;
  time: string;
  text: string;
  tone: 'info' | 'success' | 'warning';
}

export interface WritingWorkflowDefinition {
  label: string;
  status: WritingWorkflowStatus;
  stage: string;
  focus: string;
  stages: WritingWorkflowStage[];
  reviewQueue: WritingReviewPatch[];
  events: WritingWorkflowEvent[];
}

export interface WritingHistoryItem {
  id: string;
  type: 'workflow' | 'decision' | 'bible' | 'asset';
  title: string;
  summary: string;
  time: string;
  actor: string;
  tone: WritingHistoryTone;
}

export interface WritingProjectSettings {
  forbiddenTerms: string[];
  styleConstraints: string[];
  boundaryRules: string[];
  modelProfile: string;
  workflowNotes: string;
}

export interface WritingStoryCompass {
  promise: string;
  protagonistNeed: string;
  worldPressure: string;
  tone: string;
  intent: string[];
}

export interface WritingProjectMetrics {
  confirmed: number;
  candidates: number;
  openConflicts: number;
  bibleCoverage: number;
}

export interface WritingProject {
  id: string;
  title: string;
  genre: string;
  subGenre: string;
  worldType: string;
  premise: string;
  bibleVersion: string;
  updatedAt: string;
  status: WritingProjectStatus;
  storyCompass: WritingStoryCompass;
  metrics: WritingProjectMetrics;
  assets: Record<WritingCanonSection, WritingAssetRecord[]>;
  bibles: WritingBibleVersion[];
  conflicts: WritingConflictItem[];
  workflows: Record<WritingWorkflowType, WritingWorkflowDefinition>;
  history: WritingHistoryItem[];
  settings: WritingProjectSettings;
}

export interface WritingProjectOutletContext {
  project: WritingProject;
}
