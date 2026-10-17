"""Cross-compile pinned PyO3 extensions using the Android NDK, then assemble Android wheels.

Prerequisites: Python 3.12, Rust stable with aarch64-linux-android target, Android NDK.
The original upstream wheel supplies Python sources, metadata and license files only;
its Windows extension is discarded and replaced by our Android ELF library.
"""
import base64
import csv
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import tarfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / 'output/android-native'
VENDOR = ROOT / 'android/vendor'
PACKAGES = [('pydantic_core', '2.50.1', '_pydantic_core', 'lib_pydantic_core.so'),
            ('rpds_py', '2026.9.1', 'rpds', 'librpds.so')]


def download(url, path, digest=None):
    if not path.exists():
        urllib.request.urlretrieve(url, path)
    if digest and hashlib.sha256(path.read_bytes()).hexdigest() != digest:
        raise RuntimeError(f'Hash mismatch: {path.name}')


def wheel(name, version, module, libname):
    metadata = json.load(urllib.request.urlopen(f'https://pypi.org/pypi/{name}/{version}/json'))
    original = next(x for x in metadata['urls'] if x['filename'].endswith('cp312-cp312-win_amd64.whl'))
    template = WORK / original['filename']
    download(original['url'], template, original['digests']['sha256'])
    target = VENDOR / f'{name}-{version}-cp312-cp312-android_24_arm64_v8a.whl'
    dist = f'{name}-{version}.dist-info'
    with zipfile.ZipFile(template) as source:
        files = {n: source.read(n) for n in source.namelist() if not n.endswith(('.pyd', '/', '/RECORD'))}
    files[f'{dist}/WHEEL'] = b'Wheel-Version: 1.0\nGenerator: TripFlow Android NDK cross-build\nRoot-Is-Purelib: false\nTag: cp312-cp312-android_24_arm64_v8a\n'
    package = 'pydantic_core' if name == 'pydantic_core' else 'rpds'
    files[f'{package}/{module}.cpython-312.so'] = (WORK / 'cargo-target/aarch64-linux-android/release' / libname).read_bytes()
    rows = []
    for path, content in files.items():
        digest = base64.urlsafe_b64encode(hashlib.sha256(content).digest()).decode().rstrip('=')
        rows.append([path, 'sha256=' + digest, str(len(content))])
    rows.append([f'{dist}/RECORD', '', ''])
    record = io.StringIO(newline='')
    csv.writer(record).writerows(rows)
    files[f'{dist}/RECORD'] = record.getvalue().encode()
    with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as output:
        for path, content in files.items():
            output.writestr(path, content)
    print(target.name, hashlib.sha256(target.read_bytes()).hexdigest())


def main():
    WORK.mkdir(parents=True, exist_ok=True)
    VENDOR.mkdir(parents=True, exist_ok=True)
    sdk = Path(os.environ.get('ANDROID_HOME', 'D:/Android/Sdk'))
    ndk = Path(os.environ.get('ANDROID_NDK_HOME', sdk / 'ndk/26.1.10909125'))
    llvm = ndk / 'toolchains/llvm/prebuilt/windows-x86_64/bin'
    target = WORK / 'python-target'
    archive = WORK / 'target-3.12.15-0-arm64-v8a.zip'
    download('https://repo.maven.apache.org/maven2/com/chaquo/python/target/3.12.15-0/' + archive.name, archive)
    if not target.exists():
        with zipfile.ZipFile(archive) as z:
            z.extractall(target)
    config = WORK / 'pyo3-config.txt'
    config.write_text('implementation=CPython\nversion=3.12\nshared=true\nabi3=false\nlib_name=python3.12\n'
                      f'lib_dir={target / "jniLibs/arm64-v8a"}\npointer_width=64\nbuild_flags=\nsuppress_build_script_link_lines=false\n')
    env = dict(os.environ, PYO3_CONFIG_FILE=str(config), CARGO_HOME=str(WORK / 'cargo-home'),
               CARGO_TARGET_DIR=str(WORK / 'cargo-target'), RUSTUP_TOOLCHAIN='stable',
               CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER=str(llvm / 'aarch64-linux-android24-clang.cmd'),
               CC_aarch64_linux_android=str(llvm / 'aarch64-linux-android24-clang.cmd'),
               AR_aarch64_linux_android=str(llvm / 'llvm-ar.exe'))
    for name, version, module, libname in PACKAGES:
        src = WORK / f'{name}-{version}'
        if not src.exists():
            metadata = json.load(urllib.request.urlopen(f'https://pypi.org/pypi/{name}/{version}/json'))
            sdist = next(x for x in metadata['urls'] if x['packagetype'] == 'sdist')
            path = WORK / sdist['filename']
            download(sdist['url'], path, sdist['digests']['sha256'])
            with tarfile.open(path) as t:
                t.extractall(WORK, filter='data')
        subprocess.run(['cargo', 'build', '--release', '--target', 'aarch64-linux-android', '--manifest-path', str(src / 'Cargo.toml')], env=env, check=True)
        wheel(name, version, module, libname)


if __name__ == '__main__':
    main()
