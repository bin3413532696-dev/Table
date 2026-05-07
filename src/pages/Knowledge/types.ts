export interface KnowledgeNote {
  id: string;
  title: string;
  content: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface KnowledgePresetTag {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
}

export interface KnowledgeSearchHit {
  id: string;
  title: string;
  content: string;
  tags: string[];
  score: number;
  updatedAt: number;
}

export interface KnowledgeMetadata {
  noteCount: number;
  presetTagCount: number;
}