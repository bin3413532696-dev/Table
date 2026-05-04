export type JsonLdScalar = string | number | boolean | null;

export type JsonLdContextValue =
  | string
  | {
      '@id': string;
      '@type'?: string;
      '@container'?: string;
    };

export type JsonLdContext = Record<string, JsonLdContextValue>;

export interface OntologyClass {
  id: string;
  label: string;
  description: string;
  parentIds: string[];
}

export interface OntologyRelation {
  id: string;
  label: string;
  description: string;
  domain?: string[];
  range?: string[];
  inverseId?: string;
  transitive?: boolean;
  symmetric?: boolean;
}

export interface KnowledgeRelationEdge {
  predicateId: string;
  targetId: string;
  source?: string;
  confidence?: number;
}

export type KnowledgeAttributeValue =
  | JsonLdScalar
  | JsonLdScalar[]
  | Record<string, JsonLdScalar>;

export interface KnowledgeEntity {
  id: string;
  typeId: string;
  title: string;
  summary: string;
  aliases: string[];
  tags: string[];
  attributes: Record<string, KnowledgeAttributeValue>;
  relations: KnowledgeRelationEdge[];
  source?: string;
  confidence?: number;
  createdAt: number;
  updatedAt: number;
}

export interface KnowledgeDocument {
  id: string;
  title: string;
  summary: string;
  content: string;
  tags: string[];
  entityIds: string[];
  source?: string;
  createdAt: number;
  updatedAt: number;
}

export interface KnowledgeAssertion {
  id: string;
  subjectId: string;
  predicateId: string;
  objectId?: string;
  value?: JsonLdScalar;
  evidenceDocumentIds: string[];
  source?: string;
  confidence?: number;
  createdAt: number;
  updatedAt: number;
}

export interface KnowledgeOntology {
  classes: OntologyClass[];
  relations: OntologyRelation[];
}

export interface KnowledgeDataset {
  context: JsonLdContext;
  ontology: KnowledgeOntology;
  entities: KnowledgeEntity[];
  documents: KnowledgeDocument[];
  assertions: KnowledgeAssertion[];
  updatedAt: number;
}

export interface KnowledgeSearchFilters {
  typeIds?: string[];
  tags?: string[];
  includeDocuments?: boolean;
  limit?: number;
}

export interface KnowledgeSearchHit {
  kind: 'entity' | 'document';
  id: string;
  title: string;
  summary: string;
  score: number;
  typeId?: string;
  tags: string[];
}

export interface KnowledgeOverview {
  classCount: number;
  relationCount: number;
  entityCount: number;
  documentCount: number;
  assertionCount: number;
  lastUpdatedAt: number;
}
