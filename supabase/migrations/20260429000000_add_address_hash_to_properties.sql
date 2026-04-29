-- Add address_hash for upload deduplication
ALTER TABLE public.properties
ADD COLUMN IF NOT EXISTS address_hash text;

-- Unique per client so two clients can have same address (different ownership/relationship)
CREATE UNIQUE INDEX IF NOT EXISTS properties_client_address_hash_unique
ON public.properties(client_id, address_hash)
WHERE address_hash IS NOT NULL;
