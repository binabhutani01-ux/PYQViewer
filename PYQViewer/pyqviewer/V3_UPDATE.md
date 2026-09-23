# PYQViewer v3 update

This build is a drop-in update to the existing PYQViewer deployment.

## Deploy

1. Replace the existing `pyqviewer` site files with the contents of this folder.
2. In Supabase SQL Editor, run `sql/v3-ui-and-admin.sql` once.
3. Keep the existing Vercel environment variables and the existing `worksheets` storage bucket.
4. Open `/dev-console.html` and verify the Site Control → Appearance & branding section.

## What is fixed

- iOS/iPadOS PDF selection uses a native label/file-input flow without the old parent click handler that could reopen the picker and lose the selected file.
- The legacy continuously running dot canvas has been removed from the render loop. Motion is now driven by lightweight CSS transitions plus pointer-reactive ambient lighting.
- Subject navigation uses cached worksheet data immediately, a short cross-fade/slide transition, and request tokens so stale results do not repaint a newly selected subject.
- Head and developer accounts can delete sub-subjects. Existing worksheets are preserved and their deleted sub-subject label is cleared.
- The built-in SVG logo is used on the main page, owner console, PDF viewer and crash page. The breathing top-bar dot is removed while the PYQViewer text remains.
- `/viewer.html?id=...` is a dedicated minimal PDF page with Back and Download controls.
- Six local themes are included. They change the accent and reactive ambient layer while leaving the base page background intact. The font stack starts with Apple's San Francisco fonts.
- Credits remain readable across themes and the dedicated viewer/dev/crash pages.
- `/crash.html` is a real dedicated error page rather than the old in-page maintenance cover.
- Owner controls now include theme customisation locking, default-theme control, an all-user theme reset signal, live logo replacement, subject/sub-subject creation/edit/delete, worksheet edit/delete/create, and teacher profile editing.

## Logo

The supplied ZIP did not contain an SVG file; it contained the visible logo artwork as a raster reference. A minimal vector SVG was created from that reference at `logo.svg`. The owner console can replace it at any time with your preferred SVG.
