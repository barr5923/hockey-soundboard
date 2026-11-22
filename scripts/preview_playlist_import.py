"""Create a reviewable CSV matching exported playlist rows to uploaded audio."""
import argparse
import csv
import hashlib
import re
import unicodedata
from pathlib import Path

from scripts.import_shared_audio import EXTENSIONS


def normalize(value):
    value = unicodedata.normalize('NFKD', value.casefold())
    return ''.join(char for char in value if char.isalnum())


def remove_track_number(value):
    return re.sub(r'^\s*\d{1,3}[\s._-]+', '', value)


def expected_category(folder):
    normalized = normalize(folder)
    if 'powerplay' in normalized:
        return 'power-play'
    if 'clockstops' in normalized:
        return 'clock-stops'
    if 'endofperiod' in normalized:
        return 'end-of-period'
    if 'penaltykill' in normalized:
        return 'man-down-songs'
    if 'warmup' in normalized:
        return 'warmups'
    if 'theirgoal' in normalized:
        return 'their-goal'
    return ''


def candidates(source):
    tracks = []
    for path in sorted(source.rglob('*')):
        if not path.is_file() or path.suffix.lower() not in EXTENSIONS:
            continue
        relative = path.relative_to(source)
        tracks.append({
            'id': hashlib.sha256(relative.as_posix().encode('utf-8')).hexdigest()[:32],
            'file': relative.as_posix(),
            'title': remove_track_number(path.stem),
            'category': expected_category(relative.parts[0]) if len(relative.parts) > 1 else '',
        })
    return tracks


def prepare(export, source, output):
    tracks = candidates(source)
    if not tracks:
        raise ValueError('No audio files found.')
    with export.open(encoding='utf-8-sig', newline='') as input_file:
        reader = csv.DictReader(input_file)
        required = {'Category', 'Song Name', 'Start Time', 'Stop Time'}
        if not required.issubset(reader.fieldnames or []):
            raise ValueError('Playlist export is missing required columns.')
        rows = list(reader)
    fieldnames = ['csv_row', 'category', 'song', 'start', 'stop', 'status', 'track_id',
                  'matched_file', 'candidates', 'spotify_available']
    counts = {'matched': 0, 'ambiguous': 0, 'missing': 0}
    with output.open('x', encoding='utf-8-sig', newline='') as output_file:
        writer = csv.DictWriter(output_file, fieldnames=fieldnames)
        writer.writeheader()
        for line, row in enumerate(rows, start=2):
            if row['Category'] == 'built-in-sounds':
                continue
            matches = [track for track in tracks if normalize(track['title']) == normalize(remove_track_number(row['Song Name']))]
            same_category = [track for track in matches if track['category'] == row['Category']]
            if len(matches) > 1 and len(same_category) == 1:
                matches = same_category
            status = 'matched' if len(matches) == 1 else 'ambiguous' if matches else 'missing'
            counts[status] += 1
            chosen = matches[0] if status == 'matched' else None
            writer.writerow({
                'csv_row': line, 'category': row['Category'], 'song': row['Song Name'],
                'start': row['Start Time'], 'stop': row['Stop Time'], 'status': status,
                'track_id': chosen['id'] if chosen else '',
                'matched_file': chosen['file'] if chosen else '',
                'candidates': ' | '.join(track['file'] for track in matches) if not chosen else '',
                'spotify_available': 'yes' if row.get('Spotify URL') else 'no',
            })
    print(f"Matched {counts['matched']}, ambiguous {counts['ambiguous']}, missing {counts['missing']}.")
    print(f'Review file: {output}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--export', type=Path, required=True)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    prepare(args.export, args.source, args.output)
