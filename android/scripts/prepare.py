"""Prepare a private local APK payload. Never print or publish configured credentials."""
import argparse
import hashlib
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--env', type=Path, default=ROOT / '.env')
    args = parser.parse_args()
    env = args.env.resolve()
    if not env.is_file():
        raise SystemExit('A local .env file is required; use --env <path>.')
    web = ROOT / 'tripflow-frontend/tripflow/apps/web/dist'
    if not (web / 'index.html').is_file():
        raise SystemExit('Run npm run build first.')
    target = ROOT / 'android/app/build/generated/tripflow-assets'
    target.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(target / 'payload.zip', 'w', zipfile.ZIP_DEFLATED) as z:
        z.write(env, '.env')
        z.write(ROOT / 'packages/context-engine/geo-policy.json', 'packages/context-engine/geo-policy.json')
        for path in (ROOT / 'apps/api/app').glob('*.py'):
            z.write(path, path.relative_to(ROOT).as_posix())
        for path in web.rglob('*'):
            if path.is_file():
                z.write(path, 'web/' + path.relative_to(web).as_posix())
    local = ROOT / 'android/.local'
    local.mkdir(exist_ok=True)
    props = local / 'signing.properties'
    if not props.exists():
        password = secrets.token_urlsafe(30)
        keytool = shutil.which('keytool') or str(Path(os.environ['JAVA_HOME']) / 'bin/keytool.exe')
        keyenv = dict(os.environ, TRIPFLOW_SIGNING_PASSWORD=password)
        subprocess.run([keytool, '-genkeypair', '-noprompt', '-keystore', str(local / 'tripflow-release.jks'),
                        '-storepass:env', 'TRIPFLOW_SIGNING_PASSWORD', '-keypass:env', 'TRIPFLOW_SIGNING_PASSWORD',
                        '-alias', 'tripflow', '-keyalg', 'RSA', '-keysize', '3072', '-validity', '10000',
                        '-dname', 'CN=TripFlow Personal,O=TripFlow,C=CN'], env=keyenv, check=True, capture_output=True)
        props.write_text(f'storeFile=.local/tripflow-release.jks\nstorePassword={password}\nkeyAlias=tripflow\nkeyPassword={password}\n', encoding='utf-8')
    sdk = os.environ.get('ANDROID_HOME', os.environ.get('ANDROID_SDK_ROOT', 'D:/Android/Sdk'))
    (ROOT / 'android/local.properties').write_text('sdk.dir=' + sdk.replace('\\', '/') + '\n', encoding='utf-8')
    print('Prepared private runtime assets and local signing. No credential values printed.')


if __name__ == '__main__':
    main()
