# Build from Windows with scripts/build-desktop.ps1.
from pathlib import Path

root = Path(SPECPATH)

# pywebview and pythonnet register their own hooks for JS and native runtime files.
a = Analysis(
    [str(root / "desktop.py")],
    pathex=[str(root)],
    datas=[(str(root / "frontend" / "dist"), "frontend/dist"),
           (str(root / "build" / "ffmpeg"), "ffmpeg")],
    excludes=["PyQt5", "PyQt6", "PySide2", "PySide6", "tkinter", "gi", "wx"],
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="Stegloc",
    console=False,
    upx=False,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    name="Stegloc",
    upx=False,
)
