status: in-progress
by: claude parallel run
since: 2026-11-25
note: second walkthrough: Enter now calls the typer, but it answers 503 on CMU-1.tiff because the slide has no microns per pixel (SlideWithoutScaleError) and the Typing chip never ends; fix the typer's scale fallback and the chip's failure
