-- Base de dades D1 «trazo-leads»: contactes de l'estimador d'empelts per fer-ne seguiment.
-- S'aplica amb: npx wrangler d1 execute trazo-leads --remote --file schema.sql
-- Dades mínimes: cap nom ni foto (el patró d'alopècia ja és una dada de salut lleu).
CREATE TABLE IF NOT EXISTS leads (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  creat    TEXT NOT NULL DEFAULT (datetime('now')),
  correu   TEXT NOT NULL,
  idioma   TEXT,
  sexo     TEXT,
  patron   TEXT,
  pelo     TEXT,
  tecnica  TEXT,
  cuando   TEXT,
  uf_min   INTEGER,
  uf_max   INTEGER,
  sessions INTEGER,
  minim    INTEGER,
  maxim    INTEGER,
  estat    TEXT NOT NULL DEFAULT 'nou'
);
CREATE INDEX IF NOT EXISTS idx_leads_creat ON leads (creat);
