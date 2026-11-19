CREATE TABLE "guia_gamer" (
  "id" INTEGER NOT NULL PRIMARY KEY CHECK ("id" = 1),
  "revision" INTEGER NOT NULL DEFAULT 0,
  "textos" JSONB NOT NULL DEFAULT '[]'
);

INSERT INTO "guia_gamer" ("id") VALUES (1);
