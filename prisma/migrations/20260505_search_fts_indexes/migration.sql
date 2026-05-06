create index tasks_search_fts_idx
on tasks
using gin (
  (
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(notes, '')), 'B')
  )
)
where deleted_at is null;

create index finance_records_search_fts_idx
on finance_records
using gin (
  (
    setweight(to_tsvector('simple', coalesce(description, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(category, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(model, '')), 'C')
  )
)
where deleted_at is null;

create index knowledge_entities_search_fts_idx
on knowledge_entities
using gin (
  (
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(summary, '')), 'B')
  )
);

create index knowledge_documents_search_fts_idx
on knowledge_documents
using gin (
  (
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(summary, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(content, '')), 'C')
  )
);
