# GarageLog 0.7.1

## Document upload preview fix

- Allows same-origin and temporary local `blob:` frames in the Content Security Policy.
- Restores the inline PDF preview shown before a document is uploaded.
- Keeps `object-src` disabled and does not permit third-party frames.
- Does not alter the document upload, storage, OCR, or indexing process.

The blocked preview in 0.7.0 was a display issue caused by the hardened Content Security Policy. Selecting **Save** could still upload the file, but the browser was not permitted to render the temporary PDF preview frame.
