INSERT OR IGNORE INTO users (id, email, display_name, role) VALUES ('seed-admin', 'hello@example.com', 'Commons Keeper', 'admin');
INSERT OR IGNORE INTO categories (id, hub, slug, title) VALUES
  ('cat-guides', 'knowledge', 'guides', 'Guides'),
  ('cat-tools', 'software', 'tools', 'Tools'),
  ('cat-docs', 'files', 'docs', 'Documents');
INSERT OR IGNORE INTO knowledge_posts (id, author_id, category_id, title, slug, summary, body_md, status, read_minutes) VALUES
  ('kn_welcome', 'seed-admin', 'cat-guides', 'How this commons works', 'how-this-commons-works', 'Read everything freely; share through a quick human review.', 'Everything here is free. Read without an account. To share, send your piece from the Share page. A moderator checks it for safety and clarity, then it goes public with your name on it.', 'approved', 3);
INSERT OR IGNORE INTO software_items (id, author_id, title, slug, summary, os, license, status) VALUES
  ('sw_reader', 'seed-admin', 'Commons Reader', 'commons-reader', 'A tiny offline reader for saved guides.', 'multi', 'free', 'approved');
INSERT OR IGNORE INTO library_files (id, author_id, title, kind, r2_key, size_bytes, license, status) VALUES
  ('file_starter', 'seed-admin', 'Starter library card (PDF)', 'pdf', 'seed/starter.pdf', 0, 'free', 'approved');
INSERT OR IGNORE INTO services (id, provider_id, title, place, slots, status) VALUES
  ('svc_repair', 'seed-admin', 'Saturday repair table', 'Community hall', 6, 'approved');
INSERT OR IGNORE INTO events (id, host_id, title, place, starts_at, capacity, status) VALUES
  ('ev_cleanup', 'seed-admin', 'Riverside cleanup morning', 'Riverside steps', 1790000000, 30, 'approved');
