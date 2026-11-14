# CueFollow

Personal voice-tracking teleprompter. Installable web app for Chrome on Android. No account, no subscription, no server. Scripts stay on your device unless you export them.

## Put it online (one time, about 10 minutes, on a computer)

1. Unzip `cuefollow.zip`.
2. Sign in to GitHub and go to https://github.com/new. Name the repository `cuefollow`, choose **Public**, and create it. (Free GitHub Pages needs a public repository. Only the app code is public. Your scripts never leave your phone.)
3. On the new repository page choose **uploading an existing file**. Select every file in the unzipped folder (there are no subfolders) and commit. This works from a phone browser too.
4. Go to **Settings > Pages**. Under **Build and deployment** set Source to **Deploy from a branch**, branch **main**, folder **/ (root)**. Save.
5. Wait a minute or two. Your app is at `https://YOUR-USERNAME.github.io/cuefollow/`.

## Install on the phone

1. Open that address in Chrome on Android.
2. Chrome menu > **Add to Home screen** > **Install**.
3. Open CueFollow from the home screen. The first time you use Voice mode it asks for the microphone and downloads the voice model (about 40 MB, once). After that it works offline.

## Using it

- **Open file** shows Android's file picker. OneDrive and Google Drive appear there if their apps are installed. It reads .docx, .txt, .md and .rtf. Google Docs need to be saved as .docx first.
- **Save to cloud** opens the Android share sheet. Pick OneDrive or Drive to upload the script as a .txt file.
- **Back up all scripts** exports one .json file. Open that file on another device to restore.
- **Prompt** opens the teleprompter. **Record** opens it over the camera.
- Modes: **Voice** follows your speech and holds when you go off script. **Auto** scrolls at a set words-per-minute. **Manual** is finger scroll.
- Text in [square brackets] is shown as a cue and ignored by voice tracking.
- Double tap a word to move the position there. Drag the text and voice tracking picks up from the reading line.
- Recordings save to the phone's Downloads folder as .mp4 (or .webm on older Chrome).
- Settings: text size, spacing, margins, colors, mirror for teleprompter glass, reading line, countdown, camera, quality.

## Updating

Upload the changed files to the same repository. Edit the `VERSION` line at the top of `sw.js` so phones pick up the change.

## Credits

On-device speech recognition uses Vosk (vosk-browser 0.0.8 and the vosk-model-small-en-us-0.15 model), both Apache 2.0 licensed, by Alpha Cephei and Ciaran O'Reilly.
