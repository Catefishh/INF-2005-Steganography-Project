# Stegloc desktop application

## User decision

Keep the existing React interface inside a desktop app window. Target Windows first,
using pywebview for the window and PyInstaller for distribution. Tkinter would add
an unnecessary second GUI toolkit. Packaging the server alone would still need a
browser; rewriting in Tkinter would replace the current interface.

## Design

- A small Python entry point starts the existing FastAPI application with Uvicorn
  on a pre-bound loopback socket and an OS-assigned port. It waits for startup,
  opens the pywebview window on the main thread, and always stops the server on
  exit, including window creation failures. Startup waits have a timeout. Limit
  graceful shutdown to two seconds and join the daemon server thread for at most
  five seconds; close the listening socket on exit. Verify closing during active
  worker-thread processing cannot leave the app process running indefinitely.
- Serve the prebuilt `frontend/dist` through the existing `create_app` hook.
  Resolve paths relative to the Python module so both source and frozen layouts
  work independently of the working directory. No Vite or Node runtime is used.
- Desktop mode requires a random per-launch session secret, delivered to the
  window through a bootstrap URL and exchanged for an HttpOnly, SameSite=Strict
  cookie. Guard desktop requests and reject foreign Origin values on writes.
  Leave normal browser development behavior available.
- Use Windows EdgeChromium/WebView2 explicitly. Allow downloads and verify both
  backend attachments and browser-generated key downloads. Keep file inputs,
  drag/drop, previews and all existing workflows. Do not persist keys or passphrases.
- Report startup errors visibly even with no console and provide a useful local
  diagnostic log without request bodies or secrets. Closing the window terminates
  its local backend; unfinished work and unsaved generated outputs are discarded.
- Build a windowed, one-folder `dist/Stegloc/Stegloc.exe` with bundled Python,
  dependencies and frontend assets. This is the initial distributable. WebView2
  is a machine prerequisite; explain it in the README. Python and Node are build
  requirements only. A single-file or installer build is deferred.

## Files and validation

The desktop launcher owns lifecycle and window settings. FastAPI's factory owns
the optional desktop authentication. Existing React components remain intact
apart from wording that assumes a browser or manually started port 8000.
The spec and PowerShell build script own packaging, optional Python dependency
groups own desktop/build dependencies, and the README owns user instructions.

Run lifecycle/authentication regression tests, the complete pytest suite and the
frontend production build. Build the executable and smoke-test startup, asset/API
access, hide/verify, file saving, and shutdown where the environment permits.
Clearly distinguish automated backend evidence from actual desktop UI evidence.
