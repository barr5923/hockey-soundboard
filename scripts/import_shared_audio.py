"""Prepare and import a verified archive of shared audio without changing boards."""
import argparse
import hashlib
import io
import json
import os
import re
import sqlite3
import tarfile
import time
from pathlib import Path

EXTENSIONS = {'.mp3', '.m4a', '.m4b', '.aac', '.wav', '.wave', '.ogg', '.oga',
              '.opus', '.webm', '.flac', '.aif', '.aiff', '.aifc', '.amr', '.3gp'}


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def prepare(source, archive):
    source = source.resolve(strict=True)
    if not source.is_dir():
        raise ValueError('Source must be a directory.')
    paths = sorted(path for path in source.rglob('*') if path.is_file() and path.suffix.lower() in EXTENSIONS)
    if not paths:
        raise ValueError('No supported audio files found.')
    manifest = []
    with tarfile.open(archive, 'x') as output:
        for path in paths:
            relative = path.relative_to(source)
            track_id = hashlib.sha256(relative.as_posix().encode('utf-8')).hexdigest()[:32]
            file_name = track_id + path.suffix.lower()
            manifest.append({'id': track_id, 'file_name': file_name, 'name': path.stem[:160] or 'Untitled',
                             'category': relative.parts[0][:120] if len(relative.parts) > 1 else '',
                             'sha256': digest(path), 'size': path.stat().st_size})
            output.add(path, arcname=file_name, recursive=False)
        payload = json.dumps(manifest, ensure_ascii=False).encode('utf-8')
        info = tarfile.TarInfo('manifest.json')
        info.size = len(payload)
        output.addfile(info, io.BytesIO(payload))
    print(f'Prepared {len(manifest)} tracks, {sum(row["size"] for row in manifest)} bytes.')


def import_archive(archive, uploads, database):
    uploads.mkdir(parents=True, exist_ok=True)
    with tarfile.open(archive, 'r') as source:
        members = source.getmembers()
        manifests = [member for member in members if member.name == 'manifest.json' and member.isfile()]
        if len(manifests) != 1 or manifests[0].size > 1024 * 1024:
            raise ValueError('Invalid archive manifest.')
        manifest = json.load(source.extractfile(manifests[0]))
        if not isinstance(manifest, list) or not manifest:
            raise ValueError('Empty or invalid manifest.')
        expected = set()
        for row in manifest:
            track_id = row['id']
            file_name = row['file_name']
            if not re.fullmatch(r'[a-f0-9]{32}', track_id) or file_name != track_id + Path(file_name).suffix or Path(file_name).suffix not in EXTENSIONS:
                raise ValueError('Invalid audio identifier.')
            if file_name in expected or not re.fullmatch(r'[a-f0-9]{64}', row['sha256']):
                raise ValueError('Duplicate audio file or invalid digest.')
            expected.add(file_name)
        if len(members) != len(expected) + 1 or {member.name for member in members} != expected | {'manifest.json'}:
            raise ValueError('Archive contents do not match manifest.')
        for row in manifest:
            target = uploads / row['file_name']
            if target.exists():
                if target.stat().st_size != row['size'] or digest(target) != row['sha256']:
                    raise ValueError('Existing audio differs from archive.')
                continue
            member = source.getmember(row['file_name'])
            if not member.isfile() or member.size != row['size']:
                raise ValueError('Invalid audio archive entry.')
            temporary = uploads / (row['file_name'] + '.part')
            hasher = hashlib.sha256()
            try:
                with source.extractfile(member) as input_file, temporary.open('xb') as output:
                    while chunk := input_file.read(1024 * 1024):
                        hasher.update(chunk)
                        output.write(chunk)
                if hasher.hexdigest() != row['sha256']:
                    raise ValueError('Audio checksum mismatch.')
                os.replace(temporary, target)
            except Exception:
                if temporary.exists():
                    temporary.unlink()
                raise
    with sqlite3.connect(database, timeout=30) as conn:
        for row in manifest:
            existing = conn.execute('SELECT file_name, name, category FROM shared_audio WHERE id = ?', (row['id'],)).fetchone()
            wanted = (row['file_name'], row['name'], row['category'])
            if existing and existing != wanted:
                raise ValueError('Existing library entry conflicts with import.')
            if not existing:
                conn.execute('INSERT INTO shared_audio (id, file_name, name, category, created) VALUES (?, ?, ?, ?, ?)',
                             (row['id'], *wanted, time.time()))
    print(f'Verified and imported {len(manifest)} tracks, {sum(row["size"] for row in manifest)} bytes.')


def main():
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest='command', required=True)
    build = commands.add_parser('prepare')
    build.add_argument('--source', type=Path, required=True)
    build.add_argument('--archive', type=Path, required=True)
    run = commands.add_parser('import')
    run.add_argument('--archive', type=Path, required=True)
    run.add_argument('--uploads', type=Path, required=True)
    run.add_argument('--database', type=Path, required=True)
    args = parser.parse_args()
    if args.command == 'prepare':
        prepare(args.source, args.archive)
    else:
        import_archive(args.archive, args.uploads, args.database)


if __name__ == '__main__':
    main()
