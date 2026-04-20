-- Repair: bilingual_labels table was missing from production despite migration 0003 being recorded.
CREATE TABLE IF NOT EXISTS bilingual_labels (
  code        TEXT PRIMARY KEY,
  label_en    TEXT NOT NULL,
  label_pl    TEXT NOT NULL
);

INSERT OR IGNORE INTO bilingual_labels (code, label_en, label_pl) VALUES
  ('CAT_EDUCATION',     'Education',                                      'Edukacja'),
  ('CAT_MEDICAL',       'Medical',                                        'Opieka medyczna'),
  ('CAT_CLOTHING',      'Clothing',                                       'Odzież'),
  ('CAT_ACTIVITIES',    'Activities & Sport',                             'Zajęcia i sport'),
  ('CAT_TRAVEL',        'Travel',                                         'Podróże'),
  ('CAT_CHILDCARE',     'Childcare',                                      'Opieka nad dzieckiem'),
  ('CAT_MAINTENANCE',   'General Maintenance',                            'Utrzymanie ogólne'),
  ('CAT_OTHER',         'Other',                                          'Inne'),
  ('ERR_NO_CONSENT',    'Expense made without required prior agreement',   'Wydatek bez wymaganej zgody'),
  ('ERR_NO_PROOF',      'Missing or invalid receipt / documentation',      'Brak lub nieprawidłowy dowód zakupu'),
  ('ERR_OUT_OF_SCOPE',  'Covered by standard maintenance agreement',       'Objęte standardowym alimentem'),
  ('ERR_SPLIT_MISMATCH','Incorrect split percentage or calculation',        'Błędny podział procentowy'),
  ('ERR_DUPLICATE',     'Transaction already exists',                      'Transakcja już istnieje');
