-- Speed up operator chat-content search.
-- The route also uses a scoped ILIKE fallback for short IDs / mixed-language tokens.
CREATE INDEX "messages_content_fts_simple_idx"
  ON "messages"
  USING GIN (to_tsvector('simple', coalesce("content", '')));
