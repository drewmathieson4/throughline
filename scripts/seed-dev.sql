-- Synthetic demo roster for local development: three classes, 7 / 6 / 7 students. Every name
-- and id here is invented. Idempotent: fixed ids + INSERT OR IGNORE, so `npm run db:seed:local`
-- can run any number of times. The route tests load this file too, through the same splitter
-- `wrangler d1 execute` uses.
--
-- Deliberate traps for the tagger, which the demo needs to show:
--   aliases: other names the teacher uses ("Juni" for Juniper), so the tagger can match them.
--   two students share the first name Alex, one in Period 3 and one in B Block: a note that
--     just says "Alex" must become an unresolved mention for the teacher to settle.
--   Rowan Pell (Period 3) and Ronan Pike (B Block) are lookalike names across classes.
-- Class created_at values are staggered by a second so the class list keeps this order.
INSERT OR IGNORE INTO classes (id, name, term_start, term_end, created_at) VALUES ('11111111-1111-4111-8111-111111111111', 'Period 3 Humanities', '2026-09-01', '2027-06-15', '2026-09-01T08:00:00.000Z');
INSERT OR IGNORE INTO students (id, class_id, first_name, last_name, created_at) VALUES ('22222222-2222-4222-8222-222222222201', '11111111-1111-4111-8111-111111111111', 'Avery', 'Quill', '2026-09-01T08:00:00.000Z');
INSERT OR IGNORE INTO students (id, class_id, first_name, last_name, aliases, created_at) VALUES ('22222222-2222-4222-8222-222222222202', '11111111-1111-4111-8111-111111111111', 'Rowan', 'Pell', '["Ro"]', '2026-09-01T08:00:00.000Z');
INSERT OR IGNORE INTO students (id, class_id, first_name, last_name, created_at) VALUES ('22222222-2222-4222-8222-222222222203', '11111111-1111-4111-8111-111111111111', 'Sable', 'Thorncroft', '2026-09-01T08:00:00.000Z');
INSERT OR IGNORE INTO students (id, class_id, first_name, last_name, aliases, created_at) VALUES ('22222222-2222-4222-8222-222222222204', '11111111-1111-4111-8111-111111111111', 'Juniper', 'Vale', '["Juni"]', '2026-09-01T08:00:00.000Z');
INSERT OR IGNORE INTO students (id, class_id, first_name, last_name, aliases, created_at) VALUES ('22222222-2222-4222-8222-222222222205', '11111111-1111-4111-8111-111111111111', 'Marlowe', 'Finchley', '["Marlo"]', '2026-09-01T08:00:00.000Z');
INSERT OR IGNORE INTO students (id, class_id, first_name, last_name, aliases, created_at) VALUES ('22222222-2222-4222-8222-222222222206', '11111111-1111-4111-8111-111111111111', 'Ember', 'Castellane', '["Em"]', '2026-09-01T08:00:00.000Z');
INSERT OR IGNORE INTO students (id, class_id, first_name, last_name, created_at) VALUES ('22222222-2222-4222-8222-222222222209', '11111111-1111-4111-8111-111111111111', 'Alex', 'Marsh', '2026-09-01T08:00:00.000Z');

INSERT OR IGNORE INTO classes (id, name, term_start, term_end, created_at) VALUES ('11111111-1111-4111-8111-111111112222', 'B Block Humanities', '2026-09-01', '2027-06-15', '2026-09-01T08:00:01.000Z');
INSERT OR IGNORE INTO students (id, class_id, first_name, last_name, created_at) VALUES ('22222222-2222-4222-8222-222222222210', '11111111-1111-4111-8111-111111112222', 'Alex', 'Ruiz', '2026-09-01T08:00:00.000Z');
INSERT OR IGNORE INTO students (id, class_id, first_name, last_name, created_at) VALUES ('22222222-2222-4222-8222-222222222211', '11111111-1111-4111-8111-111111112222', 'Nola', 'Fairweather', '2026-09-01T08:00:00.000Z');
INSERT OR IGNORE INTO students (id, class_id, first_name, last_name, created_at) VALUES ('22222222-2222-4222-8222-222222222212', '11111111-1111-4111-8111-111111112222', 'Cassius', 'Vey', '2026-09-01T08:00:00.000Z');
INSERT OR IGNORE INTO students (id, class_id, first_name, last_name, created_at) VALUES ('22222222-2222-4222-8222-222222222213', '11111111-1111-4111-8111-111111112222', 'Ronan', 'Pike', '2026-09-01T08:00:00.000Z');
INSERT OR IGNORE INTO students (id, class_id, first_name, last_name, aliases, created_at) VALUES ('22222222-2222-4222-8222-222222222214', '11111111-1111-4111-8111-111111112222', 'Theo', 'Brightwater', '["Teddy"]', '2026-09-01T08:00:00.000Z');
INSERT OR IGNORE INTO students (id, class_id, first_name, last_name, created_at) VALUES ('22222222-2222-4222-8222-222222222215', '11111111-1111-4111-8111-111111112222', 'Imogen', 'Hale', '2026-09-01T08:00:00.000Z');

INSERT OR IGNORE INTO classes (id, name, term_start, term_end, created_at) VALUES ('11111111-1111-4111-8111-111111113333', 'Period 5 Humanities', '2026-09-01', '2027-06-15', '2026-09-01T08:00:02.000Z');
INSERT OR IGNORE INTO students (id, class_id, first_name, last_name, created_at) VALUES ('22222222-2222-4222-8222-222222222207', '11111111-1111-4111-8111-111111113333', 'Linden', 'Oakhurst', '2026-09-01T08:00:00.000Z');
INSERT OR IGNORE INTO students (id, class_id, first_name, last_name, created_at) VALUES ('22222222-2222-4222-8222-222222222208', '11111111-1111-4111-8111-111111113333', 'Wren', 'Ashby', '2026-09-01T08:00:00.000Z');
INSERT OR IGNORE INTO students (id, class_id, first_name, last_name, created_at) VALUES ('22222222-2222-4222-8222-222222222216', '11111111-1111-4111-8111-111111113333', 'Felix', 'Stroud', '2026-09-01T08:00:00.000Z');
INSERT OR IGNORE INTO students (id, class_id, first_name, last_name, created_at) VALUES ('22222222-2222-4222-8222-222222222217', '11111111-1111-4111-8111-111111113333', 'Hazel', 'Moreno-Vance', '2026-09-01T08:00:00.000Z');
INSERT OR IGNORE INTO students (id, class_id, first_name, last_name, created_at) VALUES ('22222222-2222-4222-8222-222222222218', '11111111-1111-4111-8111-111111113333', 'Kit', 'Abernathy', '2026-09-01T08:00:00.000Z');
INSERT OR IGNORE INTO students (id, class_id, first_name, last_name, aliases, created_at) VALUES ('22222222-2222-4222-8222-222222222219', '11111111-1111-4111-8111-111111113333', 'Beatrix', 'Okonkwo', '["Bea"]', '2026-09-01T08:00:00.000Z');
INSERT OR IGNORE INTO students (id, class_id, first_name, last_name, created_at) VALUES ('22222222-2222-4222-8222-222222222220', '11111111-1111-4111-8111-111111113333', 'Soren', 'Achterberg', '2026-09-01T08:00:00.000Z');
-- Databases seeded before Period 5 existed had Linden and Wren in Period 3; move them.
UPDATE students SET class_id = '11111111-1111-4111-8111-111111113333' WHERE id IN ('22222222-2222-4222-8222-222222222207', '22222222-2222-4222-8222-222222222208');
