-- Synthetic demo class for local development. Every name and id here is invented.
-- Idempotent: fixed ids + INSERT OR IGNORE, so `npm run db:seed:local` can run any number of times.
-- The route tests load this file too, through the same splitter `wrangler d1 execute` uses.
-- aliases: other names the teacher uses, so the tagger can match "Juni" to Juniper. Two students
-- share the first name Alex on purpose, one in each class: a note that just says "Alex" must
-- become an unresolved mention for the teacher to settle, and the demo needs to show that.
INSERT OR IGNORE INTO classes (id, name, term_start, term_end, created_at) VALUES ('11111111-1111-4111-8111-111111111111', 'Period 3 Humanities', '2026-09-01', '2027-06-15', '2026-09-01T08:00:00.000Z');
INSERT OR IGNORE INTO students (id, class_id, first_name, last_name, created_at) VALUES ('22222222-2222-4222-8222-222222222201', '11111111-1111-4111-8111-111111111111', 'Avery', 'Quill', '2026-09-01T08:00:00.000Z');
INSERT OR IGNORE INTO students (id, class_id, first_name, last_name, created_at) VALUES ('22222222-2222-4222-8222-222222222202', '11111111-1111-4111-8111-111111111111', 'Rowan', 'Pell', '2026-09-01T08:00:00.000Z');
INSERT OR IGNORE INTO students (id, class_id, first_name, last_name, created_at) VALUES ('22222222-2222-4222-8222-222222222203', '11111111-1111-4111-8111-111111111111', 'Sable', 'Thorncroft', '2026-09-01T08:00:00.000Z');
INSERT OR IGNORE INTO students (id, class_id, first_name, last_name, aliases, created_at) VALUES ('22222222-2222-4222-8222-222222222204', '11111111-1111-4111-8111-111111111111', 'Juniper', 'Vale', '["Juni"]', '2026-09-01T08:00:00.000Z');
INSERT OR IGNORE INTO students (id, class_id, first_name, last_name, aliases, created_at) VALUES ('22222222-2222-4222-8222-222222222205', '11111111-1111-4111-8111-111111111111', 'Marlowe', 'Finchley', '["Marlo"]', '2026-09-01T08:00:00.000Z');
INSERT OR IGNORE INTO students (id, class_id, first_name, last_name, aliases, created_at) VALUES ('22222222-2222-4222-8222-222222222206', '11111111-1111-4111-8111-111111111111', 'Ember', 'Castellane', '["Em"]', '2026-09-01T08:00:00.000Z');
INSERT OR IGNORE INTO students (id, class_id, first_name, last_name, created_at) VALUES ('22222222-2222-4222-8222-222222222207', '11111111-1111-4111-8111-111111111111', 'Linden', 'Oakhurst', '2026-09-01T08:00:00.000Z');
INSERT OR IGNORE INTO students (id, class_id, first_name, last_name, created_at) VALUES ('22222222-2222-4222-8222-222222222208', '11111111-1111-4111-8111-111111111111', 'Wren', 'Ashby', '2026-09-01T08:00:00.000Z');
INSERT OR IGNORE INTO students (id, class_id, first_name, last_name, created_at) VALUES ('22222222-2222-4222-8222-222222222209', '11111111-1111-4111-8111-111111111111', 'Alex', 'Marsh', '2026-09-01T08:00:00.000Z');
INSERT OR IGNORE INTO classes (id, name, term_start, term_end, created_at) VALUES ('11111111-1111-4111-8111-111111112222', 'B Block Humanities', '2026-09-01', '2027-06-15', '2026-09-01T08:00:00.000Z');
INSERT OR IGNORE INTO students (id, class_id, first_name, last_name, created_at) VALUES ('22222222-2222-4222-8222-222222222210', '11111111-1111-4111-8111-111111112222', 'Alex', 'Ruiz', '2026-09-01T08:00:00.000Z');
-- Databases seeded before B Block existed had Alex Ruiz in Period 3; move them.
UPDATE students SET class_id = '11111111-1111-4111-8111-111111112222' WHERE id = '22222222-2222-4222-8222-222222222210';
INSERT OR IGNORE INTO students (id, class_id, first_name, last_name, created_at) VALUES ('22222222-2222-4222-8222-222222222211', '11111111-1111-4111-8111-111111112222', 'Nola', 'Fairweather', '2026-09-01T08:00:00.000Z');
INSERT OR IGNORE INTO students (id, class_id, first_name, last_name, created_at) VALUES ('22222222-2222-4222-8222-222222222212', '11111111-1111-4111-8111-111111112222', 'Cassius', 'Vey', '2026-09-01T08:00:00.000Z');
