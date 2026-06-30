# Phase 3 Line-Art Samples

This folder records metadata for line-art embroidery regression cases.

The first sample, `butterfly-line-art-c-00012`, is used to track thin stroke behavior:

- Source image: blue butterfly wing line art.
- Professional reference: Wilcom-style stitched line art.
- Current generated DST: has incorrect stitch choices in thin areas.

Tests in this project should use the metadata and synthetic geometry. They should not depend on absolute local download paths, because those paths only exist on one machine.
