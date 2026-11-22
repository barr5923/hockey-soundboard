"""Import reviewed playlist matches as shared categories without altering boards."""
import argparse
import csv
import json
import re
import sqlite3
import time
from contextlib import closing
from pathlib import Path

from scripts.preview_playlist_import import normalize, remove_track_number

PREFIX = 'imported-csv-20261102-'


def read_csv(path):
    with path.open(encoding='utf-8-sig', newline='') as stream:
        reader = csv.DictReader(stream)
        if not reader.fieldnames:
            raise ValueError(f'No CSV header in {path.name}.')
        return list(reader)


def seconds(value, field, line):
    if not re.fullmatch(r'\d+', value or ''):
        raise ValueError(f'Invalid {field} on export row {line}.')
    return int(value)


def import_review(export, review, database, uploads, expected_matches):
    source_rows = read_csv(export)
    review_rows = read_csv(review)
    expected_lines = {i for i, row in enumerate(source_rows, 2) if row['Category'] != 'built-in-sounds'}
    indexed = {}
    for row in review_rows:
        line = int(row['csv_row'])
        if line not in expected_lines or line in indexed:
            raise ValueError('Review contains an unexpected or duplicate row.')
        original = source_rows[line - 2]
        if any(row[key] != original[column] for key, column in (
            ('category', 'Category'), ('song', 'Song Name'), ('start', 'Start Time'), ('stop', 'Stop Time')
        )):
            raise ValueError(f'Review differs from export on row {line}.')
        if row['status'] not in ('matched', 'missing', 'ambiguous'):
            raise ValueError(f'Invalid review status on row {line}.')
        indexed[line] = row
    if set(indexed) != expected_lines:
        raise ValueError('Review does not cover every exported playlist row.')
    matched = [(line, source_rows[line - 2], indexed[line]) for line in sorted(indexed)
               if indexed[line]['status'] == 'matched']
    if len(matched) != expected_matches:
        raise ValueError(f'Expected {expected_matches} matched rows, found {len(matched)}.')
    usernames = {row['Username'].strip() for _, row, _ in matched}
    if len(usernames) != 1 or not next(iter(usernames)):
        raise ValueError('Expected exactly one playlist owner.')

    categories = {}
    with closing(sqlite3.connect(database, timeout=30)) as conn:
        conn.execute('BEGIN IMMEDIATE')
        owner = conn.execute('SELECT id FROM users WHERE username = ? COLLATE NOCASE', (next(iter(usernames)),)).fetchall()
        if len(owner) != 1:
            raise ValueError('Playlist owner was not found uniquely.')
        for line, row, reviewed in matched:
            track_id = reviewed['track_id']
            category = row['Category']
            if not re.fullmatch(r'[a-z0-9-]{1,70}', category) or not re.fullmatch(r'[a-f0-9]{32}', track_id):
                raise ValueError(f'Invalid category or audio ID on row {line}.')
            audio = conn.execute('SELECT file_name, name FROM shared_audio WHERE id = ?', (track_id,)).fetchone()
            if not audio or not re.fullmatch(r'[a-f0-9]{32}\.[a-z0-9]{1,10}', audio[0]) or not (uploads / audio[0]).is_file():
                raise ValueError(f'Uploaded audio not found for row {line}.')
            if normalize(remove_track_number(audio[1])) != normalize(remove_track_number(row['Song Name'])):
                raise ValueError(f'Audio title does not match export row {line}.')
            repeatable = row['Repeatable'].strip().lower()
            if repeatable not in ('true', 'false'):
                raise ValueError(f'Invalid repeatable flag on row {line}.')
            name, description, mood = row['Song Name'].strip(), row['Description'].strip(), row['Mood'].strip()
            if not name or len(name) > 120 or len(description) > 300 or len(mood) > 40:
                raise ValueError(f'Invalid track details on row {line}.')
            track = {
                'name': name, 'description': description, 'mood': mood,
                'startTime': seconds(row['Start Time'], 'start time', line),
                'stopTime': seconds(row['Stop Time'], 'stop time', line),
                'durationSeconds': seconds(row['Duration Seconds'], 'duration', line),
                'audioUrl': '/api/shared-audio/' + track_id,
                'repeatable': repeatable == 'true',
            }
            categories.setdefault(category, []).append(track)
        for key, tracks in categories.items():
            import_key = PREFIX + key
            name = ' '.join(word.capitalize() for word in key.split('-'))
            payload = json.dumps(tracks, ensure_ascii=False)
            existing = conn.execute('SELECT name, tracks FROM shared_categories WHERE owner_id = ? AND key = ?',
                                    (owner[0][0], import_key)).fetchone()
            if existing and (existing[0] != name or json.loads(existing[1]) != tracks):
                raise ValueError(f'An existing shared playlist conflicts with {key}.')
            if not existing:
                conn.execute('INSERT INTO shared_categories (owner_id, key, name, tracks, updated) VALUES (?, ?, ?, ?, ?)',
                             (owner[0][0], import_key, name, payload, time.time()))
        conn.commit()
    print(f'Imported {len(matched)} matched songs in {len(categories)} shared playlists; '
          f'{len(review_rows) - len(matched)} unmatched rows were not imported.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--export', type=Path, required=True)
    parser.add_argument('--review', type=Path, required=True)
    parser.add_argument('--database', type=Path, required=True)
    parser.add_argument('--uploads', type=Path, required=True)
    parser.add_argument('--expected-matches', type=int, required=True)
    args = parser.parse_args()
    import_review(args.export, args.review, args.database, args.uploads, args.expected_matches)
