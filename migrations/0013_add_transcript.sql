-- Store voice transcription so it can be displayed in the Mini App
ALTER TABLE source_events ADD COLUMN transcript TEXT;
