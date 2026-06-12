-- Persist provider-native transcript blocks separately from customer/operator display text.
ALTER TABLE "messages"
  ADD COLUMN "providerContent" JSONB,
  ADD COLUMN "providerMeta" JSONB;
