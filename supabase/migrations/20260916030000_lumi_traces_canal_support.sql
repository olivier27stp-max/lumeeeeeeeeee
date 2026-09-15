-- Les traces du support (canal 'support', PR #382) étaient refusées par la
-- contrainte CHECK de lumi_traces : journaliserTrace ne lève jamais, donc
-- aucune trace support n'a été écrite en prod. On ajoute le canal.
alter table public.lumi_traces drop constraint if exists lumi_traces_canal_check;
alter table public.lumi_traces
  add constraint lumi_traces_canal_check
  check (canal in ('lumi', 'public', 'agent', 'transcription', 'migration', 'support'));
