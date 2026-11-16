ALTER TABLE "usuarios" ADD COLUMN "google_subject" TEXT;
CREATE UNIQUE INDEX "usuarios_google_subject_key" ON "usuarios"("google_subject");
