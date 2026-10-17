"""Start the original FastAPI app on this phone, without any desktop/server dependency."""
import hashlib
import logging
import os
from pathlib import Path
import sys
import threading
import zipfile

_thread = None
PORT = 18761


def start(context):
    global _thread
    if _thread and _thread.is_alive():
        return PORT
    root = Path(str(context.getFilesDir())) / 'tripflow-runtime'
    root.mkdir(parents=True, exist_ok=True)
    assets = context.getAssets()
    stream = assets.open('payload.zip')
    from java import jarray, jbyte
    buf = jarray(jbyte)(65536)
    payload = root / 'payload.zip'
    with payload.open('wb') as output:
        while True:
            count = stream.read(buf)
            if count < 0:
                break
            output.write(bytes((int(b) & 255 for b in buf[:count])))
    stream.close()
    # Only packaged code/config is replaced; browser IndexedDB remains in WebView storage.
    with zipfile.ZipFile(payload) as archive:
        archive.extractall(root)
    payload.unlink()
    sys.path.insert(0, str(root / 'apps/api'))
    os.environ['TRIPFLOW_WEB_DIST'] = str(root / 'web')
    os.environ['CORS_ORIGINS'] = f'http://127.0.0.1:{PORT}'
    from dotenv import load_dotenv
    load_dotenv(root / '.env', override=True)
    # Keep provider URL query strings and keys out of logcat.
    logging.getLogger('httpx').setLevel(logging.WARNING)
    logging.getLogger('httpcore').setLevel(logging.WARNING)
    import uvicorn
    from app.main import app
    config = uvicorn.Config(app, host='127.0.0.1', port=PORT, loop='asyncio',
                            http='h11', ws='none', lifespan='on',
                            access_log=False, log_level='warning', proxy_headers=False)
    server = uvicorn.Server(config)
    _thread = threading.Thread(target=server.run, name='tripflow-api', daemon=True)
    _thread.start()
    return PORT
