# TripFlow Android

Android app with the existing React UI and original FastAPI backend running **on the phone** through [Chaquopy](https://chaquo.com/chaquopy/doc/current/android.html). The fixed application origin is `http://127.0.0.1:18761`. No desktop server, USB reverse tunnel or hosted backend is needed for normal use. AI, map, search and POI services still require Internet access.

Package: `cn.tripflow.app`; version `1.0.2` (3); ARM64; Android 8.0/API 26 or later. Target/compile SDK 35. The native shell handles keyboard/system insets, Android back, foreground location consent and Chinese Android TTS. Location is requested only when the travel flow asks for it. No background GPS service is added. Native TTS pause/resume replays the current short sentence.

## Food recommendations during a trip

The itinerary's **找美食** entry opens an independent food panel. It starts from the current valid foreground location or an explicitly named itinerary site. Users can change the reference location, cuisine, search radius, maximum walking time and reference per-person budget. Restaurant selection can wait until arrival; generic dining wishes do not require selecting a restaurant before planning.

The product's existing AgentRunner graph divides the work: **A2** retrieves restaurant-category POIs, **A3** queries real walking routes, **A5** filters candidates against radius/walking/budget conditions, **A2** researches public review sources, and **A7** formats grounded source excerpts. This is application behavior, with real job progress events and typed boundaries; it does not require multiple coding assistants or an additional LLM call for every stage.

Cards distinguish straight-line distance from real road travel, show exact branch addresses and provider ratings, and display both origin and restaurant on the map. A line is drawn only when actual route geometry was returned. Review snippets link to their source and retrieval time; wrong-city/other-branch matches are rejected. The app does not invent reviewer identities, review counts, ratings or first-person visits when a platform's full user-review API is unavailable.

## Build a personal APK on Windows

Install Python 3.12, Node 22+, JDK 17, Android SDK 35/build tools. Install the repository's backend dependencies as described in the root README, and create a local `.env` from `.env.example`.

```powershell
.\android\build-android.ps1 -Variant Release
# Optional: -EnvFile 'C:\private\tripflow.env' -GradleHome 'D:\Gradle\TripFlow'
```

The script builds the frontend, prepares the original backend sources plus geographic policy and local ENV in a generated private payload, creates a personal RSA signing key once, and runs Android tests/lint/assembly. The resulting APK is copied into `output/android/`.

`android/.local/` contains the personal signing key and its properties. Preserve that folder privately to update the same installed application later. Never regenerate the signing key to resolve an update mismatch. Use `adb install -r <apk>` to keep WebView IndexedDB trips.

The `.env`, generated runtime payload, signing inputs, APKs, build directories and device evidence are excluded from Git. A personal APK intentionally contains the local configuration; it is a private local deliverable and is not uploaded to a public release or committed to the repository. The app opts out of backup/device transfer.

## Native Python dependencies

`vendor/` includes ARM64 CPython 3.12 wheels for the pinned `pydantic-core` and `rpds-py` versions. They are built from the upstream Rust sources against the Chaquopy CPython target using Android NDK 26.1, preserving upstream Python code, metadata and license files. All other packages are pinned in `requirements-android.txt`.

To rebuild those wheels, install Rust stable, add the `aarch64-linux-android` target, install NDK `26.1.10909125`, then run:

```powershell
rustup target add aarch64-linux-android
.\.venv\Scripts\python.exe android/scripts/build_native.py
```

`ANDROID_HOME` and `ANDROID_NDK_HOME` override local SDK/NDK paths. The script downloads source archives and verifies their PyPI SHA-256 values. It never uses a desktop binary extension in the Android wheel.

## Device checks

```powershell
adb devices -l
adb -s <serial> install -r output/android/TripFlow-1.0.2-personal-release-arm64.apk
adb -s <serial> shell am start -W -n cn.tripflow.app/.MainActivity
adb -s <serial> forward tcp:18761 tcp:18761
.\.venv\Scripts\python.exe android/scripts/verify_phone.py
```

`verify_phone.py` exercises the **phone's** backend with a clearly synthetic travel request and real providers, including food parsing, planning and typed restaurant search. It does not write the browser's trip store. A forward allows the host to inspect the phone service; it does not make the app depend on the host.

For a Debug build only, `device_inspect.py` can read/screenshot its actual WebView after forwarding `tcp:9224` to `localabstract:webview_devtools_remote_<app-pid>`. Release builds disable WebView remote debugging. Screenshots, logs and live reports stay under ignored `output/android/`.
