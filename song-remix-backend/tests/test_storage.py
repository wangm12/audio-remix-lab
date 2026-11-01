import pytest

from app.utils import storage
from app.utils.storage import (
    InvalidStorageKey,
    delete_key,
    delete_legacy_file,
    delete_prefix,
    legacy_file_path,
    resolve_key,
    song_prefix,
    song_source_key,
    versioned_song_source_key,
    store_file,
    write_key,
)


@pytest.fixture(autouse=True)
def isolated_root(tmp_path, monkeypatch):
    root = tmp_path / "storage"
    monkeypatch.setattr(storage.settings, "STORAGE_PATH", str(root))
    return root


@pytest.mark.parametrize(
    "key",
    ["", ".", "/etc/passwd", "../secret", "users/../../x", "users/./x", "users//x", "users/x/", "a\\b", "a\x00b"],
)
def test_resolve_key_rejects_unsafe_keys(key):
    with pytest.raises(InvalidStorageKey):
        resolve_key(key)


def test_resolve_key_rejects_symlinks_that_leave_the_root(isolated_root, tmp_path):
    outside = tmp_path / "outside"
    outside.mkdir()
    isolated_root.mkdir(parents=True, exist_ok=True)
    (isolated_root / "link").symlink_to(outside, target_is_directory=True)
    with pytest.raises(InvalidStorageKey):
        resolve_key("link/file.txt")


def test_song_keys_follow_the_user_song_layout():
    assert song_prefix("u1", "s1") == "users/u1/songs/s1"
    assert song_source_key("u1", "s1", "flac") == "users/u1/songs/s1/source.flac"
    with pytest.raises(InvalidStorageKey):
        song_source_key("u1", "s1", "exe")


def test_versioned_source_keys_are_unique_and_keep_the_song_prefix():
    first = versioned_song_source_key("u1", "s1", "wav")
    second = versioned_song_source_key("u1", "s1", "wav")
    assert first != second
    assert first.startswith("users/u1/songs/s1/")
    assert first.endswith(".wav")


def test_write_store_and_delete_round_trip(isolated_root, tmp_path):
    path = write_key("users/u/songs/s/notes.json", b"{}")
    assert path == (isolated_root / "users/u/songs/s/notes.json").resolve()
    assert path.read_bytes() == b"{}"

    source = tmp_path / "incoming.bin"
    source.write_bytes(b"audio")
    stored = store_file("users/u/songs/s/source.wav", source)
    assert stored.read_bytes() == b"audio"
    assert not list(stored.parent.glob("*.part"))

    delete_key("users/u/songs/s/notes.json")
    assert not path.exists()
    delete_key("../not-a-key")
    delete_key(None)


def test_delete_prefix_removes_the_whole_song_directory(isolated_root):
    write_key("users/u/songs/s/source.wav", b"x")
    write_key("users/u/songs/s/tasks/t/0.flac", b"y")
    delete_prefix("users/u/songs/s")
    assert not (isolated_root / "users/u/songs/s").exists()
    delete_prefix("users/u/songs/missing")


def test_legacy_paths_are_trusted_only_inside_the_root(tmp_path):
    inside = write_key("outputs/old.mp3", b"legacy")
    outside = tmp_path / "elsewhere.mp3"
    outside.write_bytes(b"keep me")

    assert legacy_file_path(str(inside)) == inside
    assert legacy_file_path(str(outside)) is None
    assert legacy_file_path(None) is None

    delete_legacy_file(str(outside))
    assert outside.exists()
    delete_legacy_file(str(inside))
    assert not inside.exists()


def test_write_key_removes_part_file_when_the_write_fails(isolated_root):
    (isolated_root / "users/u/target").mkdir(parents=True)
    with pytest.raises(OSError):
        write_key("users/u/target", b"data")
    assert not list((isolated_root / "users/u").glob("*.part"))


@pytest.mark.parametrize("failing", ["copyfile", "replace"])
def test_store_file_removes_part_file_when_it_fails(isolated_root, tmp_path, monkeypatch, failing):
    source = tmp_path / "incoming.bin"
    source.write_bytes(b"audio")

    def boom(*args, **kwargs):
        raise OSError("disk full")

    if failing == "copyfile":
        monkeypatch.setattr(storage.shutil, "copyfile", boom)
    else:
        monkeypatch.setattr(storage.os, "replace", boom)
    with pytest.raises(OSError):
        store_file("users/u/songs/s/source.wav", source)
    assert not list((isolated_root / "users/u/songs/s").glob("*.part"))


def test_symlink_loops_are_invalid_keys(isolated_root):
    isolated_root.mkdir(parents=True, exist_ok=True)
    (isolated_root / "a").symlink_to(isolated_root / "b")
    (isolated_root / "b").symlink_to(isolated_root / "a")
    with pytest.raises(InvalidStorageKey):
        resolve_key("a/file.txt")
    assert delete_key("a/file.txt") is None
